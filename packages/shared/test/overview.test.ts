import { describe, expect, it } from 'vitest';
import { analyzeHousehold, dataGaps, expiryOverview, newId, runOutTimeline, wasteStats, weekLabel, DEFAULT_SETTINGS, type EngineInput } from '@homeos/shared';
import { Harness } from './helpers';

function forecast(h: Harness, today = h.now.slice(0, 10)) {
  const c = h.collections();
  const input: EngineInput = {
    products: [...c.product.values()],
    lots: [...c.lot.values()],
    movements: [...c.movement.values()],
    items: [...c.shoppingItem.values()],
    purchases: [...c.purchase.values()],
    locations: [...c.location.values()],
    settings: { ...DEFAULT_SETTINGS },
    now: h.now,
    today,
  };
  return analyzeHousehold(input);
}

describe('vue péremption', () => {
  it('classe les lots par urgence (FEFO), isole les ouverts, les lots non datés et les produits oubliés', () => {
    const h = new Harness();
    h.at('2026-11-10T08:00:00Z');
    const yaourt = h.product('Yaourts', 'pot');
    h.ok('stock.add', { productId: yaourt, lotId: newId(), quantity: 2, expiryDate: '2026-11-09' }); // périmé
    h.ok('stock.add', { productId: yaourt, lotId: newId(), quantity: 4, expiryDate: '2026-11-10' }); // aujourd'hui
    h.ok('stock.add', { productId: yaourt, lotId: newId(), quantity: 4 }); // sans date alors que le produit est daté
    const creme = h.product('Crème', 'pot');
    h.ok('stock.add', { productId: creme, lotId: newId(), quantity: 1, expiryDate: '2026-11-12' }); // urgent (≤ 2 j)
    const jambon = h.product('Jambon', 'paquet');
    h.ok('stock.add', { productId: jambon, lotId: newId(), quantity: 1, expiryDate: '2026-11-15' }); // bientôt (≤ 7 j)
    const lait = h.product('Lait', 'bouteille', { openShelfLifeDays: 3 });
    h.ok('stock.add', { productId: lait, lotId: newId(), quantity: 2, expiryDate: '2027-01-30' });
    h.ok('stock.open', { productId: lait });
    const conserve = h.product('Haricots', 'boite');
    h.at('2026-06-01T08:00:00Z');
    h.ok('stock.add', { productId: conserve, lotId: newId(), quantity: 3 });
    h.at('2026-11-10T08:00:00Z');

    const o = expiryOverview(forecast(h));
    const names = (xs: { insight: { product: { name: string } } }[]) => xs.map((x) => x.insight.product.name);
    expect(names(o.expired)).toEqual(['Yaourts']);
    expect(names(o.today)).toEqual(['Yaourts']);
    expect(names(o.urgent)).toEqual(['Crème']);
    // Le lait ouvert (3 jours de conservation) est aussi « bientôt », avant le jambon.
    expect(names(o.soon)).toEqual(['Lait', 'Jambon']);
    // Ouvert : date effective = ouverture + 3 jours, bien avant la date imprimée.
    expect(names(o.opened)).toEqual(['Lait']);
    expect(o.opened[0].lot.effectiveExpiry).toBe('2026-11-13');
    expect(names(o.undated)).toEqual(['Yaourts']);
    expect(o.forgotten.map((i) => i.product.name)).toEqual(['Haricots']);
  });

  it('quantités à risque : uniquement avec une consommation fiable', () => {
    const h = new Harness();
    h.at('2026-10-01T08:00:00Z');
    const lait = h.product('Lait', 'bouteille');
    h.ok('stock.add', { productId: lait, lotId: newId(), quantity: 20 });
    for (let d = 0; d < 16; d++) {
      h.advance(48);
      h.ok('stock.consume', { productId: lait, quantity: 1 });
    }
    // 0,5 bouteille/jour ; 6 bouteilles qui expirent dans 4 jours → ~3,5 à risque après les 4 restantes du lot ancien.
    h.ok('stock.add', { productId: lait, lotId: newId(), quantity: 6, expiryDate: '2026-11-06' });
    const o = expiryOverview(forecast(h, '2026-11-02'));
    expect(o.atRisk).toHaveLength(1);
    expect(o.atRisk[0].lot.atRiskQty).toBeGreaterThan(3);
    // Même situation sans historique : aucun risque inventé.
    const h2 = new Harness();
    const p = h2.product('Lait', 'bouteille');
    h2.ok('stock.add', { productId: p, lotId: newId(), quantity: 6, expiryDate: '2026-11-04' });
    expect(expiryOverview(forecast(h2)).atRisk).toHaveLength(0);
  });
});

describe('calendrier des ruptures', () => {
  it('place les ruptures prévues (consommation fiable) par semaine, sans les produits sans données', () => {
    const h = new Harness();
    h.at('2026-09-20T08:00:00Z');
    const lait = h.product('Lait', 'bouteille');
    h.ok('stock.add', { productId: lait, lotId: newId(), quantity: 30 });
    for (let d = 0; d < 20; d++) {
      h.advance(48);
      h.ok('stock.consume', { productId: lait, quantity: 1 });
    }
    const bougies = h.product('Bougies', 'piece');
    h.ok('stock.add', { productId: bougies, lotId: newId(), quantity: 3 });
    const today = h.now.slice(0, 10); // 2026-10-30, 10 bouteilles à 0,5/jour → ~20 jours
    const weeks = runOutTimeline(forecast(h, today), today, 42);
    const events = weeks.flatMap((w) => w.events);
    expect(events.map((e) => e.name)).toEqual(['Lait']);
    expect(events[0].kind).toBe('runout');
    expect(events[0].confidence).toBe('high');
    expect(events[0].inDays).toBeGreaterThanOrEqual(18);
    expect(events[0].inDays).toBeLessThanOrEqual(22);
    expect(weeks[0].week <= events[0].date).toBe(true);
    // Horizon trop court : rien.
    expect(runOutTimeline(forecast(h, today), today, 7)).toEqual([]);
  });

  it('libellés des semaines', () => {
    expect(weekLabel('2026-11-16', '2026-11-17')).toBe('Cette semaine');
    expect(weekLabel('2026-11-23', '2026-11-17')).toBe('Semaine prochaine');
    expect(weekLabel('2026-12-07', '2026-11-17')).toBe('Semaine du 7 déc.');
  });
});

describe('données manquantes', () => {
  it('signale ce qui empêche une prévision fiable, une seule fois par produit', () => {
    const h = new Harness();
    const sans = h.product('Bougies', 'piece');
    h.ok('stock.add', { productId: sans, lotId: newId(), quantity: 3 });
    const seuil = h.product('Riz', 'paquet', { minQty: 1 });
    h.ok('stock.add', { productId: seuil, lotId: newId(), quantity: 3 });
    const approx = h.product('Farine', 'kg', { minQty: 1 });
    h.ok('stock.add', { productId: approx, lotId: newId(), quantity: 2 });
    h.ok('stock.adjust', { productId: approx, expected: 2, quantity: 1.5, reason: 'count', approx: true });
    const libre = h.product('Décoration', 'piece', { trackStock: false });
    h.ok('stock.add', { productId: libre, lotId: newId(), quantity: 1 });
    const gaps = dataGaps(forecast(h), DEFAULT_SETTINGS);
    expect(gaps.map((g) => [g.insight.product.name, g.kind])).toEqual([
      ['Bougies', 'no_data'],
      ['Farine', 'approx'],
    ]);
    expect(gaps[0].message).toContain('seuil minimal');
  });
});

describe('gaspillage', () => {
  it('compte les pertes par motif et ne valorise que les lots au prix connu', () => {
    const h = new Harness();
    const p = h.product('Salade', 'piece');
    const priced = newId();
    h.ok('stock.add', { productId: p, lotId: priced, quantity: 2, priceCents: 300 });
    const free = newId();
    h.ok('stock.add', { productId: p, lotId: free, quantity: 1 });
    h.ok('stock.waste', { productId: p, lotId: priced, quantity: 1, reason: 'spoiled' });
    h.ok('stock.waste', { productId: p, lotId: free, quantity: 1, reason: 'expired' });
    const c = h.collections();
    const w = wasteStats([...c.movement.values()], c.lot, '2026-01-01');
    expect(w.count).toBe(2);
    expect(w.byReason).toEqual({ spoiled: 1, expired: 1 });
    expect(w.valueCents).toBe(150);
    expect(w.unvaluedCount).toBe(1);
  });
});
