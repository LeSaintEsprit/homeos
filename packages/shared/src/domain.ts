import type { Lot, Product, ShoppingItem } from './types';
import { addDays, dateInTz, minDate } from './time';
import { roundQty, toStockUnit } from './units';

/** Date limite effective d'un lot : min(DLC, ouverture + durée après ouverture). */
export function effectiveExpiry(
  lot: Pick<Lot, 'expiryDate' | 'openedAt'>,
  product: Pick<Product, 'openShelfLifeDays'> | undefined,
  tz = 'Europe/Paris',
): string | null {
  let d = lot.expiryDate;
  if (lot.openedAt && product?.openShelfLifeDays != null) {
    d = minDate(d, addDays(dateInTz(lot.openedAt, tz), product.openShelfLifeDays));
  }
  return d;
}

export function isLotExpired(lot: Lot, product: Product | undefined, today: string, tz?: string): boolean {
  const e = effectiveExpiry(lot, product, tz);
  return e != null && e < today;
}

/**
 * Ordre FEFO (« premier périmé, premier sorti ») : lots non périmés d'abord,
 * date effective la plus proche, puis lots ouverts, puis les plus anciens.
 */
export function sortFefo(lots: Lot[], product: Product | undefined, today: string, tz?: string): Lot[] {
  return [...lots].sort((a, b) => {
    const ea = effectiveExpiry(a, product, tz);
    const eb = effectiveExpiry(b, product, tz);
    const xa = ea != null && ea < today ? 1 : 0;
    const xb = eb != null && eb < today ? 1 : 0;
    if (xa !== xb) return xa - xb;
    if (ea !== eb) {
      if (ea == null) return 1;
      if (eb == null) return -1;
      return ea < eb ? -1 : 1;
    }
    const oa = a.openedAt ? 0 : 1;
    const ob = b.openedAt ? 0 : 1;
    if (oa !== ob) return oa - ob;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

export function sumLots(lots: Lot[]): number {
  return roundQty(lots.reduce((s, l) => s + l.quantity, 0));
}

export const ACTIVE_SHOPPING: ShoppingItem['status'][] = ['pending', 'partial', 'purchased'];

export function isActiveItem(i: ShoppingItem): boolean {
  return ACTIVE_SHOPPING.includes(i.status);
}

/** Quantité restant à acheter pour un article (dans l'unité de l'article). */
export function remainingToBuy(i: ShoppingItem): number {
  if (i.status === 'pending') return i.quantity;
  if (i.status === 'partial') return roundQty(Math.max(0, i.quantity - i.purchasedQty));
  return 0;
}

/**
 * Quantité « en route » pour un produit, dans son unité de stock : tout ce qui est
 * demandé dans la liste active (à acheter ou acheté non réceptionné).
 * Les articles dans une unité non convertible sont ignorés et signalés.
 */
export function quantityOnList(product: Product, items: ShoppingItem[]): { qty: number; unconvertible: number } {
  let qty = 0;
  let unconvertible = 0;
  for (const i of items) {
    if (i.productId !== product.id || !isActiveItem(i)) continue;
    const q = toStockUnit(i.quantity, i.unit, product);
    if (q == null) unconvertible++;
    else qty += q;
  }
  return { qty: roundQty(qty), unconvertible };
}
