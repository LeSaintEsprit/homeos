/**
 * Vues de synthèse pour les prévisions, la péremption et la qualité des données.
 * Fonctions pures construites sur l'analyse du moteur : rien n'est estimé ici
 * qui ne l'ait déjà été (avec son niveau de confiance) par le moteur.
 */
import type { HouseholdSettings } from '../types';
import { addDays, daysBetween, startOfWeek } from '../time';
import type { Confidence, HouseholdForecast, LotInsight, ProductInsight } from './engine';

export interface LotEntry {
  insight: ProductInsight;
  lot: LotInsight;
}

export interface ExpiryOverview {
  /** Lots dont la date est dépassée (à vérifier : DDM souvent encore consommable). */
  expired: LotEntry[];
  /** Expire aujourd'hui. */
  today: LotEntry[];
  /** Dans le délai « urgent » du foyer. */
  urgent: LotEntry[];
  /** Dans le délai « bientôt » du foyer. */
  soon: LotEntry[];
  /** Lots ouverts encore en stock (date effective = conservation après ouverture). */
  opened: LotEntry[];
  /** Quantités qui risquent d'être jetées au rythme de consommation actuel (consommation fiable uniquement). */
  atRisk: LotEntry[];
  /** Produits en stock sans aucun mouvement depuis longtemps. */
  forgotten: ProductInsight[];
  /** Lots sans date connue dans des produits habituellement datés. */
  undated: LotEntry[];
}

const byDate = (a: LotEntry, b: LotEntry) =>
  (a.lot.effectiveExpiry ?? '9999').localeCompare(b.lot.effectiveExpiry ?? '9999') || a.insight.product.name.localeCompare(b.insight.product.name, 'fr');

/** Lots regroupés par urgence de consommation (ordre FEFO dans chaque groupe). */
export function expiryOverview(forecast: HouseholdForecast): ExpiryOverview {
  const out: ExpiryOverview = { expired: [], today: [], urgent: [], soon: [], opened: [], atRisk: [], forgotten: [], undated: [] };
  for (const ins of forecast.insights) {
    const dated = ins.lots.some((l) => l.effectiveExpiry);
    for (const lot of ins.lots) {
      const e = { insight: ins, lot };
      if (lot.status === 'expired') out.expired.push(e);
      else if (lot.status === 'today') out.today.push(e);
      else if (lot.status === 'urgent') out.urgent.push(e);
      else if (lot.status === 'soon') out.soon.push(e);
      if (lot.lot.openedAt && lot.status !== 'expired') out.opened.push(e);
      if (lot.atRiskQty > 0 && lot.status !== 'expired') out.atRisk.push(e);
      if (lot.status === 'unknown' && dated) out.undated.push(e);
    }
    if (ins.forgotten) out.forgotten.push(ins);
  }
  for (const k of ['expired', 'today', 'urgent', 'soon', 'opened', 'atRisk', 'undated'] as const) out[k].sort(byDate);
  out.forgotten.sort((a, b) => (a.lastMovementAt ?? '').localeCompare(b.lastMovementAt ?? ''));
  return out;
}

export interface TimelineEvent {
  productId: string;
  name: string;
  date: string;
  kind: 'runout' | 'regular';
  confidence: Confidence;
  /** Jours avant l'événement (0 = aujourd'hui). */
  inDays: number;
  /** Déjà couvert par la liste de courses. */
  onList: boolean;
}

export interface TimelineWeek {
  /** Lundi de la semaine. */
  week: string;
  events: TimelineEvent[];
}

/**
 * Calendrier des ruptures prévues (consommation fiable uniquement) et des achats
 * réguliers attendus, sur un horizon donné. Les produits déjà épuisés n'y figurent
 * pas : ils sont dans les recommandations « maintenant ».
 */
export function runOutTimeline(forecast: HouseholdForecast, today: string, horizonDays = 42): TimelineWeek[] {
  const end = addDays(today, horizonDays);
  const events: TimelineEvent[] = [];
  for (const ins of forecast.insights) {
    if (ins.status === 'untracked' || ins.usable <= 1e-9) continue;
    const p = ins.product;
    if (ins.runOutDate && ins.consumption.reliable && ins.runOutDate <= end) {
      events.push({ productId: p.id, name: p.name, date: ins.runOutDate, kind: 'runout', confidence: ins.consumption.confidence, inDays: Math.max(0, daysBetween(today, ins.runOutDate)), onList: ins.onList > 0 });
    } else if (ins.cadence?.regular && !ins.consumption.reliable && ins.cadence.nextExpected <= end) {
      const d = ins.cadence.nextExpected < today ? today : ins.cadence.nextExpected;
      events.push({ productId: p.id, name: p.name, date: d, kind: 'regular', confidence: ins.cadence.count >= 5 ? 'medium' : 'low', inDays: daysBetween(today, d), onList: ins.onList > 0 });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'fr'));
  const weeks = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const w = startOfWeek(e.date);
    weeks.set(w, [...(weeks.get(w) ?? []), e]);
  }
  return [...weeks.entries()].map(([week, list]) => ({ week, events: list }));
}

export type GapKind = 'no_data' | 'needs_check' | 'approx' | 'low_confidence';

export interface DataGap {
  insight: ProductInsight;
  kind: GapKind;
  message: string;
}

/**
 * Ce qui empêche des prévisions fiables, produit par produit, avec l'action utile.
 * Un produit n'apparaît qu'une fois, pour sa lacune la plus bloquante.
 */
export function dataGaps(forecast: HouseholdForecast, settings: HouseholdSettings): DataGap[] {
  const out: DataGap[] = [];
  for (const ins of forecast.insights) {
    if (ins.status === 'untracked') continue;
    const p = ins.product;
    const c = ins.consumption;
    if (p.minQty == null && p.idealQty == null && !c.reliable && !ins.cadence?.regular) {
      out.push({
        insight: ins,
        kind: 'no_data',
        message:
          c.events > 0
            ? `Historique encore court (${c.events} consommation${c.events > 1 ? 's' : ''}) et aucun seuil : définissez un seuil minimal pour être prévenu à temps.`
            : 'Aucun seuil ni historique : définissez un seuil minimal ou enregistrez les consommations.',
      });
    } else if (checkReasons(ins).length) {
      out.push({ insight: ins, kind: 'needs_check', message: `Stock à vérifier : ${checkReasons(ins).join(' ; ')}.` });
    } else if (ins.quality.approx) {
      out.push({ insight: ins, kind: 'approx', message: 'Quantité approximative : un comptage rendra les prévisions plus sûres.' });
    } else if (c.confidence === 'low' && c.source === 'observed' && ins.usable > 0 && ins.daysLeft != null && ins.daysLeft <= (settings.shoppingIntervalDays + settings.safetyDays) * 2) {
      out.push({ insight: ins, kind: 'low_confidence', message: `Consommation encore peu observée (${c.events} relevé${c.events > 1 ? 's' : ''} sur ${Math.round(c.spanDays)} j) : prévision indicative.` });
    }
  }
  const rank: Record<GapKind, number> = { no_data: 0, needs_check: 1, approx: 2, low_confidence: 3 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.insight.product.name.localeCompare(b.insight.product.name, 'fr'));
}

/** Raisons de vérifier le stock, hors simple saisie approximative (traitée à part). */
function checkReasons(ins: ProductInsight): string[] {
  return ins.quality.approx ? ins.quality.reasons.slice(1) : ins.quality.reasons;
}

/** Semaine (lundi) en clair : « semaine du 16 nov. ». */
export function weekLabel(week: string, today: string): string {
  const cur = startOfWeek(today);
  if (week === cur) return 'Cette semaine';
  if (week === addDays(cur, 7)) return 'Semaine prochaine';
  const [, m, d] = week.split('-');
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `Semaine du ${Number(d)} ${MONTHS[Number(m) - 1]}`;
}
