import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CURRENCIES, ROLE_LABELS, isRole, type Role } from '@homeos/shared';
import {
  HttpError, acceptInvitation, changeRole, createHousehold, createInvitation, createPlatformInvitation, findInvitation, isAdminSomewhere,
  removeMember, requireMember,
} from '../households';
import { deleteHouseholdData } from '../exportImport';
import { baseUrl, hid, householdOf, me, parse, requireUser, type Services } from '../http';

const avatarSchema = z.string().trim().min(1).max(60).nullable().optional();
const roleSchema = z.enum(['admin', 'member', 'viewer']);

export function householdRoutes(app: FastifyInstance, s: Services) {
  const { db } = s;

  app.post('/api/households', async (req) => {
    const u = requireUser(req);
    const body = parse(
      z.object({
        name: z.string().trim().min(1, 'Nom du foyer obligatoire').max(80),
        avatar: avatarSchema,
        currency: z.enum(CURRENCIES.map((c) => c.code) as [string, ...string[]]).optional(),
        timezone: z.string().max(64).optional(),
        settings: z
          .object({
            shoppingIntervalDays: z.number().int().min(1).max(60).optional(),
            safetyDays: z.number().int().min(0).max(30).optional(),
            expirySoonDays: z.number().int().min(1).max(60).optional(),
            expiryUrgentDays: z.number().int().min(0).max(14).optional(),
            monthlyBudgetCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
          })
          .optional(),
        notifications: z
          .object({
            digest: z.enum(['off', 'daily', 'weekly']).optional(),
            digestHour: z.number().int().min(0).max(23).optional(),
            pushImportant: z.boolean().optional(),
          })
          .optional(),
      }),
      req.body,
    );
    if (body.timezone) {
      try {
        new Intl.DateTimeFormat('fr-FR', { timeZone: body.timezone });
      } catch {
        throw new HttpError(400, 'invalid', 'Fuseau horaire inconnu.');
      }
    }
    const id = createHousehold(db, u, body);
    s.bus.changed(id, db.currentSeq());
    return { id, ...me(db, u) };
  });

  app.delete('/api/households/:hid', async (req) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id, 'household.delete');
    const body = parse(z.object({ confirmName: z.string() }), req.body);
    const h = householdOf(db, hid(req));
    if (body.confirmName.trim() !== h.name) throw new HttpError(400, 'confirm', 'Le nom saisi ne correspond pas au nom du foyer.');
    await s.backups.create('pre-delete');
    deleteHouseholdData(db, h.id);
    s.bus.changed(h.id, db.currentSeq());
    return { ok: true, ...me(db, u) };
  });

  // ── Invitations à rejoindre un foyer.
  app.get('/api/households/:hid/invitations', async (req) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id, 'members.manage');
    const rows = db
      .prep('SELECT * FROM invitations WHERE householdId = ? AND revokedAt IS NULL AND expiresAt > ? AND uses < maxUses ORDER BY createdAt DESC')
      .all(hid(req), new Date().toISOString());
    return { invitations: rows, emailEnabled: s.mailer.enabled };
  });

  app.post('/api/households/:hid/invitations', async (req) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id, 'members.manage');
    const body = parse(
      z.object({
        role: roleSchema.default('member'),
        days: z.number().int().min(1).max(30).default(7),
        maxUses: z.number().int().min(1).max(20).default(1),
        email: z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(160).optional(),
      }),
      req.body,
    );
    const h = householdOf(db, hid(req));
    const inv = createInvitation(db, h.id, u.id, body.role as Role, body.days, body.email ? 1 : body.maxUses, body.email ?? null);
    const link = `${baseUrl(s, req)}/invitation/${inv.code}`;
    const subject = `Invitation à rejoindre « ${h.name} » sur HOMEOS`;
    const text = `Bonjour,\n\n${u.name} vous invite à rejoindre le foyer « ${h.name} » sur HOMEOS (rôle : ${ROLE_LABELS[inv.role].toLowerCase()}).\n\nOuvrez ce lien : ${link}\nou saisissez le code ${inv.code} dans l'application.\n\nL'invitation expire le ${new Date(inv.expiresAt).toLocaleDateString('fr-FR')}.`;
    let emailSent = false;
    if (body.email && s.mailer.enabled) {
      try {
        await s.mailer.send({ to: body.email, subject, text });
        emailSent = true;
      } catch (e) {
        req.log.warn(e, "Envoi de l'invitation");
      }
    }
    const mailto = body.email ? `mailto:${encodeURIComponent(body.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` : null;
    return { invitation: inv, link, emailSent, mailto, shareText: text };
  });

  app.delete('/api/households/:hid/invitations/:id', async (req) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id, 'members.manage');
    db.prep('UPDATE invitations SET revokedAt = ? WHERE id = ? AND householdId = ?').run(new Date().toISOString(), (req.params as { id: string }).id, hid(req));
    return { ok: true };
  });

  // ── Invitations plateforme : permettre à une autre famille de créer son foyer.
  app.post('/api/platform-invitations', async (req) => {
    const u = requireUser(req);
    if (!u.isServerAdmin && !isAdminSomewhere(db, u.id)) throw new HttpError(403, 'forbidden', "Seul un administrateur peut inviter une autre famille.");
    const body = parse(z.object({ days: z.number().int().min(1).max(30).default(7), maxUses: z.number().int().min(1).max(20).default(1) }), req.body);
    const inv = createPlatformInvitation(db, u.id, body.days, body.maxUses);
    const link = `${baseUrl(s, req)}/invitation/${inv.code}`;
    return {
      invitation: inv,
      link,
      shareText: `Bonjour,\n\n${u.name} vous invite à utiliser HOMEOS pour gérer les stocks et les courses de votre foyer.\nCréez votre compte et votre foyer avec ce lien : ${link}\n(code : ${inv.code}, valable jusqu'au ${new Date(inv.expiresAt).toLocaleDateString('fr-FR')}).`,
    };
  });

  app.get('/api/platform-invitations', async (req) => {
    const u = requireUser(req);
    const rows = db
      .prep('SELECT * FROM platform_invitations WHERE createdBy = ? AND revokedAt IS NULL AND expiresAt > ? AND uses < maxUses ORDER BY createdAt DESC')
      .all(u.id, new Date().toISOString());
    return { invitations: rows };
  });

  app.delete('/api/platform-invitations/:id', async (req) => {
    const u = requireUser(req);
    const info = db
      .prep('UPDATE platform_invitations SET revokedAt = ? WHERE id = ? AND (createdBy = ? OR ? = 1)')
      .run(new Date().toISOString(), (req.params as { id: string }).id, u.id, u.isServerAdmin ? 1 : 0);
    if (!info.changes) throw new HttpError(404, 'not_found', 'Invitation introuvable.');
    return { ok: true };
  });

  // ── Aperçu et acceptation (code ou lien).
  app.get('/api/invitations/:code', async (req) => {
    if (!s.limits.inviteIp.hit(req.ip)) throw new HttpError(429, 'rate_limited', 'Trop de tentatives.');
    const inv = findInvitation(db, (req.params as { code: string }).code);
    if (!inv) throw new HttpError(404, 'invalid_invitation', "Code d'invitation invalide, expiré ou déjà utilisé.");
    const inviter = db.prep('SELECT name FROM users WHERE id = ?').get(inv.row.createdBy) as { name: string } | undefined;
    if (inv.kind === 'platform') return { kind: 'platform', inviterName: inviter?.name ?? null, expiresAt: inv.row.expiresAt };
    const h = householdOf(db, inv.row.householdId);
    return {
      kind: 'household',
      householdName: h.name,
      householdAvatar: h.avatar,
      inviterName: inviter?.name ?? null,
      role: inv.row.role,
      restrictedEmail: !!inv.row.email,
      expiresAt: inv.row.expiresAt,
    };
  });

  app.post('/api/invitations/:code/accept', async (req) => {
    const u = requireUser(req);
    if (!s.limits.inviteIp.hit(req.ip)) throw new HttpError(429, 'rate_limited', 'Trop de tentatives.');
    const id = acceptInvitation(db, (req.params as { code: string }).code, u);
    s.bus.changed(id, db.currentSeq());
    return { householdId: id, ...me(db, u) };
  });

  // ── Membres.
  app.patch('/api/households/:hid/members/:userId', async (req) => {
    const u = requireUser(req);
    const actor = requireMember(db, hid(req), u.id, 'members.manage');
    const body = parse(z.object({ role: roleSchema }), req.body);
    if (!isRole(body.role)) throw new HttpError(400, 'invalid', 'Rôle inconnu.');
    changeRole(db, hid(req), actor, (req.params as { userId: string }).userId, body.role);
    s.bus.changed(hid(req), db.currentSeq());
    return { ok: true };
  });

  app.delete('/api/households/:hid/members/:userId', async (req) => {
    const u = requireUser(req);
    const actor = requireMember(db, hid(req), u.id);
    removeMember(db, hid(req), actor, (req.params as { userId: string }).userId);
    s.bus.changed(hid(req), db.currentSeq());
    return { ok: true, ...me(db, u) };
  });
}
