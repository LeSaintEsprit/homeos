/**
 * Analyse des codes-barres : GTIN (EAN/UPC) et codes GS1 à données complémentaires
 * (GS1-128, GS1 DataMatrix, GS1 QR, GS1 Digital Link).
 *
 * Règle : un EAN/UPC classique ne contient JAMAIS de date. Les dates ne sont lues
 * que dans les Application Identifiers (15) DDM et (17) date limite.
 */

export interface ParsedCode {
  raw: string;
  /** Code canonique pour la recherche (GTIN-13 si possible, sinon tel quel). */
  code: string;
  gtin: string | null;
  isGs1: boolean;
  /** EAN à circulation restreinte (préfixe 2 : poids/prix variable en magasin). */
  restricted: boolean;
  validCheckDigit: boolean | null;
  batch: string | null;
  serial: string | null;
  /** (15) Date de durabilité minimale. */
  bestBefore: string | null;
  /** (17) Date limite (DLC). */
  expiry: string | null;
  /** (11) Date de production. */
  productionDate: string | null;
  /** Poids net en kg (AI 310n / 320n). */
  netWeightKg: number | null;
  /** Prix à payer en centimes (AI 392n). */
  priceCents: number | null;
  ais: Record<string, string>;
}

const GS = '\u001d';

/** Longueurs fixes des AI (valeur seule, hors AI) selon la spécification GS1. */
const FIXED: Record<string, number> = {
  '00': 18, '01': 14, '02': 14, '03': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2,
};
const VAR_MAX: Record<string, number> = { '10': 20, '21': 20, '22': 20, '30': 8, '37': 8, '240': 30, '241': 30, '250': 30, '251': 30, '400': 30, '401': 30 };

function aiLength(s: string): number {
  const two = s.slice(0, 2);
  if (/^(0[0-3]|1[0-9]|2[0-2]|30|37|9\d)$/.test(two)) return 2;
  if (/^(3[1-6]|39|7\d|8\d)$/.test(two)) return 4;
  if (/^(2[3-5]|4[0-2])$/.test(two)) return 3;
  return 0;
}

function valueLength(ai: string): number | null {
  if (FIXED[ai] != null) return FIXED[ai];
  if (/^3[1-6]\d\d$/.test(ai)) return 6;
  if (/^41\d$/.test(ai)) return 13;
  return null;
}

/** Calcule la clé de contrôle GS1 (modulo 10). */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** Forme canonique : GTIN-14 → GTIN-13 si zéro initial, UPC-A → EAN-13. */
export function canonicalGtin(code: string): string {
  let c = code.replace(/\D/g, '');
  if (c.length === 14 && c.startsWith('0')) c = c.slice(1);
  if (c.length === 12) c = `0${c}`;
  return c;
}

/** Date GS1 AAMMJJ → AAAA-MM-JJ (fenêtre de siècle GS1, « 00 » = dernier jour du mois). */
export function gs1Date(v: string, today = new Date()): string | null {
  if (!/^\d{6}$/.test(v)) return null;
  const yy = Number(v.slice(0, 2));
  const mm = Number(v.slice(2, 4));
  let dd = Number(v.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  const cur = today.getUTCFullYear();
  const curYY = cur % 100;
  let century = cur - curYY;
  const diff = yy - curYY;
  if (diff >= 51) century -= 100;
  else if (diff <= -50) century += 100;
  const year = century + yy;
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd === 0) dd = last;
  if (dd > last) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function parseElementString(s: string, ais: Record<string, string>): boolean {
  let i = 0;
  let guard = 0;
  while (i < s.length && guard++ < 40) {
    if (s[i] === GS) {
      i++;
      continue;
    }
    const rest = s.slice(i);
    const len = aiLength(rest);
    if (!len || rest.length < len) return false;
    const ai = rest.slice(0, len);
    if (!/^\d+$/.test(ai)) return false;
    const fixed = valueLength(ai);
    let value: string;
    if (fixed != null) {
      value = rest.slice(len, len + fixed);
      if (value.length !== fixed) return false;
      i += len + fixed;
      if (s[i] === GS) i++;
    } else {
      const end = rest.indexOf(GS, len);
      const max = VAR_MAX[ai] ?? 70;
      value = end === -1 ? rest.slice(len) : rest.slice(len, end);
      if (value.length > max) value = value.slice(0, max);
      i += len + value.length + (end === -1 ? 0 : 1);
    }
    ais[ai] = value;
  }
  return Object.keys(ais).length > 0;
}

function parseParenthesized(s: string, ais: Record<string, string>): boolean {
  const re = /\((\d{2,4})\)([^(]*)/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(s))) {
    ais[m[1]] = m[2].trim();
    found = true;
  }
  return found;
}

function parseDigitalLink(s: string, ais: Record<string, string>): boolean {
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return false;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p, k) => /^(01|00|414|8006|8013)$/.test(p) && k + 1 < parts.length);
  if (idx === -1) return false;
  for (let k = idx; k + 1 < parts.length; k += 2) {
    if (/^\d{2,4}$/.test(parts[k])) ais[parts[k]] = decodeURIComponent(parts[k + 1]);
  }
  for (const [k, v] of url.searchParams) if (/^\d{2,4}$/.test(k)) ais[k] = v;
  return '01' in ais;
}

/** Analyse le texte renvoyé par le lecteur de codes-barres. */
export function parseScannedCode(input: string, today = new Date()): ParsedCode {
  const raw = input.trim();
  const out: ParsedCode = {
    raw,
    code: raw,
    gtin: null,
    isGs1: false,
    restricted: false,
    validCheckDigit: null,
    batch: null,
    serial: null,
    bestBefore: null,
    expiry: null,
    productionDate: null,
    netWeightKg: null,
    priceCents: null,
    ais: {},
  };
  let s = raw;
  // Identifiants de symbologie AIM : ]C1 (GS1-128), ]d2 (GS1 DataMatrix), ]Q3 (GS1 QR), ]e0 (DataBar).
  const aim = /^\](C1|d2|Q3|e0|J1)/.exec(s);
  if (aim) s = s.slice(3);
  const ais: Record<string, string> = {};
  let gs1 = false;
  if (/^https?:\/\//i.test(s)) gs1 = parseDigitalLink(s, ais);
  else if (s.startsWith('(')) gs1 = parseParenthesized(s, ais);
  else if (aim || s.includes(GS) || (/^01\d{14}/.test(s) && s.length > 16)) gs1 = parseElementString(s.replace(/^è|^\u001d/, ''), ais);

  if (gs1 && ais['01']) {
    out.isGs1 = true;
    out.ais = ais;
    out.gtin = ais['01'];
    out.validCheckDigit = isValidGtin(ais['01']);
    out.code = canonicalGtin(ais['01']);
    out.batch = ais['10'] ?? null;
    out.serial = ais['21'] ?? null;
    out.bestBefore = ais['15'] ? gs1Date(ais['15'], today) : null;
    out.expiry = ais['17'] ? gs1Date(ais['17'], today) : null;
    out.productionDate = ais['11'] ? gs1Date(ais['11'], today) : null;
    for (const [ai, v] of Object.entries(ais)) {
      const n = Number(v);
      if (/^310\d$/.test(ai) && Number.isFinite(n)) out.netWeightKg = n / 10 ** Number(ai[3]);
      if (/^320\d$/.test(ai) && Number.isFinite(n)) out.netWeightKg = Math.round((n / 10 ** Number(ai[3])) * 0.45359237 * 1000) / 1000;
      if (/^392\d$/.test(ai) && Number.isFinite(n)) out.priceCents = Math.round((n / 10 ** Number(ai[3])) * 100);
    }
    out.restricted = /^0?2/.test(out.code) && out.code.length === 13 && out.code.startsWith('2');
    return out;
  }
  // Code linéaire classique (EAN-13/8, UPC-A/E…) : aucune date n'est supposée.
  const digits = s.replace(/\s/g, '');
  if (/^\d{8}$|^\d{12,14}$/.test(digits)) {
    out.validCheckDigit = isValidGtin(digits);
    out.code = canonicalGtin(digits);
    out.gtin = out.code;
    out.restricted = out.code.length === 13 && out.code.startsWith('2');
  } else {
    out.code = digits.slice(0, 48);
  }
  return out;
}

export function describeCode(p: ParsedCode): string[] {
  const out: string[] = [];
  if (p.batch) out.push(`Lot ${p.batch}`);
  if (p.expiry) out.push(`Date limite ${p.expiry.split('-').reverse().join('/')}`);
  if (p.bestBefore) out.push(`DDM ${p.bestBefore.split('-').reverse().join('/')}`);
  if (p.netWeightKg != null) out.push(`Poids net ${String(p.netWeightKg).replace('.', ',')} kg`);
  return out;
}
