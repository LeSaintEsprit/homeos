/**
 * Interprétation du texte OCR (Tesseract) : dates de péremption et tickets de caisse.
 * Aucun résultat n'est enregistré sans confirmation de l'utilisateur.
 */
import { addDays, daysBetween, isDateStr } from '../time';
import { normalizeName, similarity } from '../text';
import type { Product, Store } from '../types';
import { formatMoney } from '../money';

export interface DateCandidate {
  date: string;
  kind: 'dlc' | 'ddm' | null;
  raw: string;
  score: number;
}

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, JANV: 1, JANVIER: 1, JANUARY: 1,
  FEV: 2, FEVR: 2, FEVRIER: 2, FEB: 2, FEBRUARY: 2,
  MAR: 3, MARS: 3, MARCH: 3,
  AVR: 4, AVRIL: 4, APR: 4, APRIL: 4,
  MAI: 5, MAY: 5,
  JUN: 6, JUIN: 6, JUNE: 6,
  JUL: 7, JUIL: 7, JUILLET: 7, JULY: 7,
  AOU: 8, AOUT: 8, AUG: 8, AUGUST: 8,
  SEP: 9, SEPT: 9, SEPTEMBRE: 9, SEPTEMBER: 9,
  OCT: 10, OCTOBRE: 10, OCTOBER: 10,
  NOV: 11, NOVEMBRE: 11, NOVEMBER: 11,
  DEC: 12, DECEMBRE: 12, DECEMBER: 12,
};

const DLC_RE = /(A\s*CONSOMMER\s*JUSQU|DLC|USE\s*BY|EXP(IRY|\.)?\b|A\s*CONS\.?\s*JUSQU|JUSQU\s*AU)/;
const DDM_RE = /(DE\s*PREFERENCE|DE\s*PREF|DDM|DLUO|BEST\s*BEFORE|BB[E]?\b|MEILLEUR\s*AVANT|A\s*CONSOMMER\s*DE\s*PR)/;

/** Normalise le texte OCR (majuscules, sans accents). */
export function normalizeOcr(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[’'`]/g, "'");
}

/** Corrige les confusions courantes de l'OCR dans un groupe de chiffres. */
function fixDigits(s: string): string {
  return s.replace(/[OQD]/g, '0').replace(/[IL|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
}

function mkDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isDateStr(s) ? s : null;
}

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y < 100 ? y + 2000 : y, m, 0)).getUTCDate();
}

/**
 * Recherche les dates plausibles dans un texte OCR d'étiquette, en tenant compte des
 * mentions DLC (« à consommer jusqu'au ») et DDM (« à consommer de préférence avant »).
 */
export function findExpiryDates(text: string, today: string): DateCandidate[] {
  const norm = normalizeOcr(text);
  const out = new Map<string, DateCandidate>();
  const push = (date: string | null, raw: string, index: number, precise: boolean) => {
    if (!date) return;
    const delta = daysBetween(today, date);
    if (delta < -730 || delta > 3650) return; // hors plage plausible
    const context = norm.slice(Math.max(0, index - 60), index);
    const lineStart = norm.lastIndexOf('\n', index) + 1;
    const line = norm.slice(lineStart, index + raw.length + 20);
    let kind: DateCandidate['kind'] = null;
    if (DDM_RE.test(context) || DDM_RE.test(line)) kind = 'ddm';
    else if (DLC_RE.test(context) || DLC_RE.test(line)) kind = 'dlc';
    let score = 1;
    if (kind) score += 3;
    if (precise) score += 1;
    if (delta >= -7 && delta <= 3 * 365) score += 1;
    const prev = out.get(date);
    if (!prev || prev.score < score) out.set(date, { date, kind, raw, score });
  };
  // JJ/MM/AAAA, JJ.MM.AA, JJ-MM-AA, JJ MM AAAA
  const full = /(?<![0-9A-Z])([0-3OQDIL]?[0-9OQDILSBZ])\s?[\/.\-\s]\s?([01OQIL]?[0-9OQDILSBZ])\s?[\/.\-\s]\s?((?:20)?[0-9OQDILSBZ]{2})(?![0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = full.exec(norm))) {
    const d = Number(fixDigits(m[1]));
    const mo = Number(fixDigits(m[2]));
    const y = Number(fixDigits(m[3]));
    push(mkDate(y, mo, d), m[0], m.index, true);
  }
  // JJ MOIS AAAA (« 12 MARS 2026 », « 12 JAN 26 »)
  const named = /(?<![0-9])([0-3]?[0-9])\s*([A-Z]{3,9})\.?\s*((?:20)?[0-9]{2})(?![0-9])/g;
  while ((m = named.exec(norm))) {
    const mo = MONTH_NAMES[m[2]];
    if (!mo) continue;
    push(mkDate(Number(m[3]), mo, Number(m[1])), m[0], m.index, true);
  }
  // MM/AAAA (fréquent pour les DDM : « fin 03/2027 ») → dernier jour du mois
  const monthYear = /(?<![0-9\/.])([01]?[0-9])\s?[\/.\-]\s?(20[0-9]{2})(?![0-9\/.])/g;
  while ((m = monthYear.exec(norm))) {
    const mo = Number(m[1]);
    const y = Number(m[2]);
    if (mo < 1 || mo > 12) continue;
    push(mkDate(y, mo, lastDay(y, mo)), m[0], m.index, false);
  }
  // JJ/MM sans année → prochaine occurrence plausible
  const short = /(?<![0-9\/.])([0-3]?[0-9])\s?[\/.]\s?([01]?[0-9])(?![0-9\/.])/g;
  while ((m = short.exec(norm))) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(today.slice(0, 4));
    let date = mkDate(y, mo, d);
    if (date && daysBetween(today, date) < -30) date = mkDate(y + 1, mo, d);
    push(date, m[0], m.index, false);
  }
  return [...out.values()].sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
}

// ───────────────────────── Tickets de caisse ─────────────────────────

export interface ReceiptLineParsed {
  label: string;
  quantity: number;
  /** Unité déduite du ticket (kg pour les articles au poids). */
  weighed: boolean;
  unitPriceCents: number | null;
  totalCents: number;
  discountCents: number;
  confidence: 'high' | 'low';
}

export interface ParsedReceipt {
  storeName: string | null;
  storeId: string | null;
  date: string | null;
  totalCents: number | null;
  lines: ReceiptLineParsed[];
  /** Remises non rattachées à une ligne. */
  globalDiscountCents: number;
  warnings: string[];
}

export const KNOWN_CHAINS = [
  'CARREFOUR', 'E.LECLERC', 'LECLERC', 'LIDL', 'AUCHAN', 'INTERMARCHE', 'SUPER U', 'HYPER U', 'U EXPRESS', 'MONOPRIX',
  'FRANPRIX', 'CASINO', 'GEANT CASINO', 'ALDI', 'NETTO', 'GRAND FRAIS', 'BIOCOOP', 'PICARD', 'CORA', 'SPAR', 'MATCH',
  'G20', 'NATURALIA', 'LA VIE CLAIRE', 'LEADER PRICE', 'NORMA', 'ACTION', 'NOZ',
];

const NOT_ITEM = /(TOTAL|TVA|T\.V\.A|CB\b|CARTE|ESPECES|RENDU|MONNAIE|FIDELITE|CAGNOTTE|SOLDE|PAIEMENT|TICKET|MERCI|SIRET|TEL\b|TELEPHONE|CAISSE|CAISSIER|NB ARTICLE|ARTICLES|A PAYER|MONTANT|VISA|MASTERCARD|SANS CONTACT|EUR\s*$|HT\b|TTC\b|BIENVENUE|WWW\.|HTTP)/;
const DISCOUNT = /(REMISE|PROMO|REDUC|REDUCTION|BON\s*D|COUPON|AVANTAGE|OFFRE|IMMEDIATE|-\s*\d+\s*%)/;
const PRICE_END = /(-?\d{1,4})\s?[,.]\s?(\d{2})\s*(?:€|EUR|E)?\s*[A-Z0-9]?\s*$/;
const QTY_LINE = /^\s*(\d{1,3})\s*[X×*]\s*(\d{1,4})\s?[,.]\s?(\d{2})/;
const WEIGHT_LINE = /(\d{1,3}[,.]\d{1,3})\s*KG\s*[X×*@]\s*(\d{1,4})[,.](\d{2})\s*(?:€|EUR)?\s*\/?\s*KG/;
const INLINE_QTY = /\s[X×*]\s?(\d{1,3})\b|\b(\d{1,3})\s?[X×*]\s/;

function cents(units: string, dec: string): number {
  const u = Number(units);
  return u < 0 || units.startsWith('-') ? -(Math.abs(u) * 100 + Number(dec)) : u * 100 + Number(dec);
}

/** Analyse le texte OCR d'un ticket de caisse. Le résultat DOIT être validé par l'utilisateur. */
export function parseReceipt(text: string, stores: Store[], today: string): ParsedReceipt {
  const norm = normalizeOcr(text);
  const rawLines = norm.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out: ParsedReceipt = { storeName: null, storeId: null, date: null, totalCents: null, lines: [], globalDiscountCents: 0, warnings: [] };

  // Magasin : d'abord les magasins du foyer, puis les enseignes connues (en-tête du ticket).
  const head = rawLines.slice(0, 8).join(' ');
  let best = 0;
  for (const s of stores) {
    const n = normalizeName(s.name).toUpperCase();
    if (n && head.includes(n)) {
      out.storeId = s.id;
      out.storeName = s.name;
      best = 1;
      break;
    }
    for (const l of rawLines.slice(0, 8)) {
      const sim = similarity(l, s.name);
      if (sim > 0.8 && sim > best) {
        best = sim;
        out.storeId = s.id;
        out.storeName = s.name;
      }
    }
  }
  if (!out.storeId) {
    const chain = KNOWN_CHAINS.find((c) => head.includes(c));
    if (chain) out.storeName = chain === 'E.LECLERC' ? 'Leclerc' : chain.charAt(0) + chain.slice(1).toLowerCase();
  }

  // Date d'achat : première date complète plausible (≤ aujourd'hui).
  for (const l of rawLines) {
    const m = /(?<![0-9])([0-3]?\d)[\/.\-]([01]?\d)[\/.\-]((?:20)?\d{2})(?![0-9])/.exec(l);
    if (m) {
      const d = mkDate(Number(m[3]), Number(m[2]), Number(m[1]));
      if (d && d <= today && daysBetween(d, today) < 400) {
        out.date = d;
        break;
      }
    }
  }

  // Total payé.
  for (const l of rawLines) {
    if (/(A PAYER|NET A PAYER|TOTAL TTC|MONTANT DU|TOTAL\b)/.test(l) && !/SOUS.?TOTAL|TOTAL REMISE|TOTAL ECONOMIE/.test(l)) {
      const m = PRICE_END.exec(l);
      if (m) {
        const v = cents(m[1], m[2]);
        if (/(A PAYER|NET A PAYER)/.test(l) || out.totalCents == null) out.totalCents = v;
      }
    }
  }

  // Lignes d'articles.
  let last: ReceiptLineParsed | null = null;
  /** Libellé seul sur sa ligne (le prix suit sur la ligne de poids/quantité). */
  let pendingLabel: string | null = null;
  /** Ligne de détail (« 2 x 3,89 ») imprimée avant son article, selon les enseignes. */
  let pendingDetail: { quantity: number; unitPriceCents: number; weighed: boolean } | null = null;
  // Une ligne de détail ne se rattache qu'à l'article dont le montant concorde (quantité × prix unitaire).
  const fits = (d: { quantity: number; unitPriceCents: number }, gross: number) => Math.abs(Math.round(d.quantity * d.unitPriceCents) - gross) <= Math.max(2, gross * 0.01);
  for (const l of rawLines) {
    const qtyM = QTY_LINE.exec(l);
    const wM = WEIGHT_LINE.exec(l);
    if ((qtyM || wM) && !PRICE_END.test(l.replace(QTY_LINE, ''))) {
      // Ligne de détail sans montant (« 2 x 1,25 », « 0,532 kg x 3,99 €/kg »).
      const d = qtyM
        ? { quantity: Number(qtyM[1]), unitPriceCents: cents(qtyM[2], qtyM[3]), weighed: false }
        : { quantity: Number(wM![1].replace(',', '.')), unitPriceCents: cents(wM![2], wM![3]), weighed: true };
      if (last && fits(d, last.totalCents + last.discountCents)) {
        last.quantity = d.quantity;
        last.unitPriceCents = d.unitPriceCents;
        if (d.weighed) last.weighed = true;
        pendingDetail = null;
      } else pendingDetail = d;
      continue;
    }
    const pm = PRICE_END.exec(l);
    if (!pm) {
      pendingLabel = !NOT_ITEM.test(l) && /[A-Z]{3,}/.test(l) && !/\d{2}[\/.]\d{2}[\/.]\d{2}/.test(l) ? l : null;
      continue;
    }
    const usePending = pendingLabel;
    pendingLabel = null;
    const label = l.slice(0, pm.index).replace(/[.\-_*]+$/, '').trim();
    const value = cents(pm[1], pm[2]);
    if (DISCOUNT.test(l) || value < 0) {
      const d = Math.abs(value);
      if (last) {
        last.discountCents += d;
        last.totalCents -= d;
      } else out.globalDiscountCents += d;
      continue;
    }
    if (NOT_ITEM.test(l) && !wM && !qtyM) {
      last = null;
      continue;
    }
    if (!wM && !qtyM && label.replace(/[^A-Z]/g, '').length < 2) {
      last = null;
      continue;
    }
    const line: ReceiptLineParsed = { label, quantity: 1, weighed: false, unitPriceCents: null, totalCents: value, discountCents: 0, confidence: 'high' };
    if (qtyM) {
      line.quantity = Number(qtyM[1]);
      line.unitPriceCents = cents(qtyM[2], qtyM[3]);
      line.label = l.slice(qtyM[0].length, pm.index).replace(/^[\s€A-Z]{0,4}(?=\s)/, '').trim() || usePending || label;
    } else if (wM) {
      line.quantity = Number(wM[1].replace(',', '.'));
      line.weighed = true;
      line.unitPriceCents = cents(wM[2], wM[3]);
      const rest = label.replace(WEIGHT_LINE, '').trim();
      line.label = usePending ?? (rest || label);
    } else if (pendingDetail && fits(pendingDetail, value)) {
      // Détail imprimé juste avant l'article.
      line.quantity = pendingDetail.quantity;
      line.unitPriceCents = pendingDetail.unitPriceCents;
      line.weighed = pendingDetail.weighed;
      line.label = usePending ?? label;
    } else {
      line.label = label.replace(INLINE_QTY, ' ').replace(/\s+/g, ' ').trim();
      const iq = INLINE_QTY.exec(label);
      if (iq) {
        const n = Number(iq[1] ?? iq[2]);
        if (n > 1 && n < 50 && value % n === 0) {
          line.quantity = n;
          line.unitPriceCents = value / n;
        }
      }
    }
    if (line.unitPriceCents == null) line.unitPriceCents = line.weighed ? null : Math.round(value / line.quantity);
    if (/\d{5,}/.test(line.label) || line.label.length < 3) line.confidence = 'low';
    pendingDetail = null;
    out.lines.push(line);
    last = line;
  }

  const sum = out.lines.reduce((s, l) => s + l.totalCents, 0) - out.globalDiscountCents;
  if (out.totalCents != null && out.lines.length && Math.abs(sum - out.totalCents) > Math.max(2, out.totalCents * 0.01)) {
    out.warnings.push(`Le total des lignes lues (${formatMoney(sum)}) ne correspond pas au total du ticket (${formatMoney(out.totalCents)}) : certaines lignes ont pu être mal lues.`);
  }
  if (!out.date) out.warnings.push('Date du ticket non reconnue : vérifiez-la.');
  if (!out.lines.length) out.warnings.push("Aucune ligne d'article n'a pu être lue. Essayez une photo plus nette, bien à plat et éclairée.");
  return out;
}

export type MatchConfidence = 'sure' | 'likely' | 'uncertain' | 'none';

export interface ProductMatch {
  productId: string | null;
  confidence: MatchConfidence;
  reason: string;
  alternatives: { productId: string; score: number }[];
}

/**
 * Associe un libellé de ticket à un produit du catalogue. Les alias appris (même
 * magasin) sont sûrs ; une simple ressemblance de nom reste « incertaine » et doit
 * être confirmée.
 */
export function matchReceiptLabel(label: string, products: Product[], storeId: string | null): ProductMatch {
  const n = normalizeName(label);
  const active = products.filter((p) => !p.archived);
  for (const p of active) {
    if (p.aliases.some((a) => a.kind === 'receipt' && normalizeName(a.text) === n && (a.storeId === storeId || !storeId))) {
      return { productId: p.id, confidence: 'sure', reason: 'Libellé déjà associé lors d\'un précédent ticket', alternatives: [] };
    }
  }
  for (const p of active) {
    if (normalizeName(p.name) === n || p.aliases.some((a) => normalizeName(a.text) === n)) {
      return { productId: p.id, confidence: 'likely', reason: 'Nom identique', alternatives: [] };
    }
  }
  const scored = active
    .map((p) => ({
      productId: p.id,
      score: Math.max(similarity(label, p.name), ...p.aliases.map((a) => similarity(label, a.text)), p.brand ? similarity(label, `${p.name} ${p.brand}`) : 0),
    }))
    .filter((x) => x.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  if (!scored.length) return { productId: null, confidence: 'none', reason: 'Aucun produit correspondant', alternatives: [] };
  const top = scored[0];
  const conf: MatchConfidence = top.score >= 0.8 && (scored.length < 2 || top.score - scored[1].score > 0.1) ? 'likely' : 'uncertain';
  return { productId: top.productId, confidence: conf, reason: `Nom ressemblant (${Math.round(top.score * 100)} %)`, alternatives: scored.slice(1) };
}

/** Suggestion de date à partir de la durée de conservation habituelle — toujours marquée « estimée ». */
export function suggestEstimatedExpiry(today: string, shelfLifeDays: number | null): string | null {
  return shelfLifeDays != null && shelfLifeDays > 0 ? addDays(today, shelfLifeDays) : null;
}
