import { expect, test, type Page } from '@playwright/test';
import { createHousehold, inviteCode, register, uniq } from './helpers';

async function addItem(page: Page, name: string, qty?: string, unit?: string) {
  await page.getByTestId('add-item').fill(name);
  if (qty) await page.getByTestId('add-qty').fill(qty);
  if (unit) await page.locator('.add-bar select').selectOption(unit);
  await page.getByTestId('add-submit').click();
  await expect(page.getByTestId('add-item')).toHaveValue('');
}

const row = (page: Page, name: string) => page.getByTestId('shop-item').filter({ hasText: name });
const modeRow = (page: Page, name: string) => page.getByTestId('mode-item').filter({ hasText: name });

test.describe('Phase 5 — liste de courses, mode courses, réception, magasins', () => {
  test('liste partagée en temps réel : fusion des doublons et « pris par » un autre membre', async ({ page, browser }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison courses');
    const code = await inviteCode(page);
    const ctx = await browser.newContext();
    const bob = await ctx.newPage();
    await register(bob, 'Bob', `${uniq('bob')}@x.fr`, code);
    await expect(bob.getByTestId('active-household')).toHaveText('Maison courses');

    await page.goto('/courses');
    await bob.goto('/courses');
    await addItem(page, 'Lait', '2');
    // Bob voit l'article apparaître sans recharger.
    await expect(row(bob, 'Lait')).toBeVisible();
    await expect(row(bob, 'Lait').getByTestId('shop-qty')).toHaveText('2 unités');

    // Bob ajoute « lait » : pas de doublon, les quantités sont additionnées et la provenance conservée.
    await addItem(bob, 'lait', '1');
    await expect(bob.locator('.toast').filter({ hasText: 'était déjà dans la liste (ajouté par Nicolas)' })).toBeVisible();
    await expect(row(bob, 'Lait')).toHaveCount(1);
    await expect(row(bob, 'Lait').getByTestId('shop-qty')).toHaveText('3 unités');
    await expect(row(page, 'Lait').getByTestId('shop-qty')).toHaveText('3 unités');
    await expect(row(page, 'Lait')).toContainText('2 demandes');
    // Nicolas confie le lait à Bob : Bob le voit en direct.
    await row(page, 'Lait').locator('.meta').click();
    await page.locator('.sheet').getByLabel('Confié à').selectOption({ label: 'Bob' });
    await page.keyboard.press('Escape');
    await expect(row(bob, 'Lait').getByTestId('assignee')).toHaveAttribute('aria-label', 'Confié à Bob');

    // Les deux font les courses ; Bob prend le lait, Nicolas le voit immédiatement.
    await addItem(page, 'Café');
    await page.getByTestId('start-shopping').click();
    await bob.getByTestId('start-shopping').click();
    await expect(page.getByTestId('mode-progress')).toHaveText('0/2');
    await modeRow(bob, 'Lait').locator('.mode-hit').click();
    await expect(modeRow(bob, 'Lait')).toHaveClass(/done/);
    await expect(modeRow(page, 'Lait')).toHaveClass(/done/);
    await expect(modeRow(page, 'Lait').getByTestId('checked-by')).toHaveText('Pris par Bob');
    await expect(page.getByTestId('mode-progress')).toHaveText('1/2');
    await ctx.close();
  });

  test('achat partiel, prix facultatif et réception : le stock reçoit la quantité réelle, le reliquat reste dans la liste', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison réception');
    await page.goto('/courses');
    await addItem(page, 'Riz basmati', '3', 'paquet');
    await expect(row(page, 'Riz basmati').getByTestId('shop-qty')).toHaveText('3 paquets');

    // En magasin : seulement 2 paquets trouvés, prix noté.
    await page.getByTestId('start-shopping').click();
    await modeRow(page, 'Riz basmati').getByRole('button', { name: /Quantité ou prix/ }).click();
    await page.locator('.sheet .qty-input input').fill('2');
    await expect(page.locator('.sheet .alert')).toContainText('il restera 1 paquet');
    await page.locator('.sheet input[inputmode=decimal]').last().fill('4,30');
    await page.getByTestId('instore-save').click();
    await expect(modeRow(page, 'Riz basmati')).toHaveClass(/partial/);
    await expect(modeRow(page, 'Riz basmati')).toContainText('2 paquets pris');
    await page.getByTestId('finish-shopping').click();

    // Réception : le produit n'existe pas encore, il est créé dans l'inventaire.
    await expect(page).toHaveURL(/tab=reception/);
    const card = page.getByTestId('receive-card').filter({ hasText: 'Riz basmati' });
    await expect(card.locator('select').first()).toHaveValue('create');
    await expect(card.locator('input[inputmode=decimal]').last()).toHaveValue('4,30');
    await card.getByTestId('receive-btn').click();
    await expect(page.locator('.toast').filter({ hasText: 'Il reste 1 paquet' })).toBeVisible();
    await expect(page.getByTestId('receive-card')).toHaveCount(0);

    // Le reliquat est toujours à acheter.
    await page.goto('/courses');
    await expect(row(page, 'Riz basmati').getByTestId('shop-qty')).toHaveText('1 paquet');
    await expect(row(page, 'Riz basmati').locator('.check')).toHaveAttribute('aria-checked', 'false');
    // Le prix payé est conservé dans l'historique (prix connu).
    await page.click('.segmented button:has-text("Historique")');
    await expect(page.getByTestId('history-item').filter({ hasText: 'Riz basmati' })).toContainText('4,30');
    await page.click('.segmented button:has-text("Liste")');
    // Avertissement anti-doublon : le produit est déjà dans la liste.
    await page.getByTestId('add-item').fill('riz');
    await page.locator('.suggest-item:has-text("Riz basmati")').click();
    await expect(page.getByTestId('add-check')).toContainText('Déjà 1 paquet dans la liste');
    await page.getByTestId('add-item').fill('');

    // Le stock contient exactement la quantité reçue, avec le prix payé.
    await page.goto('/inventaire');
    await page.getByText('Riz basmati').first().click();
    await expect(page.getByTestId('detail-qty')).toHaveText('2 paquets');
    await expect(page.getByTestId('movement-row').first()).toContainText('2 paquets');
  });

  test('réception avec écart (moins que coché) et article retiré puis remis depuis l\'historique', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison écarts');
    await page.goto('/courses');
    await addItem(page, 'Yaourts', '8', 'pot');
    await addItem(page, 'Fleurs');
    await row(page, 'Yaourts').locator('.check').click();
    await expect(row(page, 'Yaourts').locator('.check')).toHaveAttribute('aria-checked', 'true');

    await page.goto('/courses?tab=reception');
    const card = page.getByTestId('receive-card').filter({ hasText: 'Yaourts' });
    await card.locator('.qty-input input').fill('6');
    await expect(card.getByTestId('receive-diff')).toContainText('2 pots de moins');
    await card.getByTestId('receive-btn').click();
    await expect(page.getByTestId('receive-card')).toHaveCount(0);
    await page.goto('/courses');
    await expect(row(page, 'Yaourts').getByTestId('shop-qty')).toHaveText('2 pots');

    // Retirer un article : il reste consultable et restaurable dans l'historique.
    await row(page, 'Fleurs').locator('.meta').click();
    await page.click('.sheet button:has-text("Retirer")');
    await expect(row(page, 'Fleurs')).toHaveCount(0);
    await page.click('.segmented button:has-text("Historique")');
    const h = page.getByTestId('history-item').filter({ hasText: 'Fleurs' });
    await expect(h).toContainText('Retiré de la liste');
    await expect(page.getByTestId('history-item').filter({ hasText: 'Yaourts' })).toContainText('Acheté et rangé · 6 pots');
    await h.locator('button:has-text("Remettre")').click();
    await page.click('.segmented button:has-text("Liste")');
    await expect(row(page, 'Fleurs')).toBeVisible();
  });

  test('magasins : répartition de la liste et ordre des rayons suivi en mode courses', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison magasins');
    await page.goto('/courses/magasins');
    await page.click('button:has-text("Ajouter un magasin")');
    await page.getByLabel('Nom').fill('Primeur');
    await page.getByLabel('Adresse').fill('3 rue des Halles');
    await page.click('.sheet button:has-text("Enregistrer")');
    await expect(page.getByRole('heading', { name: 'Primeur' })).toBeVisible();
    await expect(page.getByText('3 rue des Halles')).toBeVisible();

    // « Hygiène » placé en tête du parcours de ce magasin.
    const order = page.getByTestId('aisle-order');
    for (let i = 0; i < 5; i++) await order.getByRole('button', { name: 'Monter Hygiène' }).click();
    await expect(order.locator('.list-row').first()).toContainText('Hygiène');
    const primeurUrl = page.url();

    await page.goto('/courses');
    await addItem(page, 'Savon');
    await addItem(page, 'Tomates');
    await addItem(page, 'Piles');
    // Rayon et magasin de chaque article.
    for (const [name, rayon] of [['Savon', 'Hygiène'], ['Tomates', 'Alimentation']] as const) {
      await row(page, name).locator('.meta').click();
      await page.locator('.sheet').getByLabel('Rayon').selectOption({ label: rayon });
      await page.locator('.sheet').getByLabel('Magasin').selectOption({ label: 'Primeur' });
      await page.keyboard.press('Escape');
    }
    // Priorité et commentaire.
    await row(page, 'Tomates').locator('.meta').click();
    await page.locator('.sheet .segmented button:has-text("Urgente")').click();
    await page.locator('.sheet').getByLabel('Commentaire').fill('Bien mûres');
    await page.click('.sheet button:has-text("Enregistrer")');
    await expect(row(page, 'Tomates')).toContainText('Urgente');
    await expect(row(page, 'Tomates')).toContainText('Bien mûres');
    await page.goto('/courses/magasins');
    await page.click('[data-testid=store-row]:has-text("Primeur")');
    await expect(page).toHaveURL(primeurUrl);
    await page.click('button:has-text("Faire les courses ici")');
    await expect(page.locator('.store-pick')).toHaveValue(/.+/);
    // Hygiène d'abord (ordre du magasin), Alimentation ensuite, puis les articles sans rayon.
    const titles = await page.locator('.shop-mode .section-title').allTextContents();
    expect(titles).toEqual(['Hygiène', 'Alimentation', 'Autres articles']);
    await modeRow(page, 'Tomates').locator('.mode-hit').click();
    await expect(page.getByTestId('mode-progress')).toHaveText('1/3');
    // Réception : le magasin est repris, l'achat alimente l'historique du magasin.
    await page.getByTestId('finish-shopping').click();
    const card = page.getByTestId('receive-card').filter({ hasText: 'Tomates' });
    await card.locator('input[inputmode=decimal]').last().fill('2,40');
    await card.getByTestId('receive-btn').click();
    await expect(page.getByTestId('receive-card')).toHaveCount(0);
    await page.goto(primeurUrl);
    await expect(page.locator('.stat').filter({ hasText: 'Passages' })).toContainText('1');
    await expect(page.locator('.stat').filter({ hasText: 'Dépensé' })).toContainText('2,40');
    await expect(page.locator('.list-row').filter({ hasText: 'Tomates' })).toContainText('2,40');
  });

  test('recommandations du moteur : ajout explicite à la liste, jamais automatique', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison prévisions');
    await page.goto('/inventaire/nouveau');
    await page.getByLabel('Nom du produit').fill('Café moulu');
    await page.getByLabel('Unité de stock').selectOption('paquet');
    await page.getByPlaceholder('Ex. 2 ou 0,5').fill('1');
    await page.getByLabel('Seuil minimal').fill('2');
    await page.click('button:has-text("Ajouter le produit")');
    await expect(page.getByTestId('product-name')).toHaveText('Café moulu');

    await page.goto('/courses');
    // Rien n'est ajouté sans action : la recommandation est proposée avec son explication.
    await expect(page.getByTestId('shop-item')).toHaveCount(0);
    const reco = page.locator('.reco-line').filter({ hasText: 'Café moulu' });
    await expect(reco).toContainText('seuil');
    await reco.getByRole('button', { name: 'Ajouter Café moulu' }).click();
    await expect(row(page, 'Café moulu')).toBeVisible();
    // Une fois dans la liste, la recommandation disparaît (quantité déjà prévue).
    await expect(page.locator('.reco-line').filter({ hasText: 'Café moulu' })).toHaveCount(0);
    // La fiche produit indique la quantité prévue dans la liste.
    await page.goto('/inventaire');
    await page.getByText('Café moulu').first().click();
    await expect(page.getByTestId('on-list')).toContainText('Dans la liste de courses');
    await expect(page.getByTestId('add-to-list')).toHaveCount(0);
    // Ajout direct depuis la fiche d'un produit en stock.
    await page.goto('/inventaire/nouveau');
    await page.getByLabel('Nom du produit').fill('Sucre');
    await page.getByLabel('Unité de stock').selectOption('paquet');
    await page.getByPlaceholder('Ex. 2 ou 0,5').fill('3');
    await page.click('button:has-text("Ajouter le produit")');
    await page.getByTestId('add-to-list').click();
    await expect(page.getByTestId('on-list')).toContainText('1 paquet');
    await page.goto('/courses');
    await expect(row(page, 'Sucre').getByTestId('shop-qty')).toHaveText('1 paquet');
  });

  test("une modification d'un autre membre n'efface pas la saisie en cours, et un vrai conflit est signalé", async ({ page, browser }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison saisie');
    const code = await inviteCode(page);
    const ctx = await browser.newContext();
    const bob = await ctx.newPage();
    await register(bob, 'Bob', `${uniq('bob')}@x.fr`, code);
    await page.goto('/courses');
    await addItem(page, 'Farine', '1', 'kg');
    await bob.goto('/courses');
    await expect(row(bob, 'Farine')).toBeVisible();

    // Nicolas commence à modifier l'article…
    await row(page, 'Farine').locator('.meta').click();
    await page.locator('.sheet').getByLabel('Commentaire').fill('Type 55');
    await page.locator('.sheet .qty-input input').fill('2');
    // … pendant que Bob change la quantité.
    await row(bob, 'Farine').locator('.meta').click();
    await bob.locator('.sheet .qty-input input').fill('3');
    await bob.click('.sheet button:has-text("Enregistrer")');
    await expect(row(page, 'Farine').getByTestId('shop-qty')).toHaveText('3 kg');
    // La saisie de Nicolas est intacte.
    await expect(page.locator('.sheet').getByLabel('Commentaire')).toHaveValue('Type 55');
    await expect(page.locator('.sheet .qty-input input')).toHaveValue('2');
    await page.click('.sheet button:has-text("Enregistrer")');
    // Le commentaire (non modifié par Bob) est appliqué ; la quantité, modifiée entre-temps, est signalée et non écrasée.
    await expect(page.locator('.toast').filter({ hasText: 'modifié entre-temps par un autre membre' })).toBeVisible();
    await expect(row(page, 'Farine')).toContainText('Type 55');
    await expect(row(page, 'Farine').getByTestId('shop-qty')).toHaveText('3 kg');
    await expect(row(bob, 'Farine')).toContainText('Type 55');
    await ctx.close();
  });
});
