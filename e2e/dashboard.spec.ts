import { expect, test } from '@playwright/test';
import { createHousehold, inDays, inviteCode, register, seed, uid, uniq } from './helpers';

test.describe('Phase 7 — tableau de bord et centre de notifications', () => {
  test('accueil : ce que la maison doit prévoir, indicateurs, personnalisation propre à chaque membre', async ({ page, browser }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison accueil');
    const papier = uid();
    const yaourt = uid();
    const cafe = uid();
    await seed(page, (op) => {
      op('product.create', { id: papier, name: 'Papier toilette', unit: 'rouleau', minQty: 4 }, 10);
      op('stock.add', { productId: papier, lotId: uid(), quantity: 2 }, 10);
      op('product.create', { id: yaourt, name: 'Yaourts', unit: 'pot' }, 5);
      op('stock.add', { productId: yaourt, lotId: uid(), quantity: 4, expiryDate: inDays(1) }, 5);
      op('product.create', { id: cafe, name: 'Café', unit: 'paquet' }, 5);
      op('stock.add', { productId: cafe, lotId: uid(), quantity: 1 }, 5);
      op('stock.finish', { productId: cafe }, 1);
    });
    const code = await inviteCode(page);
    await page.goto('/');
    await expect(page.getByTestId('kpi-tracked')).toContainText('3');
    await expect(page.getByTestId('kpi-low')).toContainText('1');
    await expect(page.getByTestId('kpi-out')).toContainText('1');
    await expect(page.getByTestId('kpi-tobuy')).toContainText('0');
    await expect(page.getByTestId('kpi-expiring')).toContainText('1');
    const plan = page.getByTestId('widget-prevoir');
    await expect(plan.getByTestId('plan-reco')).toHaveCount(2);
    await expect(plan).toContainText('1 lot à consommer');

    // Ajout depuis l'accueil : l'indicateur « à acheter » suit, la recommandation disparaît.
    await plan.getByRole('button', { name: 'Ajouter Papier toilette à la liste' }).click();
    await expect(page.getByTestId('kpi-tobuy')).toContainText('1');
    await expect(plan.getByTestId('plan-reco')).toHaveCount(1);
    await expect(page.getByTestId('widget-liste')).toContainText('Papier toilette');

    // Les indicateurs mènent à la liste filtrée.
    await page.getByTestId('kpi-out').click();
    await expect(page).toHaveURL(/filtre=epuises/);
    await expect(page.getByTestId('product-row')).toHaveCount(1);
    await expect(page.getByTestId('product-row')).toContainText('Café');

    // Personnalisation : masquer « Dépenses du mois », remonter la liste de courses en tête.
    await page.goto('/');
    await page.getByTestId('customize').click();
    const settings = page.getByTestId('widget-settings');
    await settings.getByRole('switch', { name: 'Afficher Dépenses du mois' }).click();
    await settings.getByRole('button', { name: 'Monter Liste de courses' }).click();
    await settings.getByRole('button', { name: 'Monter Liste de courses' }).click();
    await page.click('.sheet button:has-text("Terminé")');
    await expect(page.getByTestId('widget-depenses')).toHaveCount(0);
    await expect(page.locator('.dashboard .widget').first()).toHaveAttribute('data-testid', 'widget-liste');
    // Conservé après rechargement (synchronisé avec le compte)…
    await page.reload();
    await expect(page.locator('.dashboard .widget').first()).toHaveAttribute('data-testid', 'widget-liste');
    await expect(page.getByTestId('widget-depenses')).toHaveCount(0);

    // … et propre à chaque membre : Bob garde l'accueil par défaut.
    const ctx = await browser.newContext();
    const bob = await ctx.newPage();
    await register(bob, 'Bob', `${uniq('bob')}@x.fr`, code);
    await bob.goto('/');
    await expect(bob.locator('.dashboard .widget').first()).toHaveAttribute('data-testid', 'widget-prevoir');
    await expect(bob.getByTestId('widget-depenses')).toBeVisible();
    await ctx.close();
  });

  test('centre de notifications : alertes, masquage réversible, modification importante d\'un autre membre, types désactivés', async ({ page, browser }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison alertes');
    const papier = uid();
    const lait = uid();
    await seed(page, (op) => {
      op('product.create', { id: papier, name: 'Papier toilette', unit: 'rouleau', minQty: 4 }, 10);
      op('stock.add', { productId: papier, lotId: uid(), quantity: 2 }, 10);
      op('product.create', { id: lait, name: 'Lait', unit: 'bouteille' }, 5);
      op('stock.add', { productId: lait, lotId: uid(), quantity: 2, expiryDate: inDays(0) }, 5);
    });
    const code = await inviteCode(page);
    await page.goto('/');
    // Stock critique + péremption du jour (la recommandation « à acheter » est une information).
    await expect(page.getByTestId('bell-count')).toHaveText('2');
    await page.getByTestId('bell').click();
    await expect(page.getByTestId('alert-row').filter({ hasText: 'Papier toilette : stock critique' })).toBeVisible();
    await expect(page.getByTestId('alert-row').filter({ hasText: "Lait : périme aujourd'hui" })).toContainText('Quantité concernée : 2 bouteilles');

    // Masquer puis réafficher.
    await page.getByRole('button', { name: 'Masquer : Papier toilette : stock critique' }).click();
    await expect(page.getByTestId('alert-row').filter({ hasText: 'Papier toilette : stock critique' })).toHaveCount(0);
    await expect(page.getByTestId('bell-count')).toHaveText('1');
    await page.getByTestId('restore-dismissed').click();
    await expect(page.getByTestId('alert-row').filter({ hasText: 'Papier toilette : stock critique' })).toBeVisible();
    await expect(page.getByTestId('bell-count')).toHaveText('2');

    // Bob signale un produit manquant : Nicolas en est averti en direct.
    const ctx = await browser.newContext();
    const bob = await ctx.newPage();
    await register(bob, 'Bob', `${uniq('bob')}@x.fr`, code);
    await page.goto('/');
    await bob.goto(`/inventaire/${lait}`);
    await bob.click('.action-grid .action:has-text("Manquant")');
    await bob.getByTestId('action-submit').click();
    await expect(page.getByTestId('bell-count')).toHaveText('3');
    await page.getByTestId('bell').click();
    const change = page.getByTestId('alert-row').filter({ hasText: 'Bob a signalé « Lait » manquant' });
    await expect(change).toHaveClass(/unread/);
    // Une fois le centre consulté, la modification n'est plus comptée comme nouvelle.
    await expect(page.getByTestId('bell-count')).toHaveText('2');
    await page.click('.segmented button:has-text("Activité du foyer")');
    await expect(page.getByTestId('activity-feed')).toContainText('Bob');

    // Type d'alerte désactivé dans les préférences : n'apparaît plus.
    await page.goto('/parametres#notifications');
    const sw = page.getByRole('switch', { name: 'Péremptions proches' });
    await sw.click();
    // L'interrupteur ne bascule qu'une fois le réglage écrit sur l'appareil.
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await page.goto('/notifications');
    await expect(page.getByTestId('alert-row').filter({ hasText: "Lait : périme aujourd'hui" })).toHaveCount(0);
    await expect(page.getByText("1 alerte d'un type désactivé dans vos préférences.")).toBeVisible();
    await ctx.close();
  });
});
