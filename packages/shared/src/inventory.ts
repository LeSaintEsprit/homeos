import type { InventoryLine, InventorySession, Lot, Movement, Product } from './types';
import { roundQty, toStockUnit } from './units';

export const QTY_EPS = 1e-6;

/** Emplacement effectif d'un lot (son emplacement, sinon celui du produit). */
export function lotLocation(lot: Lot, product: Product | undefined): string | null {
  return lot.locationId ?? product?.locationId ?? null;
}

/** Emplacements couverts par une session (tous si la session n'en cible aucun). */
export function sessionScope(session: InventorySession): Set<string> | null {
  const ids = session.locations.filter((l) => l.status !== 'skipped').map((l) => l.locationId);
  return session.locations.length === 0 ? null : new Set(ids);
}

export function lotInScope(lot: Lot, product: Product | undefined, scope: Set<string> | null): boolean {
  if (!scope) return true;
  const loc = lotLocation(lot, product);
  return loc != null && scope.has(loc);
}

export interface InventoryDiff {
  productId: string;
  /** Stock théorique dans le périmètre de la session (unité de stock). */
  expected: number;
  /** Quantité comptée (unité de stock). */
  counted: number;
  delta: number;
  approx: boolean;
  lines: InventoryLine[];
  /** Lignes dont l'unité n'est pas convertible vers l'unité de stock. */
  unconvertible: InventoryLine[];
}

/**
 * Compare le comptage physique au stock théorique, produit par produit, en ne
 * considérant que les lots situés dans les emplacements inventoriés.
 * Fonction partagée : utilisée par l'écran de validation ET par le serveur.
 */
export function computeInventoryDiff(
  session: InventorySession,
  products: Map<string, Product> | ((id: string) => Product | undefined),
  lotsOf: (productId: string) => Lot[],
): InventoryDiff[] {
  const getP = typeof products === 'function' ? products : (id: string) => products.get(id);
  const scope = sessionScope(session);
  const byProduct = new Map<string, InventoryLine[]>();
  for (const l of session.lines) {
    if (!l.productId) continue;
    const arr = byProduct.get(l.productId) ?? [];
    arr.push(l);
    byProduct.set(l.productId, arr);
  }
  const out: InventoryDiff[] = [];
  for (const [productId, lines] of byProduct) {
    const p = getP(productId);
    if (!p) continue;
    let counted = 0;
    const unconvertible: InventoryLine[] = [];
    for (const l of lines) {
      const q = toStockUnit(l.quantity, l.unit, p);
      if (q == null) unconvertible.push(l);
      else counted += q;
    }
    const expected = roundQty(
      lotsOf(productId)
        .filter((lot) => lot.quantity > 0 && lotInScope(lot, p, scope))
        .reduce((s, lot) => s + lot.quantity, 0),
    );
    counted = roundQty(counted);
    out.push({
      productId,
      expected,
      counted,
      delta: roundQty(counted - expected),
      approx: lines.some((l) => l.qtyApprox),
      lines,
      unconvertible,
    });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** Pourcentage d'avancement d'une session (emplacements terminés ou ignorés). */
export function sessionProgress(session: InventorySession): number {
  if (session.locations.length === 0) return session.lines.length > 0 ? 50 : 0;
  const done = session.locations.filter((l) => l.status === 'done' || l.status === 'skipped').length;
  const partial = session.locations.filter((l) => l.status === 'in_progress').length;
  return Math.round(((done + partial * 0.5) / session.locations.length) * 100);
}

/**
 * Mouvements du produit enregistrés après son comptage (hors inventaire) dans le périmètre :
 * le comptage ne reflète peut-être plus la réalité, l'utilisateur doit trancher.
 */
export function movedSinceCount(
  session: InventorySession,
  diff: InventoryDiff,
  product: Product | undefined,
  movements: Movement[],
  lotsById: (id: string) => Lot | undefined,
): Movement[] {
  if (!diff.lines.length) return [];
  const countedAt = diff.lines.reduce((min, l) => (l.countedAt < min ? l.countedAt : min), diff.lines[0].countedAt);
  const scope = sessionScope(session);
  return movements.filter((m) => {
    if (m.productId !== diff.productId || m.occurredAt <= countedAt || m.revertedBy || m.type === 'revert' || m.source === 'inventory' || Math.abs(m.delta) < QTY_EPS) return false;
    if (!scope) return true;
    const lot = m.lotId ? lotsById(m.lotId) : undefined;
    return lot ? lotInScope(lot, product, scope) : true;
  });
}
