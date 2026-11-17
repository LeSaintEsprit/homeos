import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { HttpError } from '../households';
import { createResetToken, listUsers } from '../accounts';
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
