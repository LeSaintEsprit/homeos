/** Analyse budgétaire : uniquement à partir des prix ENREGISTRÉS. */
import type { Category, Lot, Movement, Product, Purchase, Store } from '../types';
import { addDays, addMonths, daysInMonth, monthKey, startOfWeek } from '../time';
import { roundQty } from '../units';

export type Period = 'week' | 'month' | 'year';

export interface PeriodTotal {
  key: string;
  label: string;
  totalCents: number;
  /** Achats avec prix connu. */
  pricedCount: number;
  /** Achats sans prix (exclus des montants). */
  unpricedCount: number;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function periodKey(date: string, period: Period): string {
  if (period === 'week') return startOfWeek(date);
  if (period === 'month') return monthKey(date);
  return date.slice(0, 4);
}

export function periodLabel(key: string, period: Period): string {
  if (period === 'week') {
    const [, m, d] = key.split('-');
    return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
  }
  if (period === 'month') {
    const [y, m] = key.split('-');
    return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
  }
  return key;
}

function lastKeys(today: string, period: Period, n: number): string[] {
  const keys: string[] = [];
  if (period === 'week') {
    const w = startOfWeek(today);
    for (let i = n - 1; i >= 0; i--) keys.push(addDays(w, -7 * i));
  } else if (period === 'month') {
    const m = monthKey(today);
    for (let i = n - 1; i >= 0; i--) keys.push(addMonths(m, -i));
  } else {
    const y = Number(today.slice(0, 4));
    for (let i = n - 1; i >= 0; i--) keys.push(String(y - i));
  }
  return keys;
}

/** Totaux par période (les n dernières, période courante incluse). */
export function spendingByPeriod(purchases: Purchase[], today: string, period: Period, n: number): PeriodTotal[] {
  const keys = lastKeys(today, period, n);
  const map = new Map(keys.map((k) => [k, { key: k, label: periodLabel(k, period), totalCents: 0, pricedCount: 0, unpricedCount: 0 }]));
  for (const p of purchases) {
    const row = map.get(periodKey(p.date, period));
    if (!row) continue;
    if (p.totalCents == null) row.unpricedCount++;
    else {
      row.totalCents += p.totalCents;
      row.pricedCount++;
    }
  }
  return keys.map((k) => map.get(k)!);
}

export interface Breakdown {
  id: string | null;
  label: string;
  color: string | null;
  totalCents: number;
  count: number;
}

export function inRange(p: Purchase, from: string, to: string): boolean {
  return p.date >= from && p.date <= to;
}

export function breakdownBy(
  purchases: Purchase[],
  key: 'categoryId' | 'storeId',
  names: Map<string, Category | Store>,
  emptyLabel: string,
): Breakdown[] {
  const m = new Map<string | null, Breakdown>();
  for (const p of purchases) {
    if (p.totalCents == null) continue;
    const id = p[key];
    const e = id ? names.get(id) : undefined;
    const row = m.get(id) ?? { id, label: e?.name ?? emptyLabel, color: e?.color ?? null, totalCents: 0, count: 0 };
    row.totalCents += p.totalCents;
    row.count++;
    m.set(id, row);
  }
  return [...m.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export interface TopProduct {
  productId: string | null;
  name: string;
  totalCents: number;
  count: number;
}

export function topProducts(purchases: Purchase[], n = 10): TopProduct[] {
  const m = new Map<string, TopProduct>();
  for (const p of purchases) {
    if (p.totalCents == null) continue;
    const k = p.productId ?? `name:${p.name.toLowerCase()}`;
    const row = m.get(k) ?? { productId: p.productId, name: p.name, totalCents: 0, count: 0 };
    row.totalCents += p.totalCents;
    row.count++;
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => b.totalCents - a.totalCents).slice(0, n);
}

export interface BudgetStatus {
  month: string;
  spentCents: number;
  budgetCents: number | null;
  /** Projection fin de mois au rythme actuel (null en tout début de mois). */
  projectedCents: number | null;
  remainingCents: number | null;
  ratio: number | null;
  /** Moyenne des 3 derniers mois complets (null si aucune donnée). */
  avgMonthCents: number | null;
  /** Panier moyen par passage en magasin (même jour + même magasin). */
  avgTripCents: number | null;
  tripCount: number;
  unpricedCount: number;
}

export function budgetStatus(purchases: Purchase[], today: string, budgetCents: number | null): BudgetStatus {
  const month = monthKey(today);
  const inMonth = purchases.filter((p) => monthKey(p.date) === month);
  const spent = inMonth.reduce((s, p) => s + (p.totalCents ?? 0), 0);
  const day = Number(today.slice(8, 10));
  const dim = daysInMonth(month);
  const projected = day >= 5 ? Math.round((spent / day) * dim) : null;
  const prev = [1, 2, 3].map((i) => addMonths(month, -i));
  const prevTotals = prev.map((m) => purchases.filter((p) => monthKey(p.date) === m && p.totalCents != null));
  const withData = prevTotals.filter((arr) => arr.length > 0);
  const avgMonth = withData.length ? Math.round(withData.reduce((s, arr) => s + arr.reduce((a, p) => a + p.totalCents!, 0), 0) / withData.length) : null;
  const trips = new Map<string, number>();
  for (const p of purchases) {
    if (p.totalCents == null || p.date < addDays(today, -90)) continue;
    const k = `${p.date}|${p.storeId ?? ''}`;
    trips.set(k, (trips.get(k) ?? 0) + p.totalCents);
  }
  const tripVals = [...trips.values()];
  return {
    month,
    spentCents: spent,
    budgetCents,
    projectedCents: projected,
    remainingCents: budgetCents != null ? budgetCents - spent : null,
    ratio: budgetCents ? spent / budgetCents : null,
    avgMonthCents: avgMonth,
    avgTripCents: tripVals.length ? Math.round(tripVals.reduce((a, b) => a + b, 0) / tripVals.length) : null,
    tripCount: tripVals.length,
    unpricedCount: inMonth.filter((p) => p.totalCents == null).length,
  };
}

export interface StorePriceRow {
  storeId: string | null;
  last: number;
  min: number;
  avg: number;
  count: number;
  lastDate: string;
}

/** Comparaison des prix unitaires (centimes par unité de stock) par magasin. */
export function comparePricesByStore(points: { storeId: string | null; centsPerStockUnit: number; date: string }[]): StorePriceRow[] {
  const m = new Map<string | null, StorePriceRow & { sum: number }>();
  for (const p of points) {
    const r = m.get(p.storeId) ?? { storeId: p.storeId, last: p.centsPerStockUnit, min: Infinity, avg: 0, count: 0, lastDate: p.date, sum: 0 };
    r.min = Math.min(r.min, p.centsPerStockUnit);
    r.sum += p.centsPerStockUnit;
    r.count++;
    if (p.date >= r.lastDate) {
      r.lastDate = p.date;
      r.last = p.centsPerStockUnit;
    }
    m.set(p.storeId, r);
  }
  return [...m.values()].map(({ sum, ...r }) => ({ ...r, avg: sum / r.count })).sort((a, b) => a.avg - b.avg);
}

export interface UnusualSpending {
  key: string;
  message: string;
}

/** Dépenses inhabituelles : rythme mensuel > budget, semaine > 2× la moyenne, prix en forte hausse. */
export function detectUnusualSpending(purchases: Purchase[], products: Map<string, Product>, today: string, budgetCents: number | null): UnusualSpending[] {
  const out: UnusualSpending[] = [];
  const b = budgetStatus(purchases, today, budgetCents);
  if (budgetCents && b.projectedCents != null && b.projectedCents > budgetCents * 1.1) {
    out.push({ key: `budget:${b.month}`, message: `Au rythme actuel, les dépenses du mois atteindraient ${(b.projectedCents / 100).toFixed(0)} € pour un budget de ${(budgetCents / 100).toFixed(0)} €.` });
  }
  const weeks = spendingByPeriod(purchases, today, 'week', 9);
  const current = weeks[weeks.length - 1];
  const past = weeks.slice(0, -1).filter((w) => w.pricedCount > 0);
  if (past.length >= 4) {
    const avg = past.reduce((s, w) => s + w.totalCents, 0) / past.length;
    if (avg > 0 && current.totalCents > 2 * avg) {
      out.push({ key: `week:${current.key}`, message: `Dépenses de la semaine (${(current.totalCents / 100).toFixed(0)} €) plus de deux fois supérieures à la moyenne (${(avg / 100).toFixed(0)} €).` });
    }
  }
  // Hausse de prix : dernier prix > 1,3 × médiane des précédents (≥ 3 points).
  const byProduct = new Map<string, Purchase[]>();
  for (const p of purchases) if (p.productId && p.totalCents != null) byProduct.set(p.productId, [...(byProduct.get(p.productId) ?? []), p]);
  for (const [pid, list] of byProduct) {
    if (list.length < 4) continue;
    const sorted = list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const last = sorted[sorted.length - 1];
    if (last.date < addDays(today, -14)) continue;
    const unit = (p: Purchase) => p.totalCents! / p.quantity;
    const prev = sorted.slice(0, -1).map(unit).sort((a, b) => a - b);
    const med = prev[Math.floor(prev.length / 2)];
    if (med > 0 && unit(last) > med * 1.3) {
      const name = products.get(pid)?.name ?? last.name;
      out.push({ key: `price:${last.id}`, message: `Prix de « ${name} » en hausse de ${Math.round((unit(last) / med - 1) * 100)} % par rapport à d'habitude.` });
    }
  }
  return out;
}

export interface WasteStats {
  count: number;
  /** Valeur estimée à partir des prix enregistrés des lots. */
  valueCents: number;
  /** Mouvements sans prix connu (non valorisés). */
  unvaluedCount: number;
  byProduct: { productId: string; qty: number; valueCents: number; count: number }[];
  /** Nombre de pertes par motif (périmé, abîmé, autre). */
  byReason: Record<string, number>;
}

export function wasteStats(movements: Movement[], lots: Map<string, Lot>, from: string): WasteStats {
  const out: WasteStats = { count: 0, valueCents: 0, unvaluedCount: 0, byProduct: [], byReason: {} };
  const m = new Map<string, { productId: string; qty: number; valueCents: number; count: number }>();
  for (const mv of movements) {
    if (mv.type !== 'waste' || mv.revertedBy || mv.occurredAt.slice(0, 10) < from) continue;
    out.count++;
    const reason = mv.reason ?? 'other';
    out.byReason[reason] = (out.byReason[reason] ?? 0) + 1;
    const lot = mv.lotId ? lots.get(mv.lotId) : undefined;
    const qty = -mv.delta;
    const row = m.get(mv.productId) ?? { productId: mv.productId, qty: 0, valueCents: 0, count: 0 };
    row.qty = roundQty(row.qty + qty);
    row.count++;
    if (lot?.unitPriceCents != null) {
      const v = Math.round(lot.unitPriceCents * qty);
      row.valueCents += v;
      out.valueCents += v;
    } else out.unvaluedCount++;
    m.set(mv.productId, row);
  }
  out.byProduct = [...m.values()].sort((a, b) => b.valueCents - a.valueCents || b.count - a.count);
  return out;
}
