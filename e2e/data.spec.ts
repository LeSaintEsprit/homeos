import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createHousehold, inviteCode, register, seed, uid, uniq } from './helpers';

async function switchTo(page: Page, name: string) {
  await page.getByTestId('household-switcher').click();
  await page.locator('.sheet .list-row', { hasText: name }).first().click();
  await expect(page.getByTestId('active-household')).toHaveText(name);
}

const stock = (page: Page, name: string) => page.getByTestId('product-row').filter({ hasText: name }).getByTestId('product-qty');

test.describe('Phase 11 — données du foyer', () => {
  test('contrôle d’intégrité, export JSON et CSV, import comme nouveau foyer, version précédente restaurée, suppression confirmée', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison données');
    const riz = uid();
    await seed(page, (op) => {
      op('product.create', { id: riz, name: 'Riz basmati', unit: 'paquet' }, 3);
      op('stock.add', { productId: riz, lotId: uid(), quantity: 4 }, 3);
    });
    await page.goto('/parametres#donnees');
    await page.getByTestId('integrity-check').click();
    await expect(page.getByTestId('integrity-result')).toContainText('Aucune anomalie');

    // Export complet (fichier réellement téléchargé) puis CSV lisible dans un tableur.
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
    const jsonPath = join('e2e', '.data', `export-${Date.now()}.json`);
    await dl.saveAs(jsonPath);
    const exported = JSON.parse(readFileSync(jsonPath, 'utf8'));
    expect(exported.format).toBe('homeos-export');
    expect(exported.entities.product.map((p: { name: string }) => p.name)).toEqual(['Riz basmati']);
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
    const csvPath = join('e2e', '.data', `inventaire-${Date.now()}.csv`);
    await csv.saveAs(csvPath);
    expect(readFileSync(csvPath, 'utf8')).toContain('Riz basmati');

    // Import : nouveau foyer, l'original n'est pas touché.
    await page.getByTestId('import-file').setInputFiles(jsonPath);
    await expect(page.getByTestId('active-household')).toHaveText('Maison données (import)');
    await page.goto('/inventaire');
    await expect(stock(page, 'Riz basmati')).toHaveText('4 paquets');

    // L'import a déclenché une sauvegarde : le foyer d'origine peut revenir à cet état.
    await switchTo(page, 'Maison données');
    await page.goto('/inventaire');
    await page.getByRole('button', { name: /Consommer 1 paquet de Riz basmati/ }).click();
    await expect(stock(page, 'Riz basmati')).toHaveText('3 paquets');
    await page.goto('/parametres#donnees');
    await page.getByTestId('open-restore').click();
    const backups = page.getByTestId('household-backups').locator('.list-row');
    await expect(backups.first()).toContainText('avant un import');
    await backups.first().click();
    await page.getByTestId('do-restore').click();
    await expect(page.getByTestId('active-household')).toContainText('Maison données (restauré du');
    await page.goto('/inventaire');
    await expect(stock(page, 'Riz basmati')).toHaveText('4 paquets');
    // Le foyer d'origine garde sa modification.
    await switchTo(page, 'Maison données');
    await page.goto('/inventaire');
    await expect(stock(page, 'Riz basmati')).toHaveText('3 paquets');

    // Suppression : nom exact exigé, puis bascule sur un autre foyer.
    await page.goto('/parametres#donnees');
    await page.getByTestId('open-delete-household').click();
    await page.getByTestId('confirm-name').fill('Maison donnée');
    await expect(page.getByTestId('do-delete-household')).toBeDisabled();
    await page.getByTestId('confirm-name').fill('Maison données');
    await page.getByTestId('do-delete-household').click();
    await expect(page.getByTestId('active-household')).not.toHaveText('Maison données');
    await page.getByTestId('household-switcher').click();
    await expect(page.locator('.sheet .list-row')).toHaveCount(2);
    await expect(page.locator('.sheet .list-row', { hasText: /^Maison données$/ })).toHaveCount(0);
  });

  test('un membre (non administrateur) ne voit ni restauration ni suppression du foyer', async ({ page, browser }) => {
    await register(page, 'Admin', `${uniq('a')}@x.fr`);
    await createHousehold(page, 'Maison droits');
    const code = await inviteCode(page, 'Membre');
    const ctx = await browser.newContext();
    const bob = await ctx.newPage();
    await register(bob, 'Bob', `${uniq('b')}@x.fr`, code);
    await bob.goto('/parametres#donnees');
    await expect(bob.getByTestId('integrity-check')).toBeVisible();
    await expect(bob.getByTestId('export-json')).toBeVisible();
    await expect(bob.getByTestId('open-restore')).toHaveCount(0);
    await expect(bob.getByTestId('open-delete-household')).toHaveCount(0);
    await ctx.close();
  });
});

test.describe('Phase 11 — sauvegardes de l’instance (hébergeur)', () => {
  // Instance fraîche : le premier compte créé est l'hébergeur.
  const PORT = 18093;
  const BASE = `http://localhost:${PORT}`;
  let server: ChildProcess;
  test.beforeAll(async () => {
    const dir = join(process.env.HOMEOS_E2E_DATA ?? 'e2e/.data', `admin-${Date.now()}`);
    server = spawn('node', ['packages/server/dist/server.js'], {
      env: { ...process.env, PORT: String(PORT), HOMEOS_DATA_DIR: dir, HOMEOS_WEB_DIR: 'packages/web/dist', HOMEOS_REGISTRATION: 'open', HOMEOS_SCHEDULERS: '0', HOMEOS_RATE_LIMIT_MULTIPLIER: '50', HOMEOS_OFF_DISABLED: '1', LOG_LEVEL: 'warn' },
      stdio: 'ignore',
    });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) return;
      } catch {
        /* pas encore prêt */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('Instance de test indisponible');
  });
  test.afterAll(() => {
    server?.kill();
  });

  test('créer, vérifier, télécharger une sauvegarde, puis restaurer toute l’instance après confirmation', async ({ page }) => {
    await page.goto(`${BASE}/inscription`);
    await page.fill('input[autocomplete=name]', 'Hébergeur');
    await page.fill('input[type=email]', `${uniq('h')}@x.fr`);
    await page.fill('#pw', 'motdepasse-solide');
    await page.click('button:has-text("Créer mon compte")');
    await page.waitForURL((u) => !u.pathname.startsWith('/inscription'));
    await page.click('text=Créer un nouveau foyer');
    await page.fill('input[placeholder="Maison familiale"]', 'Maison hébergée');
    await page.click('button:has-text("Continuer")');
    await page.click('button:has-text("Continuer")');
    await page.click('button:has-text("Créer mon foyer")');
    await expect(page.getByTestId('active-household')).toHaveText('Maison hébergée');

    await page.goto(`${BASE}/parametres`);
    const box = page.getByTestId('server-backups');
    await box.getByTestId('create-backup').click();
    await expect(page.locator('.toast').filter({ hasText: 'Sauvegarde créée et vérifiée' })).toBeVisible();
    const row = box.getByTestId('backup-row').first();
    await expect(row).toContainText('manuelle');
    await expect(row).toContainText('1 foyer(s)');
    const [dl] = await Promise.all([page.waitForEvent('download'), row.getByRole('link', { name: /Télécharger la sauvegarde/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^homeos-manual-.*\.db$/);

    // Modification après la sauvegarde, puis restauration complète : elle disparaît.
    await page.goto(`${BASE}/parametres`);
    await page.getByLabel('Nom du foyer').fill('Maison renommée');
    await page.click('button:has-text("Enregistrer les réglages")');
    await expect(page.getByTestId('active-household')).toHaveText('Maison renommée');
    await expect(page.getByTestId('sync-pill').first()).toHaveAttribute('data-status', 'synced', { timeout: 15000 });
    // Un seul foyer peut être récupéré sans toucher aux autres.
    await box.getByTestId('backup-row').filter({ hasText: 'manuelle' }).first().getByTestId('backup-households').click();
    await expect(page.getByTestId('backup-homes')).toContainText('Maison hébergée');
    await expect(page.getByTestId('backup-homes')).toContainText('existe toujours');
    await page.keyboard.press('Escape');
    await box.getByTestId('backup-row').filter({ hasText: 'manuelle' }).first().getByRole('button', { name: 'Tout restaurer' }).click();
    await page.getByTestId('confirm-restore').fill('restaurer');
    await expect(page.getByTestId('do-restore-instance')).toBeDisabled();
    await page.getByTestId('confirm-restore').fill('RESTAURER');
    await page.getByTestId('do-restore-instance').click();
    await expect(page.locator('.toast').filter({ hasText: 'Instance restaurée' })).toBeVisible();
    // Resynchronisation complète (nouvelle époque) : l'ancien nom revient.
    await expect(page.getByTestId('active-household')).toHaveText('Maison hébergée', { timeout: 20000 });
    await expect(box.getByTestId('backup-row').filter({ hasText: 'avant une restauration' })).toHaveCount(1);
  });
});
