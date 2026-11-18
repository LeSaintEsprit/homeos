import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createHousehold, inviteCode, register, uniq } from './helpers';

async function login(page: Page, email: string, password: string) {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.locator('#pw').fill(password);
  await page.click('button:has-text("Se connecter")');
}

async function logout(page: Page) {
  await page.goto('/parametres');
  await page.click('button:has-text("Se déconnecter")');
  await page.locator('.sheet button:has-text("Se déconnecter")').click();
  await expect(page).toHaveURL(/\/connexion/);
}

test.describe('Comptes', () => {
  test('connexion, mauvais mot de passe, déconnexion (données locales effacées), profil visible des autres membres', async ({ page, browser }) => {
    const email = `${uniq('n')}@x.fr`;
    await register(page, 'Nicolas', email);
    await createHousehold(page, 'Maison comptes');
    const code = await inviteCode(page, 'Membre');
    const ctx = await browser.newContext();
    const bob = await ctx.newPage();
    await register(bob, 'Bob', `${uniq('b')}@x.fr`, code);

    await logout(page);
    expect(await page.evaluate(async () => (await indexedDB.databases()).filter((d) => d.name?.startsWith('homeos-')).length)).toBe(0);
    await login(page, email, 'mauvais-mot-de-passe');
    await expect(page.locator('.alert, .toast').filter({ hasText: /incorrect/i })).toBeVisible();
    await login(page, email, 'motdepasse-solide');
    await expect(page.getByTestId('active-household')).toHaveText('Maison comptes');

    // Nouveau nom affiché : les autres membres le voient.
    await page.goto('/parametres');
    // Transparence vis-à-vis de l'hébergeur (décision D4), visible de chaque membre.
    await expect(page.getByTestId('hosting-notice')).toContainText("l'hébergeur peut techniquement accéder à la base de données");
    await page.getByLabel('Nom affiché').fill('Nicolas M.');
    await page.locator('button:has-text("Enregistrer")').first().click();
    await bob.goto('/famille');
    await expect(bob.getByTestId('member-row').filter({ hasText: 'Nicolas M.' })).toBeVisible();
    await ctx.close();
  });

  test('mot de passe oublié sans serveur d’e-mail : la page explique quoi faire', async ({ page }) => {
    await page.goto('/mot-de-passe-oublie');
    await page.getByLabel('Adresse e-mail du compte').fill('quelquun@x.fr');
    await page.locator('button[type=submit], button.primary').first().click();
    await expect(page.getByRole('heading', { name: "Demandez un lien à l'administrateur" })).toBeVisible();
  });
});

test.describe('Comptes — récupération par l’hébergeur', () => {
  const PORT = 18094;
  const BASE = `http://localhost:${PORT}`;
  let server: ChildProcess;
  test.beforeAll(async () => {
    const dir = join(process.env.HOMEOS_E2E_DATA ?? 'e2e/.data', `accounts-${Date.now()}`);
    server = spawn('node', ['packages/server/dist/server.js'], {
      env: { ...process.env, PORT: String(PORT), HOMEOS_DATA_DIR: dir, HOMEOS_WEB_DIR: 'packages/web/dist', HOMEOS_REGISTRATION: 'open', HOMEOS_SCHEDULERS: '0', HOMEOS_RATE_LIMIT_MULTIPLIER: '50', HOMEOS_OFF_DISABLED: '1', LOG_LEVEL: 'warn' },
      stdio: 'ignore',
    });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) return;
      } catch {
        /* démarrage */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('Instance indisponible');
  });
  test.afterAll(() => server?.kill());

  test('lien de réinitialisation à usage unique généré par l’hébergeur', async ({ page, browser }) => {
    await page.goto(`${BASE}/inscription`);
    await page.fill('input[autocomplete=name]', 'Hébergeur');
    await page.fill('input[type=email]', `${uniq('h')}@x.fr`);
    await page.fill('#pw', 'motdepasse-solide');
    await page.click('button:has-text("Créer mon compte")');
    await page.waitForURL((u) => !u.pathname.startsWith('/inscription'));
    const ctx = await browser.newContext();
    const bob = await ctx.newPage();
    const bobEmail = `${uniq('b')}@x.fr`;
    await bob.goto(`${BASE}/inscription`);
    await bob.fill('input[autocomplete=name]', 'Bob');
    await bob.fill('input[type=email]', bobEmail);
    await bob.fill('#pw', 'motdepasse-solide');
    await bob.click('button:has-text("Créer mon compte")');
    await bob.waitForURL((u) => !u.pathname.startsWith('/inscription'));
    await ctx.clearCookies();

    // L'hébergeur n'a pas de foyer : l'administration reste accessible depuis l'accueil.
    await page.goto(`${BASE}/bienvenue`);
    await page.getByTestId('open-admin').click();
    await expect(page.getByRole('heading', { name: 'Administration du serveur' }).first()).toBeVisible();
    await page.locator('.list-row', { hasText: bobEmail }).getByRole('button', { name: 'Lien mot de passe' }).click();
    const link = await page.locator('.sheet textarea').inputValue();
    expect(link).toMatch(/\/reinitialiser\//);
    await bob.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
    await bob.locator('#pw').fill('nouveau-mot-de-passe');
    await bob.click('button:has-text("Enregistrer et me connecter")');
    await bob.waitForURL((u) => !u.pathname.startsWith('/reinitialiser'));
    // Usage unique.
    await bob.context().clearCookies();
    await bob.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
    await expect(bob.getByText('expiré ou a déjà été utilisé')).toBeVisible();
    await ctx.close();
  });
});
