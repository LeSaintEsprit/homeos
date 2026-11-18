import { describe, expect, it } from 'vitest';
import {
  normalizeName, similarity, analyzeHousehold, auditHousehold, computeAlerts, emptyCollections, DEFAULT_SETTINGS, DEFAULT_CATEGORIES,
  type EntityCollections, type Lot, type Movement, type Product, type Purchase,
} from '@homeos/shared';

/** Foyer volumineux réaliste : 1 000 produits, 2 000 lots, 50 000 mouvements, 5 000 achats sur un an. */
function bigHousehold(): EntityCollections {
  const c = emptyCollections();
  const H = 'h';
  const now = Date.parse('2026-11-18T08:00:00Z');
  const words = ['Lait', 'Café', 'Riz', 'Pâtes', 'Savon', 'Thé', 'Sucre', 'Farine', 'Huile', 'Sel', 'Yaourt', 'Beurre', 'Jus', 'Eau', 'Biscuits', 'Confiture', 'Miel', 'Céréales', 'Chocolat', 'Lessive'];
  const brands = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Fox', 'Golf', 'Hotel', 'India', 'Juliet'];
  let mv = 0;
  for (let i = 0; i < 1000; i++) {
    const id = `p${i}`;
    const p = {
      id, householdId: H, version: i + 1, name: `${words[i % 20]} ${brands[Math.floor(i / 20) % 10]} ${Math.floor(i / 200) + 1}`, brand: brands[i % 10], family: null, aliases: [],
      categoryId: `cat-${DEFAULT_CATEGORIES[i % 9].key}`, locationId: null, unit: 'piece', minQty: i % 3 === 0 ? 2 : null, idealQty: null, packUnit: null, packSize: null,
      photoId: null, defaultStoreId: null, notes: null, trackStock: true, openShelfLifeDays: null, defaultShelfLifeDays: null, manualDailyUse: null, archived: false,
      createdAt: new Date(now - 365 * 86400e3).toISOString(), createdBy: 'u', updatedAt: '', fv: {},
    } as Product;
    c.product.set(id, p);
    for (let l = 0; l < 2; l++) {
      const lotId = `l${i}-${l}`;
      let qty = 0;
      const moves: Movement[] = [];
      for (let k = 0; k < 25; k++) {
        const t = new Date(now - (365 - k * 14) * 86400e3).toISOString();
        const delta = k % 2 === 0 ? 3 : -2;
        const before = qty;
        qty += delta;
        moves.push({
          id: `m${mv++}`, householdId: H, version: mv, opId: `o${mv}`, productId: id, lotId, type: delta > 0 ? 'purchase' : 'consume', delta, quantityBefore: before, quantityAfter: qty,
          reason: null, note: null, userId: 'u', occurredAt: t, createdAt: t, source: 'manual', flags: [], revertOf: null, revertedBy: null, inputQty: null, inputUnit: null,
        } as unknown as Movement);
      }
      for (const m of moves) c.movement.set(m.id, m);
      c.lot.set(lotId, {
        id: lotId, householdId: H, version: 1, productId: id, quantity: qty, initialQuantity: 3, unit: 'piece', expiryDate: l === 0 ? '2026-12-01' : null, expirySource: l === 0 ? 'manual' : null,
        expiryKind: null, batchNumber: null, purchaseDate: null, locationId: null, openedAt: null, unitPriceCents: 120, storeId: null, qtySource: 'manual', qtyApprox: false, countedAt: null,
        createdAt: new Date(now - 365 * 86400e3).toISOString(), updatedAt: '',
      } as unknown as Lot);
    }
    for (let k = 0; k < 5; k++) {
      const pid = `pu${i}-${k}`;
      c.purchase.set(pid, { id: pid, householdId: H, version: 1, productId: id, name: p.name, categoryId: p.categoryId, quantity: 3, unit: 'piece', totalCents: 300 + k * 10, discountCents: null, storeId: null, userId: 'u', date: new Date(now - k * 70 * 86400e3).toISOString().slice(0, 10), shoppingItemId: null, lotId: null, receiptId: null, note: null, createdAt: '' } as Purchase);
    }
  }
  return c;
}

const time = (f: () => unknown) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe('performances (foyer volumineux)', () => {
  const c = bigHousehold();
  const nowIso = '2026-11-18T08:00:00.000Z';
  it('jeu de données : 1 000 produits, 50 000 mouvements', () => {
    expect(c.product.size).toBe(1000);
    expect(c.movement.size).toBe(50_000);
  });
  it('analyse complète du foyer en moins de 0,6 s', () => {
    const ms = time(() =>
      analyzeHousehold({
        products: [...c.product.values()], lots: [...c.lot.values()], movements: [...c.movement.values()], items: [], purchases: [...c.purchase.values()],
        locations: [], settings: DEFAULT_SETTINGS, now: nowIso, today: '2026-11-18',
      }),
    );
    console.log(`analyse : ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(600);
  });
  it('contrôle de cohérence en moins de 0,6 s', () => {
    const ms = time(() => auditHousehold(c, nowIso));
    console.log(`audit : ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(600);
  });
  it('alertes (analyse + audit) en moins de 1 s', () => {
    const ms = time(() => {
      const forecast = analyzeHousehold({ products: [...c.product.values()], lots: [...c.lot.values()], movements: [...c.movement.values()], items: [], purchases: [...c.purchase.values()], locations: [], settings: DEFAULT_SETTINGS, now: nowIso, today: '2026-11-18' });
      computeAlerts({ forecast, collections: c, audit: auditHousehold(c, nowIso), unusual: [], member: undefined, now: nowIso, today: '2026-11-18' });
    });
    console.log(`alertes : ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});

describe('doublons probables : la recherche indexée trouve exactement les paires de la comparaison naïve', () => {
  it('sur 300 noms proches (accents, fautes, marques, unités)', () => {
    const c = emptyCollections();
    const bases = ['Lait demi-écrémé', 'Café moulu', 'Riz basmati', 'Pâtes coquillettes', 'Savon de Marseille', 'Thé vert', 'Huile d’olive', 'Yaourt nature', 'Jus d’orange', 'Lessive liquide'];
    const variants = (b: string, k: number) => [b, b.toUpperCase(), b.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), b.replace(/e/, 'é'), `${b} bio`, b.slice(0, -1), `${b}s`, b.replace(' ', '  ')][k % 8];
    for (let i = 0; i < 300; i++) {
      const id = `p${i}`;
      c.product.set(id, {
        id, householdId: 'h', version: i, name: variants(bases[i % 10], Math.floor(i / 10)), brand: i % 7 === 0 ? 'Marque' : null, family: null,
        aliases: i % 13 === 0 ? [{ text: bases[(i + 1) % 10], kind: 'name', storeId: null }] : [], categoryId: null, locationId: null, unit: i % 5 === 0 ? 'kg' : 'piece',
        minQty: null, idealQty: null, packUnit: null, packSize: null, photoId: null, defaultStoreId: null, notes: null, trackStock: true, openShelfLifeDays: null,
        defaultShelfLifeDays: null, manualDailyUse: null, archived: false, createdAt: '', createdBy: 'u', updatedAt: '', fv: {},
      } as Product);
    }
    const list = [...c.product.values()];
    const naive = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const sameName = normalizeName(a.name) === normalizeName(b.name);
        const aliasHit = a.aliases.some((x) => normalizeName(x.text) === normalizeName(b.name)) || b.aliases.some((x) => normalizeName(x.text) === normalizeName(a.name));
        if (sameName || aliasHit || (similarity(a.name, b.name) >= 0.9 && a.unit === b.unit && (a.brand ?? '') === (b.brand ?? ''))) naive.add(`${a.id}|${b.id}`);
      }
    }
    const fast = new Set(auditHousehold(c, '2026-11-18T08:00:00.000Z').filter((i) => i.code === 'possible_duplicate').map((i) => `${i.productId}|${i.otherProductId}`));
    expect(naive.size).toBeGreaterThan(100);
    expect([...fast].sort()).toEqual([...naive].sort());
  });
});
