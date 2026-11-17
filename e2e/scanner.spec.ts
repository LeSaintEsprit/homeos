import { expect, test, type Page } from '@playwright/test';
import { createHousehold, register, uniq } from './helpers';
import { barcodePng } from './barcodes';

const EAN = '3274080005003';
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function scanPhoto(page: Page, file: string) {
  await page.getByTestId('scan-photo').setInputFiles(file);
}
async function scanManual(page: Page, code: string) {
  await page.click('button:has-text("Saisir un code")');
  await page.locator('.sheet input').fill(code);
  await page.locator('.sheet button:has-text("Valider")').click();
}
async function stockOf(page: Page, name: string) {
  await page.goto('/inventaire');
  return page.getByTestId('product-row').filter({ hasText: name }).getByTestId('product-qty');
}

test.describe('Phase 4 — scanner', () => {
  test('réception, consommation, annulation et inventaire par scan', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('s')}@x.fr`);
    await createHousehold(page, 'Maison scanner');
    await page.goto('/scanner');

    // 1. Code inconnu photographié → création rapide → +1 immédiatement.
    await scanPhoto(page, await barcodePng(EAN, 'EAN13'));
    await expect(page.locator('.sheet')).toContainText('Nouveau code-barres');
    await expect(page.locator('.sheet')).toContainText(EAN);
    await page.locator('.sheet').getByLabel('Nom').fill('Eau pétillante');
    await page.locator('.sheet').getByLabel('Compté en').selectOption('bouteille');
    await page.locator('.sheet').getByLabel('Emplacement').selectOption({ label: 'Cuisine' });
    await page.click('.sheet button:has-text("Créer et continuer")');
    await expect(page.getByTestId('scan-flash')).toContainText('+1 bouteille Eau pétillante');

    // 2. Même code (saisie) : reconnu, ajouté au même lot.
    await scanManual(page, EAN);
    await expect(page.getByTestId('scan-feed').locator('.scan-item')).toHaveCount(2);

    // 3. GS1 DataMatrix : date et numéro de lot lus dans le code → nouveau lot.
    const exp = inDays(40);
    const yymmdd = exp.slice(2).replace(/-/g, '');
    await scanPhoto(page, await barcodePng(`(01)0${EAN}(17)${yymmdd}(10)L42`, 'DataMatrix', 'gs1'));
    await expect(page.getByTestId('scan-flash')).toContainText('Lot L42');
    await expect(page.getByTestId('scan-flash')).toContainText('Date limite');

    // 4. Consommation (−1) puis annulation depuis la liste des scans.
    await page.getByRole('button', { name: 'Consommation' }).click();
    await scanManual(page, EAN);
    await expect(page.getByTestId('scan-flash')).toContainText('−1 bouteille Eau pétillante');
    await page.getByRole('button', { name: 'Annuler −1 bouteille Eau pétillante' }).click();
    await expect(page.getByTestId('scan-feed').locator('.scan-item.undone')).toHaveCount(1);

    await expect(await stockOf(page, 'Eau pétillante')).toHaveText('3 bouteilles');
    await page.getByTestId('product-row').filter({ hasText: 'Eau pétillante' }).click();
    await expect(page.getByTestId('lot-card')).toHaveCount(2);
    await expect(page.getByTestId('lot-card').filter({ hasText: 'lue dans le code' })).toContainText('lot L42');
    await expect(page.getByTestId('movement-row').filter({ hasText: 'scan' }).first()).toBeVisible();

    // 5. Inventaire : comptage par scan, écart présenté, correction après validation seulement.
    await page.goto('/scanner');
    await page.getByRole('button', { name: 'Inventaire' }).click();
    await page.getByLabel('Emplacement inventorié').selectOption({ label: 'Cuisine' });
    await scanManual(page, EAN);
    await scanManual(page, EAN);
    await page.click('button:has-text("Vérifier les écarts")');
    await expect(page.getByTestId('inventory-delta')).toHaveText('−1 bouteille');
    await page.getByTestId('apply-inventory').click();
    await expect(page.locator('.toast')).toContainText('Inventaire validé');
    await expect(await stockOf(page, 'Eau pétillante')).toHaveText('2 bouteilles');
  });

  test('une seule question pour la date quand le code n\'en contient pas (produit frais)', async ({ page }) => {
    await register(page, 'Léa', `${uniq('d')}@x.fr`);
    await createHousehold(page, 'Maison dates');
    await page.goto('/scanner');
    await scanManual(page, '3017620422003');
    await page.locator('.sheet').getByLabel('Nom').fill('Yaourt nature');
    await page.locator('.sheet').getByLabel('Catégorie').selectOption({ label: 'Produits frais' });
    await page.click('.sheet button:has-text("Créer et continuer")');
    await expect(page.locator('.sheet')).toContainText('Date de « Yaourt nature » ?');
    await page.locator('.sheet input[type=date]').fill(inDays(12));
    await page.click('.sheet button:has-text("Enregistrer")');
    await expect(page.getByTestId('scan-flash')).toContainText('+1 unité Yaourt nature');
    // « Date inconnue » : aucune date inventée.
    await scanManual(page, '3017620422003');
    await page.click('.sheet button:has-text("Date inconnue")');
    await expect(page.getByTestId('scan-feed').locator('.scan-item')).toHaveCount(2);
    await page.goto('/inventaire');
    await page.getByTestId('product-row').filter({ hasText: 'Yaourt' }).click();
    await expect(page.getByTestId('lot-card')).toHaveCount(2);
    await expect(page.getByTestId('lot-card').filter({ hasText: 'Date inconnue' })).toHaveCount(1);
    await expect(page.getByTestId('lot-card').filter({ hasText: 'date saisie' })).toHaveCount(1);
  });
});
