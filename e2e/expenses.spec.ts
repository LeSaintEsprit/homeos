import { expect, test } from '@playwright/test';
import { ago, createHousehold, register, seed, uid, uniq } from './helpers';

const day = (n: number) => ago(n).slice(0, 10);
const nbsp = (s: string) => s.replace(/ /g, ' ');

test.describe('Phase 9 — dépenses et budget', () => {
  test('budget du mois, un seul filtre de période qui pilote graphiques et listes, vue tableau', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison budget');
    const s1 = uid();
    const s2 = uid();
    await seed(page, (op, { cat }) => {
      op('store.upsert', { id: s1, name: 'Primeur' }, 0);
      op('store.upsert', { id: s2, name: 'Supérette' }, 0);
      op('household.update', { patch: { settings: { monthlyBudgetCents: 2500 } }, baseVersion: 0 }, 0);
      // Ce mois-ci (aujourd'hui) : 12 € + 8 € avec prix, et un achat sans prix.
      op('purchase.create', { id: uid(), name: 'Riz', quantity: 2, unit: 'paquet', totalCents: 1200, storeId: s2, categoryId: cat['Épicerie'], date: day(0) }, 0);
      op('purchase.create', { id: uid(), name: 'Tomates', quantity: 1, unit: 'kg', totalCents: 800, storeId: s1, categoryId: cat['Alimentation'], date: day(0) }, 0);
      op('purchase.create', { id: uid(), name: 'Fleurs', quantity: 1, unit: 'piece', totalCents: null, storeId: s1, date: day(0) }, 0);
      // Il y a environ deux mois : 30 €.
      op('purchase.create', { id: uid(), name: 'Café', quantity: 3, unit: 'paquet', totalCents: 3000, storeId: s2, categoryId: cat['Épicerie'], date: day(45) }, 45);
    });
    await page.goto('/courses');
    await page.getByTestId('open-expenses').click();
    await expect(page.getByTestId('month-spent')).toHaveText(nbsp('20,00 €'));
    await expect(page.getByTestId('budget')).toContainText('1 achat sans prix ce mois-ci, non comptés');
    await expect(page.getByTestId('period-total')).toHaveText(nbsp('20,00 € · 1 sans prix'));
    if (new Date().getDate() >= 5) {
      // Projection au rythme réel au-delà du budget de 25 € : signalée.
      await expect(page.getByTestId('unusual')).toContainText('Au rythme actuel');
    }
    const cats = page.getByTestId('by-category').getByTestId('ranked-row');
    await expect(cats.first()).toContainText('Épicerie');
    await expect(cats.first()).toContainText(nbsp('12,00 €'));
    await expect(page.getByTestId('by-store').getByTestId('ranked-row')).toHaveCount(2);
    // Vue tableau équivalente.
    await page.getByTestId('by-store').getByRole('button', { name: 'Afficher le tableau' }).click();
    await expect(page.getByTestId('by-store').locator('table')).toContainText('Supérette');
    await expect(page.getByTestId('by-store').locator('table')).toContainText('60 %');
    // Info-bulle au clavier sur une colonne.
    await page.getByTestId('spend-chart').getByTestId('viz-col').last().focus();
    await expect(page.locator('.viz-tip')).toContainText(nbsp('20,00 €'));
    await expect(page.locator('.viz-tip')).toContainText('1 achat sans prix');

    // 12 mois : tout se recalcule sur la même période.
    await page.click('.filter-row .segmented button:has-text("12 mois")');
    await expect(page.getByTestId('period-total')).toHaveText(nbsp('50,00 € · 1 sans prix'));
    await expect(page.getByTestId('spend-chart').getByTestId('viz-col')).toHaveCount(12);
    await expect(page.getByTestId('by-category').getByTestId('ranked-row').first()).toContainText(nbsp('42,00 €'));
    await expect(page.getByTestId('purchase-row')).toHaveCount(4);
  });

  test("saisie, correction et suppression d'un achat ; un achat sans prix reste « prix inconnu »", async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison achats');
    await page.goto('/depenses');
    await page.getByTestId('add-purchase').click();
    await page.locator('.sheet').getByLabel('Libellé').fill('Piles AA');
    await page.getByTestId('purchase-save').click();
    const row = page.getByTestId('purchase-row').filter({ hasText: 'Piles AA' });
    await expect(row).toContainText('prix inconnu');
    await expect(page.getByTestId('period-total')).toHaveText(nbsp('0,00 € · 1 sans prix'));
    // Le prix retrouvé plus tard est ajouté.
    await row.click();
    await page.getByTestId('purchase-price').fill('6,49');
    await page.getByTestId('purchase-save').click();
    await expect(row).toContainText(nbsp('6,49 €'));
    await expect(page.getByTestId('month-spent')).toHaveText(nbsp('6,49 €'));
    // Suppression confirmée.
    await row.click();
    await page.click('.sheet button:has-text("Supprimer")');
    await page.locator('.sheet').last().locator('button:has-text("Supprimer")').click();
    await expect(page.getByTestId('purchase-row')).toHaveCount(0);
    await expect(page.getByTestId('month-spent')).toHaveText(nbsp('0,00 €'));
  });

  test('évolution du prix d’un produit et comparaison entre magasins', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison prix');
    const cafe = uid();
    const a = uid();
    const b = uid();
    await seed(page, (op) => {
      op('store.upsert', { id: a, name: 'Hyper' }, 0);
      op('store.upsert', { id: b, name: 'Épicerie fine' }, 0);
      op('product.create', { id: cafe, name: 'Café moulu', unit: 'paquet' }, 50);
      op('purchase.create', { id: uid(), name: 'Café moulu', productId: cafe, quantity: 2, unit: 'paquet', totalCents: 700, storeId: a, date: day(40) }, 40);
      op('purchase.create', { id: uid(), name: 'Café moulu', productId: cafe, quantity: 1, unit: 'paquet', totalCents: 520, storeId: b, date: day(20) }, 20);
      op('purchase.create', { id: uid(), name: 'Café moulu', productId: cafe, quantity: 2, unit: 'paquet', totalCents: 780, storeId: a, date: day(2) }, 2);
    });
    await page.goto('/depenses');
    const chart = page.getByTestId('price-chart');
    await expect(chart).toContainText("d'après 3 achats enregistrés");
    await expect(chart).toContainText(nbsp('3,90 € / paquet'));
    const stores = chart.getByTestId('store-prices');
    await expect(stores.locator('tr').nth(1)).toContainText('Hyper');
    await expect(stores.locator('tr').nth(1)).toContainText('le moins cher');
    await expect(stores.locator('tr').nth(1)).toContainText(nbsp('3,70 €'));
    await expect(stores.locator('tr').nth(2)).toContainText(nbsp('5,20 €'));
    // Navigation au clavier dans la courbe.
    await chart.locator('.viz svg').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.viz-tip')).toContainText(nbsp('3,50 € / paquet'));
    await expect(page.locator('.viz-tip')).toContainText('Hyper');
  });
});
