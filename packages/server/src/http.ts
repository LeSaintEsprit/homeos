import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Household } from '@homeos/shared';
import type { Config } from './config';
import type { Db } from './db';
import type { Bus } from './sync';
import type { BackupManager } from './backup';
import type { PushService } from './push';
import type { BarcodeService } from './barcode';
import type { Mailer } from './mail';
import { RateLimiter, SESSION_COOKIE, SESSION_DAYS, type SessionUser } from './auth';
import { HttpError, userHouseholds } from './households';
import { rowToEntity } from './sqlStore';

export interface Services {
  config: Config;
  db: Db;
  bus: Bus;
  backups: BackupManager;
  push: PushService;
  barcodes: BarcodeService;
  mailer: Mailer;
  limits: {
    loginIp: RateLimiter;
    loginEmail: RateLimiter;
    registerIp: RateLimiter;
    inviteIp: RateLimiter;
    forgotIp: RateLimiter;
  };
}

export const emailSchema = z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(160);
export const passwordSchema = z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères').max(200);
export const nameSchema = z.string().trim().min(1, 'Nom obligatoire').max(60);

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new HttpError(400, 'invalid', r.error.issues[0]?.message ?? 'Données invalides');
  return r.data;
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'unauthenticated', 'Veuillez vous connecter.');
  return req.user;
}

export function requireServerAdmin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (!u.isServerAdmin) throw new HttpError(403, 'forbidden', "Réservé à l'administrateur du serveur.");
  return u;
}

export function setSessionCookie(s: Services, req: FastifyRequest, reply: FastifyReply, token: string) {
  const secure = s.config.cookieSecure === 'auto' ? req.protocol === 'https' : s.config.cookieSecure;
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_DAYS * 86400 });
}

/** Adresse publique de l'application (liens d'invitation et de réinitialisation). */
export function baseUrl(s: Services, req: FastifyRequest): string {
  if (s.config.publicUrl) return s.config.publicUrl.replace(/\/$/, '');
  return `${req.protocol}://${req.headers.host}`;
}

export function householdOf(db: Db, hid: string): Household {
  const row = db.prep('SELECT * FROM households WHERE id = ?').get(hid) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, 'not_found', 'Foyer introuvable.');
  return rowToEntity('household', row) as Household;
}

export function me(db: Db, u: { id: string; email: string; name: string; isServerAdmin: boolean }) {
  return {
    user: { id: u.id, email: u.email, name: u.name, isServerAdmin: u.isServerAdmin },
    households: userHouseholds(db, u.id),
  };
}

export function hid(req: FastifyRequest): string {
  return (req.params as { hid: string }).hid;
}
