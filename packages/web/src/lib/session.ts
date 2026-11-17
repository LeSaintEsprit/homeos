import type { Role } from '@homeos/shared';
import { ApiError, get, post } from './api';
import { Observable } from './store';
import { deleteLocalHousehold, knownLocalHouseholds } from './sync/db';

export interface HouseholdRef {
  id: string;
  name: string;
  avatar: string | null;
  currency: string;
  role: Role;
  memberId: string;
}

export interface Me {
  user: { id: string; email: string; name: string; isServerAdmin: boolean };
  households: HouseholdRef[];
}

export interface SessionState {
  status: 'loading' | 'anon' | 'ready';
  /** Données issues du cache local (serveur injoignable au démarrage). */
  offline: boolean;
  me: Me | null;
  activeId: string | null;
}

const ME_KEY = 'homeos:me';
const activeKey = (uid: string) => `homeos:active:${uid}`;

export const session = new Observable<SessionState>({ status: 'loading', offline: false, me: null, activeId: null });

function pickActive(me: Me): string | null {
  const saved = localStorage.getItem(activeKey(me.user.id));
  if (saved && me.households.some((h) => h.id === saved)) return saved;
  return me.households[0]?.id ?? null;
}

/** Supprime de l'appareil les données des foyers que l'utilisateur a quittés. */
async function purgeLeftHouseholds(me: Me) {
  const keep = new Set(me.households.map((h) => h.id));
  for (const hid of knownLocalHouseholds(me.user.id)) {
    if (!keep.has(hid)) await deleteLocalHousehold(me.user.id, hid);
  }
}

export function applyMe(me: Me, offline = false) {
  localStorage.setItem(ME_KEY, JSON.stringify(me));
  const prev = session.get();
  const activeId = prev.activeId && me.households.some((h) => h.id === prev.activeId) ? prev.activeId : pickActive(me);
  if (activeId) localStorage.setItem(activeKey(me.user.id), activeId);
  session.set({ status: 'ready', offline, me, activeId });
  if (!offline) void purgeLeftHouseholds(me);
}

export async function loadSession() {
  try {
    applyMe(await get<Me>('/api/auth/me'));
  } catch (e) {
    if (e instanceof ApiError && e.offline) {
      const cached = localStorage.getItem(ME_KEY);
      if (cached) {
        applyMe(JSON.parse(cached), true);
        return;
      }
    }
    session.set({ status: 'anon', offline: false, me: null, activeId: null });
  }
}

export async function refreshMe() {
  try {
    applyMe(await get<Me>('/api/auth/me'));
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) session.set({ status: 'anon', offline: false, me: null, activeId: null });
  }
}

export function setActiveHousehold(hid: string) {
  const s = session.get();
  if (!s.me || !s.me.households.some((h) => h.id === hid)) return;
  localStorage.setItem(activeKey(s.me.user.id), hid);
  session.set({ ...s, activeId: hid });
}

/** Déconnexion : supprime aussi les données locales de l'appareil (appareil partagé). */
export async function logout() {
  const s = session.get();
  try {
    await post('/api/auth/logout');
  } catch {
    /* hors ligne : on nettoie quand même l'appareil */
  }
  if (s.me) for (const hid of knownLocalHouseholds(s.me.user.id)) await deleteLocalHousehold(s.me.user.id, hid);
  localStorage.removeItem(ME_KEY);
  session.set({ status: 'anon', offline: false, me: null, activeId: null });
}

export function activeHousehold(s: SessionState): HouseholdRef | null {
  return s.me?.households.find((h) => h.id === s.activeId) ?? null;
}
