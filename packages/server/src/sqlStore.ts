import type { AnyEntity, DataStore, EntityMap, EntityType } from '@homeos/shared';
import { ENTITY_TYPES } from '@homeos/shared';
import type { Db } from './db';
import { TABLES, type ColKind } from './schema';

type Row = Record<string, unknown>;

export function rowToEntity(type: EntityType, row: Row): AnyEntity {
  const def = TABLES[type];
  const out: Row = { id: row.id, householdId: row.householdId, version: row.version };
  for (const [c, k] of Object.entries(def.cols)) {
    const v = row[c];
    if (v == null) out[c] = k === 'json' ? defaultJson(type, c) : null;
    else if (k === 'bool') out[c] = v === 1 || v === true;
    else if (k === 'json') out[c] = JSON.parse(v as string);
    else out[c] = v;
  }
  return out as unknown as AnyEntity;
}

function defaultJson(type: EntityType, col: string): unknown {
  if (col === 'fv' || col === 'prefs' || col === 'settings') return {};
  return [];
}

export function entityToRow(type: EntityType, e: AnyEntity): Row {
  const def = TABLES[type];
  const src = e as unknown as Row;
  const row: Row = { id: src.id, householdId: src.householdId, version: src.version };
  for (const [c, k] of Object.entries(def.cols)) row[c] = toSql(src[c], k);
  return row;
}

function toSql(v: unknown, k: ColKind): unknown {
  if (v === undefined || v === null) return k === 'json' ? null : null;
  if (k === 'bool') return v ? 1 : 0;
  if (k === 'json') return JSON.stringify(v);
  return v;
}

/**
 * Implémentation SQLite du magasin de données d'UN foyer, à utiliser à l'intérieur
 * d'une transaction. Toutes les lectures sont filtrées par householdId.
 */
export class SqlStore implements DataStore {
  constructor(
    private db: Db,
    public readonly householdId: string,
    private userId: string,
  ) {}

  get<K extends EntityType>(type: K, id: string): EntityMap[K] | undefined {
    const t = TABLES[type].table;
    const row = this.db.prep(`SELECT * FROM ${t} WHERE id = ? AND householdId = ?`).get(id, this.householdId) as Row | undefined;
    return row ? (rowToEntity(type, row) as EntityMap[K]) : undefined;
  }

  list<K extends EntityType>(type: K, where?: Partial<Record<keyof EntityMap[K], unknown>>): EntityMap[K][] {
    const def = TABLES[type];
    const clauses = ['householdId = ?'];
    const params: unknown[] = [this.householdId];
    for (const [k, v] of Object.entries(where ?? {})) {
      if (k !== 'id' && !(k in def.cols)) throw new Error(`Colonne inconnue ${def.table}.${k}`);
      if (v === null || v === undefined) clauses.push(`${k} IS NULL`);
      else {
        clauses.push(`${k} = ?`);
        params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
      }
    }
    const rows = this.db.prep(`SELECT * FROM ${def.table} WHERE ${clauses.join(' AND ')} ORDER BY version`).all(...params) as Row[];
    return rows.map((r) => rowToEntity(type, r) as EntityMap[K]);
  }

  put<K extends EntityType>(type: K, entity: EntityMap[K], touched?: string[]): EntityMap[K] {
    if (entity.householdId !== this.householdId) throw new Error('Écriture hors du foyer courant refusée.');
    const version = this.db.nextSeq();
    const e = { ...entity, version } as EntityMap[K] & { fv?: Record<string, [number, string]> };
    if (touched?.length && 'fv' in e) {
      const fv = { ...(e.fv ?? {}) };
      for (const f of touched) fv[f] = [version, this.userId];
      e.fv = fv;
    }
    const def = TABLES[type];
    const row = entityToRow(type, e);
    const cols = Object.keys(row);
    const sql =
      `INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) ` +
      `ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')} ` +
      `WHERE ${def.table}.householdId = excluded.householdId`;
    const info = this.db.prep(sql).run(...cols.map((c) => row[c]));
    if (info.changes !== 1) throw new Error(`Identifiant déjà utilisé par un autre foyer (${type}).`);
    this.db.prep('DELETE FROM tombstones WHERE householdId = ? AND type = ? AND id = ?').run(this.householdId, type, e.id);
    return e;
  }

  remove(type: EntityType, id: string): void {
    const def = TABLES[type];
    const info = this.db.prep(`DELETE FROM ${def.table} WHERE id = ? AND householdId = ?`).run(id, this.householdId);
    if (info.changes) {
      const v = this.db.nextSeq();
      this.db
        .prep('INSERT INTO tombstones(householdId, type, id, version) VALUES (?, ?, ?, ?) ON CONFLICT(householdId, type, id) DO UPDATE SET version = excluded.version')
        .run(this.householdId, type, id, v);
    }
  }

  resolveAlias(type: EntityType, id: string): string {
    let cur = id;
    for (let i = 0; i < 10; i++) {
      const r = this.db.prep('SELECT toId FROM id_aliases WHERE householdId = ? AND type = ? AND fromId = ?').get(this.householdId, type, cur) as { toId: string } | undefined;
      if (!r) return cur;
      cur = r.toId;
    }
    return cur;
  }

  addAlias(type: EntityType, fromId: string, toId: string): void {
    this.db
      .prep('INSERT INTO id_aliases(householdId, type, fromId, toId) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET toId = excluded.toId')
      .run(this.householdId, type, fromId, toId);
  }
}

export interface PullChange {
  t: EntityType;
  e: AnyEntity;
}

export interface PullResult {
  epoch: string;
  seq: number;
  changes: PullChange[];
  tombstones: { t: EntityType; id: string; v: number }[];
  hasMore: boolean;
  next: number;
}

/** Changements d'un foyer depuis une version (paginé, ordonné par version). */
export function pullChanges(db: Db, householdId: string, since: number, limit: number): PullResult {
  const seq = db.currentSeq();
  type Item = { v: number; change?: PullChange; tomb?: { t: EntityType; id: string; v: number } };
  const items: Item[] = [];
  for (const t of ENTITY_TYPES) {
    const rows = db.prep(`SELECT * FROM ${TABLES[t].table} WHERE householdId = ? AND version > ? ORDER BY version LIMIT ?`).all(householdId, since, limit + 1) as Row[];
    for (const r of rows) items.push({ v: r.version as number, change: { t, e: rowToEntity(t, r) } });
  }
  const tombs = db.prep('SELECT type, id, version FROM tombstones WHERE householdId = ? AND version > ? ORDER BY version LIMIT ?').all(householdId, since, limit + 1) as {
    type: EntityType;
    id: string;
    version: number;
  }[];
  for (const r of tombs) items.push({ v: r.version, tomb: { t: r.type, id: r.id, v: r.version } });
  items.sort((a, b) => a.v - b.v);
  const page = items.slice(0, limit);
  const hasMore = items.length > limit;
  return {
    epoch: db.epoch(),
    seq,
    changes: page.filter((i) => i.change).map((i) => i.change!),
    tombstones: page.filter((i) => i.tomb).map((i) => i.tomb!),
    hasMore,
    next: hasMore ? page[page.length - 1].v : seq,
  };
}

/** Charge toutes les entités d'un foyer (moteur côté serveur, export). */
export function loadHousehold(db: Db, householdId: string): Map<EntityType, AnyEntity[]> {
  const out = new Map<EntityType, AnyEntity[]>();
  for (const t of ENTITY_TYPES) {
    const rows = db.prep(`SELECT * FROM ${TABLES[t].table} WHERE householdId = ? ORDER BY version`).all(householdId) as Row[];
    out.set(t, rows.map((r) => rowToEntity(t, r)));
  }
  return out;
}
