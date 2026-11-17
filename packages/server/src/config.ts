import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  webDir: string | null;
  /** 'invite' : seul le premier compte est libre, les suivants exigent une invitation. */
  registration: 'open' | 'invite' | 'closed';
  trustProxy: boolean;
  cookieSecure: 'auto' | boolean;
  offUserAgent: string;
  offEnabled: boolean;
  backupKeepDaily: number;
  backupKeepMonthly: number;
  publicUrl: string | null;
  vapidSubject: string;
  schedulers: boolean;
  /** SMTP facultatif (votre propre boîte), ex. smtps://utilisateur:motdepasse@smtp.exemple.fr:465 */
  smtpUrl: string | null;
  mailFrom: string | null;
  /** Durée de conservation des opérations traitées (idempotence). */
  processedOpsDays: number;
  /** Multiplicateur des limites anti-abus (1 en production ; relevé pour les tests automatisés). */
  rateLimitMultiplier: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const dataDir = resolve(env.HOMEOS_DATA_DIR ?? './data');
  const reg = (env.HOMEOS_REGISTRATION ?? 'invite') as Config['registration'];
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    dbPath: resolve(dataDir, 'homeos.db'),
    backupDir: resolve(dataDir, 'backups'),
    webDir: env.HOMEOS_WEB_DIR ? resolve(env.HOMEOS_WEB_DIR) : null,
    registration: ['open', 'invite', 'closed'].includes(reg) ? reg : 'invite',
    trustProxy: env.HOMEOS_TRUST_PROXY === '1' || env.HOMEOS_TRUST_PROXY === 'true',
    cookieSecure: env.HOMEOS_COOKIE_SECURE === '1' ? true : env.HOMEOS_COOKIE_SECURE === '0' ? false : 'auto',
    offUserAgent: env.HOMEOS_OFF_USER_AGENT ?? 'HomeOS/1.0 (self-hosted family inventory)',
    offEnabled: env.HOMEOS_OFF_DISABLED !== '1',
    backupKeepDaily: Number(env.HOMEOS_BACKUP_KEEP_DAILY ?? 14),
    backupKeepMonthly: Number(env.HOMEOS_BACKUP_KEEP_MONTHLY ?? 12),
    publicUrl: env.HOMEOS_PUBLIC_URL ?? null,
    vapidSubject: env.HOMEOS_VAPID_SUBJECT ?? 'mailto:admin@homeos.local',
    schedulers: env.HOMEOS_SCHEDULERS !== '0',
    smtpUrl: env.HOMEOS_SMTP_URL || null,
    mailFrom: env.HOMEOS_MAIL_FROM || null,
    processedOpsDays: Number(env.HOMEOS_PROCESSED_OPS_DAYS ?? 180),
    rateLimitMultiplier: Math.max(1, Number(env.HOMEOS_RATE_LIMIT_MULTIPLIER ?? 1) || 1),
    ...overrides,
  };
}
