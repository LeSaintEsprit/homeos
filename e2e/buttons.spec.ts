import { expect, test, type Page } from '@playwright/test';
import { createHousehold, inDays, register, seed, uid, uniq } from './helpers';

/**
 * « Chaque bouton fonctionne » : sur chaque écran, chaque bouton visible est actionné
 * (sur une page fraîchement rechargée), puis chaque bouton de la fenêtre qu'il ouvre.
 * Échec si une erreur JavaScript survient, si l'écran d'erreur s'affiche ou si un texte technique apparaît.
 * Dans une fenêtre, ce qui confirme une action irréversible n'est pas actionné (couvert par les parcours dédiés).
 */
const PAGES = [
  '/', '/inventaire', '/inventaire/nouveau', '/inventaire/inventaires', '/inventaire/controle', '/courses', '/courses?tab=reception', '/courses?tab=historique',
  '/courses/magasins', '/courses/ticket', '/previsions', '/previsions?vue=calendrier', '/previsions?vue=peremption', '/previsions?vue=gaspillage',
  '/depenses', '/famille', '/famille?vue=journal', '/parametres', '/notifications', '/notifications?vue=activite', '/scanner', '/recettes', 'fiche', 'recette',
];
const IRREVERSIBLE = /supprimer|se déconnecter|quitter|retirer|archiver|fusionner|restaurer|réinitialiser|révoquer|valider l|tout restaurer/i;
const JUNK = /\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b|\d{4}-\d{2}-\d{2}T/;
/** Boutons, onglets, et liens internes de l'application (une action peut être un lien, ex. « Comparer et fusionner »). */
const SEL = (scope: string) => `${scope} button:visible, ${scope} summary:visible, ${scope} [role=button]:visible, ${scope} [role=tab]:visible, ${scope} a[href^="/"]:not([href^="/api/"]):visible`;

async function labels(page: Page, scope: string): Promise<string[]> {
  return page.locator(SEL(scope)).evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)));
}

/** Attend que l'écran ait fini de se construire (données locales chargées) : nombre de boutons stable. */
async function settle(page: Page, scope = 'main') {
  let last = -1;
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(150);
    const n = await page.locator(SEL(scope)).count().catch(() => 0);
    if (n === last && n > 0) return;
    last = n;
  }
}

async function check(page: Page, where: string, problems: string[]) {
  if (await page.getByTestId('error-boundary').count()) problems.push(`${where} → écran d'erreur`);
  const text = await page.locator('body').innerText().catch(() => '');
  const junk = JUNK.exec(text);
  if (junk) problems.push(`${where} → texte technique « ${junk[0]} »`);
}

async function tryClick(page: Page, scope: string, nth: number): Promise<boolean> {
  const target = page.locator(SEL(scope)).nth(nth);
  if (!(await target.count()) || !(await target.isEnabled().catch(() => false))) return false;
  return target.click({ timeout: 2000 }).then(() => true, () => false);
}

test.describe('Chaque bouton fonctionne', () => {
  for (const screen of PAGES) {
    test(`écran ${screen}`, async ({ page }) => {
      test.setTimeout(240_000);
      await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
      await createHousehold(page, 'Maison boutons');
      const lait = uid();
      const cafe = uid();
      const store = uid();
      const recette = uid();
      await seed(page, (op, { cat, loc }) => {
        op('store.upsert', { id: store, name: 'Marché du coin' }, 30);
        op('product.create', { id: lait, name: 'Lait demi-écrémé', unit: 'bouteille', minQty: 2, categoryId: cat['Produits frais'], locationId: loc['Réfrigérateur'] }, 30);
        for (const d of [28, 21, 14, 7]) {
          op('stock.add', { productId: lait, lotId: uid(), quantity: 2, expiryDate: inDays(1), priceCents: 107, storeId: store }, d);
          op('stock.consume', { productId: lait, quantity: 2 }, d - 3);
        }
        op('stock.add', { productId: lait, lotId: uid(), quantity: 1, expiryDate: inDays(2), priceCents: 109 }, 1);
        op('product.create', { id: cafe, name: 'Café moulu', unit: 'paquet', initialStock: { lotId: uid(), quantity: 3, expiryDate: inDays(-2) } }, 20);
        // Doublon probable : donne du contenu (et des boutons) à l'écran Contrôle.
        op('product.create', { id: uid(), name: 'Lait demi ecreme', unit: 'bouteille' }, 10);
        op('shopping.add', { itemId: uid(), productId: null, name: 'Piles AA', quantity: 1, unit: 'piece', source: 'manual' }, 1);
        op('shopping.add', { itemId: uid(), productId: cafe, name: 'Café moulu', quantity: 1, unit: 'paquet', source: 'manual' }, 1);
        op('purchase.create', { id: uid(), name: 'Pain', quantity: 1, unit: 'piece', totalCents: 120, date: inDays(-3), storeId: store }, 3);
        op('recipe.upsert', { id: recette, name: 'Lait chaud', servings: 2, ingredients: [{ productId: lait, name: 'Lait', quantity: 1, unit: 'bouteille', optional: false }, { productId: null, name: 'Miel', quantity: 1, unit: 'piece', optional: true }], instructions: 'Chauffer.', tags: [] }, 1);
      });
      const url = screen === 'fiche' ? `/inventaire/${lait}` : screen === 'recette' ? `/recettes/${recette}` : screen;
      const problems: string[] = [];
      let where = url;
      page.on('pageerror', (e) => problems.push(`${where} → erreur JavaScript : ${e.message}`));
      page.on('dialog', (d) => void d.dismiss());
      let clicked = 0;

      const open = async () => {
        await page.goto(url);
        await settle(page);
      };
      await open();
      await check(page, url, problems);
      const level1 = await labels(page, 'main');
      for (let i = 0; i < level1.length; i++) {
        await open();
        where = `${url} › « ${level1[i]} »`;
        if (!(await tryClick(page, 'main', i))) continue;
        clicked++;
        await settle(page, 'body');
        await check(page, where, problems);
        if (!(await page.locator('.sheet').count())) continue;
        // Second niveau : chaque bouton de la fenêtre ouverte (réouverte au besoin, sans recharger).
        await settle(page, '.sheet');
        const level2 = await labels(page, '.sheet');
        for (let j = 0; j < level2.length; j++) {
          if (IRREVERSIBLE.test(level2[j])) continue;
          if (!(await page.locator('.sheet').count()) || page.url() !== new URL(url, page.url()).href) {
            await open();
            if (!(await tryClick(page, 'main', i))) break;
            await settle(page, '.sheet');
          }
          if ((await labels(page, '.sheet'))[j] !== level2[j]) {
            // La fenêtre a changé d'état (bouton précédent) : on la rouvre telle qu'à l'origine.
            await open();
            if (!(await tryClick(page, 'main', i))) break;
            await settle(page, '.sheet');
            if ((await labels(page, '.sheet'))[j] !== level2[j]) continue;
          }
          where = `${url} › « ${level1[i]} » › « ${level2[j]} »`;
          if (!(await tryClick(page, '.sheet', j))) continue;
          clicked++;
          await settle(page, 'body');
          await check(page, where, problems);
        }
      }
      console.log(`${url} : ${clicked} boutons ou liens actionnés (${level1.length} sur l'écran)`);
      expect(problems, problems.join('\n')).toEqual([]);
      expect(clicked).toBeGreaterThan(0);
    });
  }
});
