import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createHousehold, inDays, register, seed, uid, uniq } from './helpers';

/** Écrans audités (WCAG 2.0/2.1 A et AA) avec des données réalistes. */
const PAGES = [
  '/', '/inventaire', '/inventaire/nouveau', '/inventaire/inventaires', '/inventaire/controle', '/courses', '/courses?tab=reception', '/courses?tab=historique',
  '/courses/magasins', '/courses/ticket', '/previsions', '/previsions?vue=calendrier', '/previsions?vue=peremption', '/previsions?vue=gaspillage',
  '/depenses', '/famille', '/parametres', '/notifications', '/scanner',
];

async function axeNow(page: Page, label: string) {
  await page.waitForTimeout(400);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${label} · ${v.id} (${v.impact}) : ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

async function audit(page: Page, url: string, theme: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
  // Aucun texte technique affiché (valeur manquante, calcul impossible, objet brut, date ISO).
  const text = await page.locator('body').innerText();
  const junk = /\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b|\d{4}-\d{2}-\d{2}T/.exec(text);
  if (junk) return [`${url} · texte technique affiché : « ${junk[0]} »`];
  // Interface en français : aucun libellé anglais courant.
  const english = /\b(Loading|Cancel|Submit|Delete|Save|Error|Settings|Search|Undo|Close|Back|Next|Add|Edit|Remove|Sign in|Sign up|Log out|Shopping list|Inventory)\b/.exec(text);
  if (english) return [`${url} · texte anglais affiché : « ${english[0]} »`];
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${url} · ${v.id} (${v.impact}) : ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

test.describe('Phase 13 — accessibilité (axe, WCAG 2.1 AA)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`aucune violation grave ou critique sur les écrans principaux (thème ${theme === 'light' ? 'clair' : 'sombre'})`, async ({ page }) => {
      test.setTimeout(180_000);
      await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
      await createHousehold(page, 'Maison accessible');
      const p1 = uid();
      await seed(page, (op, { cat, loc }) => {
        op('product.create', { id: p1, name: 'Lait demi-écrémé', unit: 'bouteille', minQty: 2, categoryId: cat['Produits frais'], locationId: loc['Réfrigérateur'] }, 20);
        op('stock.add', { productId: p1, lotId: uid(), quantity: 1, expiryDate: inDays(1), priceCents: 107 }, 20);
        op('shopping.add', { itemId: uid(), productId: null, name: 'Piles AA', quantity: 1, unit: 'piece', source: 'manual' }, 1);
        op('purchase.create', { id: uid(), name: 'Café', quantity: 1, unit: 'paquet', totalCents: 389, date: inDays(-3) }, 3);
      });
      await page.evaluate((t) => localStorage.setItem('homeos:theme', t), theme);
      const all: string[] = [];
      for (const url of [...PAGES, `/inventaire/${p1}`]) {
        all.push(...(await audit(page, url, theme)));
      }
      // Fiche ouverte, mode courses, puis pages publiques (déconnecté).
      await page.goto(`/inventaire/${p1}`);
      await page.click('.action-grid .action:has-text("Consommer")');
      all.push(...(await axeNow(page, 'fiche Consommer')));
      all.push(...(await audit(page, '/courses/magasin', theme)));
      await page.context().clearCookies();
      for (const url of ['/connexion', '/inscription', '/mot-de-passe-oublie']) all.push(...(await audit(page, url, theme)));
      expect(all, all.join('\n')).toEqual([]);
    });
  }
});
