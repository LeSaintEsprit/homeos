/**
 * Moteur d'approvisionnement — déterministe, explicable, sans IA.
 *
 * Règle d'or : aucune consommation n'est inventée. Sans historique suffisant,
 * seuls les seuils configurés par le foyer sont utilisés.
 */
import type { HouseholdSettings, Location, Lot, Movement, Product, Purchase, ShoppingItem } from '../types';
import { effectiveExpiry, quantityOnList, sortFefo } from '../domain';
import { addDays, daysBetween, daysBetweenInstants, DAY_MS } from '../time';
import { formatQty, fromStockUnit, roundQty, roundUpForPurchase, unitDef, type UnitCode } from '../units';
import { deOf, humanDays, lowerFirst } from '../text';
import { estimateUnitPrice, type PriceEstimate } from './prices';

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'confiance élevée',
  medium: 'confiance moyenne',
  low: 'confiance faible',
  none: 'aucune donnée',
};

export type RateSource = 'observed' | 'purchases' | 'manual' | 'none';

export interface ConsumptionEstimate {
  /** Débit journalier dans l'unité de stock, null si inconnu. */
  dailyRate: number | null;
  source: RateSource;
  confidence: Confidence;
  /** Nombre de relevés (consommations) ou d'achats utilisés. */
  events: number;
  /** Durée d'observation effective (jours, hors ruptures). */
  spanDays: number;
  /** Utilisable pour déclencher des prévisions (confiance suffisante ou estimation manuelle). */
  reliable: boolean;
  detail: string;
}

export interface PurchaseCadence {
  count: number;
  medianIntervalDays: number;
  regular: boolean;
  lastDate: string;
  nextExpected: string;
  typicalQty: number;
}

export type StockQualityLevel = 'counted' | 'traced' | 'entered' | 'approx' | 'none';

export interface StockQuality {
  level: StockQualityLevel;
  label: string;
  approx: boolean;
  lastCountedAt: string | null;
  /** Le stock mérite une vérification physique (raisons ci-dessous). */
  needsCheck: boolean;
  reasons: string[];
}

export type ExpiryStatus = 'expired' | 'today' | 'urgent' | 'soon' | 'ok' | 'unknown';

export interface LotInsight {
  lot: Lot;
  effectiveExpiry: string | null;
  daysToExpiry: number | null;
  status: ExpiryStatus;
  /** Quantité qui risque d'être jetée vu le rythme de consommation (si connu). */
  atRiskQty: number;
}

export type StockStatus = 'out' | 'low' | 'soon' | 'ok' | 'untracked';

export type Urgency = 'now' | 'soon' | 'planned';
export type RecoReason = 'out' | 'below_min' | 'forecast' | 'regular';

export interface Recommendation {
  productId: string;
  /** Quantité à acheter dans l'unité de stock. */
  quantity: number;
  /** Quantité affichée (conditionnement si défini). */
  displayQty: number;
  displayUnit: UnitCode;
  urgency: Urgency;
  reason: RecoReason;
  /** Phrase complète : « Acheter 2 bouteilles de lait : … ». */
  explanation: string;
  /** Détail des données utilisées. */
  detail: string;
  confidence: Confidence;
  dueDate: string | null;
  price: PriceEstimate | null;
  estCostCents: number | null;
}

export interface ProductInsight {
  product: Product;
  /** Stock total, lots périmés compris. */
  total: number;
  /** Stock utilisable (lots non périmés). */
  usable: number;
  expiredQty: number;
  lots: LotInsight[];
  status: StockStatus;
  consumption: ConsumptionEstimate;
  cadence: PurchaseCadence | null;
  daysLeft: number | null;
  runOutDate: string | null;
  onList: number;
  coveredByList: boolean;
  quality: StockQuality;
  nextExpiry: LotInsight | null;
  openedLots: LotInsight[];
  atRiskQty: number;
  lastMovementAt: string | null;
  forgotten: boolean;
  recommendation: Recommendation | null;
}

export interface EngineInput {
  products: Product[];
  lots: Lot[];
  movements: Movement[];
  items: ShoppingItem[];
  purchases: Purchase[];
  locations: Location[];
  settings: HouseholdSettings;
  now: string;
  today: string;
}

const WINDOW_DAYS = 120;
const HALF_LIFE = 30;
const LN2 = Math.LN2;

const CONSUMPTION_TYPES = new Set(['consume', 'finish']);

function isConsumption(m: Movement): boolean {
  if (m.revertedBy || m.delta >= 0) return false;
  return CONSUMPTION_TYPES.has(m.type) || (m.type === 'adjust' && m.reason === 'unlogged');
}

function isRestock(m: Movement): boolean {
  return !m.revertedBy && m.delta > 0 && (m.type === 'purchase' || (m.type === 'add' && m.source !== 'inventory' && m.source !== 'import'));
}

/** Intégrale de la pondération 2^(-âge/H) entre deux âges (jours). */
function weightIntegral(ageNear: number, ageFar: number): number {
  return (HALF_LIFE / LN2) * (Math.pow(2, -ageNear / HALF_LIFE) - Math.pow(2, -ageFar / HALF_LIFE));
}

/**
 * Consommation observée : relevés pondérés vers le récent, en excluant les
 * périodes où le stock était à zéro (on ne peut pas consommer ce qu'on n'a pas).
 */
export function observedConsumption(product: Product, movements: Movement[], now: string): ConsumptionEstimate {
  const nowMs = Date.parse(now);
  const sorted = movements.filter((m) => m.productId === product.id && m.type !== 'revert').sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  const none: ConsumptionEstimate = { dailyRate: null, source: 'none', confidence: 'none', events: 0, spanDays: 0, reliable: false, detail: 'Aucune consommation enregistrée.' };
  if (!sorted.length) return none;
  const windowStart = nowMs - WINDOW_DAYS * DAY_MS;
  const start = Math.max(windowStart, Date.parse(sorted[0].occurredAt), Date.parse(product.createdAt));
  if (nowMs - start < DAY_MS) return { ...none, detail: "Produit suivi depuis moins d'un jour." };

  // Intervalles [t_i, t_{i+1}) avec le stock après chaque mouvement.
  let weightSum = 0;
  let span = 0;
  let level = 0;
  let cursor = start;
  for (const m of sorted) {
    const t = Math.min(Date.parse(m.occurredAt), nowMs);
    if (t > cursor) {
      if (level > 1e-9) {
        weightSum += weightIntegral((nowMs - t) / DAY_MS, (nowMs - cursor) / DAY_MS);
        span += (t - cursor) / DAY_MS;
      }
      cursor = t;
    }
    // Les sorties qui ramènent le stock à zéro sont comptées dans l'intervalle précédent.
    level = m.quantityAfter;
  }
  if (nowMs > cursor && level > 1e-9) {
    weightSum += weightIntegral(0, (nowMs - cursor) / DAY_MS);
    span += (nowMs - cursor) / DAY_MS;
  }
  const events = sorted.filter((m) => isConsumption(m) && Date.parse(m.occurredAt) >= start);
  if (!events.length || weightSum <= 0) {
    return { ...none, spanDays: span, detail: span >= 14 ? `Aucune consommation enregistrée sur ${Math.round(span)} jours.` : 'Aucune consommation enregistrée.' };
  }
  let weighted = 0;
  for (const e of events) weighted += -e.delta * Math.pow(2, -((nowMs - Date.parse(e.occurredAt)) / DAY_MS) / HALF_LIFE);
  const rate = weighted / weightSum;
  const n = events.length;
  const confidence: Confidence = n >= 6 && span >= 30 ? 'high' : n >= 3 && span >= 14 ? 'medium' : n >= 1 && span >= 3 ? 'low' : 'none';
  return {
    dailyRate: confidence === 'none' ? null : rate,
    source: confidence === 'none' ? 'none' : 'observed',
    confidence,
    events: n,
    spanDays: span,
    reliable: confidence === 'high' || confidence === 'medium',
    detail: `${n} relevé${n > 1 ? 's' : ''} de consommation sur ${Math.round(span)} jour${span >= 2 ? 's' : ''} de stock disponible`,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Cadence d'achat : réapprovisionnements regroupés par jour. */
export function purchaseCadence(product: Product, movements: Movement[], now: string): { cadence: PurchaseCadence | null; estimate: ConsumptionEstimate | null } {
  const byDay = new Map<string, number>();
  const windowStart = new Date(Date.parse(now) - 365 * DAY_MS).toISOString();
  for (const m of movements) {
    if (m.productId !== product.id || !isRestock(m) || m.occurredAt < windowStart) continue;
    const d = m.occurredAt.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + m.delta);
  }
  const days = [...byDay.keys()].sort();
  if (days.length < 3) return { cadence: null, estimate: null };
  const intervals: number[] = [];
  for (let i = 1; i < days.length; i++) intervals.push(daysBetween(days[i - 1], days[i]));
  const med = median(intervals);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const sd = Math.sqrt(intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length);
  const cv = mean > 0 ? sd / mean : 1;
  const regular = intervals.length >= 2 && cv <= 0.5 && med >= 1;
  const last = days[days.length - 1];
  const qtys = days.map((d) => byDay.get(d)!);
  const cadence: PurchaseCadence = {
    count: days.length,
    medianIntervalDays: med,
    regular,
    lastDate: last,
    nextExpected: addDays(last, Math.round(med)),
    typicalQty: roundQty(median(qtys)),
  };
  const spanDays = daysBetween(days[0], last);
  if (spanDays < 21) return { cadence, estimate: null };
  const consumed = qtys.slice(0, -1).reduce((a, b) => a + b, 0);
  const confidence: Confidence = regular && days.length >= 4 ? 'medium' : 'low';
  return {
    cadence,
    estimate: {
      dailyRate: consumed / spanDays,
      source: 'purchases',
      confidence,
      events: days.length,
      spanDays,
      reliable: confidence === 'medium',
      detail: `déduit de ${days.length} achats sur ${spanDays} jours (environ tous les ${Math.round(med)} jours)`,
    },
  };
}

export function chooseConsumption(product: Product, observed: ConsumptionEstimate, fromPurchases: ConsumptionEstimate | null): ConsumptionEstimate {
  if (observed.reliable) return observed;
  if (fromPurchases?.reliable) return fromPurchases;
  if (product.manualDailyUse && product.manualDailyUse > 0) {
    return {
      dailyRate: product.manualDailyUse,
      source: 'manual',
      confidence: 'low',
      events: 0,
      spanDays: 0,
      reliable: true,
      detail: 'estimation saisie manuellement',
    };
  }
  if (observed.confidence === 'low') return observed;
  if (fromPurchases) return fromPurchases;
  return observed;
}

function expiryStatus(days: number | null, s: HouseholdSettings): ExpiryStatus {
  if (days == null) return 'unknown';
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days <= s.expiryUrgentDays) return 'urgent';
  if (days <= s.expirySoonDays) return 'soon';
  return 'ok';
}

export function stockQuality(product: Product, lots: Lot[], movements: Movement[], now: string): StockQuality {
  const active = lots.filter((l) => l.quantity > 0);
  const reasons: string[] = [];
  const counts = active.map((l) => l.countedAt).filter(Boolean) as string[];
  const lastCountedAt = counts.length ? counts.sort().pop()! : null;
  const approx = active.some((l) => l.qtyApprox);
  const recent = movements.filter((m) => m.productId === product.id && daysBetweenInstants(m.occurredAt, now) <= 30);
  const shortfalls = recent.filter((m) => m.flags.includes('shortfall')).length;
  if (approx) reasons.push('quantité saisie de façon approximative');
  if (shortfalls) reasons.push(`${shortfalls} consommation${shortfalls > 1 ? 's' : ''} sur un stock insuffisant ces 30 derniers jours`);
  const countAge = lastCountedAt ? daysBetweenInstants(lastCountedAt, now) : null;
  const productAge = daysBetweenInstants(product.createdAt, now);
  const moves = movements.filter((m) => m.productId === product.id && (!lastCountedAt || m.occurredAt > lastCountedAt) && m.delta !== 0).length;
  if (!approx && (countAge == null ? productAge > 60 && moves >= 15 : countAge > 90 && moves >= 15)) {
    reasons.push(lastCountedAt ? `dernier comptage il y a ${Math.round(countAge!)} jours` : 'jamais compté physiquement');
  }
  let level: StockQualityLevel;
  let label: string;
  if (!active.length) {
    level = 'none';
    label = 'Aucun stock';
  } else if (approx) {
    level = 'approx';
    label = 'Quantité approximative';
  } else if (countAge != null && countAge <= 30 && active.every((l) => l.countedAt)) {
    level = 'counted';
    label = 'Compté physiquement';
  } else if (active.every((l) => ['scan', 'receipt', 'shopping', 'count'].includes(l.qtySource))) {
    level = 'traced';
    label = 'Calculé (entrées tracées)';
  } else {
    level = 'entered';
    label = 'Calculé (saisie manuelle)';
  }
  return { level, label, approx, lastCountedAt, needsCheck: reasons.length > 0, reasons };
}

function purchaseUnit(p: Product): UnitCode {
  return p.packUnit && p.packSize ? p.packUnit : p.unit;
}

function qtyPhrase(qty: number, unit: UnitCode, name: string): string {
  if (unit === 'piece') return `${formatQty(qty, unit, { compact: true })} × ${lowerFirst(name)}`;
  return `${formatQty(qty, unit)} ${deOf(name)}`;
}

function rateText(rate: number, unit: UnitCode): string {
  if (rate * 7 < 1 && !unitDef(unit).continuous) return `~${formatQty(rate * 30, unit)} par mois`;
  if (rate < 1 && !unitDef(unit).continuous) return `~${formatQty(rate * 7, unit)} par semaine`;
  return `~${formatQty(rate, unit)} par jour`;
}

export function consumptionText(c: ConsumptionEstimate, unit: UnitCode): string {
  if (c.dailyRate == null) return c.detail;
  const src = c.source === 'manual' ? 'estimation manuelle' : c.source === 'purchases' ? 'déduit des achats' : 'observé';
  return `${rateText(c.dailyRate, unit)} (${src}, ${c.source === 'manual' ? 'à confirmer par l\'usage' : CONFIDENCE_LABELS[c.confidence]})`;
}

function minConfidence(a: Confidence, b: Confidence): Confidence {
  const r: Confidence[] = ['none', 'low', 'medium', 'high'];
  return r[Math.min(r.indexOf(a), r.indexOf(b))];
}

/** Analyse complète d'un produit. */
export function analyzeProduct(
  product: Product,
  lots: Lot[],
  movements: Movement[],
  items: ShoppingItem[],
  purchases: Purchase[],
  input: Pick<EngineInput, 'settings' | 'now' | 'today' | 'locations'>,
): ProductInsight {
  const { settings: s, now, today } = input;
  const tz = s.timezone;
  const active = sortFefo(lots.filter((l) => l.quantity > 0), product, today, tz);
  const lotInsights: LotInsight[] = active.map((lot) => {
    const eff = effectiveExpiry(lot, product, tz);
    const d = eff ? daysBetween(today, eff) : null;
    return { lot, effectiveExpiry: eff, daysToExpiry: d, status: expiryStatus(d, s), atRiskQty: 0 };
  });
  const total = roundQty(active.reduce((a, l) => a + l.quantity, 0));
  const expiredQty = roundQty(lotInsights.filter((l) => l.status === 'expired').reduce((a, l) => a + l.lot.quantity, 0));
  const usable = roundQty(total - expiredQty);

  const observed = observedConsumption(product, movements, now);
  const { cadence, estimate } = purchaseCadence(product, movements, now);
  const consumption = chooseConsumption(product, observed, estimate);
  const rate = consumption.dailyRate;
  const daysLeft = rate && rate > 0 ? usable / rate : null;
  const runOutDate = daysLeft != null ? addDays(today, Math.floor(daysLeft)) : null;

  // Risque de gaspillage : simulation de la consommation FEFO au rythme estimé.
  if (rate && rate > 0 && consumption.reliable) {
    let cumBefore = 0;
    for (const li of lotInsights) {
      if (li.status === 'expired') continue;
      if (li.daysToExpiry != null) {
        const consumableBeforeExpiry = Math.max(0, (li.daysToExpiry + 1) * rate - cumBefore);
        li.atRiskQty = roundQty(Math.max(0, li.lot.quantity - consumableBeforeExpiry));
      }
      cumBefore += li.lot.quantity;
    }
  }
  const atRiskQty = roundQty(lotInsights.reduce((a, l) => a + l.atRiskQty, 0));

  const { qty: onList } = quantityOnList(product, items);
  const quality = stockQuality(product, lots, movements, now);
  const productMoves = movements.filter((m) => m.productId === product.id);
  const lastMovementAt = productMoves.length ? productMoves.reduce((a, m) => (m.occurredAt > a ? m.occurredAt : a), productMoves[0].occurredAt) : null;
  const loc = input.locations.find((l) => l.id === product.locationId);
  const forgetDays = loc?.kind === 'fridge' ? s.forgottenFreshDays : s.forgottenDays;
  const forgotten = usable > 0 && !!lastMovementAt && daysBetweenInstants(lastMovementAt, now) > forgetDays;

  // Statut du stock.
  const horizon = s.shoppingIntervalDays + s.safetyDays;
  let status: StockStatus;
  if (!product.trackStock || product.archived) status = 'untracked';
  else if (usable <= 1e-9) status = 'out';
  else if (product.minQty != null && usable <= product.minQty) status = 'low';
  else if (daysLeft != null && consumption.reliable && daysLeft <= horizon) status = 'soon';
  else status = 'ok';

  const insight: ProductInsight = {
    product,
    total,
    usable,
    expiredQty,
    lots: lotInsights,
    status,
    consumption,
    cadence,
    daysLeft,
    runOutDate,
    onList,
    coveredByList: false,
    quality,
    nextExpiry: lotInsights.find((l) => l.effectiveExpiry) ?? null,
    openedLots: lotInsights.filter((l) => l.lot.openedAt),
    atRiskQty,
    lastMovementAt,
    forgotten,
    recommendation: null,
  };
  if (status === 'untracked') return insight;
  const reco = recommend(insight, purchases, input);
  if (reco === 'covered') insight.coveredByList = true;
  else insight.recommendation = reco;
  return insight;
}

function recommend(
  ins: ProductInsight,
  purchases: Purchase[],
  input: Pick<EngineInput, 'settings' | 'today'>,
): Recommendation | null | 'covered' {
  const { product: p, usable, consumption: c, daysLeft, onList, cadence, quality } = ins;
  const s = input.settings;
  const horizon = s.shoppingIntervalDays + s.safetyDays;
  const rate = c.reliable ? c.dailyRate : null;

  let reason: RecoReason | null = null;
  let urgency: Urgency = 'planned';
  let why = '';
  let dueDate: string | null = null;
  if (usable <= 1e-9) {
    reason = 'out';
    urgency = 'now';
    why = ins.expiredQty > 0 ? `le stock utilisable est épuisé (${formatQty(ins.expiredQty, p.unit)} périmé${ins.expiredQty > 1 ? 's' : ''})` : 'le stock est épuisé';
    dueDate = input.today;
  } else if (p.minQty != null && usable <= p.minQty) {
    reason = 'below_min';
    urgency = 'now';
    why = `il reste ${formatQty(usable, p.unit)}, ${usable < p.minQty ? 'sous le' : 'au niveau du'} seuil minimal de ${formatQty(p.minQty, p.unit)}`;
    dueDate = input.today;
  } else if (rate && daysLeft != null && daysLeft <= horizon) {
    reason = 'forecast';
    urgency = daysLeft <= s.safetyDays ? 'now' : 'soon';
    why = `le stock actuel devrait être épuisé dans ${humanDays(daysLeft)}`;
    dueDate = addDays(input.today, Math.max(0, Math.floor(daysLeft - s.safetyDays)));
  } else if (cadence?.regular && !rate && daysBetween(input.today, cadence.nextExpected) <= s.shoppingIntervalDays) {
    reason = 'regular';
    urgency = 'planned';
    const since = daysBetween(cadence.lastDate, input.today);
    why = `vous en achetez environ tous les ${Math.round(cadence.medianIntervalDays)} jours (dernier achat il y a ${since} jour${since > 1 ? 's' : ''})`;
    dueDate = cadence.nextExpected < input.today ? input.today : cadence.nextExpected;
  }
  if (!reason) return null;

  // Quantité cible.
  let target: number;
  let basis: string;
  const coverage = rate ? rate * (s.shoppingIntervalDays + horizon) : 0;
  if (p.idealQty != null && p.idealQty > 0) {
    target = Math.max(p.idealQty, coverage);
    basis = coverage > p.idealQty ? `couvrir ~${s.shoppingIntervalDays + horizon} jours au rythme actuel` : `quantité idéale de ${formatQty(p.idealQty, p.unit)}`;
  } else if (rate) {
    target = Math.max(coverage, p.minQty != null ? p.minQty * 2 : 0);
    basis = `couvrir ~${s.shoppingIntervalDays + horizon} jours au rythme actuel`;
  } else if (cadence) {
    target = usable + cadence.typicalQty;
    basis = `quantité habituellement achetée (${formatQty(cadence.typicalQty, p.unit)})`;
  } else if (p.minQty != null && p.minQty > 0) {
    target = p.minQty * 2;
    basis = `deux fois le seuil minimal (aucune quantité idéale définie)`;
  } else {
    target = usable + (p.packSize && p.packUnit ? p.packSize : unitDef(p.unit).continuous ? 0 : 1);
    if (target <= usable) target = usable + 1e-6;
    basis = 'un conditionnement (définissez une quantité idéale pour affiner)';
  }
  let need = roundQty(target - usable - onList);
  if (need <= 1e-9) {
    return onList > 0 ? 'covered' : null;
  }
  // Arrondi au conditionnement d'achat.
  const pu = purchaseUnit(p);
  let displayQty = fromStockUnit(need, pu, p) ?? need;
  displayQty = roundUpForPurchase(displayQty, pu);
  const quantity = (pu === p.unit ? displayQty : (p.packSize ?? 1) * displayQty);
  need = roundQty(quantity);

  let confidence: Confidence = reason === 'out' || reason === 'below_min' ? 'high' : c.confidence === 'none' ? 'low' : c.confidence;
  if (c.source === 'manual' && reason === 'forecast') confidence = 'low';
  if (quality.approx || quality.needsCheck) confidence = minConfidence(confidence, 'medium');
  const qualityNote = quality.approx ? ' Quantité en stock approximative.' : quality.needsCheck ? ` Stock à vérifier (${quality.reasons[0]}).` : '';
  const listNote = onList > 0 ? ` ${formatQty(onList, p.unit)} déjà dans la liste, déduit${onList > 1 ? 's' : ''}.` : '';
  const consoNote = c.dailyRate != null ? ` Consommation : ${consumptionText(c, p.unit)}.` : reason === 'below_min' || reason === 'out' ? ' Pas assez d\'historique : seuils du foyer utilisés.' : '';
  const price = estimateUnitPrice(p, purchases, p.defaultStoreId);
  const estCostCents = price ? Math.round(price.centsPerStockUnit * need) : null;

  return {
    productId: p.id,
    quantity: need,
    displayQty,
    displayUnit: pu,
    urgency,
    reason,
    explanation: `Acheter ${qtyPhrase(displayQty, pu, p.name)} : ${why}.`,
    detail: `Objectif : ${basis}.${listNote}${consoNote}${qualityNote}`.trim(),
    confidence,
    dueDate,
    price,
    estCostCents,
  };
}

export interface HouseholdForecast {
  insights: ProductInsight[];
  byId: Map<string, ProductInsight>;
  recommendations: Recommendation[];
}

const URGENCY_RANK: Record<Urgency, number> = { now: 0, soon: 1, planned: 2 };

/** Analyse de tout le foyer (regroupe les données par produit une seule fois). */
export function analyzeHousehold(input: EngineInput): HouseholdForecast {
  const lotsBy = groupBy(input.lots, (l) => l.productId);
  const movesBy = groupBy(input.movements, (m) => m.productId);
  const purchBy = groupBy(input.purchases, (p) => p.productId ?? '');
  const itemsBy = groupBy(input.items, (i) => i.productId ?? '');
  const insights = input.products
    .filter((p) => !p.archived)
    .map((p) => analyzeProduct(p, lotsBy.get(p.id) ?? [], movesBy.get(p.id) ?? [], itemsBy.get(p.id) ?? [], purchBy.get(p.id) ?? [], input));
  const recommendations = insights
    .map((i) => i.recommendation)
    .filter((r): r is Recommendation => !!r)
    .sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return { insights, byId: new Map(insights.map((i) => [i.product.id, i])), recommendations };
}

export function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export interface AddCheck {
  level: 'ok' | 'info' | 'warning';
  message: string | null;
}

/** Contrôle anti-doublon avant d'ajouter un produit à la liste. */
export function checkAddToList(ins: ProductInsight | undefined, settings: HouseholdSettings): AddCheck {
  if (!ins) return { level: 'ok', message: null };
  const p = ins.product;
  const parts: string[] = [];
  let level: AddCheck['level'] = 'ok';
  if (ins.onList > 0) {
    parts.push(`Déjà ${formatQty(ins.onList, p.unit)} dans la liste : les quantités seront additionnées.`);
    level = 'info';
  }
  const horizon = settings.shoppingIntervalDays + settings.safetyDays;
  const sufficient =
    ins.usable > 0 &&
    ((p.idealQty != null && ins.usable >= p.idealQty) || (ins.daysLeft != null && ins.consumption.reliable && ins.daysLeft > 2 * horizon));
  if (sufficient) {
    parts.push(
      `Stock actuel : ${formatQty(ins.usable, p.unit)}${ins.daysLeft != null && ins.consumption.reliable ? ` (≈ ${humanDays(ins.daysLeft)} d'autonomie)` : ''}${p.idealQty != null ? `, quantité idéale ${formatQty(p.idealQty, p.unit)}` : ''}.`,
    );
    level = 'warning';
  }
  return { level, message: parts.length ? parts.join(' ') : null };
}
