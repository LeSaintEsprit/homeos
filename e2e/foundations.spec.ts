import { expect, test } from '@playwright/test';
import { createHousehold, inviteCode, register, uniq } from './helpers';

test.describe('Phase 2 — socle : comptes, foyers, synchronisation', () => {
  test('inscription, foyer, invitation par lien et arrivée en temps réel du nouveau membre', async ({ page, browser }) => {
    await register(page, 'Nicolas', `${uniq('nico')}@x.fr`);
    await createHousehold(page, 'Maison familiale');
    const code = await inviteCode(page);
    await expect(page.getByText('1 membre')).toBeVisible();

    const ctx = await browser.newContext();
    const mom = await ctx.newPage();
    await mom.goto(`/invitation/${code}`);
    await expect(mom.getByRole('heading', { name: 'Maison familiale' })).toBeVisible();
    await mom.click('text=Créer mon compte');
    await mom.fill('input[autocomplete=name]', 'Maman');
    await mom.fill('input[type=email]', `${uniq('maman')}@x.fr`);
    await mom.fill('#pw', 'motdepasse-solide');
    await mom.click('button:has-text("Créer mon compte")');
    await expect(mom.getByTestId('active-household')).toHaveText('Maison familiale');

    // Sans recharger, Nicolas voit Maman arriver (temps réel).
    await expect(page.getByText('2 membres')).toBeVisible();
    await expect(page.getByTestId('member-row').filter({ hasText: 'Maman' })).toBeVisible();
    await ctx.close();
  });

  test('hors connexion : modification conservée, envoyée au retour du réseau, visible chez l\'autre membre', async ({ page, browser, context }) => {
    await register(page, 'Admin', `${uniq('adm')}@x.fr`);
    await createHousehold(page, 'Chez nous');
    const code = await inviteCode(page);
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await register(other, 'Papa', `${uniq('papa')}@x.fr`, code);
    await expect(other.getByTestId('active-household')).toHaveText('Chez nous');

    await page.goto('/parametres');
    await expect(page.getByTestId('sync-pill').first()).toHaveAttribute('data-status', 'synced');
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.getByLabel('Nom du foyer').fill('Chez nous (hors ligne)');
    await page.click('button:has-text("Enregistrer les réglages")');
    // Affichage immédiat, mais en attente d'envoi.
    await expect(page.getByTestId('active-household')).toHaveText('Chez nous (hors ligne)');
    await expect(page.getByTestId('sync-pill').first()).toHaveAttribute('data-status', 'offline');
    await page.waitForTimeout(800);
    await other.goto('/');
    await expect(other.getByTestId('active-household')).toHaveText('Chez nous');

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('sync-pill').first()).toHaveAttribute('data-status', 'synced', { timeout: 15000 });
    // L'autre membre voit le nouveau nom en direct, sans recharger.
    await expect(other.getByTestId('active-household')).toHaveText('Chez nous (hors ligne)');
    await ctx.close();
  });

  test('deux foyers : bascule sans aucun mélange des données', async ({ page }) => {
    await register(page, 'Léa', `${uniq('lea')}@x.fr`);
    await createHousehold(page, 'Maison A');
    const codeA = await inviteCode(page);
    await page.goto('/foyers/nouveau');
    await createHousehold(page, 'Maison B');
    await page.goto('/famille');
    await expect(page.getByText('1 membre')).toBeVisible();
    // Invitation créée dans A : absente de B.
    await expect(page.getByText(codeA)).toHaveCount(0);
    await page.click('[data-testid=household-switcher]');
    await page.click('.list-row:has-text("Maison A")');
    await expect(page.getByTestId('active-household')).toHaveText('Maison A');
    await page.goto('/famille');
    await expect(page.getByText(codeA)).toBeVisible();
    // Une base locale distincte par foyer.
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n?.startsWith('homeos-')));
    expect(dbs).toHaveLength(2);
  });

  test('un membre retiré perd l\'accès immédiatement et ses données locales sont effacées', async ({ page, browser }) => {
    await register(page, 'Admin', `${uniq('adm')}@x.fr`);
    await createHousehold(page, 'Foyer strict');
    const code = await inviteCode(page);
    const ctx = await browser.newContext();
    const guest = await ctx.newPage();
    await register(guest, 'Invité', `${uniq('inv')}@x.fr`, code);
    await expect(guest.getByTestId('active-household')).toHaveText('Foyer strict');
    expect(await guest.evaluate(async () => (await indexedDB.databases()).filter((d) => d.name?.startsWith('homeos-')).length)).toBe(1);

    await page.goto('/famille');
    await page.getByTestId('member-row').filter({ hasText: 'Invité' }).click();
    await page.click('button:has-text("Retirer du foyer")');
    await page.click('.sheet button.danger:has-text("Retirer")');
    await expect(page.getByText('1 membre')).toBeVisible();

    // Côté invité, sans recharger : retour à l'accueil sans foyer, base locale supprimée.
    await guest.waitForURL(/bienvenue/, { timeout: 15000 });
    await expect.poll(async () => guest.evaluate(async () => (await indexedDB.databases()).filter((d) => d.name?.startsWith('homeos-')).length)).toBe(0);
    await ctx.close();
  });

  test('lecture seule : aucune action de modification proposée', async ({ page, browser }) => {
    await register(page, 'Admin', `${uniq('adm')}@x.fr`);
    await createHousehold(page, 'Maison lecture');
    const code = await inviteCode(page, 'Lecture seule');
    const ctx = await browser.newContext();
    const viewer = await ctx.newPage();
    await register(viewer, 'Grand-père', `${uniq('gp')}@x.fr`, code);
    await viewer.goto('/parametres');
    await expect(viewer.getByText('Seuls les administrateurs du foyer peuvent modifier ces réglages.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Enregistrer les réglages' })).toHaveCount(0);
    await viewer.goto('/famille');
    await expect(viewer.getByRole('button', { name: 'Inviter', exact: true })).toHaveCount(0);
    await ctx.close();
  });
});

test('l\'application s\'ouvre sans réseau (PWA) avec les données de l\'appareil', async ({ page, context }) => {
  await register(page, 'Hors-ligne', `${uniq('off')}@x.fr`);
  await createHousehold(page, 'Maison sans réseau');
  // Le service worker a mis l'application en cache.
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active, null, { timeout: 15000 });
  await page.reload();
  await expect(page.getByTestId('active-household')).toHaveText('Maison sans réseau');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('active-household')).toHaveText('Maison sans réseau');
  await expect(page.getByText('Serveur injoignable')).toBeVisible();
  await page.goto('/famille');
  await expect(page.getByText('1 membre')).toBeVisible();
  await context.setOffline(false);
});
