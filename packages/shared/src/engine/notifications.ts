/**
 * Centre de notifications : alertes calculées à partir de l'état du foyer,
 * avec clé de déduplication stable, préférences par membre et récapitulatif.
 */
import type { Activity, EntityCollections, Member, NotificationKind, NotificationPrefs } from '../types';
import type { HouseholdForecast } from './engine';
import type { AuditIssue } from './audit';
import type { UnusualSpending } from './stats';
import { DEFAULT_NOTIFICATION_PREFS, DEFAULT_SETTINGS } from '../defaults';
import { addDays, daysBetweenInstants, frDate } from '../time';
import { nextShoppingTrip } from '../shopping';
import { formatQty } from '../units';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  key: string;
  kind: NotificationKind;
  severity: AlertSeverity;
  title: string;
  body: string;
  productId?: string;
  link?: string;
  at: string;
}

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  stock_out: 'Produits épuisés',
  stock_low: 'Stocks critiques',
  expiring: 'Péremptions proches',
  to_buy: 'Produits à acheter',
  shopping_unfinished: 'Courses non terminées',
  important_change: 'Modifications importantes',
  unusual_spending: 'Dépenses inhabituelles',
  inventory_check: 'Inventaires à vérifier',
  data_issue: 'Anomalies de données',
};

export interface AlertInput {
  forecast: HouseholdForecast;
  collections: EntityCollections;
  audit: AuditIssue[];
  unusual: UnusualSpending[];
  member: Member | undefined;
  now: string;
  today: string;
}

export function memberNotificationPrefs(m: Member | undefined): NotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(m?.prefs.notifications ?? {}) };
}

export function computeAlerts(input: AlertInput): Alert[] {
  const { forecast, collections: c, now, today, member } = input;
  const out: Alert[] = [];
  for (const ins of forecast.insights) {
    const p = ins.product;
    if (ins.status === 'out' && !ins.coveredByList) {
      const since = ins.lots.length ? today : (ins.lastMovementAt ?? today).slice(0, 10);
      out.push({ key: `stock_out:${p.id}:${since}`, kind: 'stock_out', severity: 'critical', title: `${p.name} : épuisé`, body: ins.recommendation?.explanation ?? 'Le stock est épuisé.', productId: p.id, link: `/inventaire/${p.id}`, at: now });
    } else if (ins.status === 'low' && !ins.coveredByList) {
      out.push({ key: `stock_low:${p.id}:${today}`, kind: 'stock_low', severity: 'warning', title: `${p.name} : stock critique`, body: `Il reste ${formatQty(ins.usable, p.unit)} (seuil : ${formatQty(p.minQty ?? 0, p.unit)}).`, productId: p.id, link: `/inventaire/${p.id}`, at: now });
    }
    for (const li of ins.lots) {
      if (li.status === 'expired' || li.status === 'today' || li.status === 'urgent') {
        const when = li.status === 'expired' ? 'périmé' : li.status === 'today' ? "périme aujourd'hui" : `périme dans ${li.daysToExpiry} jour${li.daysToExpiry! > 1 ? 's' : ''}`;
        out.push({
          key: `expiring:${li.lot.id}:${li.status}`,
          kind: 'expiring',
          severity: li.status === 'expired' ? 'critical' : 'warning',
          title: `${p.name} : ${when}`,
          body: `Quantité concernée : ${formatQty(li.lot.quantity, p.unit)}.${li.lot.expiryKind === 'ddm' && li.status === 'expired' ? ' DDM : souvent encore consommable après la date, à vérifier.' : ''}`,
          productId: p.id,
          link: '/previsions?vue=peremption',
          at: now,
        });
      }
    }
    if (ins.quality.needsCheck) {
      out.push({ key: `inventory_check:${p.id}:${today.slice(0, 7)}`, kind: 'inventory_check', severity: 'info', title: `${p.name} : stock à vérifier`, body: ins.quality.reasons.join(' ; '), productId: p.id, link: `/inventaire/${p.id}`, at: now });
    }
  }
  const urgent = forecast.recommendations.filter((r) => r.urgency === 'now');
  if (urgent.length) {
    out.push({ key: `to_buy:${today}:${urgent.length}`, kind: 'to_buy', severity: 'info', title: `${urgent.length} produit${urgent.length > 1 ? 's' : ''} à acheter`, body: urgent.slice(0, 3).map((r) => r.explanation).join(' '), link: '/previsions', at: now });
  }
  // Suggestion périodique : la veille de la prochaine sortie habituelle (et jusqu'aux courses suivantes),
  // tout ce qui est à prévoir — y compris les achats habituels — en un seul rappel par période.
  const settings = [...c.household.values()][0]?.settings ?? DEFAULT_SETTINGS;
  const { nextTrip } = nextShoppingTrip([...c.purchase.values()], settings.shoppingIntervalDays, today);
  if (nextTrip && today >= addDays(nextTrip, -1) && forecast.recommendations.length) {
    const recos = forecast.recommendations;
    const names = recos.slice(0, 5).map((r) => c.product.get(r.productId)?.name).filter(Boolean) as string[];
    const regular = recos.filter((r) => r.reason === 'regular').length;
    const when = nextTrip > today ? ` (prévues vers le ${frDate(nextTrip)})` : '';
    out.push({
      key: `restock:${nextTrip}`,
      kind: 'to_buy',
      severity: 'info',
      title: `Prochaines courses${when} : ${recos.length} produit${recos.length > 1 ? 's' : ''} à prévoir`,
      body: `${names.join(', ')}${recos.length > names.length ? '…' : ''}${regular ? ` — dont ${regular} achat${regular > 1 ? 's' : ''} habituel${regular > 1 ? 's' : ''}` : ''}. Rien n'est ajouté à la liste sans votre accord.`,
      link: '/courses',
      at: now,
    });
  }
  const waiting = [...c.shoppingItem.values()].filter((i) => i.status === 'purchased' && i.purchasedAt && daysBetweenInstants(i.purchasedAt, now) > 0.5);
  if (waiting.length) {
    out.push({ key: `shopping_unfinished:${today}`, kind: 'shopping_unfinished', severity: 'warning', title: 'Courses à réceptionner', body: `${waiting.length} article${waiting.length > 1 ? 's' : ''} acheté${waiting.length > 1 ? 's' : ''} pas encore rangé${waiting.length > 1 ? 's' : ''} dans le stock.`, link: '/courses?tab=reception', at: now });
  }
  for (const s of c.inventorySession.values()) {
    if (s.status === 'open' && daysBetweenInstants(s.updatedAt, now) > 3) {
      out.push({ key: `inventory_open:${s.id}`, kind: 'inventory_check', severity: 'info', title: `Inventaire « ${s.title} » en attente`, body: 'Reprenez-le ou validez-le pour mettre le stock à jour.', link: `/inventaire/inventaires/${s.id}`, at: now });
    }
  }
  const since = new Date(Date.parse(now) - 7 * 86_400_000).toISOString();
  const acts = [...c.activity.values()].filter((a: Activity) => a.important && a.at >= since && a.userId !== member?.userId);
  for (const a of acts.slice(-20)) {
    const who = [...c.member.values()].find((m) => m.userId === a.userId)?.name ?? 'Un membre';
    out.push({ key: `act:${a.id}`, kind: 'important_change', severity: 'info', title: `${who} ${a.summary}`, body: '', at: a.at });
  }
  for (const u of input.unusual) out.push({ key: `spend:${u.key}`, kind: 'unusual_spending', severity: 'warning', title: 'Dépense inhabituelle', body: u.message, link: '/depenses', at: now });
  const errors = input.audit.filter((i) => i.severity !== 'info');
  if (errors.length) {
    out.push({ key: `data_issue:${today}:${errors.length}`, kind: 'data_issue', severity: errors.some((e) => e.severity === 'error') ? 'critical' : 'warning', title: `${errors.length} incohérence${errors.length > 1 ? 's' : ''} à vérifier`, body: errors[0].message, link: '/inventaire/controle', at: now });
  }
  return out;
}

/** Filtre selon les préférences du membre et les alertes déjà masquées. */
export function visibleAlerts(alerts: Alert[], member: Member | undefined): Alert[] {
  const prefs = memberNotificationPrefs(member);
  const dismissed = member?.prefs.dismissed ?? {};
  const seen = new Set<string>();
  return alerts.filter((a) => {
    if (prefs.muted.includes(a.kind) || dismissed[a.key] || seen.has(a.key)) return false;
    seen.add(a.key);
    return true;
  });
}

const SEV: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Récapitulatif (push quotidien/hebdomadaire) : regroupe au lieu de multiplier les alertes. */
export function buildDigest(alerts: Alert[], period: 'daily' | 'weekly'): { title: string; body: string } | null {
  if (!alerts.length) return null;
  const counts = new Map<NotificationKind, number>();
  for (const a of alerts) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => `${NOTIFICATION_KIND_LABELS[k]} : ${n}`);
  const top = [...alerts].sort((a, b) => SEV[a.severity] - SEV[b.severity]).slice(0, 3).map((a) => `• ${a.title}`);
  return {
    title: period === 'daily' ? 'HOMEOS — votre point du jour' : 'HOMEOS — votre point de la semaine',
    body: [...top, parts.join(' · ')].join('\n'),
  };
}
