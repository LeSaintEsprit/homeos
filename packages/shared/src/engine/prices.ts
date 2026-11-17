import type { Product, Purchase, ShoppingItem } from '../types';
import { formatQty, toStockUnit } from '../units';
import { isActiveItem, remainingToBuy } from '../domain';
import { formatEuros } from '../money';

export type PriceKind = 'known' | 'estimated' | 'unknown';

export const PRICE_KIND_LABELS: Record<PriceKind, string> = {
  known: 'Prix connu',
  estimated: 'Prix estimé',
  unknown: 'Prix inconnu',
};

export interface PriceEstimate {
  /** Centimes par unité de stock du produit. */
  centsPerStockUnit: number;
  kind: 'estimated';
  samples: number;
  storeId: string | null;
  lastDate: string;
  basis: string;
}

export interface PricePoint {
  date: string;
  storeId: string | null;
  centsPerStockUnit: number;
  totalCents: number;
  quantity: number;
}

/** Historique des prix unitaires réellement payés (unité de stock). */
export function priceHistory(p: Product, purchases: Purchase[]): PricePoint[] {
  const out: PricePoint[] = [];
  for (const pu of purchases) {
    if (pu.productId !== p.id || pu.totalCents == null || !(pu.quantity > 0)) continue;
    const q = toStockUnit(pu.quantity, pu.unit, p);
    if (!q) continue;
    out.push({ date: pu.date, storeId: pu.storeId, centsPerStockUnit: pu.totalCents / q, totalCents: pu.totalCents, quantity: q });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Estimation d'un prix à partir des seuls prix ENREGISTRÉS : médiane des 5 derniers
 * achats, de préférence dans le magasin visé. Aucun prix n'est inventé.
 */
export function estimateUnitPrice(p: Product, purchases: Purchase[], storeId?: string | null): PriceEstimate | null {
  const hist = priceHistory(p, purchases);
  if (!hist.length) return null;
  const sameStore = storeId ? hist.filter((h) => h.storeId === storeId) : [];
  const pool = (sameStore.length ? sameStore : hist).slice(-5);
  const cents = median(pool.map((h) => h.centsPerStockUnit));
  const last = pool[pool.length - 1];
  return {
    centsPerStockUnit: cents,
    kind: 'estimated',
    samples: pool.length,
    storeId: sameStore.length ? storeId! : null,
    lastDate: last.date,
    basis: `d'après ${pool.length} achat${pool.length > 1 ? 's' : ''} enregistré${pool.length > 1 ? 's' : ''}${sameStore.length ? ' dans ce magasin' : ''} (dernier : ${formatEuros(last.totalCents)} pour ${formatQty(last.quantity, p.unit)} le ${last.date.split('-').reverse().join('/')})`,
  };
}

export interface ItemCost {
  itemId: string;
  kind: PriceKind;
  cents: number | null;
  basis: string | null;
}

export interface ListCost {
  items: ItemCost[];
  knownCents: number;
  estimatedCents: number;
  unknownCount: number;
}

/** Coût prévisionnel de la liste : distingue toujours prix connu, estimé, inconnu. */
export function estimateListCost(items: ShoppingItem[], products: Map<string, Product>, purchases: Purchase[]): ListCost {
  const out: ItemCost[] = [];
  let known = 0;
  let est = 0;
  let unknown = 0;
  for (const i of items) {
    if (!isActiveItem(i)) continue;
    if (i.priceCents != null && i.status !== 'pending') {
      out.push({ itemId: i.id, kind: 'known', cents: i.priceCents, basis: 'Prix saisi en magasin' });
      known += i.priceCents;
      continue;
    }
    const p = i.productId ? products.get(i.productId) : undefined;
    const qty = i.status === 'purchased' ? i.quantity : remainingToBuy(i) || i.quantity;
    const e = p ? estimateUnitPrice(p, purchases, i.storeId) : null;
    const q = p ? toStockUnit(qty, i.unit, p) : null;
    if (e && q != null) {
      const c = Math.round(e.centsPerStockUnit * q);
      out.push({ itemId: i.id, kind: 'estimated', cents: c, basis: e.basis });
      est += c;
    } else {
      out.push({ itemId: i.id, kind: 'unknown', cents: null, basis: null });
      unknown++;
    }
  }
  return { items: out, knownCents: known, estimatedCents: est, unknownCount: unknown };
}
