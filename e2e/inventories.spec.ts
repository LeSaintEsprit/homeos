import { expect, test, type Page } from '@playwright/test';
import { createHousehold, inviteCode, register, seed, uid, uniq } from './helpers';
import { barcodePng } from './barcodes';

const EAN = '3274080005003';

async function countManually(page: Page, search: string, qty: string, opts: { create?: boolean; pick?: string } = {}) {
  await page.getByTestId('add-line').click();
  await page.getByTestId('line-search').fill(search);
  if (opts.create) await page.getByTestId('line-new-product').click();
  else await page.locator('.suggest-item', { hasText: opts.pick ?? search }).first().click();
  await page.locator('.sheet input[inputmode=decimal]').first().fill(qty);
  await page.getByTestId('line-save').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
}

const stock = (page: Page, name: string) => page.getByTestId('product-row').filter({ hasText: name }).getByTestId('product-qty');

test.describe('Phase 8 — inventaires guidés, correctifs et contrôle de cohérence', () => {
  test('inventaire initial guidé par espaces, repris par un autre membre, nouveaux produits créés à la validation', async ({ page, browser }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison inventaire');
    const code = await inviteCode(page);
    await page.goto('/inventaire');
    await page.getByRole('button', { name: 'Inventaire initial guidé' }).click();
    await page.getByTestId('new-session').click();
    await page.getByTestId('start-session').click();
    await expect(page.getByTestId('session-progress')).toHaveText('0 %');
    await expect(page.getByTestId('session-location')).toHaveCount(9);

    // Réfrigérateur : deux produits encore inconnus, comptés à la main.
    await page.getByTestId('session-location').filter({ hasText: 'Réfrigérateur' }).click();
    await countManually(page, 'Beurre doux', '2', { create: true });
    await countManually(page, 'Lait demi-écrémé', '3', { create: true });
    await expect(page.getByTestId('counted-line')).toHaveCount(2);
    await page.getByTestId('location-done').click();
    await page.click('button:has-text("Tous les espaces")');
    await expect(page.getByTestId('session-location').filter({ hasText: 'Réfrigérateur' })).toContainText('Terminé');
    await expect(page.getByTestId('session-progress')).toHaveText('11 %');

    // Bob reprend l'inventaire sur son appareil et compte les placards.
    const ctx = await browser.newContext();
    const bob = await ctx.newPage();
    await register(bob, 'Bob', `${uniq('bob')}@x.fr`, code);
    await bob.goto('/inventaire/inventaires');
    await bob.getByTestId('session-row').click();
    await expect(bob.getByTestId('session-progress')).toHaveText('11 %');
    await bob.getByTestId('session-location').filter({ hasText: 'Placards' }).click();
    await countManually(bob, 'Riz basmati', '1,5', { create: true });
    await bob.getByTestId('location-done').click();
    // Nicolas voit l'avancement de Bob en direct.
    await expect(page.getByTestId('session-progress')).toHaveText('22 %');

    // Validation : les nouveaux produits doivent d'abord être créés.
    await page.getByTestId('go-review').click();
    await expect(page.getByTestId('unresolved').locator('.list-row')).toHaveCount(3);
    await expect(page.getByTestId('apply-session')).toBeDisabled();
    for (let i = 0; i < 3; i++) await page.getByTestId('create-unresolved').first().click();
    await expect(page.getByTestId('unresolved')).toHaveCount(0);
    await expect(page.getByTestId('diff-row')).toHaveCount(3);
    await page.getByTestId('apply-session').click();
    await page.click('.sheet button:has-text("Valider")');
    await expect(page.locator('.toast').filter({ hasText: 'Inventaire validé' })).toBeVisible();

    await page.goto('/inventaire');
    await expect(stock(page, 'Beurre doux')).toHaveText('2 unités');
    await expect(stock(page, 'Riz basmati')).toHaveText('1,5 unité');
    // La fiabilité du stock est « compté ».
    await page.getByTestId('product-row').filter({ hasText: 'Lait demi-écrémé' }).click();
    await expect(page.getByTestId('lot-card')).toContainText('Quantité comptée');
    await ctx.close();
  });

  test("inventaire de contrôle : attendus non comptés, absent, produit modifié après comptage laissé à l'appréciation", async ({ page, browser }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison contrôle');
    const code = await inviteCode(page);
    const lait = uid();
    const yaourt = uid();
    const confiture = uid();
    await seed(page, (op, { loc }) => {
      op('product.create', { id: lait, name: 'Lait', unit: 'bouteille', locationId: loc['Réfrigérateur'] }, 5);
      op('stock.add', { productId: lait, lotId: uid(), quantity: 4 }, 5);
      op('productCode.add', { id: uid(), productId: lait, code: EAN, packQty: 1, source: 'manual' }, 5);
      op('product.create', { id: yaourt, name: 'Yaourts', unit: 'pot', locationId: loc['Réfrigérateur'] }, 5);
      op('stock.add', { productId: yaourt, lotId: uid(), quantity: 6 }, 5);
      op('product.create', { id: confiture, name: 'Confiture', unit: 'pot', locationId: loc['Placards'] }, 5);
      op('stock.add', { productId: confiture, lotId: uid(), quantity: 2 }, 5);
    });
    await page.goto('/inventaire/inventaires');
    await page.getByTestId('new-session').click();
    await page.locator('.option-card', { hasText: 'Inventaire de contrôle' }).click();
    await page.locator('.sheet .chip', { hasText: 'Réfrigérateur' }).click();
    await page.getByTestId('start-session').click();
    await page.getByTestId('session-location').filter({ hasText: 'Réfrigérateur' }).click();
    // Seuls les produits de cet espace sont attendus.
    const expected = page.getByTestId('expected-line');
    await expect(expected).toHaveCount(2);
    await expect(page.getByTestId('expected-lines')).not.toContainText('Confiture');
    // Le lait est compté au scanner, depuis l'espace : trois scans = 3 bouteilles sur une seule ligne.
    await page.getByTestId('scan-here').click();
    await expect(page.locator('.viewfinder')).toHaveClass(/mode-inventory/);
    const png = await barcodePng(EAN, 'EAN13');
    for (let i = 1; i <= 3; i++) {
      await page.getByTestId('scan-photo').setInputFiles(png);
      await expect(page.getByTestId('scan-flash')).toContainText(`Lait : ${i} bouteille`);
    }
    await page.getByTestId('back-to-session').click();
    await expect(page.getByTestId('counted-line').filter({ hasText: 'Lait' })).toContainText('3 bouteilles');
    await expect(page.getByTestId('counted-line').filter({ hasText: 'Lait' })).toContainText('scanné');
    // « Compter » préremplit avec la quantité enregistrée.
    await expected.filter({ hasText: 'Yaourts' }).getByRole('button', { name: 'Compter' }).click();
    await expect(page.locator('.sheet .qty-input input')).toHaveValue('6');
    await page.keyboard.press('Escape');
    await expected.filter({ hasText: 'Yaourts' }).getByRole('button', { name: 'Yaourts absent' }).click();
    await expect(page.getByTestId('counted-line').filter({ hasText: 'Yaourts' })).toContainText('absent (0)');
    await expect(page.getByTestId('expected-line')).toHaveCount(0);

    // Pendant ce temps, Bob boit une bouteille de lait (après le comptage).
    const ctx = await browser.newContext();
    const bob = await ctx.newPage();
    await register(bob, 'Bob', `${uniq('bob')}@x.fr`, code);
    await bob.goto('/inventaire');
    await bob.getByRole('button', { name: /Consommer 1 bouteille de Lait/ }).click();
    await expect(bob.getByTestId('product-row').filter({ hasText: 'Lait' }).getByTestId('product-qty')).toHaveText('3 bouteilles');

    await page.click('button:has-text("Tous les espaces")');
    await page.getByTestId('go-review').click();
    const laitRow = page.getByTestId('diff-row').filter({ hasText: 'Lait' });
    // Compté 3 = enregistré 3 par coïncidence : le changement est signalé et non corrigé par défaut.
    await expect(laitRow.getByTestId('moved-since')).toContainText('Bob : −1 bouteille');
    await expect(laitRow.locator('input[type=checkbox]')).not.toBeChecked();
    const yRow = page.getByTestId('diff-row').filter({ hasText: 'Yaourts' });
    await expect(yRow).toContainText('−6 pots');
    await expect(yRow.locator('input[type=checkbox]')).toBeChecked();
    await page.getByTestId('apply-session').click();
    await page.click('.sheet button:has-text("Valider")');
    await expect(page.locator('.toast').filter({ hasText: 'Inventaire validé' })).toBeVisible();

    await page.goto('/inventaire');
    await expect(stock(page, 'Yaourts')).toHaveText('0 pot');
    await expect(stock(page, 'Lait')).toHaveText('3 bouteilles');
    await expect(stock(page, 'Confiture')).toHaveText('2 pots');
    await ctx.close();
  });

  test('contrôle de cohérence : double saisie annulée, doublon de produit proposé à la fusion', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison cohérence');
    const cafe = uid();
    const cafe2 = uid();
    await seed(page, (op) => {
      op('product.create', { id: cafe, name: 'Café moulu', unit: 'paquet' }, 3);
      op('stock.add', { productId: cafe, lotId: uid(), quantity: 5 }, 3);
      // Deux consommations identiques à une seconde d'intervalle (double scan).
      op('stock.consume', { productId: cafe, quantity: 1, source: 'scan' }, 1);
      op('stock.consume', { productId: cafe, quantity: 1, source: 'scan' }, 1 - 1 / 86400);
      op('product.create', { id: cafe2, name: 'Cafe moulu', unit: 'paquet' }, 1);
    });
    await page.goto('/inventaire');
    await expect(page.getByTestId('open-audit').locator('.count-dot')).toHaveText('1');
    await page.getByTestId('open-audit').click();
    const dup = page.getByTestId('audit-issue').filter({ hasText: 'deux mouvements identiques' });
    await expect(dup).toBeVisible();
    await dup.getByRole('button', { name: 'Annuler le doublon' }).click();
    await page.click('.sheet button:has-text("Annuler ce mouvement")');
    await expect(page.getByTestId('audit-issue').filter({ hasText: 'deux mouvements identiques' })).toHaveCount(0);
    await page.goto('/inventaire');
    await expect(stock(page, 'Café moulu')).toHaveText('4 paquets');

    await page.goto('/inventaire/controle');
    const same = page.getByTestId('audit-issue').filter({ hasText: 'pourraient être le même produit' });
    await expect(same).toBeVisible();
    await same.getByRole('link', { name: 'Comparer et fusionner' }).click();
    await expect(page.locator('.sheet')).toContainText('Doublon probable signalé par le contrôle de cohérence');
  });
});
