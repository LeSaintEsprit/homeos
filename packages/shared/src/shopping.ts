/** Organisation de la liste de courses par magasin et par rayon, bilan par magasin. */
import type { Category, Purchase, ShoppingItem, Store } from './types';
import { isActiveItem } from './domain';

export interface AisleGroup {
  /** Identifiant de catégorie (rayon), '' pour les articles sans rayon. */
  categoryId: string;
  items: ShoppingItem[];
}

/**
 * Articles à prendre dans un magasin donné : ceux affectés à ce magasin
 * et ceux sans magasin précis. Sans magasin choisi : toute la liste active.
 */
export function itemsForStore(items: ShoppingItem[], storeId: string | null): ShoppingItem[] {
  return items.filter((i) => isActiveItem(i) && (storeId == null || i.storeId == null || i.storeId === storeId));
}

/**
 * Regroupe par rayon dans l'ordre de parcours du magasin (ordre personnalisé du magasin,
 * puis ordre habituel des catégories, puis articles sans rayon). Dans un rayon :
 * restant à acheter d'abord, puis priorité, puis ordre alphabétique.
 */
export function groupByAisle(items: ShoppingItem[], categories: Category[], store: Store | null): AisleGroup[] {
  const base = [...categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'fr')).map((c) => c.id);
  const custom = (store?.categoryOrder ?? []).filter((id) => base.includes(id));
  const order = [...custom, ...base.filter((id) => !custom.includes(id))];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  const prio = { urgent: 0, high: 1, normal: 2 } as const;
  const m = new Map<string, ShoppingItem[]>();
  for (const it of items) {
    const k = it.categoryId && base.includes(it.categoryId) ? it.categoryId : '';
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : rank(a[0]) - rank(b[0])))
    .map(([categoryId, list]) => ({
      categoryId,
      items: list.sort(
        (a, b) =>
          (a.status === 'purchased' ? 1 : 0) - (b.status === 'purchased' ? 1 : 0) ||
          prio[a.priority] - prio[b.priority] ||
          a.name.localeCompare(b.name, 'fr'),
      ),
    }));
}

/** Déplace un rayon dans l'ordre de parcours d'un magasin (complète l'ordre si besoin). */
export function moveAisle(store: Store, categories: Category[], categoryId: string, delta: -1 | 1): string[] {
  const groups = groupByAisle(
    categories.map((c) => ({ id: c.id, categoryId: c.id, status: 'pending', priority: 'normal', name: c.name }) as unknown as ShoppingItem),
    categories,
    store,
  ).map((g) => g.categoryId);
  const i = groups.indexOf(categoryId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= groups.length) return groups;
  [groups[i], groups[j]] = [groups[j], groups[i]];
  return groups;
}

export interface UsualProduct {
  productId: string | null;
  name: string;
  count: number;
  lastDate: string;
}

export interface StoreSummary {
  storeId: string;
  /** Nombre de passages (jours distincts avec au moins un achat). */
  visits: number;
  lastVisit: string | null;
  /** Total des achats dont le prix est connu. */
  knownCents: number;
  /** Achats sans prix (non comptés dans les montants). */
  unpricedCount: number;
  /** Panier moyen par passage, calculé uniquement sur les passages entièrement chiffrés. */
  avgBasketCents: number | null;
  usual: UsualProduct[];
  recent: Purchase[];
}

/** Historique d'un magasin, à partir des seuls achats enregistrés. */
export function storeSummary(storeId: string, purchases: Purchase[], usualMin = 2): StoreSummary {
  const list = purchases.filter((p) => p.storeId === storeId).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const days = new Map<string, { cents: number; complete: boolean }>();
  let known = 0;
  let unpriced = 0;
  const usual = new Map<string, UsualProduct>();
  for (const p of list) {
    const d = days.get(p.date) ?? { cents: 0, complete: true };
    if (p.totalCents == null) {
      unpriced++;
      d.complete = false;
    } else {
      known += p.totalCents;
      d.cents += p.totalCents;
    }
    days.set(p.date, d);
    const k = p.productId ?? `name:${p.name.toLowerCase()}`;
    const u = usual.get(k) ?? { productId: p.productId, name: p.name, count: 0, lastDate: p.date };
    u.count++;
    if (p.date > u.lastDate) u.lastDate = p.date;
    usual.set(k, u);
  }
  const complete = [...days.values()].filter((d) => d.complete);
  return {
    storeId,
    visits: days.size,
    lastVisit: list[0]?.date ?? null,
    knownCents: known,
    unpricedCount: unpriced,
    avgBasketCents: complete.length ? Math.round(complete.reduce((s, d) => s + d.cents, 0) / complete.length) : null,
    usual: [...usual.values()].filter((u) => u.count >= usualMin).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr')).slice(0, 15),
    recent: list.slice(0, 30),
  };
}
