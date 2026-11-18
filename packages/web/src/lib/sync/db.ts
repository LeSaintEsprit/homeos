import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import type { AnyEntity, EntityType, Notice, FieldConflict } from '@homeos/shared';

/** Opération en attente de confirmation par le serveur. */
export interface PendingOp {
  seq?: number;
  opId: string;
  type: string;
  payload: unknown;
  clientTime: string;
  /** Avertissements déjà affichés lors de la prédiction locale. */
  shownWarnings: string[];
}

/** Opération refusée ou en conflit, à présenter à l'utilisateur. */
export interface SyncIssue {
  opId: string;
  type: string;
  status: 'rejected' | 'conflict';
  message: string;
  conflicts: FieldConflict[];
  warnings: Notice[];
  at: string;
  payload: unknown;
}

const VERSION = 1;
const registryKey = (uid: string) => `homeos:dbs:${uid}`;
export const dbName = (uid: string, hid: string) => `homeos-${uid}-${hid}`;

export function knownLocalHouseholds(uid: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(registryKey(uid)) ?? '[]');
  } catch {
    return [];
  }
}

function register(uid: string, hid: string) {
  const list = new Set(knownLocalHouseholds(uid));
  list.add(hid);
  localStorage.setItem(registryKey(uid), JSON.stringify([...list]));
}

export async function deleteLocalHousehold(uid: string, hid: string) {
  try {
    await deleteDB(dbName(uid, hid));
  } catch {
    /* base déjà absente */
  }
  localStorage.setItem(registryKey(uid), JSON.stringify(knownLocalHouseholds(uid).filter((h) => h !== hid)));
}

export type LocalDb = IDBPDatabase;

/** Base IndexedDB d'UN foyer pour UN utilisateur : aucune donnée partagée entre foyers. */
export async function openLocal(uid: string, hid: string): Promise<LocalDb> {
  register(uid, hid);
  const db: LocalDb = await openDB(dbName(uid, hid), VERSION, {
    // Une suppression (déconnexion, foyer quitté) ou une mise à niveau la réclame : on libère la base.
    blocking() {
      db.close();
    },
    upgrade(db) {
      db.createObjectStore('entities', { keyPath: ['t', 'id'] });
      db.createObjectStore('meta');
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('aliases');
      db.createObjectStore('issues', { keyPath: 'opId' });
    },
  });
  return db;
}

export interface StoredEntity {
  t: EntityType;
  id: string;
  e: AnyEntity;
}
