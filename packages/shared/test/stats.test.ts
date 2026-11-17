import { describe, expect, it } from 'vitest';
import {
  spendingByPeriod, budgetStatus, estimateListCost, estimateUnitPrice, priceHistory, comparePricesByStore, wasteStats, auditHousehold,
  computeAlerts, visibleAlerts, buildDigest, analyzeHousehold, newId, DEFAULT_SETTINGS, type Purchase, type Product,
} from '@homeos/shared';
import { Harness } from './helpers';

const pu = (date: string, totalCents: number | null, extra: Partial<Purchase> = {}): Purchase => ({
  id: newId(), householdId: 'h', version: 1, productId: null, name: 'x', categoryId: null, quantity: 1, unit: 'piece', totalCents, discountCents: null,
  storeId: null, userId: 'u', date, shoppingItemId: null, lotId: null, receiptId: null, note: null, createdAt: date, ...extra,
});

describe('dépenses', () => {
  it('agrège par semaine, mois, année et sépare les achats sans prix', () => {
    const list = [pu('2026-11-02', 1000), pu('2026-11-03', 500), pu('2026-11-10', 2000), pu('2026-11-11', null), pu('2026-10-05', 700)];
    const weeks = spendingByPeriod(list, '2026-11-12', 'week', 3);
    expect(weeks.map((w) => [w.key, w.totalCents, w.unpricedCount])).toEqual([['2026-10-26', 0, 0], ['2026-11-02', 1500, 0], ['2026-11-09', 2000, 1]]);
    const months = spendingByPeriod(list, '2026-11-12', 'month', 2);
    expect(months.map((m) => m.totalCents)).toEqual([700, 3500]);
    expect(spendingByPeriod(list, '2026-11-12', 'year', 1)[0].totalCents).toBe(4200);
  });
  it('budget : dépensé, projection au rythme réel, panier moyen', () => {
    const list = [pu('2026-11-02', 6000, { storeId: 's1' }), pu('2026-11-02', 2000, { storeId: 's1' }), pu('2026-11-09', 4000, { storeId: 's2' })];
    const b = budgetStatus(list, '2026-11-10', 40000);
    expect(b.spentCents).toBe(12000);
    expect(b.projectedCents).toBe(36000);
    expect(b.remainingCents).toBe(28000);
    expect(b.tripCount).toBe(2);
    expect(b.avgTripCents).toBe(6000);
  });
  it('distingue prix connu, estimé et inconnu dans le coût prévisionnel', () => {
    const p = { id: 'p1', unit: 'bouteille', packUnit: null, packSize: null } as unknown as Product;
    const purchases = [pu('2026-10-01', 210, { productId: 'p1', quantity: 2, unit: 'bouteille' }), pu('2026-10-20', 230, { productId: 'p1', quantity: 2, unit: 'bouteille', storeId: 's1' })];
    const hist = priceHistory(p, purchases);
    expect(hist.map((x) => x.centsPerStockUnit)).toEqual([105, 115]);
    expect(estimateUnitPrice(p, purchases, 's1')!.centsPerStockUnit).toBe(115);
    expect(estimateUnitPrice(p, purchases, null)!.centsPerStockUnit).toBe(110);
    const base = { householdId: 'h', version: 1, categoryId: null, storeId: null, priority: 'normal', comment: null, assignedTo: null, purchasedBy: null, purchasedAt: null, receivedAt: null, source: 'manual', requests: [], createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', fv: {} };
    const items = [
      { ...base, id: 'i1', productId: 'p1', name: 'Lait', quantity: 3, unit: 'bouteille', status: 'pending', purchasedQty: 0, priceCents: null },
      { ...base, id: 'i2', productId: null, name: 'Piles', quantity: 1, unit: 'pack', status: 'pending', purchasedQty: 0, priceCents: null },
      { ...base, id: 'i3', productId: null, name: 'Pain', quantity: 1, unit: 'piece', status: 'purchased', purchasedQty: 1, priceCents: 120 },
    ] as never;
    const cost = estimateListCost(items, new Map([['p1', p]]), purchases);
    expect(cost.knownCents).toBe(120);
    expect(cost.estimatedCents).toBe(330);
    expect(cost.unknownCount).toBe(1);
    expect(cost.items.map((i) => i.kind)).toEqual(['estimated', 'unknown', 'known']);
  });
  it('compare les prix par magasin', () => {
    const rows = comparePricesByStore([
      { storeId: 'a', centsPerStockUnit: 100, date: '2026-10-01' },
      { storeId: 'a', centsPerStockUnit: 120, date: '2026-11-01' },
      { storeId: 'b', centsPerStockUnit: 90, date: '2026-10-15' },
    ]);
    expect(rows[0]).toMatchObject({ storeId: 'b', avg: 90 });
    expect(rows[1]).toMatchObject({ storeId: 'a', last: 120, min: 100, avg: 110, count: 2 });
  });
});

describe('audit, gaspillage et notifications', () => {
  it('détecte les doubles scans, les consommations sur stock nul et les doublons de produits', () => {
    const h = new Harness();
    const p = h.product('Lait', 'bouteille');
    h.product('lait', 'bouteille');
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 1, source: 'scan', kind: 'purchase' });
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 1, source: 'scan', kind: 'purchase' });
    h.ok('stock.consume', { productId: p, quantity: 5 });
    const codes = auditHousehold(h.collections(), h.now).map((i) => i.code);
    expect(codes).toContain('duplicate_movements');
    expect(codes).toContain('shortfall');
    expect(codes).toContain('possible_duplicate');
    expect(codes).not.toContain('lot_sum_mismatch');
  });
  it('détecte une incohérence de quantité introduite hors des commandes', () => {
    const h = new Harness();
    const p = h.product('Riz', 'kg');
    const lot = newId();
    h.ok('stock.add', { productId: p, lotId: lot, quantity: 1 });
    h.store.put('lot', { ...h.store.get('lot', lot)!, quantity: 3 });
    expect(auditHousehold(h.collections(), h.now).some((i) => i.code === 'lot_sum_mismatch' && i.severity === 'error')).toBe(true);
  });
  it('valorise le gaspillage uniquement avec les prix enregistrés', () => {
    const h = new Harness();
    const p = h.product('Salade', 'piece');
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 2, priceCents: 300, kind: 'purchase' });
    h.ok('stock.waste', { productId: p, quantity: 1, reason: 'spoiled' });
    const q = h.product('Herbes', 'botte');
    h.ok('stock.add', { productId: q, lotId: newId(), quantity: 1 });
    h.ok('stock.waste', { productId: q, quantity: 1, reason: 'spoiled' });
    const c = h.collections();
    const w = wasteStats([...c.movement.values()], c.lot, '2026-01-01');
    expect(w.count).toBe(2);
    expect(w.valueCents).toBe(150);
    expect(w.unvaluedCount).toBe(1);
  });
  it('calcule des alertes dédupliquées, filtrées par préférences, et un récapitulatif', () => {
    const h = new Harness();
    const p = h.product('Café', 'paquet', { minQty: 1 });
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 1, expiryDate: '2026-11-03' });
    const y = h.product('Yaourt', 'pot');
    h.ok('stock.add', { productId: y, lotId: newId(), quantity: 2, expiryDate: '2026-11-01' });
    const c = h.collections();
    const forecast = analyzeHousehold({
      products: [...c.product.values()], lots: [...c.lot.values()], movements: [...c.movement.values()], items: [], purchases: [], locations: [...c.location.values()],
      settings: DEFAULT_SETTINGS, now: h.now, today: '2026-11-02',
    });
    const member = c.member.get('m-user-alice')!;
    const alerts = computeAlerts({ forecast, collections: c, audit: [], unusual: [], member, now: h.now, today: '2026-11-02' });
    const kinds = alerts.map((a) => a.kind);
    expect(kinds).toContain('stock_low');
    expect(kinds).toContain('expiring');
    const muted = { ...member, prefs: { notifications: { muted: ['expiring' as const], digest: 'daily' as const, digestHour: 8, pushImportant: true }, dismissed: { [alerts.find((a) => a.kind === 'stock_low')!.key]: '2026-11-02' } } };
    const visible = visibleAlerts(alerts, muted);
    expect(visible.some((a) => a.kind === 'expiring' || a.kind === 'stock_low')).toBe(false);
    const digest = buildDigest(alerts, 'daily')!;
    expect(digest.title).toContain('point du jour');
    expect(digest.body.split('\n').length).toBeLessThanOrEqual(4);
  });
});
