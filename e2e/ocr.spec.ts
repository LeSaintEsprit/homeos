import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser } from '@playwright/test';
import { createHousehold, register, seed, uid, uniq } from './helpers';

const EAN = '3274080005003';
const DIR = join('e2e', '.data', 'ocr');
const today = new Date().toISOString().slice(0, 10);
const fr = (iso: string) => iso.split('-').reverse().join('/');
const nbsp = (s: string) => s.replace(/ /g, ' ');

/** Rend un texte en image PNG (comme une photo nette) pour l'OCR. */
async function renderImage(browser: Browser, name: string, html: string): Promise<string> {
  mkdirSync(DIR, { recursive: true });
  const p = await browser.newPage({ viewport: { width: 760, height: 1000 } });
  await p.setContent(`<div id="x" style="display:inline-block;background:#fff;color:#111">${html}</div>`);
  const file = join(DIR, `${name}-${Date.now()}.png`);
  await p.locator('#x').screenshot({ path: file });
  await p.close();
  return file;
}

const RECEIPT = [
  'CARREFOUR MARKET', '12 AV DE LA GARE 75011 PARIS', '', `${fr(today)}  10:42   CAISSE 3`, '',
  'LAIT DEMI ECREME          1,07', '2 X 3,89', 'CAFE MOULU ARABICA        7,78', 'POMMES GOLDEN',
  '0,850 KG X 2,49 EUR/KG    2,12', 'REMISE IMMEDIATE         -0,50', 'PAIN DE MIE COMPLET       1,89', '',
  'TOTAL                    12,36', 'CB                       12,36', '', 'MERCI DE VOTRE VISITE',
];
const receiptHtml = `<pre style="margin:0;padding:24px 28px;font:600 22px/1.45 'Courier New',monospace">${RECEIPT.join('\n')}</pre>`;

test.describe('Phase 10 — OCR des dates et des tickets (lecture réelle sur l’appareil)', () => {
  test('date lue sur la photo de l’étiquette, proposée puis confirmée, enregistrée comme « reconnue et confirmée »', async ({ page, browser }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison OCR');
    const yaourt = uid();
    await seed(page, (op, { cat }) => {
      op('product.create', { id: yaourt, name: 'Yaourt nature', unit: 'pot', categoryId: cat['Produits frais'], codes: [{ id: uid(), code: EAN, packQty: 1, source: 'manual' }] }, 1);
    });
    const label = await renderImage(browser, 'label', `<div style="padding:30px 40px;font:600 40px Arial">Yaourt nature<br><span style="font-size:30px">À consommer jusqu'au :</span><br>19/12/2026&nbsp;&nbsp;L4521</div>`);
    await page.goto('/scanner');
    await page.click('button:has-text("Saisir un code")');
    await page.locator('.sheet input').fill(EAN);
    await page.locator('.sheet button:has-text("Valider")').click();
    // Une seule question : la date (le code n'en contient pas).
    await expect(page.locator('.sheet')).toContainText('Date de « Yaourt nature » ?');
    await page.getByTestId('ocr-date-file').setInputFiles(label);
    const cand = page.getByTestId('ocr-candidate');
    await expect(cand).toHaveCount(1, { timeout: 60000 });
    await expect(cand).toContainText('19 décembre 2026');
    await expect(cand).toContainText('(DLC)');
    // Rien n'est enregistré tant que la date n'est pas choisie puis validée.
    await expect(page.getByTestId('date-input')).toHaveValue('');
    await cand.click();
    await expect(page.getByTestId('date-input')).toHaveValue('2026-12-19');
    await page.getByTestId('date-save').click();
    await expect(page.getByTestId('scan-flash')).toContainText('Yaourt nature');
    await page.goto(`/inventaire/${yaourt}`);
    await expect(page.getByTestId('lot-card')).toContainText('DLC 19 déc.');
    await expect(page.getByTestId('lot-card')).toContainText('date reconnue et confirmée');
  });

  test('ticket de caisse : lecture, validation ligne par ligne, mise en stock seulement après confirmation, libellés appris', async ({ page, browser }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison ticket');
    const lait = uid();
    const cafe = uid();
    await seed(page, (op) => {
      op('product.create', { id: lait, name: 'Lait demi-écrémé', unit: 'bouteille' }, 1);
      op('product.create', { id: cafe, name: 'Café moulu', unit: 'paquet' }, 1);
    });
    const img = await renderImage(browser, 'receipt', receiptHtml);
    await page.goto('/courses');
    await page.getByTestId('open-receipt').click();
    await page.getByTestId('receipt-file').setInputFiles(img);
    await expect(page.getByTestId('receipt-line')).toHaveCount(4, { timeout: 60000 });
    await expect(page.getByTestId('receipt-total')).toHaveValue('12,36');
    await expect(page.getByTestId('receipt-date')).toHaveValue(today);
    await expect(page.getByTestId('receipt-sum')).toContainText('conforme au total');
    const line = (n: number) => page.getByTestId('receipt-line').nth(n);
    // Lait : même nom → probable, mis en stock par défaut.
    await expect(line(0).getByTestId('match-badge')).toHaveText('Probable');
    await expect(line(0).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    // Café : nom seulement ressemblant → à vérifier, jamais mis en stock sans confirmation.
    await expect(line(1).getByTestId('match-badge')).toHaveText('À vérifier');
    await expect(line(1).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('unchecked')).toBeVisible();
    await line(1).getByTestId('line-target').selectOption({ label: 'Café moulu' });
    await expect(line(1).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('unchecked')).toHaveCount(0);
    // Pommes (au poids, remise déduite) : nouveau produit ; pain : dépense seulement.
    await expect(line(2).locator('input').nth(1)).toHaveValue('0,85');
    await expect(line(2).getByTestId('line-price')).toHaveValue('1,62');
    await line(2).getByTestId('line-target').selectOption('create');
    await expect(line(3).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('receipt-save').click();

    await expect(page).toHaveURL(/\/depenses$/);
    await expect(page.getByTestId('month-spent')).toHaveText(nbsp('12,36 €'));
    await expect(page.getByTestId('purchase-row')).toHaveCount(4);
    await expect(page.getByTestId('purchase-row').first()).toContainText('ticket');
    await page.goto('/inventaire');
    const qty = (n: string) => page.getByTestId('product-row').filter({ hasText: n }).getByTestId('product-qty');
    await expect(qty('Lait demi-écrémé')).toHaveText('1 bouteille');
    await expect(qty('Café moulu')).toHaveText('2 paquets');
    await expect(qty('Pommes golden')).toHaveText('0,85 kg');
    await expect(page.getByTestId('product-row').filter({ hasText: 'Pain de mie' })).toHaveCount(0);

    // Deuxième ticket du même magasin : le libellé du café est désormais reconnu avec certitude.
    await page.goto('/courses/ticket');
    await page.getByTestId('receipt-file').setInputFiles(img);
    await expect(page.getByTestId('receipt-line')).toHaveCount(4, { timeout: 60000 });
    await expect(line(1).getByTestId('match-badge')).toHaveText('Sûr');
    await expect(line(1).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(line(2).getByTestId('match-badge')).toHaveText('Probable');
  });
});
