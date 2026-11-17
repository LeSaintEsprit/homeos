import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SESSION_COOKIE, createSession, hashPassword, verifyPassword } from '../auth';
import { HttpError, acceptInvitation, consumePlatformInvitation, findInvitation } from '../households';
import { changeEmail, changeName, checkResetToken, createResetToken, deleteAccount, deletionPlan, personalData, resetPassword } from '../accounts';
import { baseUrl, emailSchema, me, nameSchema, parse, passwordSchema, requireUser, setSessionCookie, type Services } from '../http';

/** Hachage factice : la vérification prend le même temps qu'un compte existe ou non. */
const DUMMY_HASH = 'scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA==:' + 'A'.repeat(86) + '==';

export function authRoutes(app: FastifyInstance, s: Services) {
  const { db } = s;

  app.get('/api/auth/config', async () => {
    const users = (db.prep('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    return { firstRun: users === 0, registration: s.config.registration, emailEnabled: s.mailer.enabled };
  });

  /**
   * Inscription. Premier compte : libre (administrateur du serveur). Ensuite, selon la
   * politique : code d'invitation de foyer OU invitation plateforme (nouvelle famille).
   */
  app.post('/api/auth/register', async (req, reply) => {
    if (!s.limits.registerIp.hit(req.ip)) throw new HttpError(429, 'rate_limited', 'Trop de tentatives. Réessayez plus tard.');
    const body = parse(z.object({ email: emailSchema, password: passwordSchema, name: nameSchema, inviteCode: z.string().max(20).optional() }), req.body);
    const users = (db.prep('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    const invitation = body.inviteCode ? findInvitation(db, body.inviteCode) : null;
    if (body.inviteCode && !invitation) throw new HttpError(400, 'invalid_invitation', "Code d'invitation invalide, expiré ou déjà utilisé.");
    if (users > 0 && s.config.registration === 'closed') throw new HttpError(403, 'registration_closed', 'Les inscriptions sont fermées sur ce serveur.');
    if (users > 0 && s.config.registration === 'invite' && !invitation) {
      throw new HttpError(403, 'invite_required', "L'inscription nécessite un code d'invitation (pour rejoindre un foyer ou créer le vôtre).");
    }
    if (invitation?.kind === 'household' && invitation.row.email && invitation.row.email !== body.email) {
      throw new HttpError(403, 'invitation_email', 'Cette invitation est réservée à une autre adresse e-mail.');
    }
    if (db.prep('SELECT 1 FROM users WHERE email = ?').get(body.email)) throw new HttpError(409, 'email_taken', 'Un compte existe déjà avec cette adresse.');
    const id = randomUUID();
    const hash = await hashPassword(body.password);
    const user = { id, email: body.email, name: body.name };
    let joined: string | null = null;
    db.tx(() => {
      db.prep('INSERT INTO users(id, email, name, passwordHash, isServerAdmin, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(id, body.email, body.name, hash, users === 0 ? 1 : 0, new Date().toISOString());
      if (invitation?.kind === 'household') joined = acceptInvitation(db, invitation.row.code, user);
      if (invitation?.kind === 'platform') consumePlatformInvitation(db, invitation.row.code);
    });
    const { token } = createSession(db, id, req.headers['user-agent']);
    setSessionCookie(s, req, reply, token);
    if (joined) s.bus.changed(joined, db.currentSeq());
    return { ...me(db, { ...user, isServerAdmin: users === 0 }), joinedHouseholdId: joined };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(z.object({ email: emailSchema, password: z.string().max(200) }), req.body);
    if (!s.limits.loginIp.hit(req.ip) || !s.limits.loginEmail.hit(body.email)) {
      throw new HttpError(429, 'rate_limited', 'Trop de tentatives de connexion. Réessayez dans quelques minutes.');
    }
    const row = db.prep('SELECT id, email, name, passwordHash, isServerAdmin FROM users WHERE email = ?').get(body.email) as
      | { id: string; email: string; name: string; passwordHash: string; isServerAdmin: number }
      | undefined;
    const ok = await verifyPassword(body.password, row?.passwordHash ?? DUMMY_HASH);
    if (!row || !ok) throw new HttpError(401, 'bad_credentials', 'Adresse e-mail ou mot de passe incorrect.');
    s.limits.loginEmail.reset(body.email);
    const { token } = createSession(db, row.id, req.headers['user-agent']);
    setSessionCookie(s, req, reply, token);
    return me(db, { id: row.id, email: row.email, name: row.name, isServerAdmin: !!row.isServerAdmin });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.user) db.prep('DELETE FROM sessions WHERE tokenHash = ?').run(req.user.tokenHash);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => me(db, requireUser(req)));

  app.patch('/api/auth/profile', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ name: nameSchema }), req.body);
    changeName(db, u.id, body.name);
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ current: z.string().max(200), next: passwordSchema }), req.body);
    const row = db.prep('SELECT passwordHash FROM users WHERE id = ?').get(u.id) as { passwordHash: string };
    if (!(await verifyPassword(body.current, row.passwordHash))) throw new HttpError(400, 'bad_credentials', 'Mot de passe actuel incorrect.');
    db.prep('UPDATE users SET passwordHash = ? WHERE id = ?').run(await hashPassword(body.next), u.id);
    db.prep('DELETE FROM sessions WHERE userId = ? AND tokenHash <> ?').run(u.id, u.tokenHash);
    return { ok: true };
  });

  app.post('/api/auth/email', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ email: emailSchema, password: z.string().max(200) }), req.body);
    const row = db.prep('SELECT passwordHash FROM users WHERE id = ?').get(u.id) as { passwordHash: string };
    if (!(await verifyPassword(body.password, row.passwordHash))) throw new HttpError(400, 'bad_credentials', 'Mot de passe incorrect.');
    changeEmail(db, u.id, body.email);
    return { ok: true };
  });

  /** « Mot de passe oublié » : réponse identique que le compte existe ou non. */
  app.post('/api/auth/forgot', async (req) => {
    if (!s.limits.forgotIp.hit(req.ip)) throw new HttpError(429, 'rate_limited', 'Trop de demandes. Réessayez plus tard.');
    const body = parse(z.object({ email: emailSchema }), req.body);
    if (!s.mailer.enabled) return { ok: true, mode: 'admin' as const };
    const row = db.prep('SELECT id, name FROM users WHERE email = ?').get(body.email) as { id: string; name: string } | undefined;
    if (row) {
      const { token } = createResetToken(db, row.id, 'self');
      const link = `${baseUrl(s, req)}/reinitialiser/${token}`;
      s.mailer
        .send({
          to: body.email,
          subject: 'HOMEOS — réinitialisation de votre mot de passe',
          text: `Bonjour ${row.name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 24 heures, utilisable une seule fois) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nHOMEOS`,
        })
        .catch((e) => req.log.warn(e, 'Envoi du lien de réinitialisation'));
    }
    return { ok: true, mode: 'email' as const };
  });

  app.get('/api/auth/reset/:token', async (req) => {
    const r = checkResetToken(db, (req.params as { token: string }).token);
    if (!r) throw new HttpError(404, 'invalid_token', 'Lien de réinitialisation invalide, expiré ou déjà utilisé.');
    const u = db.prep('SELECT email FROM users WHERE id = ?').get(r.userId) as { email: string };
    return { email: u.email, expiresAt: r.expiresAt };
  });

  app.post('/api/auth/reset', async (req, reply) => {
    const body = parse(z.object({ token: z.string().max(100), password: passwordSchema }), req.body);
    const userId = await resetPassword(db, body.token, body.password);
    const u = db.prep('SELECT id, email, name, isServerAdmin FROM users WHERE id = ?').get(userId) as { id: string; email: string; name: string; isServerAdmin: number };
    const { token } = createSession(db, userId, req.headers['user-agent']);
    setSessionCookie(s, req, reply, token);
    return me(db, { ...u, isServerAdmin: !!u.isServerAdmin });
  });

  app.get('/api/auth/account/deletion-plan', async (req) => deletionPlan(db, requireUser(req).id));

  app.post('/api/auth/account/delete', async (req, reply) => {
    const u = requireUser(req);
    const body = parse(z.object({ password: z.string().max(200), confirm: z.literal('SUPPRIMER'), deleteSoleHouseholds: z.boolean().default(false) }), req.body);
    const row = db.prep('SELECT passwordHash FROM users WHERE id = ?').get(u.id) as { passwordHash: string };
    if (!(await verifyPassword(body.password, row.passwordHash))) throw new HttpError(400, 'bad_credentials', 'Mot de passe incorrect.');
    const plan = deletionPlan(db, u.id);
    if (plan.soleHouseholds.length && body.deleteSoleHouseholds) await s.backups.create('pre-delete');
    deleteAccount(db, u.id, body.deleteSoleHouseholds);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true, deletedHouseholds: plan.soleHouseholds };
  });

  app.get('/api/auth/personal-data', async (req, reply) => {
    const u = requireUser(req);
    reply.header('Content-Disposition', `attachment; filename="homeos-donnees-personnelles-${new Date().toISOString().slice(0, 10)}.json"`);
    return personalData(db, u.id);
  });
}
