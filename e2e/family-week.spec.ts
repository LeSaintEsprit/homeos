import { expect, test, type Page } from '@playwright/test';
import { createHousehold, inviteCode, register, uniq } from './helpers';

const today = new Date().toISOString().slice(0, 10);
const nbsp = (s: string) => s.replace(/ /g, ' ');
const qty = (page: Page, name: string) => page.getByTestId('product-row').filter({ hasText: name }).getByTestId('product-qty');

async function countManually(page: Page, name: string, n: string, expiry?: string) {
  await page.getByTestId('add-line').click();
  await page.getByTestId('line-search').fill(name);
  await page.getByTestId('line-new-product').click();
  await page.locator('.sheet input[inputmode=decimal]').first().fill(n);
  if (expiry) await page.locator('.sheet input[type=date]').fill(expiry);
  await page.getByTestId('line-save').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
}

/**
 * Une semaine de la famille Martin, entièrement par l'interface, sur deux appareils :
 * inventaire de départ, liste partagée, consommations simultanées dont une hors ligne,
 * courses et réception avec prix, péremption, dépenses, cohérence finale.
 */
test('semaine familiale complète : deux membres, deux appareils, une coupure réseau', async ({ page, browser, context }) => {
  test.setTimeout(180_000);
  // Jour 1 — Nicolas crée le foyer et invite Maman (rôle Membre).
  await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
  await createHousehold(page, 'Famille Martin');
  const code = await inviteCode(page, 'Membre');
  const mctx = await browser.newContext();
  const maman = await mctx.newPage();
  await register(maman, 'Maman', `${uniq('m')}@x.fr`, code);
  await expect(maman.getByTestId('active-household')).toHaveText('Famille Martin');

  // Inventaire initial du réfrigérateur.
  await page.goto('/inventaire/inventaires');
  await page.getByTestId('new-session').click();
  await page.getByTestId('start-session').click();
  await page.getByTestId('session-location').filter({ hasText: 'Réfrigérateur' }).click();
  await countManually(page, 'Lait', '2');
  await countManually(page, 'Yaourts', '6', today);
  await page.getByTestId('location-done').click();
  await page.click('button:has-text("Tous les espaces")');
  await page.getByTestId('go-review').click();
  await page.getByTestId('create-unresolved').first().click();
  await page.getByTestId('create-unresolved').first().click();
  await page.getByTestId('apply-session').click();
  await page.click('.sheet button:has-text("Valider")');
  await expect(page.locator('.toast').filter({ hasText: 'Inventaire validé' })).toBeVisible();
  await maman.goto('/inventaire');
  await expect(qty(maman, 'Lait')).toHaveText('2 unités');
  await expect(qty(maman, 'Yaourts')).toHaveText('6 unités');

  // Jour 2 — Maman ajoute du pain à la liste ; Nicolas le voit sans recharger.
  await page.goto('/courses');
  await maman.goto('/courses');
  await maman.getByTestId('add-item').fill('Pain');
  await maman.getByTestId('add-submit').click();
  await expect(page.getByTestId('shop-item').filter({ hasText: 'Pain' })).toBeVisible();

  // Jour 3 — petit-déjeuner : chacun boit un lait, Nicolas sans réseau.
  await page.goto('/inventaire');
  await maman.goto('/inventaire');
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: /Consommer 1 unité de Lait/ }).click();
  await expect(qty(page, 'Lait')).toHaveText('1 unité');
  await expect(page.getByTestId('sync-pill').first()).toHaveAttribute('data-status', 'offline');
  await maman.getByRole('button', { name: /Consommer 1 unité de Lait/ }).click();
  await expect(qty(maman, 'Lait')).toHaveText('1 unité');
  // Retour du réseau : les deux consommations s'additionnent, rien n'est perdu.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('sync-pill').first()).toHaveAttribute('data-status', 'synced', { timeout: 15000 });
  await expect(qty(page, 'Lait')).toHaveText('0 unité');
  await expect(qty(maman, 'Lait')).toHaveText('0 unité');

  // Jour 4 — l'accueil de Maman propose le lait ; elle fait les courses.
  await maman.goto('/');
  const plan = maman.getByTestId('widget-prevoir');
  await expect(plan).toContainText('lait : le stock est épuisé');
  await plan.getByRole('button', { name: 'Ajouter Lait à la liste' }).click();
  await maman.goto('/courses');
  await expect(maman.getByTestId('shop-item')).toHaveCount(2);
  await maman.getByTestId('start-shopping').click();
  for (const name of ['Lait', 'Pain']) await maman.getByTestId('mode-item').filter({ hasText: name }).locator('.mode-hit').click();
  await expect(maman.getByTestId('mode-progress')).toHaveText('2/2');
  await maman.getByTestId('finish-shopping').click();
  const card = (name: string) => maman.getByTestId('receive-card').filter({ has: maman.locator('.strong', { hasText: new RegExp(`^${name}$`) }) });
  const lait = card('Lait');
  await lait.locator('input[inputmode=decimal]').last().fill('2,14');
  await lait.getByTestId('receive-btn').click();
  const pain = card('Pain');
  await pain.locator('input[inputmode=decimal]').last().fill('1,20');
  await pain.getByTestId('receive-btn').click();
  await expect(maman.getByTestId('receive-card')).toHaveCount(0);
  // Nicolas voit le stock et les dépenses à jour.
  await page.goto('/inventaire');
  await expect(qty(page, 'Lait')).toHaveText('1 unité');
  await expect(qty(page, 'Pain')).toHaveText('1 unité');
  await page.goto('/depenses');
  await expect(page.getByTestId('month-spent')).toHaveText(nbsp('3,34 €'));
  await expect(page.getByTestId('purchase-row')).toHaveCount(2);

  // Jour 5 — les yaourts arrivent à date : alerte, puis consommés depuis la vue Péremption.
  await page.goto('/notifications');
  await expect(page.getByTestId('alert-row').filter({ hasText: "Yaourts : périme aujourd'hui" })).toBeVisible();
  await page.goto('/previsions?vue=peremption');
  await page.getByTestId('expiry-today').getByRole('button', { name: 'Consommer' }).click();
  await page.locator('.sheet .qty-input input').fill('6');
  await page.getByTestId('action-submit').click();
  await expect(page.getByTestId('expiry-today')).toHaveCount(0);
  await maman.goto('/inventaire');
  await expect(qty(maman, 'Yaourts')).toHaveText('0 unité');

  // Fin de semaine — tout est cohérent et chaque action est attribuée.
  await page.goto('/parametres#donnees');
  await page.getByTestId('integrity-check').click();
  await expect(page.getByTestId('integrity-result')).toContainText('Aucune anomalie');
  await page.goto('/notifications?vue=activite');
  const feed = page.getByTestId('activity-feed');
  await expect(feed).toContainText('Maman');
  await expect(feed).toContainText('Nicolas');
  await expect(feed).toContainText("a validé l'inventaire");
  await mctx.close();
});
