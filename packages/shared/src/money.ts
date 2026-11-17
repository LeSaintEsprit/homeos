const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const EUR0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export function formatEuros(cents: number | null | undefined, opts: { round?: boolean } = {}): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return (opts.round ? EUR0 : EUR).format(cents / 100);
}

const fmtCache = new Map<string, Intl.NumberFormat>();
/** Montant dans la devise du foyer. */
export function formatMoney(cents: number | null | undefined, currency = 'EUR', opts: { round?: boolean } = {}): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  const key = `${currency}|${opts.round ? 0 : 2}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: opts.round ? 0 : 2, minimumFractionDigits: opts.round ? 0 : undefined });
    fmtCache.set(key, f);
  }
  return f.format(cents / 100);
}

/** « 2,35 » / « 2.35 » / « 2,35 € » → 235 centimes. */
export function parseEuros(s: string): number | null {
  const m = /(-?\d{1,6})(?:[.,](\d{1,2}))?/.exec(s.replace(/\s/g, ''));
  if (!m) return null;
  const units = Number(m[1]);
  const dec = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return units < 0 ? units * 100 - dec : units * 100 + dec;
}
