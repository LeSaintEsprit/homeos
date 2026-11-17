import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CATEGORIES, DEFAULT_LOCATIONS, DEFAULT_SETTINGS, MEMBER_COLORS, hasRole, type Member, type Role,
} from '@homeos/shared';
import type { Db } from './db';
import { SqlStore, rowToEntity } from './sqlStore';
import { invitationCode } from './auth';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function membership(db: Db, householdId: string, userId: string): Member | null {
  const row = db.prep('SELECT * FROM members WHERE householdId = ? AND userId = ? AND active = 1').get(householdId, userId) as Record<string, unknown> | undefined;
  return row ? (rowToEntity('member', row) as Member) : null;
}

export function requireMember(db: Db, householdId: string, userId: string, min: Role = 'viewer'): Member {
  const m = membership(db, householdId, userId);
  // Même réponse que pour un foyer inexistant : ne révèle pas l'existence des autres foyers.
  if (!m) throw new HttpError(404, 'not_found', 'Foyer introuvable.');
  if (!hasRole(m.role, min)) throw new HttpError(403, 'forbidden', "Vous n'avez pas les droits nécessaires pour cette action.");
  return m;
}

export function userHouseholds(db: Db, userId: string) {
  return db
    .prep(
      `SELECT h.id, h.name, m.role, m.id AS memberId FROM members m JOIN households h ON h.id = m.householdId
       WHERE m.userId = ? AND m.active = 1 ORDER BY m.joinedAt`,
    )
    .all(userId) as { id: string; name: string; role: Role; memberId: string }[];
}

function addMember(store: SqlStore, db: Db, householdId: string, user: { id: string; name: string; email: string }, role: Role, now: string): Member {
  const existing = db.prep('SELECT * FROM members WHERE householdId = ? AND userId = ?').get(householdId, user.id) as Record<string, unknown> | undefined;
  if (existing) {
    const m = rowToEntity('member', existing) as Member;
    if (m.active) throw new HttpError(409, 'already_member', 'Vous êtes déjà membre de ce foyer.');
    return store.put('member', { ...m, active: true, role, joinedAt: now });
  }
  const count = (db.prep('SELECT COUNT(*) AS n FROM members WHERE householdId = ?').get(householdId) as { n: number }).n;
  return store.put('member', {
    id: randomUUID(),
    householdId,
    version: 0,
    userId: user.id,
    name: user.name,
    email: user.email,
    role,
    color: MEMBER_COLORS[count % MEMBER_COLORS.length],
    active: true,
    joinedAt: now,
    prefs: {},
  });
}

function activity(store: SqlStore, householdId: string, userId: string, summary: string, important = true) {
  const now = new Date().toISOString();
  store.put('activity', {
    id: randomUUID(), householdId, version: 0, userId, type: 'household', summary, entityType: 'member', entityId: null, at: now, opId: 'server', important,
  });
}

/** Crée un foyer avec ses catégories et emplacements par défaut. */
export function createHousehold(db: Db, user: { id: string; name: string; email: string }, name: string, timezone?: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.tx(() => {
    const store = new SqlStore(db, id, user.id);
    store.put('household', {
      id, householdId: id, version: 0, name: name.trim().slice(0, 80) || 'Ma maison', currency: 'EUR',
      settings: { ...DEFAULT_SETTINGS, timezone: timezone || DEFAULT_SETTINGS.timezone }, createdAt: now, fv: {},
    });
    addMember(store, db, id, user, 'owner', now);
    DEFAULT_CATEGORIES.forEach((c, i) =>
      store.put('category', { id: randomUUID(), householdId: id, version: 0, name: c.name, icon: c.icon, color: c.color, sort: i, archived: false }),
    );
    DEFAULT_LOCATIONS.forEach((l, i) =>
      store.put('location', { id: randomUUID(), householdId: id, version: 0, name: l.name, icon: l.icon, kind: l.kind, sort: i, archived: false }),
    );
    activity(store, id, user.id, `a créé le foyer « ${name} »`);
  });
  return id;
}

export interface InvitationRow {
  id: string;
  householdId: string;
  code: string;
  role: Role;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt: string | null;
}

export function createInvitation(db: Db, householdId: string, userId: string, role: Role, days: number, maxUses: number): InvitationRow {
  if (role === 'owner') throw new HttpError(400, 'invalid', 'Une invitation ne peut pas donner le rôle de propriétaire.');
  const now = new Date();
  const inv: InvitationRow = {
    id: randomUUID(),
    householdId,
    code: invitationCode(),
    role,
    createdBy: userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Math.min(Math.max(days, 1), 30) * 86_400_000).toISOString(),
    maxUses: Math.min(Math.max(maxUses, 1), 20),
    uses: 0,
    revokedAt: null,
  };
  db.prep('INSERT INTO invitations(id, householdId, code, role, createdBy, createdAt, expiresAt, maxUses, uses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)').run(
    inv.id, inv.householdId, inv.code, inv.role, inv.createdBy, inv.createdAt, inv.expiresAt, inv.maxUses,
  );
  return inv;
}

export function findInvitation(db: Db, code: string): InvitationRow | null {
  const norm = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (norm.length !== 10) return null;
  const formatted = `${norm.slice(0, 5)}-${norm.slice(5)}`;
  const inv = db.prep('SELECT * FROM invitations WHERE code = ?').get(formatted) as InvitationRow | undefined;
  if (!inv || inv.revokedAt || inv.uses >= inv.maxUses || Date.parse(inv.expiresAt) < Date.now()) return null;
  return inv;
}

/** Rejoint un foyer avec un code (transaction : usage compté une seule fois). */
export function acceptInvitation(db: Db, code: string, user: { id: string; name: string; email: string }): string {
  return db.tx(() => {
    const inv = findInvitation(db, code);
    if (!inv) throw new HttpError(404, 'invalid_invitation', "Code d'invitation invalide, expiré ou déjà utilisé.");
    const store = new SqlStore(db, inv.householdId, user.id);
    addMember(store, db, inv.householdId, user, inv.role, new Date().toISOString());
    db.prep('UPDATE invitations SET uses = uses + 1 WHERE id = ?').run(inv.id);
    activity(store, inv.householdId, user.id, 'a rejoint le foyer');
    return inv.householdId;
  });
}

function ownerCount(db: Db, householdId: string): number {
  return (db.prep("SELECT COUNT(*) AS n FROM members WHERE householdId = ? AND active = 1 AND role = 'owner'").get(householdId) as { n: number }).n;
}

export function changeRole(db: Db, householdId: string, actor: Member, targetUserId: string, role: Role) {
  db.tx(() => {
    const target = membership(db, householdId, targetUserId);
    if (!target) throw new HttpError(404, 'not_found', 'Membre introuvable.');
    if ((role === 'owner' || target.role === 'owner') && actor.role !== 'owner') {
      throw new HttpError(403, 'forbidden', 'Seul un propriétaire peut attribuer ou retirer le rôle de propriétaire.');
    }
    if (target.role === 'owner' && role !== 'owner' && ownerCount(db, householdId) <= 1) {
      throw new HttpError(409, 'last_owner', 'Le foyer doit garder au moins un propriétaire.');
    }
    const store = new SqlStore(db, householdId, actor.userId);
    store.put('member', { ...target, role });
    activity(store, householdId, actor.userId, `a changé le rôle de ${target.name}`);
  });
}

export function removeMember(db: Db, householdId: string, actor: Member, targetUserId: string) {
  db.tx(() => {
    const target = membership(db, householdId, targetUserId);
    if (!target) throw new HttpError(404, 'not_found', 'Membre introuvable.');
    const self = actor.userId === targetUserId;
    if (!self && !hasRole(actor.role, 'admin')) throw new HttpError(403, 'forbidden', 'Seul un administrateur peut retirer un membre.');
    if (!self && target.role === 'owner' && actor.role !== 'owner') throw new HttpError(403, 'forbidden', 'Seul un propriétaire peut retirer un propriétaire.');
    if (target.role === 'owner' && ownerCount(db, householdId) <= 1) {
      throw new HttpError(409, 'last_owner', 'Le dernier propriétaire ne peut pas quitter le foyer : nommez un autre propriétaire ou supprimez le foyer.');
    }
    const store = new SqlStore(db, householdId, actor.userId);
    store.put('member', { ...target, active: false });
    activity(store, householdId, actor.userId, self ? 'a quitté le foyer' : `a retiré ${target.name} du foyer`);
  });
}
