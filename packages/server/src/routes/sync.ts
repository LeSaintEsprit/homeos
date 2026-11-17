import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { membership, requireMember } from '../households';
import { pushOps } from '../sync';
import { pullChanges } from '../sqlStore';
import { hid, householdOf, parse, requireUser, type Services } from '../http';

export function syncRoutes(app: FastifyInstance, s: Services) {
  const { db } = s;

  app.get('/api/households/:hid/sync/pull', async (req) => {
    const u = requireUser(req);
    requireMember(db, hid(req), u.id);
    const q = req.query as { since?: string; limit?: string };
    const since = Math.max(0, Number(q.since ?? 0) || 0);
    const limit = Math.min(Math.max(Number(q.limit ?? 2000) || 2000, 1), 5000);
    return pullChanges(db, hid(req), since, limit);
  });

  app.post('/api/households/:hid/sync/push', async (req, reply) => {
    const u = requireUser(req);
    const m = requireMember(db, hid(req), u.id);
    const body = parse(z.object({ ops: z.array(z.unknown()).max(200) }), req.body);
    const h = householdOf(db, hid(req));
    const out = pushOps(
      db,
      body.ops,
      { householdId: h.id, userId: u.id, role: m.role, timezone: h.settings.timezone, maxOpAgeDays: Math.max(1, s.config.processedOpsDays - 30) },
      (e) => req.log.error(e),
    );
    if (out.applied) s.bus.changed(h.id, db.currentSeq());
    if (out.important.length) s.push.notifyImportant(h.id, out.important).catch((e) => req.log.warn(e));
    if (out.interrupted) reply.status(503);
    return { results: out.results, seq: db.currentSeq(), epoch: db.epoch(), retry: out.interrupted };
  });

  /** Temps réel : notifie les appareils du foyer (Server-Sent Events). */
  app.get('/api/households/:hid/events', async (req, reply) => {
    const u = requireUser(req);
    const householdId = hid(req);
    requireMember(db, householdId, u.id);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('hello', { seq: db.currentSeq(), epoch: db.epoch() });
    const onChange = (seq: number) => {
      // Retrait ou suppression du foyer : la connexion est fermée immédiatement.
      if (!membership(db, householdId, u.id)) {
        send('revoked', {});
        res.end();
        return;
      }
      send('change', { seq, epoch: db.epoch() });
    };
    s.bus.on(`hh:${householdId}`, onChange);
    const hb = setInterval(() => res.write(': ping\n\n'), 25_000);
    const close = () => {
      clearInterval(hb);
      s.bus.off(`hh:${householdId}`, onChange);
    };
    req.raw.on('close', close);
    res.on('close', close);
  });
}
