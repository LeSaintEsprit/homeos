import { describe, expect, it } from 'vitest';
import { analyzeHousehold, checkAddToList, newId, DEFAULT_SETTINGS, type EngineInput } from '@homeos/shared';
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

describe('moteur d\'approvisionnement', () => {
  it('sans historique : utilise uniquement les seuils et le dit', () => {
    const h = new Harness();
    const lait = h.product('Lait', 'bouteille', { minQty: 2, idealQty: 6 });
    h.ok('stock.add', { productId: lait, lotId: newId(), quantity: 1 });
    const f = forecast(h);
    const ins = f.byId.get(lait)!;
    expect(ins.consumption.source).toBe('none');
    expect(ins.daysLeft).toBeNull();
    const r = ins.recommendation!;
    expect(r.reason).toBe('below_min');
    expect(r.quantity).toBe(5);
    expect(r.explanation).toBe('Acheter 5 bouteilles de lait : il reste 1 bouteille, sous le seuil minimal de 2 bouteilles.');
    expect(r.detail).toContain("Pas assez d'historique");
  });

  it('n\'invente rien : pas de seuil, pas d\'historique, stock présent → aucune recommandation', () => {
    const h = new Harness();
    const p = h.product('Bougies', 'piece');
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 5 });
    expect(forecast(h).byId.get(p)!.recommendation).toBeNull();
  });

  it('prévoit la rupture à partir de la consommation observée (exemple du cahier des charges)', () => {
    const h = new Harness();
    h.at('2026-09-20T08:00:00Z');
    const lait = h.product('Lait', 'bouteille', { idealQty: 4 });
    h.ok('stock.add', { productId: lait, lotId: newId(), quantity: 30 });
    // Une bouteille tous les 2 jours pendant 40 jours → 0,5/jour.
    for (let d = 0; d < 20; d++) {
      h.advance(48);
      h.ok('stock.consume', { productId: lait, quantity: 1 });
    }
    h.ok('stock.adjust', { productId: lait, expected: 10, quantity: 1.5, reason: 'error' });
    const ins = forecast(h).byId.get(lait)!;
    expect(ins.consumption.source).toBe('observed');
    expect(ins.consumption.confidence).toBe('high');
    expect(ins.consumption.dailyRate!).toBeGreaterThan(0.45);
    expect(ins.consumption.dailyRate!).toBeLessThan(0.55);
    expect(ins.daysLeft!).toBeCloseTo(3, 0);
    const r = ins.recommendation!;
    expect(r.reason).toBe('forecast');
    expect(r.explanation).toMatch(/^Acheter \d+ bouteilles de lait : le stock actuel devrait être épuisé dans environ 3 jours\.$/);
    expect(r.confidence).toBe('high');
  });

  it('exclut les périodes de rupture du calcul du débit', () => {
    const h = new Harness();
    h.at('2026-08-01T08:00:00Z');
    const p = h.product('Café', 'paquet');
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 10 });
    for (let d = 0; d < 10; d++) {
      h.advance(24);
      h.ok('stock.consume', { productId: p, quantity: 1 });
    }
    // 60 jours sans café : le débit ne doit pas être dilué.
    h.advance(24 * 60);
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 5 });
    h.advance(24);
    const ins = forecast(h).byId.get(p)!;
    // Sans exclusion, le débit serait ~10/71 = 0,14 par jour.
    expect(ins.consumption.dailyRate!).toBeGreaterThan(0.6);
    expect(ins.consumption.spanDays).toBeLessThan(13);
  });

  it('déduit la quantité déjà dans la liste et indique « déjà prévu »', () => {
    const h = new Harness();
    const p = h.product('Pâtes', 'paquet', { minQty: 1, idealQty: 4 });
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 1 });
    h.ok('shopping.add', { itemId: newId(), productId: p, name: 'Pâtes', quantity: 2, unit: 'paquet' });
    let ins = forecast(h).byId.get(p)!;
    expect(ins.recommendation!.quantity).toBe(1);
    expect(ins.recommendation!.detail).toContain('2 paquets déjà dans la liste');
    h.ok('shopping.add', { itemId: newId(), productId: p, name: 'Pâtes', quantity: 1, unit: 'paquet' });
    ins = forecast(h).byId.get(p)!;
    expect(ins.recommendation).toBeNull();
    expect(ins.coveredByList).toBe(true);
  });

  it('arrondit au conditionnement d\'achat', () => {
    const h = new Harness();
    const p = h.product('Café moulu', 'g', { minQty: 250, idealQty: 1000, packUnit: 'paquet', packSize: 250 });
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 100 });
    const r = forecast(h).byId.get(p)!.recommendation!;
    expect(r.displayUnit).toBe('paquet');
    expect(r.displayQty).toBe(4);
    expect(r.quantity).toBe(1000);
    expect(r.explanation).toContain('Acheter 4 paquets de café moulu');
  });

  it('reconnaît les achats réguliers sans consommation saisie', () => {
    const h = new Harness();
    h.at('2026-08-03T10:00:00Z');
    const p = h.product('Œufs', 'piece');
    for (let w = 0; w < 6; w++) {
      h.ok('stock.add', { productId: p, lotId: newId(), quantity: 6, kind: 'purchase' });
      h.advance(24 * 7);
    }
    h.at('2026-09-13T10:00:00Z');
    const ins = forecast(h).byId.get(p)!;
    expect(ins.cadence!.regular).toBe(true);
    expect(ins.cadence!.medianIntervalDays).toBe(7);
    expect(ins.consumption.source).toBe('purchases');
    expect(ins.consumption.confidence).toBe('medium');
  });

  it('une quantité approximative abaisse la confiance et est signalée', () => {
    const h = new Harness();
    const p = h.product('Huile', 'bouteille', { minQty: 1, idealQty: 2 });
    const lot = newId();
    h.ok('stock.add', { productId: p, lotId: lot, quantity: 1 });
    h.ok('stock.adjust', { productId: p, lotId: lot, expected: 1, quantity: 0.5, reason: 'unlogged', approx: true });
    const ins = forecast(h).byId.get(p)!;
    expect(ins.quality.level).toBe('approx');
    expect(ins.recommendation!.confidence).toBe('medium');
    expect(ins.recommendation!.detail).toContain('approximative');
  });

  it('épuisé sans aucune donnée : propose un conditionnement et l\'explique', () => {
    const h = new Harness();
    const p = h.product('Sopalin', 'rouleau');
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 1 });
    h.ok('stock.finish', { productId: p });
    const r = forecast(h).byId.get(p)!.recommendation!;
    expect(r.reason).toBe('out');
    expect(r.quantity).toBe(1);
    expect(r.detail).toContain('définissez une quantité idéale');
  });

  it('les lots périmés ne comptent pas dans le stock utilisable', () => {
    const h = new Harness();
    const p = h.product('Crème', 'pot', { minQty: 1 });
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 2, expiryDate: '2026-10-25' });
    const ins = forecast(h).byId.get(p)!;
    expect(ins.total).toBe(2);
    expect(ins.usable).toBe(0);
    expect(ins.status).toBe('out');
    expect(ins.recommendation!.explanation).toContain('périmé');
  });

  it('estime le risque de gaspillage selon le rythme de consommation', () => {
    const h = new Harness();
    h.at('2026-09-01T08:00:00Z');
    const p = h.product('Yaourt', 'pot');
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 40 });
    for (let d = 0; d < 40; d++) {
      h.advance(24);
      h.ok('stock.consume', { productId: p, quantity: 0.5 });
    }
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 8, expiryDate: '2026-10-15' });
    const ins = forecast(h, '2026-10-11').byId.get(p)!;
    // ~0,5/jour : sur 8 pots expirant dans 4 jours, la majorité risque d'être jetée.
    expect(ins.atRiskQty).toBeGreaterThan(5);
  });

  it('avertit avant d\'ajouter à la liste un produit déjà en stock suffisant', () => {
    const h = new Harness();
    const p = h.product('Riz', 'kg', { idealQty: 2 });
    h.ok('stock.add', { productId: p, lotId: newId(), quantity: 3 });
    const f = forecast(h);
    const c = checkAddToList(f.byId.get(p), DEFAULT_SETTINGS);
    expect(c.level).toBe('warning');
    expect(c.message).toContain('Stock actuel : 3');
  });
});
