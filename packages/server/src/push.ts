import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as webpush from 'web-push';
import {
  analyzeHousehold, auditHousehold, buildDigest, computeAlerts, dateInTz, detectUnusualSpending, memberNotificationPrefs, visibleAlerts,
  type Activity, type Household, type Member,
} from '@homeos/shared';
import type { Db } from './db';
import type { Config } from './config';
import { collectionsOf } from './exportImport';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<void>;

interface SubRow {
  endpoint: string;
  userId: string;
  p256dh: string;
  auth: string;
}

/**
 * Notifications Web Push (standard ouvert, clés VAPID générées localement, aucun
 * service payant). Anti-doublon : chaque clé de notification n'est envoyée qu'une fois.
 */
export class PushService {
  readonly publicKey: string;
  private sender: PushSender;

  constructor(
    private db: Db,
    private config: Config,
    sender?: PushSender,
  ) {
    const file = join(config.dataDir, 'vapid.json');
    let keys: { publicKey: string; privateKey: string };
    if (existsSync(file)) keys = JSON.parse(readFileSync(file, 'utf8'));
    else {
      keys = webpush.generateVAPIDKeys();
      writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    }
    this.publicKey = keys.publicKey;
    webpush.setVapidDetails(config.vapidSubject, keys.publicKey, keys.privateKey);
    this.sender = sender ?? (async (sub, payload) => {
      await webpush.sendNotification(sub, payload, { TTL: 12 * 3600 });
    });
  }

  subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, ua?: string) {
    if (!/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) throw new Error('Abonnement invalide');
    this.db
      .prep('INSERT INTO push_subscriptions(endpoint, userId, p256dh, auth, createdAt, userAgent) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET userId = excluded.userId, p256dh = excluded.p256dh, auth = excluded.auth')
      .run(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth, new Date().toISOString(), (ua ?? '').slice(0, 200));
  }

  unsubscribe(userId: string, endpoint: string) {
    this.db.prep('DELETE FROM push_subscriptions WHERE endpoint = ? AND userId = ?').run(endpoint, userId);
  }

  hasSubscription(userId: string): boolean {
    return !!this.db.prep('SELECT 1 FROM push_subscriptions WHERE userId = ? LIMIT 1').get(userId);
  }

  /** Envoie une notification une seule fois par clé et par utilisateur. */
  async sendOnce(userId: string, key: string, payload: PushPayload): Promise<number> {
    const claimed = this.db.prep('INSERT OR IGNORE INTO notification_log(key, userId, sentAt) VALUES (?, ?, ?)').run(key, userId, new Date().toISOString());
    if (!claimed.changes) return 0;
    const subs = this.db.prep('SELECT * FROM push_subscriptions WHERE userId = ?').all(userId) as SubRow[];
    let sent = 0;
    for (const s of subs) {
      try {
        await this.sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) this.db.prep('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint);
      }
    }
    return sent;
  }

  /** Alertes immédiates pour les modifications importantes faites par d'autres membres. */
  async notifyImportant(householdId: string, acts: Activity[]) {
    if (!acts.length) return;
    const members = (this.db.prep('SELECT userId, name, prefs FROM members WHERE householdId = ? AND active = 1').all(householdId) as { userId: string; name: string; prefs: string }[]);
    const hname = (this.db.prep('SELECT name FROM households WHERE id = ?').get(householdId) as { name: string } | undefined)?.name ?? '';
    for (const a of acts) {
      const actor = members.find((m) => m.userId === a.userId)?.name ?? 'Un membre';
      for (const m of members) {
        if (m.userId === a.userId) continue;
        const prefs = memberNotificationPrefs({ prefs: JSON.parse(m.prefs || '{}') } as Member);
        if (!prefs.pushImportant || prefs.muted.includes('important_change')) continue;
        // Le foyer est nommé et le clic ouvre l'application sur CE foyer (comptes multi-foyers).
        await this.sendOnce(m.userId, `act:${a.id}`, { title: `HOMEOS · ${hname}`, body: `${actor} ${a.summary}`, url: `/notifications?foyer=${householdId}`, tag: `act-${a.id}` });
      }
    }
  }

  /** Récapitulatifs quotidiens/hebdomadaires à l'heure choisie par chaque membre. */
  async runDigests(now = new Date()): Promise<number> {
    let count = 0;
    const households = this.db.prep('SELECT id FROM households').all() as { id: string }[];
    for (const { id } of households) {
      const subscribed = this.db
        .prep('SELECT DISTINCT m.userId FROM members m JOIN push_subscriptions p ON p.userId = m.userId WHERE m.householdId = ? AND m.active = 1')
        .all(id) as { userId: string }[];
      if (!subscribed.length) continue;
      const c = collectionsOf(this.db, id);
      const h = c.household.get(id) as Household;
      const tz = h.settings.timezone;
      const today = dateInTz(now, tz);
      // formatToParts : en français, le format horaire seul donne « 08 h », pas « 08 ».
      const hourPart = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).find((p) => p.type === 'hour');
      const hour = Number(hourPart?.value ?? -1);
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
      const iso = now.toISOString();
      const forecast = analyzeHousehold({
        products: [...c.product.values()], lots: [...c.lot.values()], movements: [...c.movement.values()], items: [...c.shoppingItem.values()],
        purchases: [...c.purchase.values()], locations: [...c.location.values()], settings: h.settings, now: iso, today,
      });
      const audit = auditHousehold(c, iso);
      const unusual = detectUnusualSpending([...c.purchase.values()], c.product, today, h.settings.monthlyBudgetCents, h.currency);
      for (const { userId } of subscribed) {
        const member = [...c.member.values()].find((m) => m.userId === userId);
        const prefs = memberNotificationPrefs(member);
        if (prefs.digest === 'off' || prefs.digestHour !== hour) continue;
        if (prefs.digest === 'weekly' && weekday !== 'Mon') continue;
        const alerts = visibleAlerts(computeAlerts({ forecast, collections: c, audit, unusual, member, now: iso, today }), member).filter((a) => a.kind !== 'important_change');
        const digest = buildDigest(alerts, prefs.digest);
        if (!digest) continue;
        const key = prefs.digest === 'daily' ? `digest:${id}:${today}` : `digest-w:${id}:${today}`;
        // Étiquette propre au foyer : le récapitulatif d'un foyer ne remplace jamais celui d'un autre.
        count += await this.sendOnce(userId, key, { title: `${digest.title} · ${h.name}`, body: digest.body, url: `/notifications?foyer=${id}`, tag: `digest-${id}` });
      }
    }
    // Purge du journal d'envoi (> 60 jours).
    this.db.prep('DELETE FROM notification_log WHERE sentAt < ?').run(new Date(now.getTime() - 60 * 86_400_000).toISOString());
    return count;
  }
}
