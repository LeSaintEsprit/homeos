import { describe, expect, it } from 'vitest';
import { checkRecipe, checkRecipes, newId, type Recipe } from '@homeos/shared';
import { Harness } from './helpers';

const TODAY = '2026-11-02';

function setup() {
  const h = new Harness();
  const oeufs = h.product('Œufs', 'piece', { initialStock: { lotId: newId(), quantity: 4, expiryDate: '2026-11-04' } });
  const lait = h.product('Lait', 'l', { initialStock: { lotId: newId(), quantity: 1 } });
  const farine = h.product('Farine', 'kg', { initialStock: { lotId: newId(), quantity: 0.2 } });
  const beurre = h.product('Beurre', 'g', { initialStock: { lotId: newId(), quantity: 250, expiryDate: '2026-10-30' } });
  const sucre = h.product('Sucre', 'kg', { aliases: [{ text: 'Sucre en poudre', kind: 'name', storeId: null }] } as never);
  const id = newId();
  h.ok('recipe.upsert', {
    id,
    name: 'Crêpes',
    servings: 4,
    ingredients: [
      { productId: farine, name: 'Farine', quantity: 250, unit: 'g', optional: false },
      { productId: oeufs, name: 'Œufs', quantity: 4, unit: 'piece', optional: false },
      { productId: lait, name: 'Lait', quantity: 50, unit: 'cl', optional: false },
      { productId: beurre, name: 'Beurre', quantity: 50, unit: 'g', optional: true },
      { productId: null, name: 'Sucre en poudre', quantity: 30, unit: 'g', optional: true },
      { productId: null, name: 'Rhum', quantity: 2, unit: 'cl', optional: true },
    ],
    instructions: null,
    tags: [],
  });
  const ctx = () => {
    const c = h.collections();
    return { products: [...c.product.values()], lots: [...c.lot.values()], items: [...c.shoppingItem.values()], today: TODAY };
  };
  const recipe = () => h.store.get('recipe', id) as Recipe;
  return { h, id, recipe, ctx, oeufs, lait, farine, beurre, sucre };
}

describe('recettes réalisables avec le stock', () => {
  it('compare chaque ingrédient au stock réel, unités converties, sans jamais supposer ce qui n’est pas suivi', () => {
    const { recipe, ctx } = setup();
    const r = checkRecipe(recipe(), 4, ctx());
    const by = (n: string) => r.lines.find((l) => l.ingredient.name === n)!;
    expect(by('Œufs')).toMatchObject({ status: 'ok', available: 4, neededStock: 4, urgent: true });
    expect(by('Lait')).toMatchObject({ status: 'ok', neededStock: 0.5 });
    expect(by('Farine')).toMatchObject({ status: 'partial', available: 0.2, missing: 0.05 });
    // Beurre : DLC dépassée → non disponible.
    expect(by('Beurre')).toMatchObject({ status: 'missing', available: 0 });
    // Sucre : retrouvé par son nom alternatif, mais aucun stock.
    expect(by('Sucre en poudre').product?.name).toBe('Sucre');
    expect(by('Rhum')).toMatchObject({ status: 'unknown', product: null });
    expect(r.status).toBe('almost');
    expect(r.missingCount).toBe(1); // seule la farine est obligatoire et insuffisante
    expect(r.urgentCount).toBe(1);
    // À acheter : uniquement les obligatoires, arrondis à l'unité d'achat.
    expect(r.toBuy).toEqual([{ productId: by('Farine').product!.id, name: 'Farine', quantity: 0.25, unit: 'kg' }]);
  });

  it('adapte les quantités au nombre de parts', () => {
    const { recipe, ctx } = setup();
    const r = checkRecipe(recipe(), 2, ctx());
    expect(r.lines.find((l) => l.ingredient.name === 'Farine')).toMatchObject({ needed: 125, status: 'ok' }); // 200 g en stock
    expect(r.lines.find((l) => l.ingredient.name === 'Œufs')).toMatchObject({ needed: 2, status: 'ok' });
    const r8 = checkRecipe(recipe(), 8, ctx());
    expect(r8.lines.find((l) => l.ingredient.name === 'Œufs')).toMatchObject({ needed: 8, missing: 4, status: 'partial' });
    expect(r8.status).toBe('almost'); // farine et œufs insuffisants
  });

  it('une date « de préférence avant » dépassée reste utilisable', () => {
    const { h, recipe, ctx, beurre } = setup();
    const lot = h.lots(beurre)[0];
    h.ok('lot.update', { lotId: lot.id, patch: { expiryKind: 'ddm' } } as never);
    expect(checkRecipe(recipe(), 4, ctx()).lines.find((l) => l.ingredient.name === 'Beurre')).toMatchObject({ status: 'ok', available: 250 });
  });

  it('ce qui est déjà dans la liste n’est pas proposé une seconde fois', () => {
    const { h, recipe, ctx, farine } = setup();
    h.ok('shopping.add', { itemId: newId(), productId: farine, name: 'Farine', quantity: 1, unit: 'kg', source: 'manual' });
    const r = checkRecipe(recipe(), 4, ctx());
    expect(r.lines.find((l) => l.ingredient.name === 'Farine')).toMatchObject({ status: 'partial', onList: 1 });
    expect(r.toBuy).toEqual([]);
  });

  it('les ingrédients manquants ajoutés à la liste en une fois, puis la recette cuisinée déduit le stock', () => {
    const { h, recipe, ctx, farine, oeufs, lait } = setup();
    for (const n of checkRecipe(recipe(), 4, ctx()).toBuy) {
      h.ok('shopping.add', { itemId: newId(), productId: n.productId, name: n.name, quantity: n.quantity, unit: n.unit, source: 'recipe' });
    }
    const items = [...h.collections().shoppingItem.values()];
    expect(items.map((i) => [i.name, i.quantity, i.unit, i.source])).toEqual([['Farine', 0.25, 'kg', 'recipe']]);
    // Après achat de la farine, la recette est réalisable.
    h.ok('stock.add', { productId: farine, lotId: newId(), quantity: 1 });
    expect(checkRecipe(recipe(), 4, ctx()).status).toBe('ready');
    h.ok('recipe.cook', { recipeId: recipe().id, servings: 4 });
    expect(h.total(farine)).toBe(0.95);
    expect(h.total(oeufs)).toBe(0);
    expect(h.total(lait)).toBe(0.5);
    const moves = [...h.collections().movement.values()].filter((m) => m.source === 'recipe');
    expect(moves.length).toBeGreaterThanOrEqual(3);
    h.assertInvariants();
  });

  it('classe les recettes : réalisables d’abord, puis celles qui sauvent des produits à consommer vite', () => {
    const { h, ctx, oeufs, lait } = setup();
    const mk = (name: string, ingredients: Recipe['ingredients']) => {
      const id = newId();
      h.ok('recipe.upsert', { id, name, servings: 2, ingredients, instructions: null, tags: [] });
      return id;
    };
    mk('Lait chaud', [{ productId: lait, name: 'Lait', quantity: 25, unit: 'cl', optional: false }]);
    mk('Omelette', [{ productId: oeufs, name: 'Œufs', quantity: 3, unit: 'piece', optional: false }]);
    const archived = mk('Ancienne', [{ productId: lait, name: 'Lait', quantity: 1, unit: 'cl', optional: false }]);
    h.ok('recipe.archive', { id: archived, archived: true });
    const names = checkRecipes([...h.collections().recipe.values()], ctx()).map((r) => [r.recipe.name, r.status]);
    expect(names).toEqual([['Omelette', 'ready'], ['Lait chaud', 'ready'], ['Crêpes', 'almost']]);
  });
});
