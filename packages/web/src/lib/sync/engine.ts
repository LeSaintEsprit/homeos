/**
 * Moteur de synchronisation d'UN foyer côté appareil.
 *
 * - État confirmé (réplique IndexedDB) + opérations en attente (outbox persistante).
 * - Vue affichée = état confirmé + opérations en attente rejouées avec la MÊME logique
 *   métier que le serveur (prédiction optimiste, fonctionne hors connexion).
 * - Une opération ne quitte l'outbox que lorsque le serveur l'a confirmée.
 */
import {
  ENTITY_TYPES, MemoryStore, executeOp, newId, type AnyEntity, type EntityCollections, type EntityType, type Household,
  type Member, type Notice, type OpInput, type OpResult, type OpType, type Role,
} from '@homeos/shared';
import { ApiError, get, post } from '../api';
import { Observable } from '../store';
import { openLocal, type LocalDb, type PendingOp, type StoredEntity, type SyncIssue } from './db';

export type SyncStatus = 'loading' | 'synced' | 'pending' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  ready: boolean;
  view: EntityCollections;
  status: SyncStatus;
  pending: number;
  issues: SyncIssue[];
  lastSyncAt: string | null;
  error: string | null;
  /** Rôle courant de l'utilisateur dans ce foyer (donnée synchronisée). */
  role: Role;
}

export interface RunOutcome {
  ok: boolean;
  opId: string;
  result: OpResult;
}

interface PullResponse {
  epoch: string;
  seq: number;
  changes: { t: EntityType; e: AnyEntity }[];
  tombstones: { t: EntityType; id: string }[];
  hasMore: boolean;
  next: number;
}

interface PushResponse {
  results: OpResult[];
  seq: number;
  epoch: string;
  retry: boolean;
}

type Maps = { [K in EntityType]: Map<string, AnyEntity> };

const emptyMaps = (): Maps => Object.fromEntries(ENTITY_TYPES.map((t) => [t, new Map()])) as Maps;
const PROVISIONAL = 2 ** 52;

export type EngineEvent =
  | { kind: 'notice'; notices: Notice[]; opType: string }
  | { kind: 'issue'; issue: SyncIssue }
  | { kind: 'revoked' }
  | { kind: 'epoch' };

export class SyncEngine {
  readonly state: Observable<SyncState>;
  private db!: LocalDb;
  private confirmed: Maps = emptyMaps();
  private outbox: PendingOp[] = [];
  private aliases = new Map<string, string>();
  private lastSeq = 0;
  private epoch: string | null = null;
  private flushing = false;
  private pulling: Promise<void> | null = null;
  private pullAgain = false;
  private es: EventSource | null = null;
  private timers: number[] = [];
  private retryDelay = 2000;
  private retryTimer: number | null = null;
  private networkDown = false;
  private disposed = false;
  private listeners = new Set<(e: EngineEvent) => void>();
  private pullDebounce: number | null = null;

  constructor(
    readonly userId: string,
    readonly householdId: string,
    initialRole: Role,
  ) {
    this.state = new Observable<SyncState>({
      ready: false,
      view: emptyMaps() as unknown as EntityCollections,
      status: 'loading',
      pending: 0,
      issues: [],
      lastSyncAt: null,
      error: null,
      role: initialRole,
    });
  }

  on(fn: (e: EngineEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EngineEvent) {
    for (const l of this.listeners) l(e);
  }

  async init() {
    this.db = await openLocal(this.userId, this.householdId);
    const [entities, outbox, aliasKeys, aliasVals, issues, lastSeq, epoch, lastSyncAt] = await Promise.all([
      this.db.getAll('entities') as Promise<StoredEntity[]>,
      this.db.getAll('outbox') as Promise<PendingOp[]>,
      this.db.getAllKeys('aliases'),
      this.db.getAll('aliases'),
      this.db.getAll('issues') as Promise<SyncIssue[]>,
      this.db.get('meta', 'lastSeq'),
      this.db.get('meta', 'epoch'),
      this.db.get('meta', 'lastSyncAt'),
    ]);
    for (const s of entities) this.confirmed[s.t]?.set(s.id, s.e);
    this.outbox = outbox.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    aliasKeys.forEach((k, i) => this.aliases.set(String(k), String(aliasVals[i])));
    this.lastSeq = Number(lastSeq ?? 0);
    this.epoch = (epoch as string) ?? null;
    this.recompute({ issues: issues.sort((a, b) => (a.at < b.at ? 1 : -1)), lastSyncAt: (lastSyncAt as string) ?? null });
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    this.connect();
    void this.sync();
  }

  // ───────────────────────── Vue ─────────────────────────

  private role(): Role {
    const me = [...this.confirmed.member.values()].find((m) => (m as Member).userId === this.userId) as Member | undefined;
    return me?.role ?? this.state.get().role;
  }

  private timezone(): string {
    const h = this.confirmed.household.get(this.householdId) as Household | undefined;
    return h?.settings.timezone ?? 'Europe/Paris';
  }

  private makeStore(): MemoryStore {
    const conf = this.confirmed;
    return new MemoryStore(
      { get: (t, id) => conf[t].get(id), all: (t) => conf[t].values() },
      () => this.userId,
      PROVISIONAL,
      this.aliases.entries(),
    );
  }

  /** Recalcule la vue : état confirmé + opérations en attente rejouées. */
  private recompute(extra: Partial<SyncState> = {}) {
    const store = this.makeStore();
    const env = { householdId: this.householdId, userId: this.userId, role: this.role(), timezone: this.timezone() };
    for (const op of this.outbox) {
      store.begin();
      const { rollback } = executeOp(store, op as never, { ...env, now: op.clientTime });
      if (rollback) store.rollback();
      else store.commit();
    }
    const { puts, deletes } = store.overlay();
    const view = {} as Maps;
    for (const t of ENTITY_TYPES) {
      const p = puts.get(t)!;
      const hasDel = [...deletes].some((k) => k.startsWith(`${t}\u0000`));
      if (!p.size && !hasDel) {
        view[t] = this.confirmed[t];
        continue;
      }
      const m = new Map(this.confirmed[t]);
      for (const k of deletes) {
        const [tt, id] = k.split('\u0000');
        if (tt === t) m.delete(id);
      }
      for (const [id, e] of p) m.set(id, e);
      view[t] = m;
    }
    this.state.update((s) => ({ ...s, ...extra, ready: true, view: view as unknown as EntityCollections, pending: this.outbox.length, role: this.role(), status: this.computeStatus() }));
  }

  private computeStatus(): SyncStatus {
    if (this.networkDown || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'offline';
    if (this.flushing || this.pulling) return 'syncing';
    if (this.outbox.length) return 'pending';
    if (this.state.get().error) return 'error';
    return 'synced';
  }

  private refreshStatus() {
    this.state.update((s) => ({ ...s, status: this.computeStatus(), pending: this.outbox.length }));
  }

  /** Version confirmée d'une entité (base des détections de conflit). */
  confirmedVersion(type: EntityType, id: string): number {
    return this.confirmed[type].get(this.aliases.get(`${type}\u0000${id}`) ?? id)?.version ?? 0;
  }

  // ───────────────────────── Actions ─────────────────────────

  /**
   * Exécute une action : prédiction locale immédiate (mêmes règles que le serveur),
   * puis enregistrement durable dans l'outbox avant toute autre chose.
   */
  async run<T extends OpType>(type: T, payload: OpInput<T>): Promise<RunOutcome> {
    const op: PendingOp = { opId: newId(), type, payload, clientTime: new Date().toISOString(), shownWarnings: [] };
    // Prédiction sur la vue courante (état confirmé + attente).
    const store = this.makeStore();
    const env = { householdId: this.householdId, userId: this.userId, role: this.role(), timezone: this.timezone() };
    for (const p of this.outbox) {
      store.begin();
      const r = executeOp(store, p as never, { ...env, now: p.clientTime });
      if (r.rollback) store.rollback();
      else store.commit();
    }
    store.begin();
    const { result, rollback } = executeOp(store, op as never, { ...env, now: op.clientTime });
    if (rollback) return { ok: false, opId: op.opId, result };
    op.shownWarnings = result.warnings.map((w) => w.code);
    const seq = await this.db.add('outbox', op);
    op.seq = Number(seq);
    this.outbox.push(op);
    this.recompute();
    void this.flush();
    return { ok: true, opId: op.opId, result };
  }

  // ───────────────────────── Réseau ─────────────────────────

  async sync() {
    await this.flush();
    await this.pull();
  }

  async flush(): Promise<void> {
    if (this.flushing || this.disposed || !this.outbox.length) return;
    this.flushing = true;
    this.refreshStatus();
    try {
      while (this.outbox.length && !this.disposed) {
        const batch = this.outbox.slice(0, 100);
        let res: PushResponse;
        try {
          res = await post<PushResponse>(`/api/households/${this.householdId}/sync/push`, {
            ops: batch.map(({ opId, type, payload, clientTime }) => ({ opId, type, payload, clientTime })),
          });
        } catch (e) {
          if (e instanceof ApiError && e.status === 503) {
            this.scheduleRetry();
            break;
          }
          throw e;
        }
        const done = new Set<string>();
        const tx = this.db.transaction(['outbox', 'issues', 'aliases'], 'readwrite');
        for (const r of res.results) {
          const op = batch.find((b) => b.opId === r.opId);
          if (!op) continue;
          done.add(r.opId);
          void tx.objectStore('outbox').delete(op.seq!);
          for (const a of r.aliases ?? []) {
            this.aliases.set(`${a.type}\u0000${a.from}`, a.to);
            void tx.objectStore('aliases').put(a.to, `${a.type}\u0000${a.from}`);
          }
          if (r.status === 'rejected' || r.status === 'conflict' || r.conflicts.length) {
            const issue: SyncIssue = {
              opId: r.opId,
              type: op.type,
              status: r.status === 'rejected' ? 'rejected' : 'conflict',
              message: r.error?.message ?? (r.conflicts.length ? 'Modification en conflit avec celle d’un autre membre.' : 'Modification refusée.'),
              conflicts: r.conflicts,
              warnings: r.warnings,
              at: new Date().toISOString(),
              payload: op.payload,
            };
            void tx.objectStore('issues').put(issue);
            this.state.update((s) => ({ ...s, issues: [issue, ...s.issues.filter((i) => i.opId !== issue.opId)] }));
            this.emit({ kind: 'issue', issue });
          } else {
            const fresh = r.warnings.filter((w) => !op.shownWarnings.includes(w.code));
            if (fresh.length) this.emit({ kind: 'notice', notices: fresh, opType: op.type });
          }
        }
        await tx.done;
        this.outbox = this.outbox.filter((o) => !done.has(o.opId));
        this.networkDown = false;
        this.retryDelay = 2000;
        if (res.retry) {
          this.scheduleRetry();
          break;
        }
      }
      this.state.update((s) => ({ ...s, error: null }));
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        this.networkDown = true;
        this.scheduleRetry();
      } else if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
        this.handleAccessLost(e.status);
      } else {
        this.state.update((s) => ({ ...s, error: e instanceof Error ? e.message : 'Erreur de synchronisation' }));
        this.scheduleRetry();
      }
    } finally {
      this.flushing = false;
      this.recompute();
    }
    if (!this.networkDown) await this.pull();
  }

  private scheduleRetry() {
    if (this.retryTimer || this.disposed) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.sync();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
  }

  pull(): Promise<void> {
    if (this.pulling) {
      this.pullAgain = true;
      return this.pulling;
    }
    this.pulling = this.doPull().finally(() => {
      this.pulling = null;
      this.refreshStatus();
      if (this.pullAgain) {
        this.pullAgain = false;
        void this.pull();
      }
    });
    this.refreshStatus();
    return this.pulling;
  }

  private async doPull() {
    if (this.disposed) return;
    try {
      for (let guard = 0; guard < 500; guard++) {
        const r = await get<PullResponse>(`/api/households/${this.householdId}/sync/pull?since=${this.lastSeq}&limit=2000`);
        if (this.epoch && r.epoch !== this.epoch) {
          // Restauration côté serveur : resynchronisation complète.
          this.confirmed = emptyMaps();
          this.lastSeq = 0;
          this.epoch = r.epoch;
          await this.db.clear('entities');
          await this.db.put('meta', r.epoch, 'epoch');
          await this.db.put('meta', 0, 'lastSeq');
          this.emit({ kind: 'epoch' });
          continue;
        }
        this.epoch = r.epoch;
        const changed = new Set<EntityType>(r.changes.map((c) => c.t).concat(r.tombstones.map((t) => t.t)));
        for (const t of changed) this.confirmed[t] = new Map(this.confirmed[t]); // copie à l'écriture (rendu React)
        const tx = this.db.transaction(['entities', 'meta'], 'readwrite');
        const store = tx.objectStore('entities');
        for (const c of r.changes) {
          this.confirmed[c.t].set(c.e.id, c.e);
          void store.put({ t: c.t, id: c.e.id, e: c.e });
        }
        for (const tb of r.tombstones) {
          this.confirmed[tb.t].delete(tb.id);
          void store.delete([tb.t, tb.id]);
        }
        this.lastSeq = r.next;
        void tx.objectStore('meta').put(this.lastSeq, 'lastSeq');
        void tx.objectStore('meta').put(r.epoch, 'epoch');
        const at = new Date().toISOString();
        void tx.objectStore('meta').put(at, 'lastSyncAt');
        await tx.done;
        this.networkDown = false;
        this.recompute({ lastSyncAt: at, error: null });
        if (!r.hasMore) break;
      }
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        this.networkDown = true;
        this.refreshStatus();
      } else if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
        this.handleAccessLost(e.status);
      } else {
        this.state.update((s) => ({ ...s, error: e instanceof Error ? e.message : 'Erreur de synchronisation' }));
      }
    }
  }

  private handleAccessLost(status: number) {
    // 404 : foyer supprimé ou membre retiré ; 401 : session expirée.
    this.emit({ kind: 'revoked' });
    this.state.update((s) => ({ ...s, error: status === 401 ? 'Session expirée' : 'Accès au foyer retiré' }));
  }

  private connect() {
    const schedulePull = () => {
      if (this.pullDebounce) window.clearTimeout(this.pullDebounce);
      this.pullDebounce = window.setTimeout(() => void this.pull(), 120);
    };
    if (typeof EventSource !== 'undefined') {
      this.es = new EventSource(`/api/households/${this.householdId}/events`);
      this.es.addEventListener('change', schedulePull);
      this.es.addEventListener('hello', () => {
        this.networkDown = false;
        void this.sync();
      });
      this.es.addEventListener('revoked', () => {
        this.es?.close();
        this.emit({ kind: 'revoked' });
      });
      this.es.onerror = () => {
        if (navigator.onLine === false) {
          this.networkDown = true;
          this.refreshStatus();
        }
      };
    }
    const online = () => {
      this.networkDown = false;
      void this.sync();
    };
    const offline = () => {
      this.networkDown = true;
      this.refreshStatus();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void this.sync();
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    this.timers.push(window.setInterval(() => document.visibilityState === 'visible' && void this.sync(), 60_000));
    this.cleanup = () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }

  private cleanup = () => {};

  async dismissIssue(opId: string) {
    await this.db.delete('issues', opId);
    this.state.update((s) => ({ ...s, issues: s.issues.filter((i) => i.opId !== opId) }));
  }

  /** Avant de changer de foyer : tente d'envoyer les modifications en attente. */
  async drain(timeoutMs = 3000) {
    await Promise.race([this.flush(), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  dispose() {
    this.disposed = true;
    this.es?.close();
    this.cleanup();
    for (const t of this.timers) window.clearInterval(t);
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    if (this.pullDebounce) window.clearTimeout(this.pullDebounce);
    this.db?.close();
  }
}
