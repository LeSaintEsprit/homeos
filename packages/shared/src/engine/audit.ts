/** Contrôle de cohérence des données du foyer (aucune correction automatique). */
import type { EntityCollections, Movement } from '../types';
import { normalizeName, similarity } from '../text';
import { daysBetween, daysBetweenInstants } from '../time';
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
    movesByLot.set(m.lotId, [...(movesByLot.get(m.lotId) ?? []), m]);
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
      issues.push({ code: 'expiry_before_purchase', severity: 'warning', message: `« ${name(lot.productId)} » : date de péremption (${lot.expiryDate}) antérieure à la date d'achat (${lot.purchaseDate}).`, productId: lot.productId, lotId: lot.id });
    }
    if (lot.expiryDate && daysBetween(lot.createdAt.slice(0, 10), lot.expiryDate) > 3650) {
      issues.push({ code: 'expiry_far', severity: 'warning', message: `« ${name(lot.productId)} » : date de péremption à plus de 10 ans (${lot.expiryDate}).`, productId: lot.productId, lotId: lot.id });
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
  const seen = new Set<string>();
  for (let i = 0; i < moves.length; i++) {
    const a = moves[i];
    if (a.revertedBy || a.type === 'revert' || a.delta === 0 || a.occurredAt < recentFrom) continue;
    for (let j = i + 1; j < moves.length; j++) {
      const b = moves[j];
      if (daysBetweenInstants(a.occurredAt, b.occurredAt) * 86400 > 10) break;
      if (b.revertedBy || b.opId === a.opId || b.productId !== a.productId || b.type !== a.type || b.userId !== a.userId) continue;
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
  for (const m of moves) {
    if (m.flags.includes('shortfall') && m.occurredAt >= recentFrom && !m.revertedBy) {
      issues.push({ code: 'shortfall', severity: 'warning', message: `« ${name(m.productId)} » a été consommé alors que le stock enregistré était insuffisant : un inventaire est conseillé.`, productId: m.productId, movementIds: [m.id] });
    }
  }

  // 3. Produits en double probables (jamais fusionnés automatiquement).
  const active = [...products.values()].filter((p) => !p.archived);
  const codesByProduct = new Map<string, string[]>();
  for (const code of c.productCode.values()) codesByProduct.set(code.productId, [...(codesByProduct.get(code.productId) ?? []), code.code]);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const sameName = normalizeName(a.name) === normalizeName(b.name);
      const sim = similarity(a.name, b.name);
      const aliasHit = a.aliases.some((x) => normalizeName(x.text) === normalizeName(b.name)) || b.aliases.some((x) => normalizeName(x.text) === normalizeName(a.name));
      if (sameName || aliasHit || (sim >= 0.9 && a.unit === b.unit && (a.brand ?? '') === (b.brand ?? ''))) {
        issues.push({
          code: 'possible_duplicate',
          severity: 'info',
          message: `« ${a.name} » et « ${b.name} » pourraient être le même produit. Vérifiez avant de fusionner.`,
          productId: a.id,
          otherProductId: b.id,
        });
      }
    }
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
