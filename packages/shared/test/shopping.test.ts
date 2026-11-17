import { describe, expect, it } from 'vitest';
import { groupByAisle, itemsForStore, moveAisle, storeSummary, newId, type Category, type Purchase, type ShoppingItem, type Store } from '@homeos/shared';

const cat = (id: string, sort: number): Category => ({ id, householdId: 'h', version: 1, name: id, icon: 'box', color: '#000', sort, archived: false }) as unknown as Category;
const store = (categoryOrder: string[]): Store => ({ id: 's1', householdId: 'h', version: 1, name: 'Marché', address: null, notes: null, categoryOrder, color: '#000', sort: 0, archived: false });
const item = (name: string, extra: Partial<ShoppingItem> = {}): ShoppingItem =>
  ({
    id: newId(), householdId: 'h', version: 1, productId: null, name, categoryId: null, storeId: null, quantity: 1, unit: 'piece', priority: 'normal', comment: null,
    assignedTo: null, status: 'pending', purchasedQty: 0, purchasedBy: null, purchasedAt: null, priceCents: null, receivedAt: null, source: 'manual', requests: [],
    createdAt: '', createdBy: 'u', updatedAt: '', updatedBy: 'u', fv: {}, ...extra,
  }) as ShoppingItem;
const pu = (date: string, totalCents: number | null, extra: Partial<Purchase> = {}): Purchase => ({
  id: newId(), householdId: 'h', version: 1, productId: null, name: 'x', categoryId: null, quantity: 1, unit: 'piece', totalCents, discountCents: null,
  storeId: 's1', userId: 'u', date, shoppingItemId: null, lotId: null, receiptId: null, note: null, createdAt: date, ...extra,
});

describe('organisation de la liste par magasin', () => {
  const cats = [cat('fruits', 0), cat('frais', 1), cat('hygiene', 2)];
  it('filtre les articles du magasin choisi et ceux sans magasin', () => {
    const list = [item('a', { storeId: 's1' }), item('b', { storeId: 's2' }), item('c'), item('d', { status: 'done' }), item('e', { status: 'removed' })];
    expect(itemsForStore(list, 's1').map((i) => i.name)).toEqual(['a', 'c']);
    expect(itemsForStore(list, null).map((i) => i.name)).toEqual(['a', 'b', 'c']);
  });
  it("suit l'ordre des rayons du magasin, les articles sans rayon à la fin, les cochés en bas", () => {
    const list = [
      item('Savon', { categoryId: 'hygiene' }),
      item('Pommes', { categoryId: 'fruits', status: 'purchased', purchasedQty: 1 }),
      item('Bananes', { categoryId: 'fruits' }),
      item('Yaourts', { categoryId: 'frais', priority: 'urgent' }),
      item('Lait', { categoryId: 'frais' }),
      item('Truc'),
      item('Inconnu', { categoryId: 'catégorie-supprimée' }),
    ];
    const g = groupByAisle(list, cats, store(['hygiene', 'frais']));
    expect(g.map((x) => x.categoryId)).toEqual(['hygiene', 'frais', 'fruits', '']);
    expect(g[1].items.map((i) => i.name)).toEqual(['Yaourts', 'Lait']);
    expect(g[2].items.map((i) => i.name)).toEqual(['Bananes', 'Pommes']);
    expect(g[3].items.map((i) => i.name).sort()).toEqual(['Inconnu', 'Truc']);
    // Sans magasin : ordre habituel des catégories.
    expect(groupByAisle(list, cats, null).map((x) => x.categoryId)).toEqual(['fruits', 'frais', 'hygiene', '']);
  });
  it("déplace un rayon dans l'ordre de parcours", () => {
    expect(moveAisle(store([]), cats, 'hygiene', -1)).toEqual(['fruits', 'hygiene', 'frais']);
    expect(moveAisle(store(['hygiene']), cats, 'hygiene', -1)).toEqual(['hygiene', 'fruits', 'frais']);
    expect(moveAisle(store(['hygiene']), cats, 'frais', 1)).toEqual(['hygiene', 'fruits', 'frais']);
  });
});

describe('historique par magasin', () => {
  it('compte les passages, sépare les achats sans prix et calcule le panier moyen sur les passages chiffrés', () => {
    const list = [
      pu('2026-11-02', 300, { productId: 'lait', name: 'Lait' }),
      pu('2026-11-02', 700, { productId: 'pain', name: 'Pain' }),
      pu('2026-11-09', 350, { productId: 'lait', name: 'Lait' }),
      pu('2026-11-09', null, { name: 'Fleurs' }),
      pu('2026-11-12', 2000, { productId: 'lait', name: 'Lait' }),
      pu('2026-11-12', 500, { storeId: 's2' }),
    ];
    const s = storeSummary('s1', list);
    expect(s.visits).toBe(3);
    expect(s.lastVisit).toBe('2026-11-12');
    expect(s.knownCents).toBe(3350);
    expect(s.unpricedCount).toBe(1);
    // Passages complets : 02/11 (1000) et 12/11 (2000) ; le 09/11 a un prix inconnu.
    expect(s.avgBasketCents).toBe(1500);
    expect(s.usual).toEqual([{ productId: 'lait', name: 'Lait', count: 3, lastDate: '2026-11-12' }]);
    expect(storeSummary('vide', list)).toMatchObject({ visits: 0, lastVisit: null, avgBasketCents: null, usual: [] });
  });
});
