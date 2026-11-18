/** Contrôle de cohérence des données du foyer (aucune correction automatique). */
import type { EntityCollections, Movement } from '../types';
import { bigrams, normalizeName } from '../text';
import { daysBetween, daysBetweenInstants, frDate } from '../time';
import { roundQty } from '../units';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface AuditIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  productId?: string;
  lotId?: string;
  otherProductId?: string;
  movementIds?: string[];
}

export const AUDIT_EPS = 1e-4;

export function auditHousehold(c: EntityCollections, now: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const products = c.product;
  const name = (id: string) => products.get(id)?.name ?? '?';

  // 1. Lots : quantité ≥ 0, cohérence avec les mouvements, produit existant.
  const sumByLot = new Map<string, number>();
  const movesByLot = new Map<string, Movement[]>();
  for (const m of c.movement.values()) {
    if (!m.lotId) continue;
    sumByLot.set(m.lotId, (sumByLot.get(m.lotId) ?? 0) + m.delta);
    const ml = movesByLot.get(m.lotId);
    if (ml) ml.push(m);
    else movesByLot.set(m.lotId, [m]);
  }
  for (const lot of c.lot.values()) {
    if (!products.has(lot.productId)) {
      issues.push({ code: 'orphan_lot', severity: 'error', message: `Un lot référence un produit inexistant.`, lotId: lot.id });
      continue;
    }
    if (lot.quantity < -AUDIT_EPS) {
      issues.push({ code: 'negative_qty', severity: 'error', message: `Quantité négative pour « ${name(lot.productId)} ».`, productId: lot.productId, lotId: lot.id });
    }
    const sum = roundQty(sumByLot.get(lot.id) ?? 0);
    if (Math.abs(sum - lot.quantity) > AUDIT_EPS) {
      issues.push({
        code: 'lot_sum_mismatch',
        severity: 'error',
        message: `« ${name(lot.productId)} » : la quantité du lot (${lot.quantity}) ne correspond pas à la somme de ses mouvements (${sum}).`,
        productId: lot.productId,
        lotId: lot.id,
      });
    }
    if (lot.expiryDate && lot.purchaseDate && lot.expiryDate < lot.purchaseDate) {
      issues.push({ code: 'expiry_before_purchase', severity: 'warning', message: `« ${name(lot.productId)} » : date de péremption (${frDate(lot.expiryDate!)}) antérieure à la date d'achat (${frDate(lot.purchaseDate!)}).`, productId: lot.productId, lotId: lot.id });
    }
    if (lot.expiryDate && daysBetween(lot.createdAt.slice(0, 10), lot.expiryDate) > 3650) {
      issues.push({ code: 'expiry_far', severity: 'warning', message: `« ${name(lot.productId)} » : date de péremption à plus de 10 ans (${frDate(lot.expiryDate!)}).`, productId: lot.productId, lotId: lot.id });
    }
  }

  // 2. Mouvements : arithmétique, doublons rapprochés, consommations sur stock nul.
  const moves = [...c.movement.values()].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  for (const m of moves) {
    if (Math.abs(m.quantityBefore + m.delta - m.quantityAfter) > AUDIT_EPS) {
      issues.push({ code: 'movement_math', severity: 'error', message: `Mouvement incohérent pour « ${name(m.productId)} » (avant + variation ≠ après).`, productId: m.productId, movementIds: [m.id] });
    }
  }
  const recentFrom = new Date(Date.parse(now) - 30 * 86_400_000).toISOString();
  // Doubles saisies : comparaison au sein d'un même produit seulement (un inventaire ou un ticket
  // crée beaucoup de mouvements au même instant, sur des produits différents).
  const recentByProduct = new Map<string, { m: Movement; t: number }[]>();
  for (const m of moves) {
    if (m.occurredAt < recentFrom || m.revertedBy || m.type === 'revert' || m.delta === 0) continue;
    const l = recentByProduct.get(m.productId);
    const e = { m, t: Date.parse(m.occurredAt) };
    if (l) l.push(e);
    else recentByProduct.set(m.productId, [e]);
  }
  const seen = new Set<string>();
  for (const list of recentByProduct.values()) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i].m;
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].t - list[i].t > 10_000) break;
        const b = list[j].m;
        if (b.opId === a.opId || b.type !== a.type || b.userId !== a.userId) continue;
        if (Math.abs(b.delta - a.delta) > AUDIT_EPS) continue;
        const k = [a.id, b.id].sort().join('|');
        if (seen.has(k)) continue;
        seen.add(k);
        issues.push({
          code: 'duplicate_movements',
          severity: 'warning',
          message: `« ${name(a.productId)} » : deux mouvements identiques à quelques secondes d'intervalle (${a.type === 'consume' ? 'consommation' : a.type === 'purchase' ? 'réception' : a.type}). S'agit-il d'un double scan ?`,
          productId: a.productId,
          movementIds: [a.id, b.id],
        });
      }
    }
  }
  for (const m of moves) {
    if (m.flags.includes('shortfall') && m.occurredAt >= recentFrom && !m.revertedBy) {
      issues.push({ code: 'shortfall', severity: 'warning', message: `« ${name(m.productId)} » a été consommé alors que le stock enregistré était insuffisant : un inventaire est conseillé.`, productId: m.productId, movementIds: [m.id] });
    }
  }

  // 3. Produits en double probables (jamais fusionnés automatiquement).
  //    Même règle qu'une comparaison deux à deux (nom identique, alias, ou ressemblance ≥ 0,9 avec
  //    même unité et même marque), mais sans coût quadratique : prétraitement unique par produit et
  //    index inversé des bigrammes — seules les paires partageant assez de bigrammes sont comparées.
  const active = [...products.values()].filter((p) => !p.archived);
  const prep = active.map((p) => {
    const norm = normalizeName(p.name);
    const grams = bigrams(norm);
    let total = 0;
    for (const c of grams.values()) total += c;
    return { p, norm, grams, total, aliases: new Set(p.aliases.map((x) => normalizeName(x.text))) };
  });
  const pairs = new Set<number>();
  const pairKey = (i: number, j: number) => i * active.length + j;
  const flag = (i: number, j: number) => {
    const [a, b] = i < j ? [i, j] : [j, i];
    if (a === b || pairs.has(pairKey(a, b))) return;
    pairs.add(pairKey(a, b));
  };
  // Noms identiques et alias désignant un autre produit.
  const byNorm = new Map<string, number[]>();
  prep.forEach((x, i) => x.norm && byNorm.set(x.norm, [...(byNorm.get(x.norm) ?? []), i]));
  for (const list of byNorm.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) flag(list[a], list[b]);
  prep.forEach((x, i) => {
    for (const al of x.aliases) for (const j of byNorm.get(al) ?? []) flag(i, j);
  });
  // Ressemblance (Dice sur les bigrammes ≥ 0,9).
  const postings = new Map<string, number[]>();
  prep.forEach((x, i) => {
    for (const g of x.grams.keys()) {
      const l = postings.get(g);
      if (l) l.push(i);
      else postings.set(g, [i]);
    }
  });
  for (let i = 0; i < prep.length; i++) {
    const xi = prep[i];
    if (!xi.total) continue;
    const overlap = new Map<number, number>();
    for (const [g, ci] of xi.grams) {
      for (const j of postings.get(g)!) {
        if (j <= i) continue;
        overlap.set(j, (overlap.get(j) ?? 0) + Math.min(ci, prep[j].grams.get(g)!));
      }
    }
    for (const [j, inter] of overlap) {
      const xj = prep[j];
      if ((2 * inter) / (xi.total + xj.total) >= 0.9 && xi.p.unit === xj.p.unit && (xi.p.brand ?? '') === (xj.p.brand ?? '')) flag(i, j);
    }
  }
  for (const k of [...pairs].sort((x, y) => x - y)) {
    const a = active[Math.floor(k / active.length)];
    const b = active[k % active.length];
    issues.push({
      code: 'possible_duplicate',
      severity: 'info',
      message: `« ${a.name} » et « ${b.name} » pourraient être le même produit. Vérifiez avant de fusionner.`,
      productId: a.id,
      otherProductId: b.id,
    });
  }

  // 4. Codes-barres orphelins.
  for (const code of c.productCode.values()) {
    if (!products.has(code.productId)) issues.push({ code: 'orphan_code', severity: 'warning', message: `Le code ${code.code} référence un produit inexistant.` });
  }

  // 5. Inventaires ouverts depuis longtemps.
  for (const s of c.inventorySession.values()) {
    if (s.status === 'open' && daysBetweenInstants(s.updatedAt, now) > 7) {
      issues.push({ code: 'inventory_stale', severity: 'info', message: `L'inventaire « ${s.title} » est en cours depuis plus d'une semaine.` });
    }
  }
  const rank: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
