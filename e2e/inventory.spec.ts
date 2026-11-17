import { expect, test, type Page } from '@playwright/test';
import { createHousehold, inviteCode, register, uniq } from './helpers';

async function createProduct(page: Page, name: string, unit: string, qty: string, expiry?: string) {
  await page.goto('/inventaire/nouveau');
  await page.getByLabel('Nom du produit').fill(name);
  await page.getByLabel('Unité de stock').selectOption(unit);
  await page.getByPlaceholder('Ex. 2 ou 0,5').fill(qty);
  if (expiry) await page.getByLabel('Date de péremption').fill(expiry);
  await page.click('button:has-text("Ajouter le produit")');
  await expect(page.getByTestId('product-name')).toHaveText(name);
}

async function act(page: Page, action: string, qty?: string) {
  await page.click(`.action-grid .action:has-text("${action}")`);
  if (qty !== undefined) await page.locator('.sheet .qty-input input').fill(qty);
  await page.getByTestId('action-submit').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test.describe('Phase 3 — inventaire et mouvements', () => {
  test('cycle de vie d\'un produit : stock initial, consommation décimale, annulation, ouverture, correction, perte, historique', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison stock');
    await createProduct(page, 'Lait demi-écrémé', 'bouteille', '2', inDays(10));
    await expect(page.getByTestId('detail-qty')).toHaveText('2 bouteilles');
    await expect(page.getByTestId('lot-card')).toHaveCount(1);
    await expect(page.getByTestId('lot-card')).toContainText('DLC');

    // Consommation décimale puis annulation depuis la notification.
    await act(page, 'Consommer', '0,5');
    await expect(page.getByTestId('detail-qty')).toHaveText('1,5 bouteille');
    await page.locator('.toast .t-action:has-text("Annuler")').click();
    await expect(page.getByTestId('detail-qty')).toHaveText('2 bouteilles');
    await expect(page.getByTestId('movement-row').filter({ hasText: 'Annulation' })).toHaveCount(1);
    await expect(page.getByTestId('movement-row').filter({ hasText: 'annulé' })).toHaveCount(1);

    // Ouverture : l'unité ouverte est isolée dans son propre lot.
    await act(page, 'Ouvrir');
    await expect(page.getByTestId('lot-card')).toHaveCount(2);
    await expect(page.getByTestId('lot-card').filter({ hasText: 'Ouvert' })).toHaveCount(1);
    await expect(page.getByTestId('detail-qty')).toHaveText('2 bouteilles');

    // Correction approximative (« il en reste environ… »).
    await page.click('.action-grid .action:has-text("Corriger")');
    await page.locator('.sheet .qty-input input').fill('1,5');
    await page.getByRole('switch', { name: 'Approximative' }).click();
    await page.locator('.sheet select').last().selectOption('unlogged');
    await page.getByTestId('action-submit').click();
    await expect(page.getByTestId('detail-qty')).toHaveText('≈ 1,5 bouteille');

    // Perte.
    await page.click('.action-grid .action:has-text("Consommer")');
    await page.keyboard.press('Escape');
    await page.getByTestId('lot-card').first().locator('button:has-text("Jeter")').click();
    await page.locator('.sheet .qty-input input').fill('0,5');
    await page.getByTestId('action-submit').click();
    await expect(page.getByTestId('detail-qty')).toHaveText('≈ 1 bouteille');

    // Historique : chaque mouvement est attribué, avec quantités avant → après.
    const rows = page.getByTestId('movement-row');
    await expect(rows.filter({ hasText: 'Jeté' })).toContainText('Nicolas');
    await expect(rows.filter({ hasText: 'Correction' })).toContainText('Consommation non enregistrée');
    await expect(rows.first()).toContainText('→');

    // Liste : quantité approximative signalée, « −1 » rapide.
    await page.goto('/inventaire');
    await expect(page.getByTestId('product-qty').first()).toHaveText('≈ 1 bouteille');
  });

  test('doublon probable signalé à la création, sans fusion automatique', async ({ page }) => {
    await register(page, 'Léa', `${uniq('l')}@x.fr`);
    await createHousehold(page, 'Maison doublons');
    await createProduct(page, 'Pâtes complètes', 'g', '500');
    await page.goto('/inventaire/nouveau');
    await page.getByLabel('Nom du produit').fill('pates completes');
    await expect(page.getByTestId('duplicate-warning')).toContainText('Pâtes complètes');
  });

  test('temps réel entre membres et lecture seule', async ({ page, browser }) => {
    await register(page, 'Admin', `${uniq('a')}@x.fr`);
    await createHousehold(page, 'Maison partagée');
    await createProduct(page, 'Café', 'paquet', '3');
    const codeMember = await inviteCode(page, 'Membre');
    const codeViewer = await inviteCode(page, 'Lecture seule');

    const c1 = await browser.newContext();
    const bob = await c1.newPage();
    await register(bob, 'Bob', `${uniq('b')}@x.fr`, codeMember);
    await bob.goto('/inventaire');
    await expect(bob.getByTestId('product-qty')).toHaveText('3 paquets');

    // Alice consomme depuis la liste (−1 rapide) : Bob le voit sans recharger.
    await page.goto('/inventaire');
    await page.getByRole('button', { name: /Consommer 1 paquet de Café/ }).click();
    await expect(page.getByTestId('product-qty')).toHaveText('2 paquets');
    await expect(bob.getByTestId('product-qty')).toHaveText('2 paquets');

    const c2 = await browser.newContext();
    const gp = await c2.newPage();
    await register(gp, 'Grand-père', `${uniq('g')}@x.fr`, codeViewer);
    await gp.goto('/inventaire');
    await expect(gp.getByTestId('product-qty')).toHaveText('2 paquets');
    await expect(gp.getByRole('button', { name: /Consommer/ })).toHaveCount(0);
    await expect(gp.getByRole('button', { name: 'Ajouter' })).toHaveCount(0);
    await gp.getByTestId('product-row').click();
    await expect(gp.locator('.action-grid')).toHaveCount(0);
    await c1.close();
    await c2.close();
  });

  test('catalogue : nouvel emplacement disponible pour les produits', async ({ page }) => {
    await register(page, 'Zoé', `${uniq('z')}@x.fr`);
    await createHousehold(page, 'Maison catalogue');
    await page.goto('/parametres');
    await page.locator('#catalogue').getByRole('button', { name: 'Emplacements' }).click();
    await page.locator('#catalogue').getByRole('button', { name: 'Emplacement', exact: true }).click();
    await page.locator('.sheet').getByLabel('Nom').fill('Garde-manger');
    await page.locator('.sheet button:has-text("Enregistrer")').click();
    await expect(page.locator('#catalogue')).toContainText('Garde-manger');
    await page.goto('/inventaire/nouveau');
    await expect(page.getByLabel('Emplacement habituel').locator('option', { hasText: 'Garde-manger' })).toHaveCount(1);
  });
});
