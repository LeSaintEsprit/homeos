import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { HttpError } from '../households';
import { createResetToken, listUsers } from '../accounts';
import { extractHousehold, householdsInBackup } from '../backup';
import { importHousehold } from '../exportImport';
import { baseUrl, emailSchema, parse, requireServerAdmin, type Services } from '../http';

/** Administration de l'instance (hébergeur) : sauvegardes, comptes. */
export function adminRoutes(app: FastifyInstance, s: Services) {
  const { db } = s;

  app.get('/api/admin/backups', async (req) => {
    requireServerAdmin(req);
    return { backups: s.backups.list(), dbPath: s.config.dbPath };
  });

  app.post('/api/admin/backups', async (req) => {
    requireServerAdmin(req);
    return { backup: await s.backups.create('manual') };
  });

  app.get('/api/admin/backups/:name', async (req, reply) => {
    requireServerAdmin(req);
    const name = (req.params as { name: string }).name;
    let p: string;
    try {
      p = s.backups.path(name);
    } catch (e) {
      throw new HttpError(404, 'not_found', (e as Error).message);
    }
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    reply.type('application/octet-stream');
    return reply.send(createReadStream(p));
  });

  /** Restauration COMPLÈTE de l'instance (toutes les familles) : réservée à l'hébergeur. */
  app.post('/api/admin/backups/:name/restore', async (req) => {
    requireServerAdmin(req);
    parse(z.object({ confirm: z.literal('RESTAURER') }), req.body);
    try {
      const r = await s.backups.restore((req.params as { name: string }).name);
      for (const { id } of db.prep('SELECT id FROM households').all() as { id: string }[]) s.bus.changed(id, db.currentSeq());
      return { ok: true, safetyBackup: r.safety.name, epoch: r.epoch };
    } catch (e) {
      throw new HttpError(400, 'restore_failed', (e as Error).message);
    }
  });

  /** Foyers contenus dans une sauvegarde (pour en récupérer un seul). */
  app.get('/api/admin/backups/:name/households', async (req) => {
    requireServerAdmin(req);
    let p: string;
    try {
      p = s.backups.path((req.params as { name: string }).name);
    } catch (e) {
      throw new HttpError(404, 'not_found', (e as Error).message);
    }
    const current = new Set((db.prep('SELECT id FROM households').all() as { id: string }[]).map((r) => r.id));
    return { households: householdsInBackup(p).map((h) => ({ ...h, existsNow: current.has(h.id) })) };
  });

  /**
   * Récupère UN foyer d'une sauvegarde comme nouveau foyer (ex. foyer supprimé par erreur),
   * sans toucher aux autres familles. Les membres dont le compte existe toujours retrouvent l'accès ;
   * l'hébergeur n'en devient pas membre s'il ne l'était pas.
   */
  app.post('/api/admin/backups/:name/households/:hid/restore', async (req) => {
    const u = requireServerAdmin(req);
    const { name, hid: householdId } = req.params as { name: string; hid: string };
    let p: string;
    try {
      p = s.backups.path(name);
    } catch (e) {
      throw new HttpError(404, 'not_found', (e as Error).message);
    }
    const file = extractHousehold(p, householdId);
    if (!file) throw new HttpError(404, 'not_found', 'Ce foyer ne figure pas dans cette sauvegarde.');
    const info = s.backups.list().find((b) => b.name === name);
    await s.backups.create('pre-import');
    const date = new Date(info?.createdAt ?? Date.now()).toLocaleDateString('fr-FR');
    const wasMember = (file.entities.member ?? []).some((m) => (m as { userId: string; active: boolean }).userId === u.id && (m as { active: boolean }).active);
    const report = importHousehold(db, file, u, { name: `${file.householdName} (restauré du ${date})`, keepMembers: true, importerJoins: wasMember });
    s.bus.changed(report.householdId, db.currentSeq());
    return { ...report, name: `${file.householdName} (restauré du ${date})` };
  });

  app.get('/api/admin/users', async (req) => {
    requireServerAdmin(req);
    return { users: listUsers(db) };
  });

  /** Lien de réinitialisation à usage unique, à transmettre à la personne concernée. */
  app.post('/api/admin/reset-link', async (req) => {
    const admin = requireServerAdmin(req);
    const body = parse(z.object({ email: emailSchema }), req.body);
    const u = db.prep('SELECT id FROM users WHERE email = ?').get(body.email) as { id: string } | undefined;
    if (!u) throw new HttpError(404, 'not_found', 'Aucun compte avec cette adresse.');
    const { token, expiresAt } = createResetToken(db, u.id, admin.id);
    return { link: `${baseUrl(s, req)}/reinitialiser/${token}`, expiresAt };
  });
}
