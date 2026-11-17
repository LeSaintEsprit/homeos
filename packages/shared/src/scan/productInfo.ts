/** Normalisation des fiches Open Food / Beauty / Products Facts. */
import type { UnitCode } from '../units';

export interface ExternalProduct {
  code: string;
  source: 'off' | 'obf' | 'opf';
  name: string;
  brand: string | null;
  quantityText: string | null;
  /** Unité de stock suggérée. */
  unit: UnitCode;
  /** Contenu d'un emballage dans cette unité (ex. 400 pour « 400 g »). */
  amount: number | null;
  /** Nombre d'unités dans un lot (« 6 x 1 L » → 6). */
  multipack: number | null;
  categoryKey: string | null;
  imageUrl: string | null;
}

/** Interprète « 400 g », « 1,5 L », « 6 x 1 L », « 4 x 125 g », « 75cl ». */
export function parseQuantityText(q: string | null | undefined): { unit: UnitCode; amount: number; multipack: number | null } | null {
  if (!q) return null;
  const s = q.toLowerCase().replace(',', '.').replace(/\s+/g, ' ');
  const multi = /(\d{1,3})\s?[x×*]\s?(\d+(?:\.\d+)?)\s?(kg|g|mg|ml|cl|l|litres?)\b/.exec(s);
  const single = /(\d+(?:\.\d+)?)\s?(kg|g|mg|ml|cl|l|litres?)\b/.exec(s);
  const m = multi ?? single;
  if (!m) return null;
  const count = multi ? Number(multi[1]) : null;
  let amount = Number(multi ? multi[2] : m[1]);
  let u = (multi ? multi[3] : m[2]).replace(/litres?/, 'l');
  if (u === 'mg') {
    amount /= 1000;
    u = 'g';
  }
  if (!(amount > 0)) return null;
  return { unit: u as UnitCode, amount, multipack: count };
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/(frozen|surgel)/, 'surgeles'],
  [/(beverages|boissons|waters|eaux|juices|jus|sodas|wines|vins|beers|bieres|coffees|cafes|teas|thes)/, 'boissons'],
  [/(dairies|dairy|laitiers|milks|laits|cheeses|fromages|yogurts|yaourts|eggs|oeufs|meats|viandes|fishes|poissons|fresh|frais|hams|jambons|butters|beurres|creams|cremes)/, 'frais'],
  [/(fruits|vegetables|legumes)/, 'alimentation'],
  [/(pastas|pates|rices|riz|cereals|cereales|flours|farines|sugars|sucres|biscuits|cookies|snacks|spreads|tartiner|chocolates|chocolats|condiments|sauces|oils|huiles|canned|conserves|breakfasts|confectioneries)/, 'epicerie'],
  [/(shampoo|shower|douche|soap|savon|toothpaste|dentifrice|deodorant|cosmetic|hygiene|hygiène|creme-|lotion)/, 'hygiene'],
  [/(cleaning|nettoyant|detergent|lessive|laundry|dishwash|vaisselle|entretien|household)/, 'entretien'],
  [/(paper|papier|tissues|mouchoirs|batteries|piles|bags|sacs|foil|aluminium)/, 'consommables'],
];

export function guessCategoryKey(tags: string[], source: ExternalProduct['source']): string | null {
  const joined = tags.join(' ').toLowerCase();
  for (const [re, key] of CATEGORY_RULES) if (re.test(joined)) return key;
  if (source === 'obf') return 'hygiene';
  if (source === 'opf') return 'entretien';
  return tags.length ? 'alimentation' : null;
}

interface OffProduct {
  product_name?: string;
  product_name_fr?: string;
  generic_name_fr?: string;
  brands?: string;
  quantity?: string;
  product_quantity?: number | string;
  product_quantity_unit?: string;
  categories_tags?: string[];
  image_front_small_url?: string;
  image_front_url?: string;
}

/** Convertit une réponse API v2 (Open Food/Beauty/Products Facts) en suggestion HOMEOS. */
export function normalizeOffProduct(code: string, source: ExternalProduct['source'], p: OffProduct): ExternalProduct | null {
  const name = (p.product_name_fr || p.product_name || p.generic_name_fr || '').trim();
  if (!name) return null;
  const parsed = parseQuantityText(p.quantity) ?? (p.product_quantity && p.product_quantity_unit ? parseQuantityText(`${p.product_quantity} ${p.product_quantity_unit}`) : null);
  const brand = (p.brands ?? '').split(',').map((b) => b.trim()).filter(Boolean).pop() ?? null;
  return {
    code,
    source,
    name: name.length > 100 ? name.slice(0, 100) : name,
    brand,
    quantityText: p.quantity?.trim() || null,
    unit: parsed?.unit ?? 'piece',
    amount: parsed?.amount ?? null,
    multipack: parsed?.multipack ?? null,
    categoryKey: guessCategoryKey(p.categories_tags ?? [], source),
    imageUrl: p.image_front_small_url || p.image_front_url || null,
  };
}
