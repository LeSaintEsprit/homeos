import { describe, expect, it } from 'vitest';
import { convert, toStockUnit, fromStockUnit, formatQty, roundQty, roundUpForPurchase, compatibleUnits, deOf, normalizeName, similarity, formatEuros, parseEuros } from '@homeos/shared';

describe('unités', () => {
  it('convertit dans une même famille', () => {
    expect(convert(1.5, 'kg', 'g')).toBe(1500);
    expect(convert(75, 'cl', 'l')).toBe(0.75);
    expect(convert(2, 'douzaine', 'piece')).toBe(24);
  });
  it('refuse les conversions entre familles incompatibles', () => {
    expect(convert(1, 'kg', 'l')).toBeNull();
    expect(convert(1, 'paquet', 'g')).toBeNull();
    expect(convert(1, 'bouteille', 'piece')).toBeNull();
  });
  it('convertit via le conditionnement déclaré du produit uniquement', () => {
    const cafe = { unit: 'g' as const, packUnit: 'paquet' as const, packSize: 250 };
    expect(toStockUnit(2, 'paquet', cafe)).toBe(500);
    expect(toStockUnit(0.5, 'kg', cafe)).toBe(500);
    expect(fromStockUnit(750, 'paquet', cafe)).toBe(3);
    expect(toStockUnit(1, 'bouteille', cafe)).toBeNull();
    expect(toStockUnit(1, 'paquet', { unit: 'g' })).toBeNull();
    expect(compatibleUnits(cafe).slice(0, 2)).toEqual(['g', 'paquet']);
  });
  it('gère les quantités partielles sans erreur d\'arrondi', () => {
    expect(roundQty(0.1 + 0.2)).toBe(0.3);
    expect(toStockUnit(0.5, 'bouteille', { unit: 'bouteille' })).toBe(0.5);
    expect(convert(300, 'ml', 'l')).toBe(0.3);
  });
  it('formate en français', () => {
    expect(formatQty(1500, 'g')).toBe('1,5 kg');
    expect(formatQty(250, 'g')).toBe('250 g');
    expect(formatQty(2, 'bouteille')).toBe('2 bouteilles');
    expect(formatQty(0.5, 'bouteille')).toBe('0,5 bouteille');
    expect(formatQty(1, 'piece')).toBe('1 unité');
  });
  it('arrondit les quantités d\'achat', () => {
    expect(roundUpForPurchase(1.2, 'bouteille')).toBe(2);
    expect(roundUpForPurchase(120, 'g')).toBe(150);
    expect(roundUpForPurchase(1.1, 'kg')).toBe(1.25);
  });
});

describe('texte et argent', () => {
  it('élision', () => {
    expect(deOf('Lait')).toBe('de lait');
    expect(deOf('Huile d\'olive')).toBe("d'huile d'olive");
    expect(deOf('Œufs')).toBe("d'œufs");
  });
  it('normalisation et similarité', () => {
    expect(normalizeName('Pâtes  Complètes')).toBe(normalizeName('pates complete'));
    expect(similarity('Lait demi-écrémé', 'LAIT DEMI ECREME')).toBe(1);
    expect(similarity('Lait', 'Café')).toBeLessThan(0.3);
  });
  it('euros', () => {
    expect(formatEuros(1234)).toBe('12,34 €');
    expect(parseEuros('2,35 €')).toBe(235);
    expect(parseEuros('12.5')).toBe(1250);
  });
});
