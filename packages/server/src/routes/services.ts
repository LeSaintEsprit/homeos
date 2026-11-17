import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../households';
import { parse, requireUser, type Services } from '../http';

export function serviceRoutes(app: FastifyInstance, s: Services) {
  // Codes-barres : proxy avec cache vers Open Food / Beauty / Products Facts.
  app.get('/api/barcode/:code', async (req) => {
    requireUser(req);
    const r = await s.barcodes.lookup((req.params as { code: string }).code);
    // L'information « déjà en cache » n'est pas transmise : elle révélerait qu'un autre foyer a scanné ce code.
    return { status: r.status, product: r.product, imagePath: r.imagePath };
  });

  app.get('/api/barcode/:code/image', async (req, reply) => {
    requireUser(req);
    const img = s.barcodes.image((req.params as { code: string }).code);
    if (!img) throw new HttpError(404, 'not_found', 'Image introuvable.');
    reply.header('Cache-Control', 'private, max-age=2592000');
    reply.type(img.mime);
    return reply.send(img.data);
  });

  // Notifications push.
  app.get('/api/push/key', async (req) => {
    const u = requireUser(req);
    return { publicKey: s.push.publicKey, subscribed: s.push.hasSubscription(u.id) };
  });
  app.post('/api/push/subscribe', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }), req.body);
    s.push.subscribe(u.id, body, req.headers['user-agent']);
    return { ok: true };
  });
  app.post('/api/push/unsubscribe', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
    s.push.unsubscribe(u.id, body.endpoint);
    return { ok: true };
  });
  app.post('/api/push/test', async (req) => {
    const u = requireUser(req);
    const n = await s.push.sendOnce(u.id, `test:${randomUUID()}`, { title: 'HOMEOS', body: 'Les notifications fonctionnent sur cet appareil.', url: '/' });
    return { sent: n };
  });
}
