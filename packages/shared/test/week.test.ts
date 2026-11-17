/**
 * Simulation d'une semaine complète d'utilisation familiale (niveau domaine).
 * Les invariants de stock sont vérifiés après chaque journée.
 */
import { describe, expect, it } from 'vitest';
import { newId, analyzeHousehold, DEFAULT_SETTINGS, computeInventoryDiff } from '@homeos/shared';
import { Harness } from './helpers';

describe('semaine familiale simulée', () => {
  it('garde des quantités cohérentes du lundi au dimanche', () => {
    const h = new Harness();
    const alice = () => h.as('user-alice');
    const bob = () => h.as('user-bob', 'member');
    const leclerc = newId();
    h.ok('store.upsert', { id: leclerc, name: 'Leclerc' });

    // ── Lundi : inventaire initial guidé du frigo et des placards.
    h.at('2026-11-02T09:00:00+01:00');
    const lait = h.product('Lait demi-écrémé', 'bouteille', { locationId: h.loc.frigo, minQty: 2, idealQty: 6, openShelfLifeDays: 3, categoryId: h.cat.frais });
    const pates = h.product('Pâtes', 'g', { packUnit: 'paquet', packSize: 500, minQty: 500, idealQty: 2000 });
    const yaourt = h.product('Yaourt nature', 'pot', { locationId: h.loc.frigo, minQty: 4, idealQty: 12, categoryId: h.cat.frais });
    const pq = h.product('Papier toilette', 'rouleau', { locationId: h.loc.sdb, minQty: 4, idealQty: 12, categoryId: h.cat.consommables });
    const inv = newId();
    h.ok('inventory.start', { id: inv, kind: 'initial', title: 'Inventaire de départ', locationIds: [h.loc.frigo, h.loc.placard, h.loc.sdb] });
    h.ok('inventory.upsertLine', { sessionId: inv, line: { id: newId(), productId: lait, quantity: 1.5, unit: 'bouteille', qtyApprox: true, locationId: h.loc.frigo, expiryDate: '2026-11-06' } });
    h.ok('inventory.upsertLine', { sessionId: inv, line: { id: newId(), productId: yaourt, quantity: 6, unit: 'pot', locationId: h.loc.frigo, expiryDate: '2026-11-04' } });
    h.ok('inventory.upsertLine', { sessionId: inv, line: { id: newId(), productId: pates, quantity: 1.5, unit: 'paquet', locationId: h.loc.placard } });
    h.ok('inventory.upsertLine', { sessionId: inv, line: { id: newId(), productId: pq, quantity: 9, unit: 'rouleau', locationId: h.loc.sdb } });
    for (const l of [h.loc.frigo, h.loc.placard, h.loc.sdb]) h.ok('inventory.setLocation', { sessionId: inv, locationId: l, status: 'done' });
    const s = h.store.get('inventorySession', inv)!;
    const diffs = computeInventoryDiff(s, (id) => h.store.get('product', id), (pid) => h.store.list('lot', { productId: pid }));
    h.ok('inventory.apply', { sessionId: inv, decisions: diffs.map((d) => ({ productId: d.productId, expected: d.expected, apply: true })) });
    expect([h.total(lait), h.total(yaourt), h.total(pates), h.total(pq)]).toEqual([1.5, 6, 750, 9]);
    h.assertInvariants();

    // ── Mardi : consommation, ouverture, liste de courses à deux.
    h.at('2026-11-03T07:30:00+01:00');
    alice().ok('stock.consume', { productId: yaourt, quantity: 2 });
    bob().ok('stock.consume', { productId: lait, quantity: 0.5 });
    bob().ok('stock.consume', { productId: pates, quantity: 250 });
    const f = analyzeHousehold({
      products: h.store.all('product'), lots: h.store.all('lot'), movements: h.store.all('movement'), items: h.store.all('shoppingItem'),
      purchases: h.store.all('purchase'), locations: h.store.all('location'), settings: DEFAULT_SETTINGS, now: h.now, today: '2026-11-03',
    });
    const recoLait = f.byId.get(lait)!.recommendation!;
    expect(recoLait.reason).toBe('below_min');
    for (const r of f.recommendations) {
      const p = h.store.get('product', r.productId)!;
      alice().ok('shopping.add', { itemId: newId(), productId: p.id, name: p.name, quantity: r.displayQty, unit: r.displayUnit, source: 'recommendation', storeId: leclerc });
    }
    // Bob ajoute aussi du lait depuis son téléphone : fusion, pas de doublon.
    bob().ok('shopping.add', { itemId: newId(), productId: lait, name: 'Lait', quantity: 1, unit: 'bouteille' });
    const laitItems = h.store.list('shoppingItem', { productId: lait });
    expect(laitItems).toHaveLength(1);
    expect(laitItems[0].quantity).toBe(recoLait.displayQty + 1);
    h.assertInvariants();

    // ── Mercredi : courses (achat partiel), réception avec dates et prix.
    h.at('2026-11-04T18:00:00+01:00');
    const active = h.store.all('shoppingItem').filter((i) => i.status === 'pending');
    for (const i of active) {
      const q = i.productId === yaourt ? i.quantity - 4 : i.quantity; // rupture partielle des yaourts au magasin
      bob().ok('shopping.setPurchased', { itemId: i.id, purchasedQty: q });
    }
    expect(h.total(lait)).toBe(1); // rien en stock avant la réception
    for (const i of h.store.all('shoppingItem').filter((x) => x.status === 'purchased' || x.status === 'partial')) {
      bob().ok('shopping.receive', {
        itemId: i.id, receivedQty: i.purchasedQty, unit: i.unit, totalCents: Math.round(i.purchasedQty * 95), storeId: leclerc, lotId: newId(), purchaseId: newId(),
        expiryDate: i.productId === lait ? '2026-11-20' : i.productId === yaourt ? '2026-11-18' : null,
      });
    }
    const yItem = h.store.list('shoppingItem', { productId: yaourt })[0];
    expect(yItem).toMatchObject({ status: 'pending', quantity: 4 });
    expect(h.total(lait)).toBe(1 + recoLait.displayQty + 1);
    expect(h.store.all('purchase').every((p) => p.storeId === leclerc && p.totalCents != null)).toBe(true);
    h.assertInvariants();

    // ── Jeudi : ouverture d'une bouteille, péremption des vieux yaourts.
    h.at('2026-11-05T08:00:00+01:00');
    alice().ok('stock.open', { productId: lait });
    const opened = h.lots(lait).find((l) => l.openedAt)!;
    expect(opened.quantity).toBeLessThanOrEqual(1);
    const fx = analyzeHousehold({
      products: h.store.all('product'), lots: h.store.all('lot'), movements: h.store.all('movement'), items: h.store.all('shoppingItem'),
      purchases: h.store.all('purchase'), locations: h.store.all('location'), settings: DEFAULT_SETTINGS, now: h.now, today: '2026-11-05',
    });
    const expiredYaourts = fx.byId.get(yaourt)!.lots.filter((l) => l.status === 'expired');
    expect(expiredYaourts.length).toBe(1);
    alice().ok('stock.waste', { productId: yaourt, reason: 'expired' });
    expect(fx.byId.get(yaourt)!.usable).toBe(h.total(yaourt));
    h.assertInvariants();

    // ── Vendredi : double scan accidentel puis annulation.
    h.at('2026-11-06T19:00:00+01:00');
    const scan1 = newId();
    const scan2 = newId();
    bob().ok('stock.consume', { productId: pq, quantity: 1, source: 'scan' }, scan1);
    bob().ok('stock.consume', { productId: pq, quantity: 1, source: 'scan' }, scan2);
    bob().ok('movement.revertOp', { targetOpId: scan2, reason: 'Double scan' });
    expect(h.total(pq)).toBe(9 + 0 - 1 + (h.store.all('purchase').some((p) => p.productId === pq) ? h.store.all('purchase').filter((p) => p.productId === pq).reduce((s, p) => s + p.quantity, 0) : 0));
    h.assertInvariants();

    // ── Samedi : modification de quantité approximative et ajout manuel.
    h.at('2026-11-07T12:00:00+01:00');
    const pl = h.lots(pates)[0];
    alice().ok('stock.adjust', { productId: pates, lotId: pl.id, expected: pl.quantity, quantity: 300, reason: 'unlogged', approx: true });
    alice().ok('stock.add', { productId: yaourt, lotId: newId(), quantity: 4, kind: 'purchase', expiryDate: '2026-11-21', storeId: leclerc, priceCents: 220 });
    h.assertInvariants();

    // ── Dimanche : inventaire correctif du frigo avec écart.
    h.at('2026-11-08T10:00:00+01:00');
    const check = newId();
    h.ok('inventory.start', { id: check, kind: 'check', title: 'Frigo du dimanche', locationIds: [h.loc.frigo] });
    h.ok('inventory.upsertLine', { sessionId: check, line: { id: newId(), productId: yaourt, quantity: h.total(yaourt) - 1, unit: 'pot', locationId: h.loc.frigo } });
    const cs = h.store.get('inventorySession', check)!;
    const d2 = computeInventoryDiff(cs, (id) => h.store.get('product', id), (pid) => h.store.list('lot', { productId: pid }));
    expect(d2[0].delta).toBe(-1);
    const before = h.total(yaourt);
    h.ok('inventory.apply', { sessionId: check, decisions: [{ productId: yaourt, expected: d2[0].expected, apply: true }] });
    expect(h.total(yaourt)).toBe(before - 1);
    h.assertInvariants();

    // Bilan : chaque mouvement est attribué, daté et réversible ; aucune quantité négative.
    const moves = h.store.all('movement');
    expect(moves.every((m) => m.userId && m.occurredAt && m.opId && m.quantityAfter >= 0)).toBe(true);
    expect(h.store.all('lot').every((l) => l.quantity >= 0)).toBe(true);
  });
});
