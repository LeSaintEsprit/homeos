import { expect, test, type Page } from '@playwright/test';
import { createHousehold, register, seed, uid, uniq } from './helpers';

async function switchTo(page: Page, name: string) {
  await page.getByTestId('household-switcher').click();
  await page.locator('.sheet .list-row', { hasText: name }).first().click();
  await expect(page.getByTestId('active-household')).toHaveText(name);
}

test('deux foyers d’un même compte : stocks, liste, prévisions, alertes et dépenses ne se mélangent jamais', async ({ page }) => {
  await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
  await createHousehold(page, 'Maison A');
  const p = uid();
  await seed(page, (op) => {
    op('product.create', { id: p, name: 'Lait de la maison A', unit: 'bouteille', minQty: 3, initialStock: { lotId: uid(), quantity: 1 } }, 2);
    op('shopping.add', { itemId: uid(), productId: null, name: 'Piles de la maison A', quantity: 1, unit: 'piece', source: 'manual' }, 1);
    op('purchase.create', { id: uid(), name: 'Achat de la maison A', quantity: 1, unit: 'piece', totalCents: 999, date: new Date().toISOString().slice(0, 10) }, 1);
  });
  await page.goto('/notifications');
  await expect(page.getByTestId('alert-row').filter({ hasText: 'Lait de la maison A' }).first()).toBeVisible();

  await page.goto('/foyers/nouveau');
  await createHousehold(page, 'Maison B');
  for (const [url, check] of [
    ['/inventaire', async () => expect(page.getByTestId('product-row')).toHaveCount(0)],
    ['/courses', async () => expect(page.getByTestId('shop-item')).toHaveCount(0)],
    ['/previsions', async () => expect(page.getByTestId('reco')).toHaveCount(0)],
    ['/notifications', async () => expect(page.getByTestId('alert-row')).toHaveCount(0)],
    ['/depenses', async () => expect(page.getByTestId('purchase-row')).toHaveCount(0)],
  ] as const) {
    await page.goto(url);
    await check();
    await expect(page.locator('body')).not.toContainText('maison A');
  }
  await expect(page.getByTestId('bell-count')).toHaveCount(0);

  // Retour dans A : tout est là.
  await switchTo(page, 'Maison A');
  await page.goto('/courses');
  await expect(page.getByTestId('shop-item').filter({ hasText: 'Piles de la maison A' })).toBeVisible();
  await page.goto('/depenses');
  await expect(page.getByTestId('purchase-row')).toHaveCount(1);
});
