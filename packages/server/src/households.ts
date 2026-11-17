import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CATEGORIES, DEFAULT_LOCATIONS, DEFAULT_NOTIFICATION_PREFS, DEFAULT_SETTINGS, MEMBER_COLORS, can,
  type HouseholdSettings, type Member, type NotificationPrefs, type Permission, type Role,
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

export interface UserRef {
  id: string;
  name: string;
  email: string;
}

export function membership(db: Db, householdId: string, userId: string): Member | null {
  const row = db.prep('SELECT * FROM members WHERE householdId = ? AND userId = ? AND active = 1').get(householdId, userId) as Record<string, unknown> | undefined;
  return row ? (rowToEntity('member', row) as Member) : null;
}

/**
 * Vérifie côté serveur que l'utilisateur est membre ACTIF du foyer et dispose de la
 * permission demandée. Le foyer d'un autre utilisateur répond 404 (aucune révélation).
 */
export function requireMember(db: Db, householdId: string, userId: string, perm: Permission = 'data.read'): Member {
  const m = membership(db, householdId, userId);
  if (!m) throw new HttpError(404, 'not_found', 'Foyer introuvable.');
  if (!can(m.role, perm)) throw new HttpError(403, 'forbidden', "Vous n'avez pas les droits nécessaires pour cette action.");
  return m;
}

export function userHouseholds(db: Db, userId: string) {
  return db
    .prep(
      `SELECT h.id, h.name, h.avatar, h.currency, m.role, m.id AS memberId FROM members m JOIN households h ON h.id = m.householdId
       WHERE m.userId = ? AND m.active = 1 ORDER BY m.joinedAt`,
    )
    .all(userId) as { id: string; name: string; avatar: string | null; currency: string; role: Role; memberId: string }[];
}

export function isAdminSomewhere(db: Db, userId: string): boolean {
  return !!db.prep("SELECT 1 FROM members WHERE userId = ? AND active = 1 AND role = 'admin' LIMIT 1").get(userId);
}

function addMember(store: SqlStore, db: Db, householdId: string, user: UserRef, role: Role, now: string, notifications?: NotificationPrefs): Member {
  const existing = db.prep('SELECT * FROM members WHERE householdId = ? AND userId = ?').get(householdId, user.id) as Record<string, unknown> | undefined;
  if (existing) {
    const m = rowToEntity('member', existing) as Member;
    if (m.active) throw new HttpError(409, 'already_member', 'Vous êtes déjà membre de ce foyer.');
    return store.put('member', { ...m, active: true, role, joinedAt: now, name: user.name, email: user.email });
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
    prefs: notifications ? { notifications } : {},
  });
}

export function logActivity(store: SqlStore, householdId: string, userId: string, summary: string, important = true) {
  store.put('activity', {
    id: randomUUID(), householdId, version: 0, userId, type: 'household', summary, entityType: 'member', entityId: null,
    at: new Date().toISOString(), opId: 'server', important,
  });
}

export interface CreateHouseholdInput {
  name: string;
  avatar?: string | null;
  currency?: string;
  timezone?: string;
  settings?: Partial<HouseholdSettings>;
  notifications?: Partial<NotificationPrefs>;
}

/** Crée un foyer : le créateur en devient administrateur ; catégories et emplacements par défaut. */
export function createHousehold(db: Db, user: UserRef, input: CreateHouseholdInput): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const name = input.name.trim().slice(0, 80) || 'Ma maison';
  db.tx(() => {
    const store = new SqlStore(db, id, user.id);
    store.put('household', {
      id,
      householdId: id,
      version: 0,
      name,
      avatar: input.avatar ?? null,
      currency: input.currency ?? 'EUR',
      settings: { ...DEFAULT_SETTINGS, ...(input.settings ?? {}), timezone: input.timezone || DEFAULT_SETTINGS.timezone },
      createdAt: now,
      createdBy: user.id,
      fv: {},
    });
    addMember(store, db, id, user, 'admin', now, { ...DEFAULT_NOTIFICATION_PREFS, ...(input.notifications ?? {}) });
    DEFAULT_CATEGORIES.forEach((c, i) =>
      store.put('category', { id: randomUUID(), householdId: id, version: 0, name: c.name, icon: c.icon, color: c.color, sort: i, archived: false }),
    );
    DEFAULT_LOCATIONS.forEach((l, i) =>
      store.put('location', { id: randomUUID(), householdId: id, version: 0, name: l.name, icon: l.icon, kind: l.kind, sort: i, archived: false }),
    );
    logActivity(store, id, user.id, `a créé le foyer « ${name} »`);
  });
  return id;
}

// ───────────────────────── Invitations ─────────────────────────

export interface InvitationRow {
  id: string;
  householdId: string;
  code: string;
  role: Role;
  email: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt: string | null;
}

export interface PlatformInvitationRow {
  id: string;
  code: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt: string | null;
}

function uniqueCode(db: Db): string {
  for (let i = 0; i < 20; i++) {
    const c = invitationCode();
    const used = db.prep('SELECT 1 FROM invitations WHERE code = ? UNION SELECT 1 FROM platform_invitations WHERE code = ?').get(c, c);
    if (!used) return c;
  }
  throw new Error('Impossible de générer un code unique');
}

function bounds(days: number, maxUses: number) {
  const now = new Date();
  return {
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Math.min(Math.max(days, 1), 30) * 86_400_000).toISOString(),
    maxUses: Math.min(Math.max(maxUses, 1), 20),
  };
}

export function createInvitation(db: Db, householdId: string, userId: string, role: Role, days: number, maxUses: number, email: string | null): InvitationRow {
  const b = bounds(days, maxUses);
  const inv: InvitationRow = { id: randomUUID(), householdId, code: uniqueCode(db), role, email: email?.toLowerCase() ?? null, createdBy: userId, ...b, uses: 0, revokedAt: null };
  db.prep('INSERT INTO invitations(id, householdId, code, role, email, createdBy, createdAt, expiresAt, maxUses, uses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').run(
    inv.id, inv.householdId, inv.code, inv.role, inv.email, inv.createdBy, inv.createdAt, inv.expiresAt, inv.maxUses,
  );
  return inv;
}

export function createPlatformInvitation(db: Db, userId: string, days: number, maxUses: number): PlatformInvitationRow {
  const b = bounds(days, maxUses);
  const inv: PlatformInvitationRow = { id: randomUUID(), code: uniqueCode(db), createdBy: userId, ...b, uses: 0, revokedAt: null };
  db.prep('INSERT INTO platform_invitations(id, code, createdBy, createdAt, expiresAt, maxUses, uses) VALUES (?, ?, ?, ?, ?, ?, 0)').run(
    inv.id, inv.code, inv.createdBy, inv.createdAt, inv.expiresAt, inv.maxUses,
  );
  return inv;
}

export function normalizeCode(code: string): string | null {
  const norm = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return norm.length === 10 ? `${norm.slice(0, 5)}-${norm.slice(5)}` : null;
}

function valid<T extends { revokedAt: string | null; uses: number; maxUses: number; expiresAt: string }>(r: T | undefined): T | null {
  if (!r || r.revokedAt || r.uses >= r.maxUses || Date.parse(r.expiresAt) < Date.now()) return null;
  return r;
}

export type AnyInvitation = { kind: 'household'; row: InvitationRow } | { kind: 'platform'; row: PlatformInvitationRow };

export function findInvitation(db: Db, code: string): AnyInvitation | null {
  const c = normalizeCode(code);
  if (!c) return null;
  const h = valid(db.prep('SELECT * FROM invitations WHERE code = ?').get(c) as InvitationRow | undefined);
  if (h) return { kind: 'household', row: h };
  const p = valid(db.prep('SELECT * FROM platform_invitations WHERE code = ?').get(c) as PlatformInvitationRow | undefined);
  return p ? { kind: 'platform', row: p } : null;
}

const INVALID = "Code d'invitation invalide, expiré ou déjà utilisé.";

/** Rejoint un foyer avec un code (transaction : usage compté une seule fois). */
export function acceptInvitation(db: Db, code: string, user: UserRef): string {
  return db.tx(() => {
    const inv = findInvitation(db, code);
    if (!inv || inv.kind !== 'household') throw new HttpError(404, 'invalid_invitation', INVALID);
    if (inv.row.email && inv.row.email !== user.email.toLowerCase()) {
      throw new HttpError(403, 'invitation_email', "Cette invitation est réservée à une autre adresse e-mail.");
    }
    const store = new SqlStore(db, inv.row.householdId, user.id);
    addMember(store, db, inv.row.householdId, user, inv.row.role, new Date().toISOString());
    db.prep('UPDATE invitations SET uses = uses + 1 WHERE id = ?').run(inv.row.id);
    logActivity(store, inv.row.householdId, user.id, 'a rejoint le foyer');
    return inv.row.householdId;
  });
}

/** Consomme une invitation plateforme (inscription d'une nouvelle famille). */
export function consumePlatformInvitation(db: Db, code: string) {
  const inv = findInvitation(db, code);
  if (!inv || inv.kind !== 'platform') throw new HttpError(404, 'invalid_invitation', INVALID);
  db.prep('UPDATE platform_invitations SET uses = uses + 1 WHERE id = ?').run(inv.row.id);
}

// ───────────────────────── Rôles et membres ─────────────────────────

export function adminCount(db: Db, householdId: string): number {
  return (db.prep("SELECT COUNT(*) AS n FROM members WHERE householdId = ? AND active = 1 AND role = 'admin'").get(householdId) as { n: number }).n;
}

export function activeCount(db: Db, householdId: string): number {
  return (db.prep('SELECT COUNT(*) AS n FROM members WHERE householdId = ? AND active = 1').get(householdId) as { n: number }).n;
}

export function changeRole(db: Db, householdId: string, actor: Member, targetUserId: string, role: Role) {
  db.tx(() => {
    const target = membership(db, householdId, targetUserId);
    if (!target) throw new HttpError(404, 'not_found', 'Membre introuvable.');
    if (target.role === 'admin' && role !== 'admin' && adminCount(db, householdId) <= 1) {
      throw new HttpError(409, 'last_admin', 'Le foyer doit garder au moins un administrateur.');
    }
    if (target.role === role) return;
    const store = new SqlStore(db, householdId, actor.userId);
    store.put('member', { ...target, role });
    logActivity(store, householdId, actor.userId, `a changé le rôle de ${target.name}`);
  });
}

export function removeMember(db: Db, householdId: string, actor: Member, targetUserId: string) {
  db.tx(() => {
    const target = membership(db, householdId, targetUserId);
    if (!target) throw new HttpError(404, 'not_found', 'Membre introuvable.');
    const self = actor.userId === targetUserId;
    if (!self && !can(actor.role, 'members.manage')) throw new HttpError(403, 'forbidden', 'Seul un administrateur peut retirer un membre.');
    if (target.role === 'admin' && adminCount(db, householdId) <= 1) {
      throw new HttpError(
        409,
        'last_admin',
        self
          ? 'Vous êtes le dernier administrateur : nommez un autre administrateur ou supprimez le foyer avant de le quitter.'
          : 'Le foyer doit garder au moins un administrateur.',
      );
    }
    const store = new SqlStore(db, householdId, actor.userId);
    store.put('member', { ...target, active: false });
    logActivity(store, householdId, actor.userId, self ? 'a quitté le foyer' : `a retiré ${target.name} du foyer`);
  });
}
