/** Dates calendaires « YYYY-MM-DD » et calculs de durées. */

export const DAY_MS = 86_400_000;

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    dtfCache.set(tz, f);
  }
  return f;
}

/** Date calendaire d'un instant dans un fuseau horaire. */
export function dateInTz(instant: string | number | Date, tz = 'Europe/Paris'): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  return dtf(tz).format(d); // en-CA → YYYY-MM-DD
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateStr(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Nombre de jours entre deux dates calendaires (b − a). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / DAY_MS);
}

export function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + Math.round(n) * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** Durée en jours (fractionnaire) entre deux instants ISO. */
export function daysBetweenInstants(a: string | number, b: string | number): number {
  const ta = typeof a === 'number' ? a : Date.parse(a);
  const tb = typeof b === 'number' ? b : Date.parse(b);
  return (tb - ta) / DAY_MS;
}

export function minDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/** Lundi de la semaine d'une date (semaine ISO). */
export function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lundi
  return addDays(date, -dow);
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Borne la date client : pas plus de 5 min dans le futur ni plus de 60 jours dans le passé. */
export function clampClientTime(clientTime: string | undefined, serverNow: string): string {
  const now = Date.parse(serverNow);
  const t = clientTime ? Date.parse(clientTime) : NaN;
  if (Number.isNaN(t)) return serverNow;
  if (t > now + 5 * 60_000) return serverNow;
  if (t < now - 60 * DAY_MS) return new Date(now - 60 * DAY_MS).toISOString();
  return new Date(t).toISOString();
}

/** « 2026-11-19 » → « 19/11/2026 » (dates affichées dans les messages). */
export function frDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}
