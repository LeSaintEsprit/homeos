import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyCollections, type AnyEntity, type EntityCollections, type EntityType, type OpResult } from '@homeos/shared';
import { buildApp, type App } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { MemoryMailer, NullMailer } from '../src/mail';
import type { FetchLike } from '../src/barcode';

process.env.NODE_ENV = 'test';

export interface TestServer extends App {
  dir: string;
  mailer: MemoryMailer;
  pushes: { endpoint: string; payload: { title: string; body: string } }[];
  close(): Promise<void>;
}

export function makeServer(over: Partial<Config> = {}, deps: { fetchImpl?: FetchLike; noMail?: boolean } = {}): TestServer {
  const dir = mkdtempSync(join(tmpdir(), 'homeos-test-'));
  const mailer = new MemoryMailer();
  const pushes: TestServer['pushes'] = [];
  const built = buildApp({
    config: loadConfig({}, { dataDir: dir, dbPath: join(dir, 'homeos.db'), backupDir: join(dir, 'backups'), schedulers: false, offEnabled: false, registration: 'open', ...over }),
    mailer: deps.noMail ? new NullMailer() : mailer,
    fetchImpl: deps.fetchImpl,
    pushSender: async (sub, payload) => {
      pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    },
  });
  return { ...built, dir, mailer, pushes, close: () => built.app.close() };
}

let ipCounter = 1;

export interface Res {
  status: number;
  json: any;
  headers: Record<string, unknown>;
  body: string;
}

export interface PendingOp {
  opId: string;
  type: string;
  payload: unknown;
  clientTime: string;
}

/** Un appareil : cookie de session, adresse IP propre, file d'opérations (outbox). */
export class Client {
  cookie = '';
  ip = `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
  outbox: PendingOp[] = [];
  userId = '';
  email = '';

  constructor(public s: TestServer) {}

  async req(method: string, url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const res = await this.s.app.inject({
      method: method as 'GET',
      url,
      payload: payload as object,
      remoteAddress: this.ip,
      headers: { ...(method === 'GET' ? {} : { 'x-homeos': '1' }), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    const set = res.headers['set-cookie'];
    if (set) {
      const c = String([set].flat()[0]).split(';')[0];
      this.cookie = c.endsWith('=') ? '' : c;
    }
    let json: unknown = null;
    try {
      json = res.json();
    } catch {
      /* non JSON */
    }
    return { status: res.statusCode, json, headers: res.headers, body: res.body };
  }

  async register(email: string, name: string, inviteCode?: string): Promise<Res> {
    const r = await this.req('POST', '/api/auth/register', { email, password: 'motdepasse-solide', name, inviteCode });
    if (r.status === 200) {
      this.userId = r.json.user.id;
      this.email = email;
    }
    return r;
  }

  async login(email: string, password = 'motdepasse-solide'): Promise<Res> {
    const r = await this.req('POST', '/api/auth/login', { email, password });
    if (r.status === 200) {
      this.userId = r.json.user.id;
      this.email = email;
    }
    return r;
  }

  async createHousehold(name: string, extra: Record<string, unknown> = {}): Promise<string> {
    const r = await this.req('POST', '/api/households', { name, ...extra });
    if (r.status !== 200) throw new Error(`createHousehold ${r.status} ${r.body}`);
    return r.json.id;
  }

  async invite(hid: string, opts: Record<string, unknown> = {}): Promise<string> {
    const r = await this.req('POST', `/api/households/${hid}/invitations`, opts);
    if (r.status !== 200) throw new Error(`invite ${r.status} ${r.body}`);
    return r.json.invitation.code;
  }

  /** Prépare une opération dans l'outbox (comme un appareil, éventuellement hors ligne). */
  queue(type: string, payload: unknown, clientTime = new Date().toISOString()): string {
    const opId = randomUUID();
    this.outbox.push({ opId, type, payload, clientTime });
    return opId;
  }

  /** Envoie l'outbox ; ne retire que les opérations confirmées par le serveur. */
  async flush(hid: string): Promise<OpResult[]> {
    if (!this.outbox.length) return [];
    const r = await this.req('POST', `/api/households/${hid}/sync/push`, { ops: this.outbox });
    if (r.status !== 200) throw new Error(`push ${r.status} ${r.body}`);
    const results: OpResult[] = r.json.results;
    const done = new Set(results.map((x) => x.opId));
    this.outbox = this.outbox.filter((o) => !done.has(o.opId));
    return results;
  }

  /** Envoie une opération immédiatement et renvoie son résultat. */
  async op(hid: string, type: string, payload: unknown): Promise<OpResult> {
    this.queue(type, payload);
    const [r] = await this.flush(hid);
    return r;
  }

  async ok(hid: string, type: string, payload: unknown): Promise<OpResult> {
    const r = await this.op(hid, type, payload);
    if (r.status !== 'applied') throw new Error(`${type} → ${r.status} ${r.error?.message ?? JSON.stringify(r.conflicts)}`);
    return r;
  }

  /** État complet du foyer tel que vu par cet utilisateur (pull paginé). */
  async state(hid: string, limit = 2000): Promise<EntityCollections> {
    const c = emptyCollections();
    let since = 0;
    for (let i = 0; i < 1000; i++) {
      const r = await this.req('GET', `/api/households/${hid}/sync/pull?since=${since}&limit=${limit}`);
      if (r.status !== 200) throw new Error(`pull ${r.status} ${r.body}`);
      for (const ch of r.json.changes as { t: EntityType; e: AnyEntity }[]) (c[ch.t] as Map<string, AnyEntity>).set(ch.e.id, ch.e);
      for (const t of r.json.tombstones as { t: EntityType; id: string }[]) c[t.t].delete(t.id);
      since = r.json.next;
      if (!r.json.hasMore) break;
    }
    return c;
  }
}

export function total(c: EntityCollections, productId: string): number {
  return Math.round([...c.lot.values()].filter((l) => l.productId === productId).reduce((s, l) => s + l.quantity, 0) * 1e6) / 1e6;
}

export function now(): string {
  return new Date().toISOString();
}

export { randomUUID as id };
