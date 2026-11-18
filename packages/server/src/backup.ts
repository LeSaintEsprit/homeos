import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Db } from './db';
import { ENTITY_TYPES, type AnyEntity, type EntityType } from '@homeos/shared';
import { TABLES } from './schema';
import { rowToEntity } from './sqlStore';
import { EXPORT_FORMAT, EXPORT_VERSION, type ExportFile } from './exportImport';

export type BackupReason = 'auto' | 'manual' | 'pre-import' | 'pre-restore' | 'pre-delete';

export interface BackupInfo {
  name: string;
  reason: BackupReason;
  createdAt: string;
  sizeBytes: number;
  sha256: string;
  verified: boolean;
  verifyError: string | null;
  counts: Record<string, number>;
}

const NAME_RE = /^homeos-(auto|manual|pre-import|pre-restore|pre-delete)-(\d{8}T\d{6}Z)(?:-\d+)?\.db$/;
const COUNT_TABLES = ['users', 'households', 'members', 'products', 'lots', 'movements', 'shoppingItems', 'purchases'];

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Vérifie qu'une sauvegarde est réellement exploitable : ouverture en lecture seule,
 * contrôle d'intégrité SQLite, contrôle des clés étrangères, lecture des tables clés.
 */
export function verifyBackupFile(path: string): { ok: boolean; error: string | null; counts: Record<string, number> } {
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') return { ok: false, error: `integrity_check : ${String(integrity)}`, counts: {} };
    const fk = db.pragma('foreign_key_check') as unknown[];
    if (fk.length) return { ok: false, error: `${fk.length} violation(s) de clés étrangères`, counts: {} };
    const counts: Record<string, number> = {};
    for (const t of COUNT_TABLES) counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const seq = db.prepare("SELECT value FROM meta WHERE key = 'seq'").get() as { value: string } | undefined;
    if (!seq) return { ok: false, error: 'Table meta absente', counts };
    return { ok: true, error: null, counts };
  } catch (e) {
    return { ok: false, error: (e as Error).message, counts: {} };
  } finally {
    db?.close();
  }
}

export class BackupManager {
  constructor(
    private db: Db,
    private dir: string,
    private keepDaily = 14,
    private keepMonthly = 12,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  /** Crée une sauvegarde cohérente (API de sauvegarde en ligne de SQLite) puis la vérifie. */
  async create(reason: BackupReason): Promise<BackupInfo> {
    let name = `homeos-${reason}-${stamp()}.db`;
    for (let i = 1; existsSync(join(this.dir, name)); i++) name = `homeos-${reason}-${stamp()}-${i}.db`;
    const path = join(this.dir, name);
    await this.db.raw.backup(path);
    // Fichier autonome : la copie hérite du mode WAL de la base ; on la repasse en
    // journal classique pour qu'elle tienne en UN fichier (sans -wal/-shm à côté).
    const copy = new Database(path);
    copy.pragma('journal_mode = DELETE');
    copy.close();
    const v = verifyBackupFile(path);
    const info: BackupInfo = {
      name,
      reason,
      createdAt: new Date().toISOString(),
      sizeBytes: statSync(path).size,
      sha256: fileSha256(path),
      verified: v.ok,
      verifyError: v.error,
      counts: v.counts,
    };
    writeFileSync(`${path}.json`, JSON.stringify(info, null, 2));
    if (reason === 'auto') this.rotate();
    if (!v.ok) throw new Error(`Sauvegarde ${name} invalide : ${v.error}`);
    return info;
  }

  list(): BackupInfo[] {
    const out: BackupInfo[] = [];
    for (const f of readdirSync(this.dir)) {
      if (!NAME_RE.test(f)) continue;
      const side = join(this.dir, `${f}.json`);
      if (existsSync(side)) {
        try {
          out.push(JSON.parse(readFileSync(side, 'utf8')));
          continue;
        } catch {
          /* fiche illisible : on recalcule ci-dessous */
        }
      }
      const m = NAME_RE.exec(f)!;
      out.push({ name: f, reason: m[1] as BackupReason, createdAt: statSync(join(this.dir, f)).mtime.toISOString(), sizeBytes: statSync(join(this.dir, f)).size, sha256: '', verified: false, verifyError: 'non vérifiée', counts: {} });
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  path(name: string): string {
    if (!NAME_RE.test(name) || basename(name) !== name) throw new Error('Nom de sauvegarde invalide');
    const p = join(this.dir, name);
    if (!existsSync(p)) throw new Error('Sauvegarde introuvable');
    return p;
  }

  lastAutoAt(): string | null {
    return this.list().find((b) => b.reason === 'auto')?.createdAt ?? null;
  }

  /** Rotation : N quotidiennes + 1 par mois sur M mois ; autres sauvegardes conservées 30 jours (20 max). */
  rotate() {
    const all = this.list();
    const keep = new Set<string>();
    const autos = all.filter((b) => b.reason === 'auto');
    const days = new Set<string>();
    for (const b of autos) {
      const d = b.createdAt.slice(0, 10);
      if (days.size < this.keepDaily && !days.has(d)) {
        days.add(d);
        keep.add(b.name);
      }
    }
    const months = new Map<string, BackupInfo>();
    for (const b of autos) months.set(b.createdAt.slice(0, 7), b); // la plus ancienne du mois l'emporte (liste décroissante)
    [...months.keys()].sort().reverse().slice(0, this.keepMonthly).forEach((m) => keep.add(months.get(m)!.name));
    const others = all.filter((b) => b.reason !== 'auto');
    others.filter((b) => Date.now() - Date.parse(b.createdAt) < 30 * 86_400_000).slice(0, 20).forEach((b) => keep.add(b.name));
    for (const b of all) {
      if (keep.has(b.name)) continue;
      for (const f of [b.name, `${b.name}.json`, `${b.name}-wal`, `${b.name}-shm`]) {
        const p = join(this.dir, f);
        if (existsSync(p)) unlinkSync(p);
      }
    }
  }

  /**
   * Restaure une sauvegarde : vérification, sauvegarde préalable de l'état actuel,
   * remplacement du fichier, réouverture, nouvelle « époque » (les appareils se
   * resynchronisent intégralement).
   */
  async restore(name: string): Promise<{ safety: BackupInfo; epoch: string }> {
    const src = this.path(name);
    const v = verifyBackupFile(src);
    if (!v.ok) throw new Error(`Sauvegarde invalide, restauration annulée : ${v.error}`);
    const safety = await this.create('pre-restore');
    const target = this.db.path;
    this.db.close();
    for (const ext of ['-wal', '-shm']) if (existsSync(target + ext)) unlinkSync(target + ext);
    copyFileSync(src, target);
    this.db.reopen();
    const epoch = randomUUID();
    this.db.setMeta('epoch', epoch);
    return { safety, epoch };
  }
}

/**
 * Extrait UN foyer d'un fichier de sauvegarde (lecture seule), au format d'export.
 * Permet de restaurer une famille sans toucher aux autres familles de l'instance.
 */
export function extractHousehold(path: string, householdId: string): ExportFile | null {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const h = db.prepare('SELECT * FROM households WHERE id = ?').get(householdId) as Record<string, unknown> | undefined;
    if (!h) return null;
    const entities: Partial<Record<EntityType, AnyEntity[]>> = {};
    for (const t of ENTITY_TYPES) {
      const def = TABLES[t];
      // Colonnes ajoutées après la sauvegarde : valeurs par défaut.
      const cols = new Set((db.prepare(`PRAGMA table_info(${def.table})`).all() as { name: string }[]).map((c) => c.name));
      if (!cols.size) continue;
      const rows = db.prepare(`SELECT * FROM ${def.table} WHERE householdId = ? ORDER BY version`).all(householdId) as Record<string, unknown>[];
      entities[t] = rows.map((r) => rowToEntity(t, r));
    }
    const photos = (db.prepare('SELECT id, mime, data FROM photos WHERE householdId = ?').all(householdId) as { id: string; mime: string; data: Buffer }[]).map((p) => ({
      id: p.id,
      mime: p.mime,
      data: p.data.toString('base64'),
    }));
    return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), householdId, householdName: String(h.name), entities, photos };
  } finally {
    db.close();
  }
}

/** Sauvegardes vérifiées contenant ce foyer (les plus récentes d'abord). */
export function backupsContaining(manager: BackupManager, householdId: string): BackupInfo[] {
  const out: BackupInfo[] = [];
  for (const b of manager.list()) {
    if (!b.verified) continue;
    let db: Database.Database | null = null;
    try {
      db = new Database(manager.path(b.name), { readonly: true, fileMustExist: true });
      if (db.prepare('SELECT 1 FROM households WHERE id = ?').get(householdId)) out.push(b);
    } catch {
      /* sauvegarde illisible : ignorée */
    } finally {
      db?.close();
    }
  }
  return out;
}

/** Foyers présents dans une sauvegarde (nom, nombre de membres et de produits) — pour l'hébergeur. */
export function householdsInBackup(path: string): { id: string; name: string; members: number; products: number }[] {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare(
        `SELECT h.id, h.name,
                (SELECT COUNT(*) FROM members m WHERE m.householdId = h.id AND m.active = 1) AS members,
                (SELECT COUNT(*) FROM products p WHERE p.householdId = h.id AND p.archived = 0) AS products
           FROM households h ORDER BY h.name`,
      )
      .all() as { id: string; name: string; members: number; products: number }[];
  } finally {
    db.close();
  }
}
