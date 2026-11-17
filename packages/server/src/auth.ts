import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(pw: string, salt: Buffer, len: number, opts: typeof SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join(':');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split(':');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export const SESSION_COOKIE = 'homeos_session';
export const SESSION_DAYS = 180;
const DAY = 86_400_000;

export function createSession(db: Db, userId: string, userAgent: string | undefined): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY).toISOString();
  db.prep('INSERT INTO sessions(tokenHash, userId, createdAt, expiresAt, lastSeenAt, userAgent) VALUES (?, ?, ?, ?, ?, ?)').run(
    sha256(token), userId, now.toISOString(), expiresAt, now.toISOString(), (userAgent ?? '').slice(0, 200),
  );
  return { token, expiresAt };
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isServerAdmin: boolean;
  tokenHash: string;
}

interface SessionRow {
  tokenHash: string;
  expiresAt: string;
  lastSeenAt: string;
  id: string;
  email: string;
  name: string;
  isServerAdmin: number;
}

export function getSessionUser(db: Db, token: string | undefined): SessionUser | null {
  if (!token || token.length > 100) return null;
  const h = sha256(token);
  const row = db
    .prep('SELECT s.tokenHash, s.expiresAt, s.lastSeenAt, u.id, u.email, u.name, u.isServerAdmin FROM sessions s JOIN users u ON u.id = s.userId WHERE s.tokenHash = ?')
    .get(h) as SessionRow | undefined;
  if (!row) return null;
  const now = Date.now();
  if (Date.parse(row.expiresAt) < now) {
    db.prep('DELETE FROM sessions WHERE tokenHash = ?').run(h);
    return null;
  }
  // Session glissante : prolongée si elle est utilisée à moins de 90 jours de son expiration.
  if (Date.parse(row.expiresAt) - now < 90 * DAY) {
    db.prep('UPDATE sessions SET expiresAt = ?, lastSeenAt = ? WHERE tokenHash = ?').run(new Date(now + SESSION_DAYS * DAY).toISOString(), new Date(now).toISOString(), h);
  } else if (now - Date.parse(row.lastSeenAt) > 3_600_000) {
    db.prep('UPDATE sessions SET lastSeenAt = ? WHERE tokenHash = ?').run(new Date(now).toISOString(), h);
  }
  return { id: row.id, email: row.email, name: row.name, isServerAdmin: !!row.isServerAdmin, tokenHash: h };
}

/** Limiteur de débit en mémoire (fenêtre glissante). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Renvoie true si la requête est autorisée. */
  hit(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Code d'invitation lisible (sans caractères ambigus), ex. « K7QPM-3XHTA ». */
export function invitationCode(): string {
  const b = randomBytes(10);
  let s = '';
  for (let i = 0; i < 10; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
