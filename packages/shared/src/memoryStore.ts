import type { DataStore } from './commands/context';
import type { AnyEntity, EntityMap, EntityType } from './types';
import { ENTITY_TYPES } from './types';

type Tables = Map<EntityType, Map<string, AnyEntity>>;

/**
 * Magasin en mémoire à couches : une base (état confirmé) et une surcouche
 * d'écritures. Utilisé pour la prédiction optimiste côté client et pour les tests.
 * `begin/commit/rollback` permettent d'annuler les écritures d'une opération rejetée.
 */
export class MemoryStore implements DataStore {
  private layers: Tables[] = [];
  private deleted: Set<string>[] = [];
  private aliasMap = new Map<string, string>();
  private versionCounter: number;

  constructor(
    private base: { get(type: EntityType, id: string): AnyEntity | undefined; all(type: EntityType): Iterable<AnyEntity> },
    private userId: () => string,
    startVersion = 0,
    aliases: Iterable<[string, string]> = [],
  ) {
    this.versionCounter = startVersion;
    for (const [k, v] of aliases) this.aliasMap.set(k, v);
    this.pushLayer();
  }

  /** Magasin autonome (tests) à partir de collections vides. */
  static standalone(userId: () => string): MemoryStore {
    const tables: Tables = new Map(ENTITY_TYPES.map((t) => [t, new Map()]));
    return new MemoryStore(
      { get: (t, id) => tables.get(t)!.get(id), all: (t) => tables.get(t)!.values() },
      userId,
      0,
    );
  }

  private pushLayer() {
    this.layers.push(new Map(ENTITY_TYPES.map((t) => [t, new Map()])));
    this.deleted.push(new Set());
  }

  begin() {
    this.pushLayer();
  }

  commit() {
    if (this.layers.length < 2) throw new Error('Aucune transaction en cours');
    const top = this.layers.pop()!;
    const del = this.deleted.pop()!;
    const target = this.layers[this.layers.length - 1];
    const targetDel = this.deleted[this.deleted.length - 1];
    for (const k of del) {
      const [t, id] = k.split('\u0000') as [EntityType, string];
      target.get(t)!.delete(id);
      targetDel.add(k);
    }
    for (const [t, m] of top) {
      for (const [id, e] of m) {
        target.get(t)!.set(id, e);
        targetDel.delete(`${t}\u0000${id}`);
      }
    }
  }

  rollback() {
    if (this.layers.length < 2) throw new Error('Aucune transaction en cours');
    this.layers.pop();
    this.deleted.pop();
  }

  get<K extends EntityType>(type: K, id: string): EntityMap[K] | undefined {
    const key = `${type}\u0000${id}`;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const e = this.layers[i].get(type)!.get(id);
      if (e) return e as EntityMap[K];
      if (this.deleted[i].has(key)) return undefined;
    }
    return this.base.get(type, id) as EntityMap[K] | undefined;
  }

  all<K extends EntityType>(type: K): EntityMap[K][] {
    const out = new Map<string, AnyEntity>();
    for (const e of this.base.all(type)) out.set(e.id, e);
    for (let i = 0; i < this.layers.length; i++) {
      for (const k of this.deleted[i]) {
        const [t, id] = k.split('\u0000');
        if (t === type) out.delete(id);
      }
      for (const [id, e] of this.layers[i].get(type)!) out.set(id, e);
    }
    return [...out.values()] as EntityMap[K][];
  }

  list<K extends EntityType>(type: K, where?: Partial<Record<keyof EntityMap[K], unknown>>): EntityMap[K][] {
    const all = this.all(type);
    if (!where) return all;
    const entries = Object.entries(where);
    return all.filter((e) => entries.every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v));
  }

  put<K extends EntityType>(type: K, entity: EntityMap[K], touched?: string[]): EntityMap[K] {
    this.versionCounter += 1;
    const v = this.versionCounter;
    const e = { ...entity, version: v } as EntityMap[K] & { fv?: Record<string, [number, string]> };
    if (touched?.length && 'fv' in e) {
      const fv = { ...(e.fv ?? {}) };
      for (const f of touched) fv[f] = [v, this.userId()];
      e.fv = fv;
    }
    const top = this.layers.length - 1;
    this.layers[top].get(type)!.set(e.id, e);
    this.deleted[top].delete(`${type}\u0000${e.id}`);
    return e;
  }

  remove(type: EntityType, id: string): void {
    const top = this.layers.length - 1;
    this.layers[top].get(type)!.delete(id);
    this.deleted[top].add(`${type}\u0000${id}`);
  }

  resolveAlias(type: EntityType, id: string): string {
    let cur = id;
    for (let i = 0; i < 10; i++) {
      const next = this.aliasMap.get(`${type}\u0000${cur}`);
      if (!next) return cur;
      cur = next;
    }
    return cur;
  }

  addAlias(type: EntityType, fromId: string, toId: string): void {
    this.aliasMap.set(`${type}\u0000${fromId}`, toId);
  }

  aliases(): [string, string][] {
    return [...this.aliasMap.entries()];
  }

  /** Écritures de la couche de travail (au-dessus de la base). */
  overlay(): { puts: Map<EntityType, Map<string, AnyEntity>>; deletes: Set<string> } {
    const puts = new Map<EntityType, Map<string, AnyEntity>>(ENTITY_TYPES.map((t) => [t, new Map()]));
    const deletes = new Set<string>();
    for (let i = 0; i < this.layers.length; i++) {
      for (const k of this.deleted[i]) {
        deletes.add(k);
        const [t, id] = k.split('\u0000') as [EntityType, string];
        puts.get(t)!.delete(id);
      }
      for (const [t, m] of this.layers[i]) for (const [id, e] of m) {
        puts.get(t)!.set(id, e);
        deletes.delete(`${t}\u0000${id}`);
      }
    }
    return { puts, deletes };
  }
}
