import { expect, test, type Page } from '@playwright/test';
import { createHousehold, register, seed, uid, uniq } from './helpers';

const qty = (page: Page, name: string) => page.getByTestId('product-row').filter({ hasText: name }).getByTestId('product-qty');
const shop = (page: Page, name: string) => page.getByTestId('shop-item').filter({ hasText: name });

test.describe('Catalogue et gestes du quotidien', () => {
  test('codes multiples, nom alternatif, fusion validée, archivage puis restauration', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison catalogue');
    const lait = uid();
    const doublon = uid();
    await seed(page, (op) => {
      op('product.create', { id: lait, name: 'Lait demi-écrémé', unit: 'bouteille', initialStock: { lotId: uid(), quantity: 2 } }, 5);
      op('product.create', { id: doublon, name: 'Lait 1/2 écrémé', unit: 'bouteille', initialStock: { lotId: uid(), quantity: 3 } }, 4);
    });
    await page.goto(`/inventaire/${lait}`);
    // Deux codes-barres (bouteille seule, autre marque) pour le même produit.
    for (const code of ['3274080005003', '3560070000000']) {
      await page.getByLabel('Nouveau code-barres').fill(code);
      await page.getByLabel('Nouveau code-barres').press('Enter');
      await expect(page.getByText(code)).toBeVisible();
    }
    // Nom alternatif : retrouvable par la recherche.
    await page.getByLabel('Nouveau nom alternatif').fill('Lait UHT');
    await page.getByLabel('Nouveau nom alternatif').press('Enter');
    await expect(page.locator('.badge', { hasText: 'Lait UHT' })).toBeVisible();
    await page.goto('/inventaire');
    await page.getByLabel('Rechercher un produit').fill('uht');
    await expect(page.getByTestId('product-row')).toHaveCount(1);
    await page.getByLabel('Rechercher un produit').fill('5003');
    await expect(page.getByTestId('product-row')).toContainText('Lait demi-écrémé');

    // Fusion du doublon, après confirmation : stocks et historique regroupés.
    await page.goto(`/inventaire/${lait}`);
    await page.click('button:has-text("Fusionner un doublon")');
    await page.locator('.sheet .list-row', { hasText: 'Lait 1/2 écrémé' }).click();
    await page.click('.sheet button:has-text("Fusionner")');
    await expect(page.getByTestId('detail-qty')).toHaveText('5 bouteilles');
    await page.goto('/inventaire');
    await expect(page.getByTestId('product-row')).toHaveCount(1);
    await page.getByLabel('Rechercher un produit').fill('1/2');
    await expect(page.getByTestId('product-row')).toContainText('Lait demi-écrémé');

    // Archivage : masqué de l'inventaire, mais retrouvable et restaurable.
    await page.goto(`/inventaire/${lait}`);
    await page.click('button:has-text("Archiver")');
    await page.click('.sheet button:has-text("Archiver")');
    await page.goto('/inventaire');
    await expect(page.getByTestId('product-row')).toHaveCount(0);
    await page.getByTestId('archived-products').locator('summary').click();
    await page.getByTestId('archived-products').getByText('Lait demi-écrémé').click();
    await page.click('button:has-text("Restaurer")');
    // Attendre la confirmation (l'action est alors enregistrée sur l'appareil) avant de recharger.
    await expect(page.locator('.toast').filter({ hasText: 'Produit restauré' })).toBeVisible();
    await page.goto('/inventaire');
    await expect(qty(page, 'Lait demi-écrémé')).toHaveText('5 bouteilles');
  });

  test('terminé (avec ajout à la liste), manquant, déplacement partiel d’un lot', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison gestes');
    const cafe = uid();
    const sucre = uid();
    const riz = uid();
    await seed(page, (op, { loc }) => {
      op('product.create', { id: cafe, name: 'Café', unit: 'paquet', initialStock: { lotId: uid(), quantity: 1 } }, 5);
      op('product.create', { id: sucre, name: 'Sucre', unit: 'paquet', initialStock: { lotId: uid(), quantity: 2 } }, 5);
      op('product.create', { id: riz, name: 'Riz', unit: 'paquet', locationId: loc['Placards'], initialStock: { lotId: uid(), quantity: 4 } }, 5);
    });
    // « Terminé » : stock à zéro et article ajouté à la liste.
    await page.goto(`/inventaire/${cafe}`);
    await page.click('.action-grid .action:has-text("Terminé")');
    await page.getByTestId('action-submit').click();
    await expect(page.getByTestId('detail-qty')).toHaveText('0 paquet');
    // « Manquant » : le stock enregistré n'est pas modifié, l'article part en priorité dans la liste.
    await page.goto(`/inventaire/${sucre}`);
    await page.click('.action-grid .action:has-text("Manquant")');
    await page.getByTestId('action-submit').click();
    await expect(page.getByTestId('detail-qty')).toHaveText('2 paquets');
    await page.goto('/courses');
    await expect(shop(page, 'Café')).toBeVisible();
    await expect(shop(page, 'Sucre')).toContainText('Haute');

    // Déplacement de 1 paquet de riz vers le cellier : le lot est scindé.
    await page.goto(`/inventaire/${riz}`);
    await page.getByTestId('lot-card').locator('button:has-text("Déplacer")').click();
    await page.locator('.sheet').getByLabel('Nouvel emplacement').selectOption({ label: 'Cellier' });
    await page.locator('.sheet .qty-input input').fill('1');
    await page.getByTestId('action-submit').click();
    await expect(page.getByTestId('lot-card')).toHaveCount(2);
    await expect(page.getByTestId('lot-card').filter({ hasText: 'Cellier' })).toContainText('1 paquet');
    await expect(page.getByTestId('lot-card').filter({ hasText: 'Placards' })).toContainText('3 paquets');
    await expect(page.getByTestId('detail-qty')).toHaveText('4 paquets');
  });
});
