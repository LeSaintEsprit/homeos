import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ENTITY_TYPES } from '@homeos/shared';
import { SERVER_DDL, entityTableDDL } from './schema';

export type SqliteDb = Database.Database;

export const SCHEMA_VERSION = 1;

/**
 * Poignée vers la base. La connexion peut être remplacée (restauration d'une
 * sauvegarde) sans que le reste de l'application ne garde une référence périmée.
 */
export class Db {
  private _db: SqliteDb;
  private stmts = new Map<string, Database.Statement>();

  constructor(public readonly path: string) {
    this._db = Db.openFile(path);
    this.migrate();
  }

  static openFile(path: string): SqliteDb {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return db;
  }

  get raw(): SqliteDb {
    return this._db;
  }

  /** Requête préparée mise en cache. */
  prep(sql: string): Database.Statement {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this._db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  tx<T>(fn: () => T): T {
    return this._db.transaction(fn).immediate();
  }

  migrate() {
    const db = this._db;
    db.exec('BEGIN');
    try {
      for (const sql of SERVER_DDL.slice(0, 1)) db.exec(sql);
      // La table des foyers doit exister avant les tables qui la référencent.
      for (const t of ENTITY_TYPES) for (const sql of entityTableDDL(t)) db.exec(sql);
      for (const sql of SERVER_DDL.slice(1)) db.exec(sql);
      const get = db.prepare('SELECT value FROM meta WHERE key = ?');
      const set = db.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)');
      set.run('seq', '0');
      set.run('epoch', randomUUID());
      set.run('schemaVersion', String(SCHEMA_VERSION));
      const v = Number((get.get('schemaVersion') as { value: string }).value);
      if (v > SCHEMA_VERSION) throw new Error(`Base de données plus récente que le serveur (schéma ${v}).`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  meta(key: string): string | null {
    const r = this.prep('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }

  setMeta(key: string, value: string) {
    this.prep('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /** Numéro de séquence global suivant (dans la transaction en cours). */
  nextSeq(): number {
    const r = this.prep("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'seq' RETURNING value").get() as { value: number | string };
    return Number(r.value);
  }

  currentSeq(): number {
    return Number(this.meta('seq') ?? 0);
  }

  epoch(): string {
    return this.meta('epoch')!;
  }

  close() {
    this.stmts.clear();
    if (this._db.open) this._db.close();
  }

  /** Remplace la connexion (après restauration du fichier). */
  reopen() {
    this.close();
    this._db = Db.openFile(this.path);
    this.migrate();
  }
}
