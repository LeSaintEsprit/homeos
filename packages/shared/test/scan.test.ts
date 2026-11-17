import { describe, expect, it } from 'vitest';
import { parseScannedCode, isValidGtin, canonicalGtin, gs1Date, findExpiryDates, parseReceipt, matchReceiptLabel, normalizeOffProduct, parseQuantityText, type Product, type Store } from '@homeos/shared';

const TODAY = new Date('2026-11-17T10:00:00Z');

describe('codes-barres et GS1', () => {
  it('valide et normalise les GTIN', () => {
    expect(isValidGtin('3017620422003')).toBe(true);
    expect(isValidGtin('3017620422004')).toBe(false);
    expect(canonicalGtin('03017620422003')).toBe('3017620422003');
    expect(canonicalGtin('036000291452')).toBe('0036000291452');
  });
  it('un EAN-13 classique ne contient jamais de date', () => {
    const p = parseScannedCode('3017620422003', TODAY);
    expect(p).toMatchObject({ code: '3017620422003', isGs1: false, expiry: null, bestBefore: null, validCheckDigit: true });
  });
  it('analyse une chaîne GS1 DataMatrix avec séparateur FNC1', () => {
    const p = parseScannedCode(']d2010301762042200317270315' + '10LOT42A\u001d' + '3103000450', TODAY);
    expect(p.isGs1).toBe(true);
    expect(p.code).toBe('3017620422003');
    expect(p.expiry).toBe('2027-03-15');
    expect(p.batch).toBe('LOT42A');
    expect(p.netWeightKg).toBe(0.45);
  });
  it('analyse le format entre parenthèses et la DDM', () => {
    const p = parseScannedCode('(01)03017620422003(15)261200(10)A12', TODAY);
    expect(p.bestBefore).toBe('2026-12-31'); // « 00 » = dernier jour du mois
    expect(p.expiry).toBeNull();
    expect(p.batch).toBe('A12');
  });
  it('analyse un GS1 Digital Link', () => {
    const p = parseScannedCode('https://id.gs1.org/01/03017620422003/10/B7?17=270101', TODAY);
    expect(p).toMatchObject({ isGs1: true, code: '3017620422003', batch: 'B7', expiry: '2027-01-01' });
  });
  it('fenêtre de siècle GS1', () => {
    expect(gs1Date('991231', TODAY)).toBe('1999-12-31');
    expect(gs1Date('300101', TODAY)).toBe('2030-01-01');
    expect(gs1Date('261340', TODAY)).toBeNull();
  });
  it('identifie les codes magasin à poids variable sans les interpréter', () => {
    const p = parseScannedCode('2123456012345', TODAY);
    expect(p.restricted).toBe(true);
    expect(p.netWeightKg).toBeNull();
  });
});

describe('OCR des dates', () => {
  it('reconnaît une DLC et une DDM', () => {
    const dlc = findExpiryDates("A consommer jusqu'au : 24/11/2026\nLOT 4521", '2026-11-17');
    expect(dlc[0]).toMatchObject({ date: '2026-11-24', kind: 'dlc' });
    const ddm = findExpiryDates('À consommer de préférence avant fin : 03/2027', '2026-11-17');
    expect(ddm[0]).toMatchObject({ date: '2027-03-31', kind: 'ddm' });
  });
  it('corrige les confusions OCR courantes et les mois en lettres', () => {
    expect(findExpiryDates('DLC 2O.12.26', '2026-11-17')[0].date).toBe('2026-12-20');
    expect(findExpiryDates('BEST BEFORE 12 MARS 2027', '2026-11-17')[0]).toMatchObject({ date: '2027-03-12', kind: 'ddm' });
  });
  it('écarte les dates invraisemblables', () => {
    expect(findExpiryDates('Fabriqué le 12/05/1998', '2026-11-17')).toHaveLength(0);
  });
});

describe('tickets de caisse', () => {
  const stores = [{ id: 'st-lidl', name: 'Lidl' }] as Store[];
  const text = `LIDL
Magasin de Lyon
17/11/2026 18:42
LAIT DEMI ECREME 1L        2,10 A
  2 x 1,05
PATES FUSILLI 500G         0,89 A
BANANES
0,850 kg x 1,99 EUR/kg     1,69 A
REMISE FIDELITE           -0,30
YAOURT NATURE X4           1,25 A
TOTAL                      5,63
CB                         5,63`;
  it('lit magasin, date, lignes, quantités, poids, remises et total', () => {
    const r = parseReceipt(text, stores, '2026-11-17');
    expect(r.storeId).toBe('st-lidl');
    expect(r.date).toBe('2026-11-17');
    expect(r.totalCents).toBe(563);
    expect(r.lines.map((l) => l.label)).toEqual(['LAIT DEMI ECREME 1L', 'PATES FUSILLI 500G', 'BANANES', 'YAOURT NATURE']);
    expect(r.lines[0]).toMatchObject({ quantity: 2, unitPriceCents: 105, totalCents: 210 });
    expect(r.lines[2]).toMatchObject({ weighed: true, quantity: 0.85, discountCents: 30, totalCents: 139 });
    expect(r.warnings.filter((w) => w.includes('total'))).toHaveLength(0);
  });
  it('signale les correspondances incertaines et reconnaît les alias appris', () => {
    const products = [
      { id: 'p1', name: 'Lait demi-écrémé', archived: false, brand: null, aliases: [] },
      { id: 'p2', name: 'Pâtes', archived: false, brand: null, aliases: [{ text: 'PATES FUSILLI 500G', kind: 'receipt', storeId: 'st-lidl' }] },
    ] as unknown as Product[];
    expect(matchReceiptLabel('PATES FUSILLI 500G', products, 'st-lidl')).toMatchObject({ productId: 'p2', confidence: 'sure' });
    const m = matchReceiptLabel('LAIT DEMI ECREME 1L', products, 'st-lidl');
    expect(m.productId).toBe('p1');
    expect(['likely', 'uncertain']).toContain(m.confidence);
    expect(matchReceiptLabel('PILES AA', products, null).confidence).toBe('none');
  });
});

describe('fiches produits externes', () => {
  it('interprète les formats', () => {
    expect(parseQuantityText('400 g e')).toEqual({ unit: 'g', amount: 400, multipack: null });
    expect(parseQuantityText('6 x 1 L')).toEqual({ unit: 'l', amount: 1, multipack: 6 });
    expect(parseQuantityText('75cl')).toEqual({ unit: 'cl', amount: 75, multipack: null });
    expect(parseQuantityText('lot')).toBeNull();
  });
  it('normalise une réponse Open Food Facts réelle', () => {
    const p = normalizeOffProduct('3017620422003', 'off', {
      brands: 'Ferrero, Nutella', categories_tags: ['en:breakfasts', 'en:spreads', 'fr:pates-a-tartiner'], product_name: 'Nutella', product_name_fr: 'Nutella', product_quantity: 400, product_quantity_unit: 'g', quantity: '400 g e',
      image_front_small_url: 'https://images.openfoodfacts.org/x.jpg',
    })!;
    expect(p).toMatchObject({ name: 'Nutella', brand: 'Nutella', unit: 'g', amount: 400, categoryKey: 'epicerie' });
  });
});
