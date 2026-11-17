import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { existsSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Household, Role } from '@homeos/shared';
import { Db } from './db';
import type { Config } from './config';
import { RateLimiter, SESSION_COOKIE, SESSION_DAYS, createSession, getSessionUser, hashPassword, verifyPassword, type SessionUser } from './auth';
import {
  HttpError, acceptInvitation, changeRole, createHousehold, createInvitation, findInvitation, membership, removeMember, requireMember, userHouseholds,
  type InvitationRow,
} from './households';
import { Bus, pushOps } from './sync';
import { pullChanges, rowToEntity } from './sqlStore';
import { BackupManager } from './backup';
import { exportCsv, exportHousehold, importHousehold, integrityReport } from './exportImport';
import { BarcodeService, type FetchLike } from './barcode';
import { PushService, type PushSender } from './push';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export interface AppDeps {
  config: Config;
  fetchImpl?: FetchLike;
  pushSender?: PushSender;
}

export interface App {
  app: FastifyInstance;
  db: Db;
  bus: Bus;
  backups: BackupManager;
  push: PushService;
  barcodes: BarcodeService;
}

const emailSchema = z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(160);
const passwordSchema = z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères').max(200);
const nameSchema = z.string().trim().min(1, 'Nom obligatoire').max(60);

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'invalid', r.error.issues[0]?.message ?? 'Données invalides');
  return r.data;
}

export function buildApp(deps: AppDeps): App {
  const { config } = deps;
  const db = new Db(config.dbPath);
  const bus = new Bus();
  const backups = new BackupManager(db, config.backupDir, config.backupKeepDaily, config.backupKeepMonthly);
  const push = new PushService(db, config, deps.pushSender);
  const barcodes = new BarcodeService(db, config, deps.fetchImpl);
  const loginIp = new RateLimiter(30, 15 * 60_000);
  const loginEmail = new RateLimiter(10, 15 * 60_000);
  const registerIp = new RateLimiter(10, 60 * 60_000);
  const inviteIp = new RateLimiter(30, 15 * 60_000);

  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: config.trustProxy,
    bodyLimit: 6 * 1024 * 1024,
  });
  app.register(cookie);
  app.decorateRequest('user', null);

  // ── Sécurité : anti-CSRF, en-têtes, authentification.
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers['x-homeos'] !== '1') throw new HttpError(403, 'csrf', 'Requête refusée (en-tête de sécurité manquant).');
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'csrf', 'Origine de la requête refusée.');
    }
    req.user = getSessionUser(db, req.cookies?.[SESSION_COOKIE]);
  });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' data: blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.url.startsWith('/api/') && !reply.getHeader('cache-control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: { code: 'bad_request', message: status === 413 ? 'Fichier trop volumineux.' : 'Requête invalide.' } });
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: 'Erreur interne du serveur. Aucune donnée partielle n’a été enregistrée.' } });
  });

  const auth = (req: FastifyRequest): SessionUser => {
    if (!req.user) throw new HttpError(401, 'unauthenticated', 'Veuillez vous connecter.');
    return req.user;
  };
  const admin = (req: FastifyRequest): SessionUser => {
    const u = auth(req);
    if (!u.isServerAdmin) throw new HttpError(403, 'forbidden', "Réservé à l'administrateur du serveur.");
    return u;
  };
  const setSessionCookie = (req: FastifyRequest, reply: FastifyReply, token: string) => {
    const secure = config.cookieSecure === 'auto' ? req.protocol === 'https' : config.cookieSecure;
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_DAYS * 86400 });
  };
  const householdOf = (hid: string) => {
    const row = db.prep('SELECT * FROM households WHERE id = ?').get(hid) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'not_found', 'Foyer introuvable.');
    return rowToEntity('household', row) as Household;
  };
  const me = (u: SessionUser) => ({
    user: { id: u.id, email: u.email, name: u.name, isServerAdmin: u.isServerAdmin },
    households: userHouseholds(db, u.id),
  });

  // ── Santé.
  app.get('/api/health', async () => ({ ok: true, epoch: db.epoch(), seq: db.currentSeq(), time: new Date().toISOString() }));

  // ── Authentification.
  app.get('/api/auth/config', async () => {
    const users = (db.prep('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    return { firstRun: users === 0, registration: config.registration };
  });

  app.post('/api/auth/register', async (req, reply) => {
    if (!registerIp.hit(req.ip)) throw new HttpError(429, 'rate_limited', 'Trop de tentatives. Réessayez plus tard.');
    const body = parse(z.object({ email: emailSchema, password: passwordSchema, name: nameSchema, inviteCode: z.string().max(20).optional() }), req.body);
    const users = (db.prep('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    let invitation: InvitationRow | null = null;
    if (body.inviteCode) {
      invitation = findInvitation(db, body.inviteCode);
      if (!invitation) throw new HttpError(400, 'invalid_invitation', "Code d'invitation invalide, expiré ou déjà utilisé.");
    }
    if (users > 0 && config.registration === 'closed') throw new HttpError(403, 'registration_closed', 'Les inscriptions sont fermées sur ce serveur.');
    if (users > 0 && config.registration === 'invite' && !invitation) {
      throw new HttpError(403, 'invite_required', "L'inscription nécessite un code d'invitation d'un foyer existant.");
    }
    if (db.prep('SELECT 1 FROM users WHERE email = ?').get(body.email)) throw new HttpError(409, 'email_taken', 'Un compte existe déjà avec cette adresse.');
    const id = randomUUID();
    const hash = await hashPassword(body.password);
    db.prep('INSERT INTO users(id, email, name, passwordHash, isServerAdmin, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(id, body.email, body.name, hash, users === 0 ? 1 : 0, new Date().toISOString());
    const user = { id, email: body.email, name: body.name };
    let joined: string | null = null;
    if (invitation) joined = acceptInvitation(db, invitation.code, user);
    const { token } = createSession(db, id, req.headers['user-agent']);
    setSessionCookie(req, reply, token);
    return { ...me({ ...user, isServerAdmin: users === 0, tokenHash: '' }), joinedHouseholdId: joined };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(z.object({ email: emailSchema, password: z.string().max(200) }), req.body);
    if (!loginIp.hit(req.ip) || !loginEmail.hit(body.email)) throw new HttpError(429, 'rate_limited', 'Trop de tentatives de connexion. Réessayez dans quelques minutes.');
    const row = db.prep('SELECT id, email, name, passwordHash, isServerAdmin FROM users WHERE email = ?').get(body.email) as
      | { id: string; email: string; name: string; passwordHash: string; isServerAdmin: number }
      | undefined;
    // Vérification systématique (même sans compte) pour ne pas révéler l'existence d'une adresse.
    const ok = await verifyPassword(body.password, row?.passwordHash ?? 'scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA==:AAAA');
    if (!row || !ok) throw new HttpError(401, 'bad_credentials', 'Adresse e-mail ou mot de passe incorrect.');
    loginEmail.reset(body.email);
    const { token } = createSession(db, row.id, req.headers['user-agent']);
    setSessionCookie(req, reply, token);
    return me({ id: row.id, email: row.email, name: row.name, isServerAdmin: !!row.isServerAdmin, tokenHash: '' });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.user) db.prep('DELETE FROM sessions WHERE tokenHash = ?').run(req.user.tokenHash);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => me(auth(req)));

  app.post('/api/auth/password', async (req) => {
    const u = auth(req);
    const body = parse(z.object({ current: z.string().max(200), next: passwordSchema }), req.body);
    const row = db.prep('SELECT passwordHash FROM users WHERE id = ?').get(u.id) as { passwordHash: string };
    if (!(await verifyPassword(body.current, row.passwordHash))) throw new HttpError(400, 'bad_credentials', 'Mot de passe actuel incorrect.');
    db.prep('UPDATE users SET passwordHash = ? WHERE id = ?').run(await hashPassword(body.next), u.id);
    // Déconnecte les autres appareils.
    db.prep('DELETE FROM sessions WHERE userId = ? AND tokenHash <> ?').run(u.id, u.tokenHash);
    return { ok: true };
  });

  app.patch('/api/auth/profile', async (req) => {
    const u = auth(req);
    const body = parse(z.object({ name: nameSchema }), req.body);
    db.prep('UPDATE users SET name = ? WHERE id = ?').run(body.name, u.id);
    return { ok: true };
  });

  // ── Foyers et membres.
  app.post('/api/households', async (req) => {
    const u = auth(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(80), timezone: z.string().max(64).optional() }), req.body);
    const id = createHousehold(db, u, body.name, body.timezone);
    bus.changed(id, db.currentSeq());
    return { id, ...me(u) };
  });

  app.delete('/api/households/:hid', async (req) => {
    const u = auth(req);
    const { hid } = req.params as { hid: string };
    requireMember(db, hid, u.id, 'owner');
    const body = parse(z.object({ confirmName: z.string() }), req.body);
    const h = householdOf(hid);
    if (body.confirmName.trim() !== h.name) throw new HttpError(400, 'confirm', 'Le nom saisi ne correspond pas au nom du foyer.');
    await backups.create('pre-delete');
    db.tx(() => db.prep('DELETE FROM households WHERE id = ?').run(hid));
    return { ok: true };
  });

  app.get('/api/households/:hid/invitations', async (req) => {
    const u = auth(req);
    const { hid } = req.params as { hid: string };
    requireMember(db, hid, u.id, 'admin');
    const rows = db.prep('SELECT * FROM invitations WHERE householdId = ? AND revokedAt IS NULL AND expiresAt > ? AND uses < maxUses ORDER BY createdAt DESC').all(hid, new Date().toISOString());
    return { invitations: rows };
  });

  app.post('/api/households/:hid/invitations', async (req) => {
    const u = auth(req);
    const { hid } = req.params as { hid: string };
    requireMember(db, hid, u.id, 'admin');
    const body = parse(z.object({ role: z.enum(['admin', 'member', 'viewer']).default('member'), days: z.number().int().min(1).max(30).default(7), maxUses: z.number().int().min(1).max(20).default(1) }), req.body ?? {});
    return { invitation: createInvitation(db, hid, u.id, body.role as Role, body.days, body.maxUses) };
  });

  app.delete('/api/households/:hid/invitations/:id', async (req) => {
    const u = auth(req);
    const { hid, id } = req.params as { hid: string; id: string };
    requireMember(db, hid, u.id, 'admin');
    db.prep('UPDATE invitations SET revokedAt = ? WHERE id = ? AND householdId = ?').run(new Date().toISOString(), id, hid);
    return { ok: true };
  });

  app.get('/api/invitations/:code', async (req) => {
    if (!inviteIp.hit(req.ip)) throw new HttpError(429, 'rate_limited', 'Trop de tentatives.');
    const inv = findInvitation(db, (req.params as { code: string }).code);
    if (!inv) throw new HttpError(404, 'invalid_invitation', "Code d'invitation invalide, expiré ou déjà utilisé.");
    const h = householdOf(inv.householdId);
    const inviter = db.prep('SELECT name FROM users WHERE id = ?').get(inv.createdBy) as { name: string } | undefined;
    return { householdName: h.name, inviterName: inviter?.name ?? null, role: inv.role, expiresAt: inv.expiresAt };
  });

  app.post('/api/invitations/:code/accept', async (req) => {
    const u = auth(req);
    if (!inviteIp.hit(req.ip)) throw new HttpError(429, 'rate_limited', 'Trop de tentatives.');
    const hid = acceptInvitation(db, (req.params as { code: string }).code, u);
    bus.changed(hid, db.currentSeq());
    return { householdId: hid, ...me(u) };
  });

  app.patch('/api/households/:hid/members/:userId', async (req) => {
    const u = auth(req);
    const { hid, userId } = req.params as { hid: string; userId: string };
    const actor = requireMember(db, hid, u.id, 'admin');
    const body = parse(z.object({ role: z.enum(['owner', 'admin', 'member', 'viewer']) }), req.body);
    changeRole(db, hid, actor, userId, body.role as Role);
    bus.changed(hid, db.currentSeq());
    return { ok: true };
  });

  app.delete('/api/households/:hid/members/:userId', async (req) => {
    const u = auth(req);
    const { hid, userId } = req.params as { hid: string; userId: string };
    const actor = requireMember(db, hid, u.id, 'viewer');
    removeMember(db, hid, actor, userId);
    bus.changed(hid, db.currentSeq());
    return { ok: true };
  });

  // ── Synchronisation.
  app.get('/api/households/:hid/sync/pull', async (req) => {
    const u = auth(req);
    const { hid } = req.params as { hid: string };
    requireMember(db, hid, u.id);
    const q = req.query as { since?: string; limit?: string };
    const since = Math.max(0, Number(q.since ?? 0) || 0);
    const limit = Math.min(Math.max(Number(q.limit ?? 2000) || 2000, 1), 5000);
    return pullChanges(db, hid, since, limit);
  });

  app.post('/api/households/:hid/sync/push', async (req, reply) => {
    const u = auth(req);
    const { hid } = req.params as { hid: string };
    const m = requireMember(db, hid, u.id);
    const body = parse(z.object({ ops: z.array(z.unknown()).max(200) }), req.body);
    const h = householdOf(hid);
    const out = pushOps(db, body.ops, { householdId: hid, userId: u.id, role: m.role, timezone: h.settings.timezone }, (e) => req.log.error(e));
    if (out.applied) bus.changed(hid, db.currentSeq());
    if (out.important.length) push.notifyImportant(hid, out.important).catch((e) => req.log.warn(e));
    if (out.interrupted) reply.status(503);
    return { results: out.results, seq: db.currentSeq(), epoch: db.epoch(), retry: out.interrupted };
  });

  app.get('/api/households/:hid/events', async (req, reply) => {
    const u = auth(req);
    const { hid } = req.params as { hid: string };
    requireMember(db, hid, u.id);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('hello', { seq: db.currentSeq(), epoch: db.epoch() });
    const onChange = (seq: number) => {
      // Vérifie que l'utilisateur est toujours membre (retrait en cours de session).
      if (!membership(db, hid, u.id)) {
        send('revoked', {});
        res.end();
        return;
      }
      send('change', { seq, epoch: db.epoch() });
    };
    bus.on(`hh:${hid}`, onChange);
    const hb = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(hb);
      bus.off(`hh:${hid}`, onChange);
    });
  });

  // ── Données : export, import, intégrité.
  app.get('/api/households/:hid/export', async (req, reply) => {
    const u = auth(req);
    const { hid } = req.params as { hid: string };
    requireMember(db, hid, u.id, 'member');
    const withPhotos = (req.query as { photos?: string }).photos !== '0';
    const file = exportHousehold(db, hid, withPhotos);
    reply.header('Content-Disposition', `attachment; filename="homeos-${new Date().toISOString().slice(0, 10)}.json"`);
    return file;
  });

  app.get('/api/households/:hid/export/:kind', async (req, reply) => {
    const u = auth(req);
    const { hid, kind } = req.params as { hid: string; kind: string };
    requireMember(db, hid, u.id, 'member');
    const k = kind.replace(/\.csv$/, '');
    if (!['inventaire', 'achats', 'mouvements'].includes(k)) throw new HttpError(404, 'not_found', 'Export inconnu.');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="homeos-${k}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return exportCsv(db, hid, k as 'inventaire');
  });

  app.post('/api/households/import', { bodyLimit: 60 * 1024 * 1024 }, async (req) => {
    const u = auth(req);
    await backups.create('pre-import');
    const report = importHousehold(db, req.body, u);
    return { ...report, ...me(u) };
  });

  app.get('/api/households/:hid/integrity', async (req) => {
    const u = auth(req);
    const { hid } = req.params as { hid: string };
    requireMember(db, hid, u.id);
    const issues = integrityReport(db, hid);
    return { ok: !issues.some((i) => i.severity === 'error'), issues, checkedAt: new Date().toISOString() };
  });

  // ── Photos.
  app.post('/api/households/:hid/photos', { bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const u = auth(req);
    const { hid } = req.params as { hid: string };
    requireMember(db, hid, u.id, 'member');
    const body = parse(z.object({ dataUrl: z.string().max(1_500_000) }), req.body);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl);
    if (!m) throw new HttpError(400, 'invalid', 'Image invalide (JPEG, PNG ou WebP attendus).');
    const data = Buffer.from(m[2], 'base64');
    if (data.length > 600_000) throw new HttpError(413, 'too_large', 'Image trop volumineuse.');
    const id = randomUUID();
    db.prep('INSERT INTO photos(id, householdId, mime, data, createdAt) VALUES (?, ?, ?, ?, ?)').run(id, hid, m[1], data, new Date().toISOString());
    return { id };
  });

  app.get('/api/households/:hid/photos/:id', async (req, reply) => {
    const u = auth(req);
    const { hid, id } = req.params as { hid: string; id: string };
    requireMember(db, hid, u.id);
    let img: { data: Buffer; mime: string } | null = null;
    if (id.startsWith('bc-')) img = barcodes.image(id.slice(3));
    else {
      const r = db.prep('SELECT data, mime FROM photos WHERE id = ? AND householdId = ?').get(id, hid) as { data: Buffer; mime: string } | undefined;
      img = r ?? null;
    }
    if (!img) throw new HttpError(404, 'not_found', 'Photo introuvable.');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    reply.type(img.mime);
    return reply.send(img.data);
  });

  // ── Codes-barres (proxy avec cache vers Open Food / Beauty / Products Facts).
  app.get('/api/barcode/:code', async (req) => {
    auth(req);
    return barcodes.lookup((req.params as { code: string }).code);
  });

  app.get('/api/barcode/:code/image', async (req, reply) => {
    auth(req);
    const img = barcodes.image((req.params as { code: string }).code);
    if (!img) throw new HttpError(404, 'not_found', 'Image introuvable.');
    reply.header('Cache-Control', 'private, max-age=2592000');
    reply.type(img.mime);
    return reply.send(img.data);
  });

  // ── Notifications push.
  app.get('/api/push/key', async (req) => {
    const u = auth(req);
    return { publicKey: push.publicKey, subscribed: push.hasSubscription(u.id) };
  });
  app.post('/api/push/subscribe', async (req) => {
    const u = auth(req);
    const body = parse(z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }), req.body);
    push.subscribe(u.id, body, req.headers['user-agent']);
    return { ok: true };
  });
  app.post('/api/push/unsubscribe', async (req) => {
    const u = auth(req);
    const body = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
    push.unsubscribe(u.id, body.endpoint);
    return { ok: true };
  });
  app.post('/api/push/test', async (req) => {
    const u = auth(req);
    const n = await push.sendOnce(u.id, `test:${randomUUID()}`, { title: 'HOMEOS', body: 'Les notifications fonctionnent sur cet appareil.', url: '/' });
    return { sent: n };
  });

  // ── Administration du serveur : sauvegardes.
  app.get('/api/admin/backups', async (req) => {
    admin(req);
    return { backups: backups.list(), dbPath: config.dbPath };
  });
  app.post('/api/admin/backups', async (req) => {
    admin(req);
    return { backup: await backups.create('manual') };
  });
  app.get('/api/admin/backups/:name', async (req, reply) => {
    admin(req);
    let p: string;
    try {
      p = backups.path((req.params as { name: string }).name);
    } catch (e) {
      throw new HttpError(404, 'not_found', (e as Error).message);
    }
    reply.header('Content-Disposition', `attachment; filename="${(req.params as { name: string }).name}"`);
    reply.type('application/octet-stream');
    return reply.send(createReadStream(p));
  });
  app.post('/api/admin/backups/:name/restore', async (req) => {
    admin(req);
    const name = (req.params as { name: string }).name;
    parse(z.object({ confirm: z.literal('RESTAURER') }), req.body);
    try {
      const r = await backups.restore(name);
      for (const { id } of db.prep('SELECT id FROM households').all() as { id: string }[]) bus.changed(id, db.currentSeq());
      return { ok: true, safetyBackup: r.safety.name, epoch: r.epoch };
    } catch (e) {
      throw new HttpError(400, 'restore_failed', (e as Error).message);
    }
  });

  // ── Application web (PWA).
  if (config.webDir && existsSync(join(config.webDir, 'index.html'))) {
    app.register(fastifyStatic, {
      root: config.webDir,
      wildcard: false,
      setHeaders(res, path) {
        if (/\/assets\//.test(path)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
    app.get('/*', async (req, reply) => {
      const url = req.url.split('?')[0];
      if (url.startsWith('/api/')) throw new HttpError(404, 'not_found', 'Route inconnue.');
      const file = join(config.webDir!, url);
      if (url !== '/' && !url.includes('..') && existsSync(file) && !file.endsWith('/')) return reply.sendFile(url.slice(1));
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Route inconnue.' } }));

  app.addHook('onClose', async () => db.close());
  return { app, db, bus, backups, push, barcodes };
}
