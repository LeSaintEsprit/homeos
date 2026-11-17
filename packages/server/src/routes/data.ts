import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError, requireMember } from '../households';
import { exportCsv, exportHousehold, importHousehold, integrityReport } from '../exportImport';
import { backupsContaining, extractHousehold } from '../backup';
import { hid, householdOf, me, parse, requireUser, type Services } from '../http';

export function dataRoutes(app: FastifyInstance, s: Services) {
  const { db } = s;

  app.get('/api/households/:hid/export', async (req, reply) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id, 'data.export');
    const withPhotos = (req.query as { photos?: string }).photos !== '0';
    reply.header('Content-Disposition', `attachment; filename="homeos-${new Date().toISOString().slice(0, 10)}.json"`);
    return exportHousehold(db, hid(req), withPhotos);
  });

  app.get('/api/households/:hid/export/:kind', async (req, reply) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id, 'data.export');
    const k = (req.params as { kind: string }).kind.replace(/\.csv$/, '');
    if (!['inventaire', 'achats', 'mouvements'].includes(k)) throw new HttpError(404, 'not_found', 'Export inconnu.');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="homeos-${k}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return exportCsv(db, hid(req), k as 'inventaire');
  });

  /** Import d'un export : crée un NOUVEAU foyer (identifiants régénérés) dont l'importateur est administrateur. */
  app.post('/api/households/import', { bodyLimit: 60 * 1024 * 1024 }, async (req) => {
    const u = requireUser(req);
    await s.backups.create('pre-import');
    const report = importHousehold(db, req.body, u);
    s.bus.changed(report.householdId, db.currentSeq());
    return { ...report, ...me(db, u) };
  });

  app.get('/api/households/:hid/integrity', async (req) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id);
    const issues = integrityReport(db, hid(req));
    return { ok: !issues.some((i) => i.severity === 'error'), issues, checkedAt: new Date().toISOString() };
  });

  /** Sauvegardes du serveur contenant ce foyer (dates seulement). */
  app.get('/api/households/:hid/backups', async (req) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id, 'data.import');
    return { backups: backupsContaining(s.backups, hid(req)).map((b) => ({ name: b.name, createdAt: b.createdAt, reason: b.reason })) };
  });

  /**
   * Restauration d'UN foyer depuis une sauvegarde : ses données à cette date sont
   * recréées dans un nouveau foyer, sans toucher aux autres familles de l'instance.
   */
  app.post('/api/households/:hid/restore', async (req) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id, 'data.import');
    const body = parse(z.object({ backup: z.string().max(120) }), req.body);
    let path: string;
    try {
      path = s.backups.path(body.backup);
    } catch (e) {
      throw new HttpError(404, 'not_found', (e as Error).message);
    }
    const file = extractHousehold(path, hid(req));
    if (!file) throw new HttpError(404, 'not_found', 'Ce foyer ne figure pas dans cette sauvegarde.');
    const info = s.backups.list().find((b) => b.name === body.backup);
    await s.backups.create('pre-import');
    const date = new Date(info?.createdAt ?? Date.now()).toLocaleDateString('fr-FR');
    const report = importHousehold(db, file, u, { name: `${file.householdName} (restauré du ${date})`, keepMembers: true });
    s.bus.changed(report.householdId, db.currentSeq());
    return { ...report, ...me(db, u) };
  });

  // ── Photos (isolées par foyer).
  app.post('/api/households/:hid/photos', { bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id, 'catalog.write');
    const body = parse(z.object({ dataUrl: z.string().max(1_500_000) }), req.body);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl);
    if (!m) throw new HttpError(400, 'invalid', 'Image invalide (JPEG, PNG ou WebP attendus).');
    const data = Buffer.from(m[2], 'base64');
    if (data.length > 600_000) throw new HttpError(413, 'too_large', 'Image trop volumineuse.');
    const id = randomUUID();
    db.prep('INSERT INTO photos(id, householdId, mime, data, createdAt) VALUES (?, ?, ?, ?, ?)').run(id, hid(req), m[1], data, new Date().toISOString());
    return { id };
  });

  app.get('/api/households/:hid/photos/:id', async (req, reply) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id);
    const id = (req.params as { id: string }).id;
    let img: { data: Buffer; mime: string } | null;
    if (id.startsWith('bc-')) img = s.barcodes.image(id.slice(3));
    else img = (db.prep('SELECT data, mime FROM photos WHERE id = ? AND householdId = ?').get(id, hid(req)) as { data: Buffer; mime: string } | undefined) ?? null;
    if (!img) throw new HttpError(404, 'not_found', 'Photo introuvable.');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    reply.type(img.mime);
    return reply.send(img.data);
  });

  // Rappel : le foyer existe-t-il encore ? (utilisé par les appareils pour purger une réplique locale)
  app.get('/api/households/:hid', async (req) => {
    const u = requireUser(req);
    const m = requireMember(db, hid(req), u.id);
    const h = householdOf(db, hid(req));
    return { id: h.id, name: h.name, avatar: h.avatar, role: m.role };
  });
}
