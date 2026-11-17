import {
  MemoryStore, executeOp, newId, DEFAULT_SETTINGS, DEFAULT_CATEGORIES, DEFAULT_LOCATIONS, auditHousehold, emptyCollections,
  ENTITY_TYPES, type Op, type OpType, type OpInput, type OpResult, type Role, type EntityCollections, type AnyEntity,
} from '@homeos/shared';

export const HH = 'hh-test-0001';

export class Harness {
  store: MemoryStore;
  now = '2026-11-02T08:00:00.000Z';
  userId = 'user-alice';
  role: Role = 'admin';
  cat: Record<string, string> = {};
  loc: Record<string, string> = {};
  results: OpResult[] = [];

  constructor() {
    this.store = MemoryStore.standalone(() => this.userId);
    const h = { id: HH, householdId: HH, version: 0, name: 'Famille Test', avatar: null, currency: 'EUR', settings: { ...DEFAULT_SETTINGS }, createdAt: this.now, createdBy: 'user-alice', fv: {} };
    this.store.put('household', h);
    for (const [u, name] of [['user-alice', 'Alice'], ['user-bob', 'Bob'], ['user-zoe', 'Zoé']]) {
      this.store.put('member', { id: `m-${u}`, householdId: HH, version: 0, userId: u, name, email: `${u}@x.fr`, role: u === 'user-zoe' ? 'viewer' : u === 'user-bob' ? 'member' : 'admin', color: '#1F7A64', active: true, joinedAt: this.now, prefs: {} });
    }
    DEFAULT_CATEGORIES.forEach((c, i) => {
      this.cat[c.key] = `cat-${c.key}`;
      this.store.put('category', { id: `cat-${c.key}`, householdId: HH, version: 0, name: c.name, icon: c.icon, color: c.color, sort: i, archived: false });
    });
    DEFAULT_LOCATIONS.forEach((l, i) => {
      this.loc[l.key] = `loc-${l.key}`;
      this.store.put('location', { id: `loc-${l.key}`, householdId: HH, version: 0, name: l.name, icon: l.icon, kind: l.kind, sort: i, archived: false });
    });
  }

  as(userId: string, role: Role = 'admin') {
    this.userId = userId;
    this.role = role;
    return this;
  }

  at(iso: string) {
    this.now = new Date(iso).toISOString();
    return this;
  }

  advance(hours: number) {
    this.now = new Date(Date.parse(this.now) + hours * 3_600_000).toISOString();
    return this;
  }

  exec<T extends OpType>(type: T, payload: OpInput<T>, opId = newId()): OpResult {
    const op: Op = { opId, type, payload: payload as never, clientTime: this.now };
    this.store.begin();
    const { result, rollback } = executeOp(this.store, op, { householdId: HH, userId: this.userId, role: this.role, now: this.now, timezone: 'Europe/Paris' });
    if (rollback) this.store.rollback();
    else this.store.commit();
    this.results.push(result);
    return result;
  }

  ok<T extends OpType>(type: T, payload: OpInput<T>, opId?: string): OpResult {
    const r = this.exec(type, payload, opId);
    if (r.status !== 'applied') throw new Error(`${type} → ${r.status}: ${r.error?.message ?? JSON.stringify(r.conflicts)}`);
    return r;
  }

  product(name: string, unit: OpInput<'product.create'>['unit'], extra: Partial<OpInput<'product.create'>> = {}): string {
    const id = newId();
    this.ok('product.create', { id, name, unit, categoryId: this.cat.epicerie, locationId: this.loc.placard, ...extra });
    return id;
  }

  collections(): EntityCollections {
    const c = emptyCollections();
    for (const t of ENTITY_TYPES) for (const e of this.store.all(t)) (c[t] as Map<string, AnyEntity>).set(e.id, e);
    return c;
  }

  total(productId: string): number {
    return Math.round(this.store.list('lot', { productId }).reduce((s, l) => s + l.quantity, 0) * 1e6) / 1e6;
  }

  lots(productId: string) {
    return this.store.list('lot', { productId }).filter((l) => l.quantity > 0);
  }

  /** Invariants : aucune erreur d'audit (quantités ≥ 0, Σ mouvements = lot, arithmétique des mouvements). */
  assertInvariants() {
    const errors = auditHousehold(this.collections(), this.now).filter((i) => i.severity === 'error');
    if (errors.length) throw new Error(`Invariants violés : ${errors.map((e) => e.message).join(' | ')}`);
  }
}
