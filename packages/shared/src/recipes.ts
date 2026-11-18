import type { Lot, Product, Recipe, RecipeIngredient, ShoppingItem } from './types';
import type { UnitCode } from './units';
import { effectiveExpiry, isActiveItem, quantityOnList } from './domain';
import { addDays } from './time';
import { normalizeName } from './text';
import { fromStockUnit, roundQty, roundUpForPurchase, toStockUnit } from './units';

/**
 * Faisabilité d'une recette avec le stock réel.
 * - Un lot périmé (date limite de consommation dépassée) ne compte pas comme disponible ;
 *   une date « de préférence avant » dépassée reste utilisable.
 * - Un ingrédient sans produit associé est rapproché par nom exact (ou nom alternatif) ; sinon il est « à vérifier » :
 *   HOMEOS ne suppose jamais qu'on l'a.
 * - Ce qui est déjà dans la liste de courses est déduit de ce qu'il faut ajouter (jamais compté deux fois).
 */
export type IngredientStatus = 'ok' | 'partial' | 'missing' | 'unknown' | 'unconvertible';
export type RecipeStatus = 'ready' | 'almost' | 'missing';

export interface IngredientCheck {
  ingredient: RecipeIngredient;
  product: Product | null;
  /** Quantité nécessaire pour le nombre de parts demandé, dans l'unité de la recette. */
  needed: number;
  /** Quantité nécessaire dans l'unité de stock du produit (null si non convertible ou sans produit). */
  neededStock: number | null;
  /** Disponible dans l'unité de stock (lots non périmés). */
  available: number;
  /** Manque dans l'unité de stock (0 si disponible). */
  missing: number;
  /** Déjà demandé dans la liste de courses, unité de stock. */
  onList: number;
  status: IngredientStatus;
  /** Le produit a un lot à utiliser vite (périme d'ici 3 jours, date effective). */
  urgent: boolean;
  /** Date effective la plus proche parmi les lots disponibles. */
  soonestExpiry: string | null;
}

export interface ShoppingNeed {
  productId: string | null;
  name: string;
  quantity: number;
  unit: UnitCode;
}

export interface RecipeCheck {
  recipe: Recipe;
  servings: number;
  lines: IngredientCheck[];
  status: RecipeStatus;
  /** Ingrédients obligatoires non disponibles (manquants, partiels ou à vérifier). */
  missingCount: number;
  /** Ingrédients à utiliser vite présents dans la recette (anti-gaspillage). */
  urgentCount: number;
  /** Ce qu'il faudrait ajouter à la liste (déduction faite de ce qui y est déjà). */
  toBuy: ShoppingNeed[];
}

export interface RecipeContext {
  products: Product[];
  lots: Lot[];
  items: ShoppingItem[];
  today: string;
  tz?: string;
}

const URGENT_DAYS = 3;

function findProduct(ing: RecipeIngredient, byId: Map<string, Product>, byName: Map<string, Product>): Product | null {
  if (ing.productId) {
    const p = byId.get(ing.productId);
    if (p) return p;
  }
  return byName.get(normalizeName(ing.name)) ?? null;
}

function indexProducts(products: Product[]) {
  const byId = new Map<string, Product>();
  const byName = new Map<string, Product>();
  for (const p of products) {
    if (p.archived) continue;
    byId.set(p.id, p);
    if (!byName.has(normalizeName(p.name))) byName.set(normalizeName(p.name), p);
    for (const a of p.aliases) if (!byName.has(normalizeName(a.text))) byName.set(normalizeName(a.text), p);
  }
  return { byId, byName };
}

function lotsByProduct(lots: Lot[]): Map<string, Lot[]> {
  const m = new Map<string, Lot[]>();
  for (const l of lots) {
    if (l.quantity <= 0) continue;
    const arr = m.get(l.productId);
    if (arr) arr.push(l);
    else m.set(l.productId, [l]);
  }
  return m;
}

export function checkRecipe(recipe: Recipe, servings: number, ctx: RecipeContext, index = indexProducts(ctx.products), lots = lotsByProduct(ctx.lots)): RecipeCheck {
  const factor = servings / Math.max(1, recipe.servings);
  const urgentLimit = addDays(ctx.today, URGENT_DAYS);
  const lines: IngredientCheck[] = recipe.ingredients.map((ing) => {
    const needed = roundQty(ing.quantity * factor);
    const product = findProduct(ing, index.byId, index.byName);
    if (!product) {
      return { ingredient: ing, product: null, needed, neededStock: null, available: 0, missing: 0, onList: 0, status: 'unknown', urgent: false, soonestExpiry: null };
    }
    let available = 0;
    let soonest: string | null = null;
    for (const l of lots.get(product.id) ?? []) {
      const exp = effectiveExpiry(l, product, ctx.tz);
      const expired = exp != null && exp < ctx.today && l.expiryKind !== 'ddm';
      if (expired) continue;
      available += l.quantity;
      if (exp && (!soonest || exp < soonest)) soonest = exp;
    }
    available = roundQty(available);
    const onList = quantityOnList(product, ctx.items).qty;
    const urgent = soonest != null && soonest <= urgentLimit;
    const neededStock = toStockUnit(needed, ing.unit, product);
    if (neededStock == null) {
      return { ingredient: ing, product, needed, neededStock: null, available, missing: 0, onList, status: 'unconvertible', urgent, soonestExpiry: soonest };
    }
    const missing = roundQty(Math.max(0, neededStock - available));
    const status: IngredientStatus = missing <= 1e-9 ? 'ok' : available > 0 ? 'partial' : 'missing';
    return { ingredient: ing, product, needed, neededStock: roundQty(neededStock), available, missing, onList, status, urgent, soonestExpiry: soonest };
  });

  const required = lines.filter((l) => !l.ingredient.optional);
  const missingCount = required.filter((l) => l.status !== 'ok').length;
  const urgentCount = lines.filter((l) => l.urgent && l.status !== 'unknown').length;
  const status: RecipeStatus = missingCount === 0 ? 'ready' : missingCount <= 2 ? 'almost' : 'missing';

  const toBuy: ShoppingNeed[] = [];
  for (const l of required) {
    if (l.status === 'partial' || l.status === 'missing') {
      const p = l.product!;
      const rest = roundQty(l.missing - l.onList);
      if (rest <= 1e-9) continue;
      toBuy.push({ productId: p.id, name: p.name, quantity: roundUpForPurchase(rest, p.unit), unit: p.unit });
    } else if (l.status === 'unknown') {
      // Ingrédient non suivi : proposé à l'achat dans l'unité de la recette, sauf s'il est déjà dans la liste sous ce nom.
      const already = ctx.items.some((i) => i.productId == null && isActiveItem(i) && normalizeName(i.name) === normalizeName(l.ingredient.name));
      if (!already) toBuy.push({ productId: null, name: l.ingredient.name, quantity: roundUpForPurchase(l.needed, l.ingredient.unit), unit: l.ingredient.unit });
    }
  }
  return { recipe, servings, lines, status, missingCount, urgentCount, toBuy };
}

const RANK: Record<RecipeStatus, number> = { ready: 0, almost: 1, missing: 2 };

/**
 * Toutes les recettes actives, de la plus faisable à la moins faisable ;
 * à faisabilité égale, celles qui utilisent des produits à consommer vite d'abord (anti-gaspillage).
 */
export function checkRecipes(recipes: Recipe[], ctx: RecipeContext): RecipeCheck[] {
  const index = indexProducts(ctx.products);
  const lots = lotsByProduct(ctx.lots);
  return recipes
    .filter((r) => !r.archived)
    .map((r) => checkRecipe(r, r.servings, ctx, index, lots))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || b.urgentCount - a.urgentCount || a.missingCount - b.missingCount || a.recipe.name.localeCompare(b.recipe.name, 'fr'));
}

/** Quantité affichable d'un ingrédient dans l'unité de la recette, à partir d'une quantité en unité de stock. */
export function stockToRecipeUnit(qty: number, ing: RecipeIngredient, product: Product): number | null {
  return fromStockUnit(qty, ing.unit, product);
}
