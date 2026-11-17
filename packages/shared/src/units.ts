/**
 * Gestion des unités.
 *
 * Trois familles convertibles entre elles : masse (g, kg), volume (ml, cl, l) et
 * comptage (unité, douzaine). Chaque conditionnement (paquet, bouteille…) forme sa
 * propre famille : « 2 paquets » ne se convertit en grammes que si le produit
 * déclare un conditionnement (packUnit + packSize, ex. 1 paquet = 500 g).
 */

export type UnitCode =
  | 'g'
  | 'kg'
  | 'ml'
  | 'cl'
  | 'l'
  | 'piece'
  | 'douzaine'
  | 'paquet'
  | 'bouteille'
  | 'boite'
  | 'sachet'
  | 'rouleau'
  | 'pot'
  | 'canette'
  | 'brique'
  | 'tube'
  | 'flacon'
  | 'barquette'
  | 'tablette'
  | 'dose'
  | 'pack'
  | 'bocal'
  | 'filet'
  | 'botte'
  | 'carton';

export interface UnitDef {
  code: UnitCode;
  /** Famille de conversion. */
  dim: string;
  /** Facteur vers l'unité de référence de la famille (g, ml, unité). */
  factor: number;
  singular: string;
  plural: string;
  /** Abréviation affichée après un nombre (« 500 g »). */
  short?: string;
  /** Unité « continue » (masse/volume) : décimales autorisées. */
  continuous: boolean;
  feminine?: boolean;
}

const pkg = (code: UnitCode, singular: string, plural: string, feminine = false): UnitDef => ({
  code,
  dim: `pkg:${code}`,
  factor: 1,
  singular,
  plural,
  continuous: false,
  feminine,
});

export const UNITS: Record<UnitCode, UnitDef> = {
  g: { code: 'g', dim: 'mass', factor: 1, singular: 'gramme', plural: 'grammes', short: 'g', continuous: true },
  kg: { code: 'kg', dim: 'mass', factor: 1000, singular: 'kilogramme', plural: 'kilogrammes', short: 'kg', continuous: true },
  ml: { code: 'ml', dim: 'volume', factor: 1, singular: 'millilitre', plural: 'millilitres', short: 'ml', continuous: true },
  cl: { code: 'cl', dim: 'volume', factor: 10, singular: 'centilitre', plural: 'centilitres', short: 'cl', continuous: true },
  l: { code: 'l', dim: 'volume', factor: 1000, singular: 'litre', plural: 'litres', short: 'L', continuous: true },
  piece: { code: 'piece', dim: 'count', factor: 1, singular: 'unité', plural: 'unités', continuous: false, feminine: true },
  douzaine: { code: 'douzaine', dim: 'count', factor: 12, singular: 'douzaine', plural: 'douzaines', continuous: false, feminine: true },
  paquet: pkg('paquet', 'paquet', 'paquets'),
  bouteille: pkg('bouteille', 'bouteille', 'bouteilles', true),
  boite: pkg('boite', 'boîte', 'boîtes', true),
  sachet: pkg('sachet', 'sachet', 'sachets'),
  rouleau: pkg('rouleau', 'rouleau', 'rouleaux'),
  pot: pkg('pot', 'pot', 'pots'),
  canette: pkg('canette', 'canette', 'canettes', true),
  brique: pkg('brique', 'brique', 'briques', true),
  tube: pkg('tube', 'tube', 'tubes'),
  flacon: pkg('flacon', 'flacon', 'flacons'),
  barquette: pkg('barquette', 'barquette', 'barquettes', true),
  tablette: pkg('tablette', 'tablette', 'tablettes', true),
  dose: pkg('dose', 'dose', 'doses', true),
  pack: pkg('pack', 'pack', 'packs'),
  bocal: pkg('bocal', 'bocal', 'bocaux'),
  filet: pkg('filet', 'filet', 'filets'),
  botte: pkg('botte', 'botte', 'bottes', true),
  carton: pkg('carton', 'carton', 'cartons'),
};

export const UNIT_CODES = Object.keys(UNITS) as UnitCode[];

/** Groupes pour les sélecteurs de l'interface. */
export const UNIT_GROUPS: { label: string; units: UnitCode[] }[] = [
  { label: 'Comptage', units: ['piece', 'douzaine'] },
  { label: 'Masse', units: ['g', 'kg'] },
  { label: 'Volume', units: ['ml', 'cl', 'l'] },
  {
    label: 'Conditionnements',
    units: [
      'paquet', 'bouteille', 'boite', 'sachet', 'rouleau', 'pot', 'canette', 'brique', 'tube',
      'flacon', 'barquette', 'tablette', 'dose', 'pack', 'bocal', 'filet', 'botte', 'carton',
    ],
  },
];

export function isUnit(u: unknown): u is UnitCode {
  return typeof u === 'string' && Object.prototype.hasOwnProperty.call(UNITS, u);
}

export function unitDef(u: UnitCode): UnitDef {
  const d = UNITS[u];
  if (!d) throw new Error(`Unité inconnue : ${u}`);
  return d;
}

/** Arrondi à 6 décimales pour neutraliser les erreurs de virgule flottante. */
export function roundQty(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const r = Math.round(x * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

export function sameDimension(a: UnitCode, b: UnitCode): boolean {
  return unitDef(a).dim === unitDef(b).dim;
}

/** Conversion directe entre unités d'une même famille. Renvoie null si incompatible. */
export function convert(qty: number, from: UnitCode, to: UnitCode): number | null {
  if (from === to) return roundQty(qty);
  const a = unitDef(from);
  const b = unitDef(to);
  if (a.dim !== b.dim) return null;
  return roundQty((qty * a.factor) / b.factor);
}

/** Description minimale d'un produit pour les conversions. */
export interface ProductUnits {
  unit: UnitCode;
  packUnit?: UnitCode | null;
  /** Quantité, exprimée dans l'unité de stock, contenue dans un conditionnement. */
  packSize?: number | null;
}

/**
 * Convertit une quantité saisie dans n'importe quelle unité compatible vers l'unité
 * de stock du produit (via le conditionnement déclaré si nécessaire).
 */
export function toStockUnit(qty: number, from: UnitCode, p: ProductUnits): number | null {
  const direct = convert(qty, from, p.unit);
  if (direct !== null) return direct;
  if (p.packUnit && p.packSize && p.packSize > 0) {
    const inPacks = convert(qty, from, p.packUnit);
    if (inPacks !== null) return roundQty(inPacks * p.packSize);
  }
  return null;
}

/** Inverse de toStockUnit. */
export function fromStockUnit(qty: number, to: UnitCode, p: ProductUnits): number | null {
  const direct = convert(qty, p.unit, to);
  if (direct !== null) return direct;
  if (p.packUnit && p.packSize && p.packSize > 0) {
    const packs = qty / p.packSize;
    const c = convert(packs, p.packUnit, to);
    if (c !== null) return c;
  }
  return null;
}

/** Unités dans lesquelles on peut saisir une quantité pour ce produit. */
export function compatibleUnits(p: ProductUnits): UnitCode[] {
  const dims = new Set<string>([unitDef(p.unit).dim]);
  if (p.packUnit && p.packSize) dims.add(unitDef(p.packUnit).dim);
  const list = UNIT_CODES.filter((u) => dims.has(unitDef(u).dim));
  // L'unité de stock et le conditionnement en premier.
  const head = [p.unit, ...(p.packUnit && p.packSize ? [p.packUnit] : [])];
  return [...new Set([...head, ...list])];
}

const nf = (max: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: max, minimumFractionDigits: 0 });
const NF0 = nf(0);
const NF1 = nf(1);
const NF2 = nf(2);
const NF3 = nf(3);

export function formatNumber(x: number, maxDecimals = 2): string {
  const v = roundQty(x);
  switch (maxDecimals) {
    case 0:
      return NF0.format(v);
    case 1:
      return NF1.format(v);
    case 3:
      return NF3.format(v);
    default:
      return NF2.format(v);
  }
}

export function unitLabel(u: UnitCode, qty: number): string {
  const d = unitDef(u);
  if (d.short) return d.short;
  return Math.abs(qty) >= 2 ? d.plural : d.singular;
}

/**
 * Formatage lisible d'une quantité : « 1,5 kg », « 750 g », « 2 bouteilles », « 6 unités ».
 * Les grammes/millilitres passent automatiquement en kg/L au-delà de 1000.
 */
export function formatQty(qty: number, u: UnitCode, opts: { compact?: boolean } = {}): string {
  let q = roundQty(qty);
  let unit = u;
  if ((unit === 'g' || unit === 'ml') && Math.abs(q) >= 1000) {
    q = q / 1000;
    unit = unit === 'g' ? 'kg' : 'l';
  }
  if (unit === 'cl' && Math.abs(q) >= 100) {
    q = q / 100;
    unit = 'l';
  }
  const d = unitDef(unit);
  const decimals = d.continuous ? (Math.abs(q) < 10 ? 2 : 1) : 2;
  const n = formatNumber(q, decimals);
  if (unit === 'piece' && opts.compact) return n;
  return `${n}${d.short ? ' ' : ' '}${unitLabel(unit, q)}`;
}

/** Pas de saisie recommandé pour les boutons +/− dans l'unité donnée. */
export function defaultStep(u: UnitCode): number {
  switch (u) {
    case 'g':
    case 'ml':
      return 50;
    case 'cl':
      return 10;
    case 'kg':
    case 'l':
      return 0.25;
    default:
      return 1;
  }
}

/** Arrondit vers le haut une quantité à acheter selon l'unité (entiers pour les comptages). */
export function roundUpForPurchase(qty: number, u: UnitCode): number {
  const d = unitDef(u);
  if (!d.continuous) return Math.max(1, Math.ceil(roundQty(qty) - 1e-9));
  if (u === 'g' || u === 'ml') return Math.ceil(qty / 50 - 1e-9) * 50;
  if (u === 'cl') return Math.ceil(qty / 5 - 1e-9) * 5;
  return Math.ceil(qty * 4 - 1e-9) / 4; // kg, l : au quart
}
