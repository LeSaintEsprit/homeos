import { beforeEach, describe, expect, it } from 'vitest';
import { newId, computeInventoryDiff, movedSinceCount, sessionProgress } from '@homeos/shared';
import { Harness } from './helpers';

let h: Harness;
beforeEach(() => {
  h = new Harness();
});

describe('produits et lots', () => {
  it('crée un produit avec un stock initial (lot + mouvement + activité)', () => {
    const id = newId();
    const lotId = newId();
    h.ok('product.create', {
      id, name: 'Lait demi-écrémé', unit: 'bouteille', categoryId: h.cat.frais, locationId: h.loc.frigo, minQty: 2, idealQty: 6,
      initialStock: { lotId, quantity: 6, expiryDate: '2026-11-20' },
    });
    expect(h.total(id)).toBe(6);
    const lot = h.store.get('lot', lotId)!;
    expect(lot.initialQuantity).toBe(6);
    expect(lot.expirySource).toBe('manual');
    const mv = h.store.list('movement', { productId: id });
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ type: 'add', delta: 6, quantityBefore: 0, quantityAfter: 6, userId: 'user-alice' });
    expect(h.store.all('activity').some((a) => a.summary.includes('Lait demi-écrémé'))).toBe(true);
    h.assertInvariants();
  });

  it('signale un doublon probable sans le fusionner', () => {
    h.product('Pâtes complètes', 'g');
    const r = h.exec('product.create', { id: newId(), name: 'pates completes', unit: 'g' });
    expect(r.status).toBe('applied');
    expect(r.warnings.map((w) => w.code)).toContain('possible_duplicate');
    expect(h.store.all('product')).toHaveLength(2);
  });

  it('refuse un conditionnement incomplet et un changement d\'unité avec historique', () => {
    expect(h.exec('product.create', { id: newId(), name: 'Café', unit: 'g', packUnit: 'paquet' }).status).toBe('rejected');
    const id = h.product('Riz', 'g');
    h.ok('stock.add', { productId: id, lotId: newId(), quantity: 1000 });
    const p = h.store.get('product', id)!;
    const r = h.exec('product.update', { id, patch: { unit: 'kg' }, baseVersion: p.version });
    expect(r.status).toBe('rejected');
    expect(r.error?.code).toBe('unit_locked');
  });

  it('consomme selon FEFO : la date la plus proche d\'abord, lots périmés en dernier', () => {
    const id = h.product('Yaourt nature', 'pot', { locationId: h.loc.frigo });
    const late = newId();
    const soon = newId();
    const expired = newId();
    h.ok('stock.add', { productId: id, lotId: late, quantity: 4, expiryDate: '2026-11-20' });
    h.ok('stock.add', { productId: id, lotId: soon, quantity: 2, expiryDate: '2026-11-05' });
    h.ok('stock.add', { productId: id, lotId: expired, quantity: 1, expiryDate: '2026-10-30' });
    h.ok('stock.consume', { productId: id, quantity: 3 });
    expect(h.store.get('lot', soon)!.quantity).toBe(0);
    expect(h.store.get('lot', late)!.quantity).toBe(3);
    expect(h.store.get('lot', expired)!.quantity).toBe(1);
    const mvs = h.store.list('movement', { productId: id }).filter((m) => m.type === 'consume');
    expect(mvs.map((m) => m.delta).sort((a, b) => a - b)).toEqual([-2, -1]);
    h.assertInvariants();
  });

  it('accepte les quantités partielles et convertit via le conditionnement', () => {
    const id = h.product('Café', 'g', { packUnit: 'paquet', packSize: 250 });
    h.ok('stock.add', { productId: id, lotId: newId(), quantity: 2, unit: 'paquet' });
    expect(h.total(id)).toBe(500);
    h.ok('stock.consume', { productId: id, quantity: 0.5, unit: 'paquet' });
    expect(h.total(id)).toBe(375);
    const r = h.exec('stock.consume', { productId: id, quantity: 1, unit: 'l' });
    expect(r.status).toBe('rejected');
    expect(r.error?.code).toBe('unit_incompatible');
    h.assertInvariants();
  });

  it('ne descend jamais sous zéro et trace la consommation sur stock insuffisant', () => {
    const id = h.product('Beurre', 'piece');
    h.ok('stock.add', { productId: id, lotId: newId(), quantity: 1 });
    const r = h.exec('stock.consume', { productId: id, quantity: 2 });
    expect(r.status).toBe('applied');
    expect(r.warnings[0].code).toBe('shortfall');
    expect(h.total(id)).toBe(0);
    const r2 = h.exec('stock.consume', { productId: id, quantity: 1 });
    expect(r2.warnings[0].code).toBe('shortfall');
    const flagged = h.store.list('movement', { productId: id }).filter((m) => m.flags.includes('shortfall'));
    expect(flagged).toHaveLength(2);
    h.assertInvariants();
  });

  it('ouvre une unité d\'un lot de 6 en isolant l\'unité ouverte', () => {
    const id = h.product('Lait', 'bouteille', { openShelfLifeDays: 3 });
    const lot = newId();
    h.ok('stock.add', { productId: id, lotId: lot, quantity: 6, expiryDate: '2026-12-01' });
    h.ok('stock.open', { productId: id });
    const lots = h.lots(id);
    expect(lots).toHaveLength(2);
    const opened = lots.find((l) => l.openedAt)!;
    expect(opened.quantity).toBe(1);
    expect(h.store.get('lot', lot)!.quantity).toBe(5);
    expect(h.total(id)).toBe(6);
    // La consommation suivante prend d'abord la bouteille ouverte (date effective plus proche).
    h.ok('stock.consume', { productId: id, quantity: 0.5 });
    expect(h.store.get('lot', opened.id)!.quantity).toBe(0.5);
    h.assertInvariants();
  });

  it('corrige une quantité approximative (« il en reste environ la moitié »)', () => {
    const id = h.product('Huile', 'bouteille');
    const lot = newId();
    h.ok('stock.add', { productId: id, lotId: lot, quantity: 1 });
    h.ok('stock.adjust', { productId: id, lotId: lot, expected: 1, quantity: 0.5, reason: 'unlogged', approx: true });
    const l = h.store.get('lot', lot)!;
    expect(l.quantity).toBe(0.5);
    expect(l.qtyApprox).toBe(true);
    h.assertInvariants();
  });

  it('détecte un conflit de correction si le stock a changé entre-temps', () => {
    const id = h.product('Pâtes', 'paquet');
    h.ok('stock.add', { productId: id, lotId: newId(), quantity: 5 });
    // Bob consomme pendant qu'Alice compte (elle voyait 5).
    h.as('user-bob').ok('stock.consume', { productId: id, quantity: 1 });
    const r = h.as('user-alice').exec('stock.adjust', { productId: id, expected: 5, quantity: 3, reason: 'count' });
    expect(r.status).toBe('conflict');
    expect(r.conflicts[0]).toMatchObject({ field: 'stock', mine: 3, theirs: 4 });
    expect(h.total(id)).toBe(4);
    // Avec la bonne valeur attendue, la correction passe.
    h.ok('stock.adjust', { productId: id, expected: 4, quantity: 3, reason: 'count' });
    expect(h.total(id)).toBe(3);
    expect(h.lots(id).every((l) => l.qtySource === 'count' && l.countedAt)).toBe(true);
    h.assertInvariants();
  });

  it('jette les lots périmés en priorité', () => {
    expect(h.exec('product.create', { id: newId(), name: 'Jambon', unit: 'tranche' as never }).status).toBe('rejected');
    const pid = h.product('Jambon', 'paquet');
    const fresh = newId();
    const old = newId();
    h.ok('stock.add', { productId: pid, lotId: fresh, quantity: 1, expiryDate: '2026-11-10' });
    h.ok('stock.add', { productId: pid, lotId: old, quantity: 1, expiryDate: '2026-10-28' });
    h.ok('stock.waste', { productId: pid, reason: 'expired' });
    expect(h.store.get('lot', old)!.quantity).toBe(0);
    expect(h.store.get('lot', fresh)!.quantity).toBe(1);
    h.assertInvariants();
  });

  it('déplace une partie d\'un lot vers un autre emplacement', () => {
    const id = h.product('Steak haché', 'piece', { locationId: h.loc.frigo });
    const lot = newId();
    h.ok('stock.add', { productId: id, lotId: lot, quantity: 4, expiryDate: '2026-11-06' });
    h.ok('stock.move', { lotId: lot, locationId: h.loc.congel, quantity: 2 });
    const lots = h.lots(id);
    expect(lots.map((l) => [l.locationId, l.quantity]).sort()).toEqual([[h.loc.congel, 2], [h.loc.frigo, 2]].sort());
    h.assertInvariants();
  });

  it('complète un lot existant lors d\'une réception à la chaîne (même lot)', () => {
    const id = h.product('Eau', 'bouteille');
    const lot = newId();
    h.ok('stock.add', { productId: id, lotId: lot, quantity: 1, kind: 'purchase', source: 'scan', expiryDate: '2027-06-01', expirySource: 'gs1' });
    h.ok('stock.add', { productId: id, lotId: lot, quantity: 1, kind: 'purchase', source: 'scan' });
    const l = h.store.get('lot', lot)!;
    expect(l).toMatchObject({ quantity: 2, initialQuantity: 2, qtySource: 'scan', expirySource: 'gs1' });
    expect(h.store.list('movement', { productId: id })).toHaveLength(2);
    h.assertInvariants();
  });
});

describe('annulation', () => {
  it('annule une action par mouvements compensatoires, une seule fois', () => {
    const id = h.product('Lait', 'bouteille');
    h.ok('stock.add', { productId: id, lotId: newId(), quantity: 2, expiryDate: '2026-11-08' });
    h.ok('stock.add', { productId: id, lotId: newId(), quantity: 2, expiryDate: '2026-11-15' });
    const op = newId();
    h.ok('stock.consume', { productId: id, quantity: 3 }, op);
    expect(h.total(id)).toBe(1);
    h.ok('movement.revertOp', { targetOpId: op });
    expect(h.total(id)).toBe(4);
    const originals = h.store.list('movement', { opId: op });
    expect(originals.every((m) => m.revertedBy)).toBe(true);
    const r = h.exec('movement.revertOp', { targetOpId: op });
    expect(r.warnings[0].code).toBe('already_reverted');
    expect(h.total(id)).toBe(4);
    expect(h.store.list('movement', { productId: id }).filter((m) => m.type === 'revert')).toHaveLength(2);
    h.assertInvariants();
  });

  it('refuse d\'annuler un ajout déjà partiellement consommé', () => {
    const id = h.product('Pain', 'piece');
    const op = newId();
    h.ok('stock.add', { productId: id, lotId: newId(), quantity: 1 }, op);
    h.ok('stock.consume', { productId: id, quantity: 1 });
    const r = h.exec('movement.revertOp', { targetOpId: op });
    expect(r.status).toBe('rejected');
    expect(r.error?.code).toBe('revert_impossible');
    h.assertInvariants();
  });
});

describe('liste de courses', () => {
  it('fusionne les doublons, additionne les quantités et redirige l\'identifiant', () => {
    const id = h.product('Lait', 'bouteille');
    const a = newId();
    h.ok('shopping.add', { itemId: a, productId: id, name: 'Lait', quantity: 2, unit: 'bouteille' });
    const b = newId();
    const r = h.as('user-bob').exec('shopping.add', { itemId: b, productId: id, name: 'Lait', quantity: 1, unit: 'bouteille' });
    expect(r.status).toBe('applied');
    expect(r.aliases).toEqual([{ type: 'shoppingItem', from: b, to: a }]);
    expect(r.warnings[0].message).toContain('Alice');
    const items = h.store.all('shoppingItem');
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
    expect(items[0].requests.map((x) => x.u)).toEqual(['user-alice', 'user-bob']);
    // Une opération qui vise l'ancien identifiant est redirigée.
    h.ok('shopping.setPurchased', { itemId: b, purchasedQty: 3 });
    expect(h.store.get('shoppingItem', a)!.status).toBe('purchased');
  });

  it('fusionne les articles libres de même nom, pas les unités incompatibles', () => {
    h.ok('shopping.add', { itemId: newId(), name: 'Ampoules', quantity: 2, unit: 'piece' });
    h.ok('shopping.add', { itemId: newId(), name: 'ampoules', quantity: 1, unit: 'piece' });
    h.ok('shopping.add', { itemId: newId(), name: 'Ampoules', quantity: 1, unit: 'pack' });
    const items = h.store.all('shoppingItem');
    expect(items.map((i) => [i.unit, i.quantity]).sort()).toEqual([['pack', 1], ['piece', 3]]);
  });

  it('gère les achats partiels et la réception avec reliquat', () => {
    const id = h.product('Œufs', 'piece', { categoryId: h.cat.frais });
    const item = newId();
    h.ok('shopping.add', { itemId: item, productId: id, name: 'Œufs', quantity: 12, unit: 'piece' });
    h.ok('shopping.setPurchased', { itemId: item, purchasedQty: 6 });
    expect(h.store.get('shoppingItem', item)!.status).toBe('partial');
    // Aucune mise en stock tant que la réception n'est pas faite.
    expect(h.total(id)).toBe(0);
    const lotId = newId();
    const r = h.ok('shopping.receive', { itemId: item, receivedQty: 6, unit: 'piece', totalCents: 189, lotId, purchaseId: newId(), expiryDate: '2026-11-25', storeId: null });
    expect(r.warnings.map((w) => w.code)).toContain('partial_received');
    expect(h.total(id)).toBe(6);
    const it = h.store.get('shoppingItem', item)!;
    expect(it).toMatchObject({ status: 'pending', quantity: 6, purchasedQty: 0 });
    const pu = h.store.all('purchase')[0];
    expect(pu).toMatchObject({ totalCents: 189, quantity: 6, userId: 'user-alice', shoppingItemId: item, lotId });
    expect(h.store.get('lot', lotId)!.unitPriceCents).toBeCloseTo(31.5);
    h.assertInvariants();
  });

  it('enregistre un achat sans prix comme « prix inconnu » (aucun prix inventé)', () => {
    const item = newId();
    h.ok('shopping.add', { itemId: item, name: 'Piles AA', quantity: 1, unit: 'pack' });
    h.ok('shopping.receive', { itemId: item, receivedQty: 1, unit: 'pack', lotId: newId(), purchaseId: newId() });
    expect(h.store.all('purchase')[0].totalCents).toBeNull();
    expect(h.store.get('shoppingItem', item)!.status).toBe('done');
  });

  it('prévient quand un article déjà coché est coché par un autre membre', () => {
    const item = newId();
    h.ok('shopping.add', { itemId: item, name: 'Pain', quantity: 1, unit: 'piece' });
    h.ok('shopping.setPurchased', { itemId: item, purchasedQty: 1 });
    const r = h.as('user-bob').exec('shopping.setPurchased', { itemId: item, purchasedQty: 1 });
    expect(r.warnings[0].code).toBe('already_purchased');
  });

  it('signaler manquant ajoute à la liste en priorité haute et alerte si le stock théorique diffère', () => {
    const id = h.product('Sel', 'paquet');
    h.ok('stock.add', { productId: id, lotId: newId(), quantity: 1 });
    const r = h.ok('stock.reportMissing', { productId: id, itemId: newId() });
    expect(r.warnings[0].code).toBe('stock_mismatch');
    expect(h.store.all('shoppingItem')[0]).toMatchObject({ priority: 'high', source: 'missing' });
    expect(h.total(id)).toBe(1); // jamais de modification silencieuse du stock
  });
});

describe('conflits et droits', () => {
  it('fusionne les champs non concurrents et signale les champs en conflit', () => {
    const id = h.product('Café', 'g', { minQty: 250 });
    const base = h.store.get('product', id)!.version;
    h.as('user-bob').ok('product.update', { id, patch: { minQty: 500 }, baseVersion: base });
    const r = h.as('user-alice').exec('product.update', { id, patch: { minQty: 300, idealQty: 1000 }, baseVersion: base });
    expect(r.status).toBe('applied');
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ field: 'minQty', mine: 300, theirs: 500, theirsBy: 'user-bob' });
    const p = h.store.get('product', id)!;
    expect(p.minQty).toBe(500);
    expect(p.idealQty).toBe(1000);
  });

  it('n\'entre pas en conflit avec ses propres modifications successives', () => {
    const id = h.product('Thé', 'sachet');
    const base = h.store.get('product', id)!.version;
    h.ok('product.update', { id, patch: { minQty: 10 }, baseVersion: base });
    expect(h.exec('product.update', { id, patch: { minQty: 20 }, baseVersion: base }).conflicts).toHaveLength(0);
  });

  it('interdit toute écriture à un membre en lecture seule', () => {
    const r = h.as('user-zoe', 'viewer').exec('product.create', { id: newId(), name: 'Test', unit: 'piece' });
    expect(r.status).toBe('rejected');
    expect(r.error?.code).toBe('forbidden');
    expect(h.as('user-zoe', 'viewer').exec('member.updateSelf', { color: '#123456' }).status).toBe('applied');
  });

  it('réserve les réglages du foyer aux administrateurs', () => {
    const v = h.store.get('household', 'hh-test-0001')!.version;
    expect(h.as('user-bob', 'member').exec('household.update', { patch: { name: 'X' }, baseVersion: v }).error?.code).toBe('forbidden');
    h.as('user-alice', 'admin').ok('household.update', { patch: { settings: { monthlyBudgetCents: 60000 } }, baseVersion: v });
    expect(h.store.get('household', 'hh-test-0001')!.settings.monthlyBudgetCents).toBe(60000);
  });

  it('rejette les références vers des entités inexistantes', () => {
    const r = h.exec('product.create', { id: newId(), name: 'X', unit: 'piece', categoryId: 'inexistant-123' });
    expect(r.status).toBe('rejected');
    expect(h.store.all('product')).toHaveLength(0);
  });
});

describe('catalogue', () => {
  it('associe plusieurs codes-barres à un produit et refuse un code déjà pris', () => {
    const lait = h.product('Lait', 'bouteille');
    h.ok('productCode.add', { id: newId(), productId: lait, code: '3428272950014', label: 'Bouteille 1 L', brand: 'Lactel' });
    h.ok('productCode.add', { id: newId(), productId: lait, code: '3033490004521', label: 'Pack de 6', packQty: 6, brand: 'Candia' });
    expect(h.store.list('productCode', { productId: lait })).toHaveLength(2);
    const other = h.product('Jus', 'brique');
    const r = h.exec('productCode.add', { id: newId(), productId: other, code: '3428272950014' });
    expect(r.status).toBe('rejected');
    expect(r.error?.message).toContain('Lait');
  });

  it('fusionne deux produits sur validation en conservant tout l\'historique', () => {
    const a = h.product('Riz basmati', 'g');
    const b = h.product('Riz basmati 1kg', 'kg');
    h.ok('stock.add', { productId: a, lotId: newId(), quantity: 500 });
    h.ok('stock.add', { productId: b, lotId: newId(), quantity: 1 });
    h.ok('productCode.add', { id: newId(), productId: b, code: '3017620422003' });
    h.ok('product.merge', { sourceId: b, targetId: a });
    expect(h.total(a)).toBe(1500);
    expect(h.store.get('product', b)!.archived).toBe(true);
    expect(h.store.list('productCode', { productId: a })).toHaveLength(1);
    expect(h.store.get('product', a)!.aliases.map((x) => x.text)).toContain('Riz basmati 1kg');
    // Les opérations visant l'ancien produit sont redirigées.
    h.ok('stock.consume', { productId: b, quantity: 200 });
    expect(h.total(a)).toBe(1300);
    h.assertInvariants();
  });

  it('refuse la fusion d\'unités incompatibles', () => {
    const a = h.product('Lessive', 'l');
    const b = h.product('Lessive capsules', 'piece');
    expect(h.exec('product.merge', { sourceId: b, targetId: a }).error?.code).toBe('unit_incompatible');
  });
});

describe('inventaire', () => {
  it('compare au stock théorique du seul emplacement inventorié et corrige après validation', () => {
    const lait = h.product('Lait', 'bouteille', { locationId: h.loc.frigo });
    h.ok('stock.add', { productId: lait, lotId: newId(), quantity: 2, locationId: h.loc.frigo });
    h.ok('stock.add', { productId: lait, lotId: newId(), quantity: 6, locationId: h.loc.cellier });
    const sid = newId();
    h.ok('inventory.start', { id: sid, kind: 'check', title: 'Frigo', locationIds: [h.loc.frigo] });
    h.ok('inventory.upsertLine', { sessionId: sid, line: { id: newId(), productId: lait, quantity: 1, unit: 'bouteille', locationId: h.loc.frigo } });
    const s = h.store.get('inventorySession', sid)!;
    const diff = computeInventoryDiff(s, (id) => h.store.get('product', id), (pid) => h.store.list('lot', { productId: pid }));
    expect(diff[0]).toMatchObject({ expected: 2, counted: 1, delta: -1 });
    // Rien ne change avant validation.
    expect(h.total(lait)).toBe(8);
    h.ok('inventory.apply', { sessionId: sid, decisions: [{ productId: lait, expected: 2, apply: true }] });
    expect(h.total(lait)).toBe(7);
    const cellier = h.lots(lait).find((l) => l.locationId === h.loc.cellier)!;
    expect(cellier.quantity).toBe(6);
    expect(h.store.get('inventorySession', sid)!.status).toBe('applied');
    h.assertInvariants();
  });

  it('inventaire initial : crée un lot par ligne (dates distinctes) et refuse les lignes non associées', () => {
    const sid = newId();
    h.ok('inventory.start', { id: sid, kind: 'initial', title: 'Inventaire initial', locationIds: [h.loc.frigo, h.loc.placard] });
    const yaourt = h.product('Yaourt', 'pot', { locationId: h.loc.frigo });
    h.ok('inventory.upsertLine', { sessionId: sid, line: { id: newId(), productId: yaourt, quantity: 4, unit: 'pot', locationId: h.loc.frigo, expiryDate: '2026-11-10' } });
    h.ok('inventory.upsertLine', { sessionId: sid, line: { id: newId(), productId: yaourt, quantity: 2, unit: 'pot', locationId: h.loc.frigo, expiryDate: '2026-11-14', expirySource: 'ocr' } });
    const unknown = newId();
    h.ok('inventory.upsertLine', { sessionId: sid, line: { id: unknown, name: 'Produit inconnu', code: '3560070000000', quantity: 1, unit: 'piece', locationId: h.loc.placard } });
    h.ok('inventory.setLocation', { sessionId: sid, locationId: h.loc.frigo, status: 'done' });
    expect(h.exec('inventory.apply', { sessionId: sid, decisions: [] }).error?.code).toBe('unresolved_lines');
    h.ok('inventory.removeLine', { sessionId: sid, lineId: unknown });
    h.ok('inventory.apply', { sessionId: sid, decisions: [{ productId: yaourt, expected: 0, apply: true }] });
    const lots = h.lots(yaourt);
    expect(lots.map((l) => [l.quantity, l.expiryDate, l.qtySource]).sort()).toEqual([[2, '2026-11-14', 'count'], [4, '2026-11-10', 'count']]);
    expect(lots.find((l) => l.expiryDate === '2026-11-14')!.expirySource).toBe('ocr');
    h.assertInvariants();
  });

  it('refuse d\'appliquer un écart si le stock a bougé pendant l\'inventaire', () => {
    const p = h.product('Farine', 'kg');
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 2, locationId: h.loc.placard });
    const sid = newId();
    h.ok('inventory.start', { id: sid, kind: 'check', title: 'Placards', locationIds: [h.loc.placard] });
    h.ok('inventory.upsertLine', { sessionId: sid, line: { id: newId(), productId: p, quantity: 1, unit: 'kg', locationId: h.loc.placard } });
    h.as('user-bob').ok('stock.consume', { productId: p, quantity: 0.5 });
    const r = h.as('user-alice').exec('inventory.apply', { sessionId: sid, decisions: [{ productId: p, expected: 2, apply: true }] });
    expect(r.conflicts).toHaveLength(1);
    expect(h.total(p)).toBe(1.5);
  });

  it("calcule l'avancement par espace (terminé ou ignoré = fait, en cours = moitié)", () => {
    const sid = newId();
    h.ok('inventory.start', { id: sid, kind: 'initial', title: 'Tout', locationIds: [h.loc.frigo, h.loc.placard, h.loc.cellier, h.loc.garage] });
    expect(sessionProgress(h.store.get('inventorySession', sid)!)).toBe(0);
    const p = h.product('Riz', 'paquet');
    h.ok('inventory.upsertLine', { sessionId: sid, line: { id: newId(), productId: p, quantity: 1, unit: 'paquet', locationId: h.loc.placard } });
    expect(h.store.get('inventorySession', sid)!.locations.find((l) => l.locationId === h.loc.placard)!.status).toBe('in_progress');
    expect(sessionProgress(h.store.get('inventorySession', sid)!)).toBe(13);
    h.ok('inventory.setLocation', { sessionId: sid, locationId: h.loc.frigo, status: 'done' });
    h.ok('inventory.setLocation', { sessionId: sid, locationId: h.loc.garage, status: 'skipped' });
    expect(sessionProgress(h.store.get('inventorySession', sid)!)).toBe(63);
  });

  it('signale un produit qui a bougé après son comptage, même si les chiffres coïncident', () => {
    const lait = h.product('Lait', 'bouteille', { locationId: h.loc.frigo });
    h.ok('stock.add', { productId: lait, lotId: newId(), quantity: 4, locationId: h.loc.frigo });
    const autre = h.product('Pâtes', 'paquet', { locationId: h.loc.placard });
    h.ok('stock.add', { productId: autre, lotId: newId(), quantity: 2, locationId: h.loc.placard });
    const sid = newId();
    h.ok('inventory.start', { id: sid, kind: 'check', title: 'Frigo', locationIds: [h.loc.frigo] });
    h.ok('inventory.upsertLine', { sessionId: sid, line: { id: newId(), productId: lait, quantity: 3, unit: 'bouteille', locationId: h.loc.frigo } });
    h.advance(0.1);
    // Bob consomme une bouteille après le comptage : attendu 3, compté 3… mais le comptage est dépassé.
    h.as('user-bob').ok('stock.consume', { productId: lait, quantity: 1 });
    h.ok('stock.consume', { productId: autre, quantity: 1 });
    h.as('user-alice');
    const s = h.store.get('inventorySession', sid)!;
    const diffs = computeInventoryDiff(s, (id) => h.store.get('product', id), (pid) => h.store.list('lot', { productId: pid }));
    expect(diffs[0]).toMatchObject({ expected: 3, counted: 3, delta: 0 });
    const moves = h.store.all('movement');
    const moved = movedSinceCount(s, diffs[0], h.store.get('product', lait), moves, (id) => h.store.get('lot', id));
    expect(moved).toHaveLength(1);
    expect(moved[0].userId).toBe('user-bob');
    // Les mouvements antérieurs au comptage ne comptent pas.
    const before = movedSinceCount(s, { ...diffs[0], lines: s.lines.map((l) => ({ ...l, countedAt: h.now })) }, h.store.get('product', lait), moves, (id) => h.store.get('lot', id));
    expect(before).toHaveLength(0);
  });
});

describe('tickets de caisse', () => {
  it('n\'ajoute au stock que les lignes validées et apprend les libellés', () => {
    const store = newId();
    h.ok('store.upsert', { id: store, name: 'Lidl' });
    const lait = h.product('Lait', 'bouteille');
    const r = h.ok('receipt.apply', {
      id: newId(), storeId: store, date: '2026-11-01', totalCents: 450,
      lines: [
        { id: newId(), label: 'LAIT DEMI ECR 1L', quantity: 2, unit: 'bouteille', totalCents: 210, productId: lait, stock: true, purchaseId: newId(), lotId: newId() },
        { id: newId(), label: 'SAC CABAS', quantity: 1, unit: 'piece', totalCents: 240, stock: false, purchaseId: newId(), lotId: newId() },
      ],
    });
    expect(r.warnings).toHaveLength(0);
    expect(h.total(lait)).toBe(2);
    expect(h.store.all('purchase')).toHaveLength(2);
    expect(h.store.get('product', lait)!.aliases).toEqual([{ text: 'LAIT DEMI ECR 1L', kind: 'receipt', storeId: store }]);
    expect(h.store.list('movement', { productId: lait })[0]).toMatchObject({ type: 'purchase', source: 'receipt' });
    h.assertInvariants();
  });
});

describe('matrice des permissions', () => {
  it('chaque opération exige une permission, accordée selon les 3 rôles', async () => {
    const { OP_TYPES, OP_PERMISSIONS, can, ROLES } = await import('@homeos/shared');
    expect(ROLES).toEqual(['admin', 'member', 'viewer']);
    for (const t of OP_TYPES) expect(OP_PERMISSIONS[t], t).toBeTruthy();
    const allowed = (r: 'admin' | 'member' | 'viewer') => OP_TYPES.filter((t) => can(r, OP_PERMISSIONS[t]));
    expect(allowed('viewer')).toEqual(['member.updateSelf']);
    expect(allowed('member')).not.toContain('household.update');
    expect(allowed('member').length).toBe(OP_TYPES.length - 1);
    expect(allowed('admin').length).toBe(OP_TYPES.length);
    expect(can('member', 'members.manage')).toBe(false);
    expect(can('admin', 'platform.invite')).toBe(true);
  });
});
