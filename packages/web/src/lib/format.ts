const rtf = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });
const dtf = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dtfFull = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const dtfTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** « il y a 5 min », « hier », « 12 nov. ». */
export function relativeTime(iso: string, now = Date.now()): string {
  const d = Date.parse(iso);
  const s = Math.round((d - now) / 1000);
  const a = Math.abs(s);
  if (a < 45) return "à l'instant";
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  return dtf.format(d);
}

export const formatDate = (iso: string) => dtfFull.format(Date.parse(iso.length === 10 ? `${iso}T12:00:00` : iso));
export const formatShortDate = (iso: string) => dtf.format(Date.parse(iso.length === 10 ? `${iso}T12:00:00` : iso));
export const formatTime = (iso: string) => dtfTime.format(Date.parse(iso));

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Bonne nuit';
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${Math.abs(n) >= 2 ? many : one}`;
}
