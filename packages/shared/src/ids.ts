/** Génération d'identifiants (UUID v4) et dérivation déterministe. */

export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Repli (navigateurs anciens) : UUID v4 à partir de getRandomValues.
  const b = new Uint8Array(16);
  c!.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Identifiant dérivé d'une opération : identique côté client (prédiction) et serveur,
 * ce qui permet de rapprocher les entités créées par une même opération.
 */
export function deriveId(opId: string, suffix: string | number): string {
  return `${opId}~${suffix}`;
}

export const ID_RE = /^[A-Za-z0-9_~:-]{6,80}$/;
