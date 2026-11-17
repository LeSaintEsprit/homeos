import { expect, test, type Page } from '@playwright/test';
import { createHousehold, register, uniq } from './helpers';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

/**
 * Prépare un historique via l'API de synchronisation (mêmes opérations que l'interface),
 * avec l'heure réelle de chaque action : c'est ce qu'envoie un appareil resté hors ligne.
 */
async function seed(page: Page, build: (op: (type: string, payload: Record<string, unknown>, daysAgo?: number) => void, ids: { cat: Record<string, string>; loc: Record<string, string> }) => void) {
  const base = await page.evaluate(async () => {
    const me = await (await fetch('/api/auth/me')).json();
    const hid = me.households[0].id as string;
    const st = await (await fetch(`/api/households/${hid}/sync/pull?since=0`)).json();
    return { hid, changes: st.changes as { t: string; e: { id: string; name: string } }[] };
  });
  const cat = Object.fromEntries(base.changes.filter((c) => c.t === 'category').map((c) => [c.e.name, c.e.id]));
  const loc = Object.fromEntries(base.changes.filter((c) => c.t === 'location').map((c) => [c.e.name, c.e.id]));
  const ops: unknown[] = [];
  build((type, payload, daysAgo = 0) => ops.push({ opId: crypto.randomUUID(), type, payload, clientTime: ago(daysAgo) }), { cat, loc });
  const res = await page.evaluate(
    async ({ hid, ops }) => (await fetch(`/api/households/${hid}/sync/push`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-homeos': '1' }, body: JSON.stringify({ ops }) })).json(),
    { hid: base.hid, ops },
  );
  const rejected = (res.results as { status: string; error?: { message: string } }[]).filter((r) => r.status !== 'applied');
  expect(rejected, JSON.stringify(rejected)).toHaveLength(0);
}

const uid = () => crypto.randomUUID();

test.describe('Phase 6 — prévisions, péremption, gaspillage', () => {
  test('recommandations expliquées avec leur fiabilité, ajout groupé, produits sans données signalés', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison prévisions');
    const lait = uid();
    const papier = uid();
    const bougies = uid();
    const cafe = uid();
    await seed(page, (op) => {
      op('product.create', { id: lait, name: 'Lait', unit: 'bouteille', idealQty: 6 }, 45);
      op('stock.add', { productId: lait, lotId: uid(), quantity: 24 }, 45);
      for (let d = 44; d > 1; d -= 2) op('stock.consume', { productId: lait, quantity: 1 }, d);
      op('product.create', { id: papier, name: 'Papier toilette', unit: 'rouleau', minQty: 4 }, 20);
      op('stock.add', { productId: papier, lotId: uid(), quantity: 2 }, 20);
      op('purchase.create', { id: uid(), name: 'Papier toilette', productId: papier, quantity: 12, unit: 'rouleau', totalCents: 480, date: ago(15).slice(0, 10) }, 15);
      op('product.create', { id: cafe, name: 'Café', unit: 'paquet' }, 10);
      op('stock.add', { productId: cafe, lotId: uid(), quantity: 1 }, 10);
      op('stock.finish', { productId: cafe }, 1);
      op('product.create', { id: bougies, name: 'Bougies', unit: 'piece' }, 10);
      op('stock.add', { productId: bougies, lotId: uid(), quantity: 6 }, 10);
    });
    await page.goto('/previsions');
    await expect(page.getByTestId('reco-count')).toHaveText('3 produits à prévoir');
    // Coût : estimé d'après l'achat enregistré (0,40 € le rouleau), les autres restent « sans prix ».
    await expect(page.locator('.summary-card')).toContainText('Coût estimé ≈ 2,40 € · 2 sans prix connu');
    await expect(page.getByTestId('reco').filter({ hasText: 'Café' })).toContainText('le stock est épuisé');

    // Seuil : certitude, explication claire.
    const pap = page.getByTestId('reco').filter({ hasText: 'Papier toilette' });
    await expect(pap).toContainText('il reste 2 rouleaux, sous le seuil minimal de 4 rouleaux');
    await expect(pap.getByTestId('confidence')).toHaveText('Fiable');
    await expect(pap).toContainText('Acheter 6 rouleaux');
    await expect(pap).toContainText('≈ 2,40 €');
    // Prévision : rupture calculée sur la consommation observée (1 bouteille tous les 2 jours).
    const l = page.getByTestId('reco').filter({ hasText: 'Lait' });
    await expect(l).toContainText('Acheter 6 bouteilles de lait : le stock actuel devrait être épuisé dans');
    await expect(l).toContainText('prix inconnu');
    await l.getByRole('button', { name: 'Pourquoi ?' }).click();
    // Environ une bouteille tous les deux jours, exprimée par semaine pour une unité dénombrable ; dite une seule fois.
    await expect(l).toContainText(/Consommation : ~3,\d+ bouteilles par semaine \(observé, confiance élevée\)/);
    expect(((await l.textContent()) ?? '').split('Consommation :').length).toBe(2);
    // Aucun chiffre inventé pour un produit sans seuil ni historique.
    await expect(page.getByTestId('reco').filter({ hasText: 'Bougies' })).toHaveCount(0);
    await expect(page.getByTestId('data-gaps')).toContainText('Bougies');

    await page.getByTestId('reco-add-all').click();
    await expect(page.getByText('Rien à prévoir pour le moment')).toBeVisible();
    await expect(page.getByText('3 produit(s) déjà couvert(s) par la liste de courses.')).toBeVisible();
    await page.goto('/courses');
    await expect(page.getByTestId('shop-item')).toHaveCount(3);

    // Calendrier : la rupture du lait apparaît ; celle des bougies, sans données, jamais.
    await page.goto('/previsions?vue=calendrier');
    const ev = page.getByTestId('timeline-event');
    await expect(ev).toHaveCount(1);
    await expect(ev).toContainText('Lait');
    await expect(ev).toContainText('déjà dans la liste');
  });

  test('péremption : priorités par date, DDM dépassée signalée, consommer et jeter depuis la vue, pertes chiffrées', async ({ page }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison dates');
    const yaourt = uid();
    const creme = uid();
    const salade = uid();
    const yLot = uid();
    await seed(page, (op, { loc }) => {
      const frigo = loc['Réfrigérateur'];
      op('product.create', { id: yaourt, name: 'Yaourts', unit: 'pot', locationId: frigo }, 5);
      op('stock.add', { productId: yaourt, lotId: uid(), quantity: 2, expiryDate: inDays(-2), expiryKind: 'ddm' }, 5);
      op('stock.add', { productId: yaourt, lotId: yLot, quantity: 4, expiryDate: inDays(0) }, 5);
      op('product.create', { id: creme, name: 'Crème fraîche', unit: 'pot', locationId: frigo }, 3);
      op('stock.add', { productId: creme, lotId: uid(), quantity: 1, expiryDate: inDays(5) }, 3);
      op('product.create', { id: salade, name: 'Salade', unit: 'piece', locationId: frigo }, 3);
      op('stock.add', { productId: salade, lotId: uid(), quantity: 1, expiryDate: inDays(1), priceCents: 129 }, 3);
    });
    await page.goto('/previsions?vue=peremption');
    await expect(page.getByTestId('expiry-count')).toContainText('4 lots à consommer bientôt');
    await expect(page.getByTestId('expiry-count')).toContainText('dont 3 en urgence');
    const expired = page.getByTestId('expiry-expired');
    await expect(expired).toContainText('Yaourts');
    await expect(expired).toContainText('DDM dépassée');
    await expect(expired).toContainText('souvent encore consommable');
    await expect(page.getByTestId('expiry-today')).toContainText("DLC aujourd'hui");
    await expect(page.getByTestId('expiry-urgent')).toContainText('Salade');
    await expect(page.getByTestId('expiry-soon')).toContainText('Crème fraîche');

    // Consommer le lot du jour, directement depuis la vue.
    await page.getByTestId('expiry-today').getByRole('button', { name: 'Consommer' }).click();
    await page.locator('.sheet .qty-input input').fill('4');
    await page.getByTestId('action-submit').click();
    await expect(page.getByTestId('expiry-today')).toHaveCount(0);

    // Jeter la salade : elle alimente les pertes, valorisées au prix réellement payé.
    await page.getByTestId('expiry-urgent').getByRole('button', { name: 'Jeter Salade' }).click();
    await page.locator('.sheet .segmented button:has-text("Abîmé")').click();
    await page.getByTestId('action-submit').click();
    await expect(page.getByTestId('expiry-urgent')).toHaveCount(0);
    await page.click('.segmented button:has-text("Pertes")');
    await expect(page.getByTestId('waste-count')).toHaveText('1');
    await expect(page.getByTestId('waste-products')).toContainText('Salade');
    await expect(page.getByTestId('waste-products')).toContainText('1,29');
    await expect(page.getByText('Abîmé')).toBeVisible();
  });
});
