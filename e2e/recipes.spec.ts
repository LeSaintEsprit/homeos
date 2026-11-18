import { expect, test, type Page } from '@playwright/test';
import { createHousehold, inDays, register, seed, uid, uniq } from './helpers';

const qty = (page: Page, name: string) => page.getByTestId('product-row').filter({ hasText: name }).getByTestId('product-qty');

async function ingredient(page: Page, i: number, search: string, product: string | null, quantity: string, unit?: string, optional = false) {
  if (i > 0) await page.getByTestId('add-ingredient').click();
  const ed = page.getByTestId('ingredient-editor').nth(i);
  await ed.getByRole('textbox', { name: `Ingrédient ${i + 1}`, exact: true }).fill(search);
  if (product) await ed.getByRole('button', { name: product, exact: true }).click();
  await ed.getByLabel('Quantité').fill(quantity);
  if (unit) await ed.getByLabel('Unité').selectOption(unit);
  if (optional) await ed.getByRole('switch').click();
}

test.describe('Phase 15 — recettes', () => {
  test('recette créée depuis l’inventaire, faisabilité réelle, manquants vers la liste, cuisinée avec déduction du stock', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison recettes');
    const farine = uid();
    await seed(page, (op) => {
      op('product.create', { id: uid(), name: 'Œufs', unit: 'piece', initialStock: { lotId: uid(), quantity: 4, expiryDate: inDays(1) } }, 5);
      op('product.create', { id: uid(), name: 'Lait', unit: 'l', initialStock: { lotId: uid(), quantity: 1 } }, 5);
      op('product.create', { id: farine, name: 'Farine', unit: 'kg', initialStock: { lotId: uid(), quantity: 0.2 } }, 5);
    });

    await page.goto('/inventaire');
    await page.getByTestId('open-recipes').click();
    await expect(page.getByText('Aucune recette')).toBeVisible();
    await page.getByTestId('new-recipe').click();
    await page.getByLabel('Nom de la recette').fill('Crêpes');
    await page.getByLabel('Nombre de parts').fill('4');
    await ingredient(page, 0, 'fari', 'Farine', '250', 'g');
    await ingredient(page, 1, 'oeu', 'Œufs', '4');
    await ingredient(page, 2, 'lai', 'Lait', '50', 'cl');
    await ingredient(page, 3, 'Rhum', null, '2', 'cl', true);
    await page.getByTestId('save-recipe').click();

    // Faisabilité : la farine manque (200 g pour 250 g), le rhum n'est pas suivi (facultatif), les œufs sont à consommer vite.
    await expect(page.getByRole('heading', { name: 'Crêpes' })).toBeVisible();
    await expect(page.getByTestId('recipe-status')).toHaveText('Il manque 1 ingrédient');
    const row = (name: string) => page.getByTestId('ingredient-row').filter({ hasText: name });
    await expect(row('Farine')).toHaveAttribute('data-status', 'partial');
    await expect(row('Farine')).toContainText('Il manque 50 g');
    await expect(row('Œufs')).toContainText('à consommer avant le');
    await expect(row('Rhum')).toHaveAttribute('data-status', 'unknown');
    // Deux parts : réalisable.
    await page.getByRole('button', { name: 'Une part de moins' }).click();
    await page.getByRole('button', { name: 'Une part de moins' }).click();
    await expect(page.getByTestId('servings')).toHaveText('2');
    await expect(page.getByTestId('recipe-status')).toHaveText('Réalisable');
    await page.getByRole('button', { name: 'Une part de plus' }).click();
    await page.getByRole('button', { name: 'Une part de plus' }).click();

    // Manquants vers la liste (arrondis à l'achat), une seule fois.
    await page.getByTestId('add-missing').click();
    await expect(page.locator('.toast').filter({ hasText: '1 ingrédient ajouté à la liste' })).toBeVisible();
    await expect(page.getByTestId('add-missing')).toHaveText(/Manquants déjà dans la liste/);
    await expect(page.getByTestId('add-missing')).toBeDisabled();
    await page.goto('/courses');
    const item = page.getByTestId('shop-item').filter({ hasText: 'Farine' });
    await expect(item).toContainText('Recette « Crêpes »');
    await expect(item.getByTestId('shop-qty')).toHaveText('0,25 kg');

    // La farine arrive : la recette est réalisable et se trouve en tête des recettes « anti-gaspi ».
    await seed(page, (op) => op('stock.add', { productId: farine, lotId: uid(), quantity: 1 }));
    await page.goto('/recettes');
    await expect(page.getByTestId('recipe-row').filter({ hasText: 'Crêpes' }).getByTestId('recipe-status')).toHaveText('Réalisable');
    await expect(page.getByTestId('recipe-row').filter({ hasText: 'Crêpes' })).toContainText('utilise Œufs');
    await page.getByTestId('recipe-row').filter({ hasText: 'Crêpes' }).click();

    // Cuisiner : confirmation détaillée, puis stock diminué.
    await page.getByTestId('cook').click();
    await expect(page.locator('.sheet')).toContainText('Farine : 250 g');
    await page.locator('.sheet button:has-text("Cuisiner")').click();
    await expect(page.locator('.toast').filter({ hasText: 'cuisiné' })).toBeVisible();
    await page.goto('/inventaire');
    await expect(qty(page, 'Œufs')).toHaveText('0 unité');
    await expect(qty(page, 'Farine')).toHaveText('0,95 kg');
    await expect(qty(page, 'Lait')).toHaveText('0,5 L');
  });

  test('modifier puis archiver une recette', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison recettes 2');
    const r = uid();
    await seed(page, (op) => {
      op('recipe.upsert', { id: r, name: 'Omelette', servings: 2, ingredients: [{ productId: null, name: 'Œufs', quantity: 3, unit: 'piece', optional: false }], instructions: 'Battre les œufs.', tags: [] }, 1);
    });
    await page.goto(`/recettes/${r}`);
    await expect(page.getByTestId('recipe-status')).toHaveText('Il manque 1 ingrédient');
    await expect(page.getByText('Battre les œufs.')).toBeVisible();
    await page.getByRole('button', { name: 'Modifier la recette' }).click();
    await page.getByLabel('Nom de la recette').fill('Omelette nature');
    await page.getByTestId('save-recipe').click();
    await expect(page.getByRole('heading', { name: 'Omelette nature' })).toBeVisible();
    await page.getByRole('button', { name: 'Archiver la recette' }).click();
    await page.locator('.sheet button:has-text("Archiver")').click();
    await expect(page).toHaveURL(/\/recettes$/);
    await expect(page.getByTestId('recipe-row')).toHaveCount(0);
  });
});
