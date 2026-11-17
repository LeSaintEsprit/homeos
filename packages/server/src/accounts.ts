import { randomBytes } from 'node:crypto';
import type { Member } from '@homeos/shared';
import type { Db } from './db';
import { hashPassword, sha256 } from './auth';
import { HttpError, activeCount, adminCount, logActivity } from './households';
import { SqlStore, rowToEntity } from './sqlStore';
import { deleteHouseholdData } from './exportImport';

const RESET_HOURS = 24;

/** Lien de réinitialisation à usage unique (24 h). Seul le hachage du jeton est stocké. */
export function createResetToken(db: Db, userId: string, createdBy: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_HOURS * 3_600_000).toISOString();
  db.prep('INSERT INTO password_resets(tokenHash, userId, createdBy, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)').run(sha256(token), userId, createdBy, now.toISOString(), expiresAt);
  return { token, expiresAt };
}

interface ResetRow {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  usedAt: string | null;
}

export function checkResetToken(db: Db, token: string): ResetRow | null {
  if (!token || token.length > 100) return null;
  const r = db.prep('SELECT tokenHash, userId, expiresAt, usedAt FROM password_resets WHERE tokenHash = ?').get(sha256(token)) as ResetRow | undefined;
  if (!r || r.usedAt || Date.parse(r.expiresAt) < Date.now()) return null;
  return r;
}

/** Réinitialise le mot de passe et déconnecte tous les appareils du compte. */
export async function resetPassword(db: Db, token: string, password: string): Promise<string> {
  const r = checkResetToken(db, token);
  if (!r) throw new HttpError(400, 'invalid_token', 'Lien de réinitialisation invalide, expiré ou déjà utilisé.');
  const hash = await hashPassword(password);
  db.tx(() => {
    const again = checkResetToken(db, token);
    if (!again) throw new HttpError(400, 'invalid_token', 'Lien de réinitialisation invalide, expiré ou déjà utilisé.');
    db.prep('UPDATE users SET passwordHash = ? WHERE id = ?').run(hash, r.userId);
    db.prep('UPDATE password_resets SET usedAt = ? WHERE tokenHash = ?').run(new Date().toISOString(), r.tokenHash);
    // Les autres liens en attente sont invalidés.
    db.prep('UPDATE password_resets SET usedAt = ? WHERE userId = ? AND usedAt IS NULL').run(new Date().toISOString(), r.userId);
    db.prep('DELETE FROM sessions WHERE userId = ?').run(r.userId);
  });
  return r.userId;
}

function memberships(db: Db, userId: string): Member[] {
  return (db.prep('SELECT * FROM members WHERE userId = ? AND active = 1').all(userId) as Record<string, unknown>[]).map((r) => rowToEntity('member', r) as Member);
}

/** Change l'adresse e-mail et la répercute dans tous les foyers du compte. */
export function changeEmail(db: Db, userId: string, email: string) {
  db.tx(() => {
    const taken = db.prep('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, userId);
    if (taken) throw new HttpError(409, 'email_taken', 'Un compte existe déjà avec cette adresse.');
    db.prep('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
    for (const m of memberships(db, userId)) new SqlStore(db, m.householdId, userId).put('member', { ...m, email });
  });
}

/** Change le nom et le répercute dans tous les foyers du compte. */
export function changeName(db: Db, userId: string, name: string) {
  db.tx(() => {
    db.prep('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
    for (const m of memberships(db, userId)) new SqlStore(db, m.householdId, userId).put('member', { ...m, name });
  });
}

export interface DeletionPlan {
  /** Foyers dont l'utilisateur est le seul membre : ils seront supprimés. */
  soleHouseholds: { id: string; name: string }[];
  /** Foyers où l'utilisateur est le dernier administrateur avec d'autres membres : suppression impossible. */
  blocking: { id: string; name: string }[];
}

export function deletionPlan(db: Db, userId: string): DeletionPlan {
  const plan: DeletionPlan = { soleHouseholds: [], blocking: [] };
  for (const m of memberships(db, userId)) {
    const h = db.prep('SELECT name FROM households WHERE id = ?').get(m.householdId) as { name: string };
    if (activeCount(db, m.householdId) === 1) plan.soleHouseholds.push({ id: m.householdId, name: h.name });
    else if (m.role === 'admin' && adminCount(db, m.householdId) === 1) plan.blocking.push({ id: m.householdId, name: h.name });
  }
  return plan;
}

/**
 * Supprime un compte : les foyers dont il était le seul membre sont supprimés ;
 * ailleurs, son appartenance est désactivée et son nom anonymisé (« Ancien membre »).
 * L'historique des foyers est conservé (les mouvements restent attribués à « Ancien membre »).
 */
export function deleteAccount(db: Db, userId: string, deleteSoleHouseholds: boolean): DeletionPlan {
  const plan = deletionPlan(db, userId);
  if (plan.blocking.length) {
    throw new HttpError(409, 'last_admin', `Nommez d'abord un autre administrateur dans : ${plan.blocking.map((h) => `« ${h.name} »`).join(', ')}.`);
  }
  if (plan.soleHouseholds.length && !deleteSoleHouseholds) {
    throw new HttpError(409, 'sole_households', `Vous êtes le seul membre de : ${plan.soleHouseholds.map((h) => `« ${h.name} »`).join(', ')}. Confirmez leur suppression.`);
  }
  for (const h of plan.soleHouseholds) deleteHouseholdData(db, h.id);
  db.tx(() => {
    for (const m of memberships(db, userId)) {
      const store = new SqlStore(db, m.householdId, userId);
      logActivity(store, m.householdId, userId, 'a supprimé son compte');
      store.put('member', { ...m, active: false, name: 'Ancien membre', email: '', prefs: {} });
    }
    // Les appartenances inactives sont aussi anonymisées.
    for (const r of db.prep('SELECT * FROM members WHERE userId = ? AND active = 0').all(userId) as Record<string, unknown>[]) {
      const m = rowToEntity('member', r) as Member;
      if (m.name !== 'Ancien membre') new SqlStore(db, m.householdId, userId).put('member', { ...m, name: 'Ancien membre', email: '', prefs: {} });
    }
    db.prep('DELETE FROM users WHERE id = ?').run(userId);
  });
  return plan;
}

/** Export des données personnelles du compte (profil, foyers, appareils connectés). */
export function personalData(db: Db, userId: string) {
  const user = db.prep('SELECT id, email, name, isServerAdmin, createdAt FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
  const households = (db.prep('SELECT m.householdId, h.name, m.role, m.joinedAt, m.active, m.prefs FROM members m JOIN households h ON h.id = m.householdId WHERE m.userId = ?').all(userId) as Record<string, unknown>[]).map(
    (r) => ({ ...r, active: !!r.active, prefs: JSON.parse((r.prefs as string) || '{}') }),
  );
  const sessions = db.prep('SELECT createdAt, lastSeenAt, expiresAt, userAgent FROM sessions WHERE userId = ?').all(userId);
  const pushDevices = (db.prep('SELECT COUNT(*) AS n FROM push_subscriptions WHERE userId = ?').get(userId) as { n: number }).n;
  return { format: 'homeos-personal-data', exportedAt: new Date().toISOString(), user: { ...user, isServerAdmin: !!user.isServerAdmin }, households, sessions, pushDevices };
}

export function listUsers(db: Db) {
  return db
    .prep(
      `SELECT u.id, u.email, u.name, u.isServerAdmin, u.createdAt,
        (SELECT COUNT(*) FROM members m WHERE m.userId = u.id AND m.active = 1) AS households
       FROM users u ORDER BY u.createdAt`,
    )
    .all()
    .map((r) => ({ ...(r as Record<string, unknown>), isServerAdmin: !!(r as { isServerAdmin: number }).isServerAdmin }));
}

export function purgeProcessedOps(db: Db, days: number): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return db.prep('DELETE FROM processed_ops WHERE at < ?').run(cutoff).changes;
}
