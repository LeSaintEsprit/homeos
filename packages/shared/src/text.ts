/** Utilitaires de texte (français). */

/** Normalise un nom pour la détection des doublons : minuscules, sans accents ni ponctuation. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\b(\w{4,})s\b/g, '$1'); // pluriels simples
}

/** Distance de similarité simple (0..1) entre deux noms normalisés (bigrammes). */
/** Bigrammes (avec bornes) d'un nom déjà normalisé, et leur nombre d'occurrences. */
export function bigrams(norm: string): Map<string, number> {
  const m = new Map<string, number>();
  if (!norm) return m;
  const t = ` ${norm} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let inter = 0;
  let total = 0;
  for (const [g, c] of ga) {
    inter += Math.min(c, gb.get(g) ?? 0);
    total += c;
  }
  for (const c of gb.values()) total += c;
  return (2 * inter) / total;
}

const VOWEL_START = /^[aàâäeéèêëiîïoôöuùûüyœæh]/i;
/** « de lait », « d'huile », « d'œufs ». */
export function deOf(name: string): string {
  const n = lowerFirst(name.trim());
  return VOWEL_START.test(n) && !/^h(a|ari|ach)/i.test(n) ? `d'${n}` : `de ${n}`;
}

/** Met en minuscule la première lettre sauf pour les sigles/marques (« IKEA », « M&M's »). */
export function lowerFirst(s: string): string {
  if (s.length < 2) return s.toLowerCase();
  const second = s[1];
  if (second === second.toUpperCase() && second !== second.toLowerCase()) return s;
  return s[0].toLowerCase() + s.slice(1);
}

export function upperFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return Math.abs(n) >= 2 ? (pluralForm ?? `${singular}s`) : singular;
}

/** « environ 3 jours », « moins d'un jour », « environ 2 semaines ». */
export function humanDays(days: number): string {
  if (!Number.isFinite(days)) return 'une durée indéterminée';
  if (days < 1) return "moins d'un jour";
  const d = Math.round(days);
  if (d < 14) return `environ ${d} ${plural(d, 'jour')}`;
  if (d < 60) {
    const w = Math.round(d / 7);
    return `environ ${w} semaines`;
  }
  const m = Math.round(d / 30);
  return `environ ${m} mois`;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
