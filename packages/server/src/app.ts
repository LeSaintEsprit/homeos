import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Db } from './db';
import type { Config } from './config';
import { RateLimiter, SESSION_COOKIE, getSessionUser, type SessionUser } from './auth';
import { HttpError } from './households';
import { Bus } from './sync';
import { BackupManager } from './backup';
import { BarcodeService, type FetchLike } from './barcode';
import { PushService, type PushSender } from './push';
import { mailerFromConfig, type Mailer } from './mail';
import type { Services } from './http';
import { authRoutes } from './routes/auth';
import { householdRoutes } from './routes/households';
import { syncRoutes } from './routes/sync';
import { dataRoutes } from './routes/data';
import { serviceRoutes } from './routes/services';
import { adminRoutes } from './routes/admin';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export interface AppDeps {
  config: Config;
  fetchImpl?: FetchLike;
  pushSender?: PushSender;
  mailer?: Mailer;
}

export interface App extends Services {
  app: FastifyInstance;
}

const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; " +
  "worker-src 'self' blob:; connect-src 'self' data: blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export function buildApp(deps: AppDeps): App {
  const { config } = deps;
  const db = new Db(config.dbPath);
  const services: Services = {
    config,
    db,
    bus: new Bus(),
    backups: new BackupManager(db, config.backupDir, config.backupKeepDaily, config.backupKeepMonthly),
    push: new PushService(db, config, deps.pushSender),
    barcodes: new BarcodeService(db, config, deps.fetchImpl),
    mailer: deps.mailer ?? mailerFromConfig(config),
    limits: {
      loginIp: new RateLimiter(30, 15 * 60_000),
      loginEmail: new RateLimiter(10, 15 * 60_000),
      registerIp: new RateLimiter(10, 60 * 60_000),
      inviteIp: new RateLimiter(30, 15 * 60_000),
      forgotIp: new RateLimiter(5, 60 * 60_000),
    },
  };

  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: config.trustProxy,
    bodyLimit: 6 * 1024 * 1024,
  });
  app.register(cookie);
  app.decorateRequest('user', null);

  // Sécurité : anti-CSRF (en-tête obligatoire + origine), authentification par cookie.
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers['x-homeos'] !== '1') throw new HttpError(403, 'csrf', 'Requête refusée (en-tête de sécurité manquant).');
      const origin = req.headers.origin;
      if (origin) {
        let host: string;
        try {
          host = new URL(origin).host;
        } catch {
          throw new HttpError(403, 'csrf', 'Origine de la requête refusée.');
        }
        if (host !== req.headers.host) throw new HttpError(403, 'csrf', 'Origine de la requête refusée.');
      }
    }
    req.user = getSessionUser(db, req.cookies?.[SESSION_COOKIE]);
  });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    reply.header('Content-Security-Policy', CSP);
    if (req.url.startsWith('/api/') && !reply.getHeader('cache-control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: 'bad_request', message: status === 413 ? 'Fichier trop volumineux.' : 'Requête invalide.' } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: "Erreur interne du serveur. Aucune donnée partielle n'a été enregistrée." } });
  });

  app.get('/api/health', async () => ({ ok: true, epoch: db.epoch(), seq: db.currentSeq(), time: new Date().toISOString() }));
  authRoutes(app, services);
  householdRoutes(app, services);
  syncRoutes(app, services);
  dataRoutes(app, services);
  serviceRoutes(app, services);
  adminRoutes(app, services);

  // Application web (PWA).
  const webDir = config.webDir;
  if (webDir && existsSync(join(webDir, 'index.html'))) {
    app.register(fastifyStatic, {
      root: webDir,
      wildcard: false,
      setHeaders(res, path) {
        if (/[\\/]assets[\\/]/.test(path)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
    app.get('/*', async (req, reply) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url.startsWith('/api/')) throw new HttpError(404, 'not_found', 'Route inconnue.');
      if (url !== '/' && !url.includes('..') && existsSync(join(webDir, url)) && !url.endsWith('/')) return reply.sendFile(url.slice(1));
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Route inconnue.' } }));

  app.addHook('onClose', async () => db.close());
  return { app, ...services };
}
