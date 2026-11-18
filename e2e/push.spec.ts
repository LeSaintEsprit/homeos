import { expect, test } from '@playwright/test';
import { createHousehold, register, uniq } from './helpers';

/**
 * Le service push du navigateur (FCM, Mozilla, Apple) n'est pas joignable ici : le message
 * est livré au service worker par le protocole de débogage de Chromium, exactement comme
 * s'il venait du serveur push. L'envoi côté serveur est couvert par services.test.
 */
// Le Chromium « allégé » des tests refuse toute permission de notification : navigateur complet ici.
test.use({ channel: 'chromium' });

test.describe('Phase 12 — notifications push sur l’appareil', () => {
  test('un message push affiche une notification nommant le foyer ; son lien ouvre l’application sur ce foyer', async ({ page, context }) => {
    await register(page, 'Nicolas', `${uniq('n')}@x.fr`);
    await createHousehold(page, 'Maison A');
    const hidA = await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).households[0].id as string);
    await page.goto('/foyers/nouveau');
    await createHousehold(page, 'Chalet');
    await expect(page.getByTestId('active-household')).toHaveText('Chalet');

    await context.grantPermissions(['notifications']);
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active, null, { timeout: 15000 });
    const cdp = await context.newCDPSession(page);
    const reg = new Promise<string>((resolve) => {
      cdp.on('ServiceWorker.workerRegistrationUpdated', (e: { registrations: { registrationId: string; isDeleted: boolean }[] }) => {
        const r = e.registrations.find((x) => !x.isDeleted);
        if (r) resolve(r.registrationId);
      });
    });
    await cdp.send('ServiceWorker.enable');
    const registrationId = await reg;
    const origin = new URL(page.url()).origin;
    const payload = { title: 'HOMEOS · Maison A', body: 'Bob a signalé « Lait » manquant', url: `/notifications?foyer=${hidA}`, tag: 'act-1' };
    await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(payload) });

    await expect
      .poll(async () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, url: (n.data as { url: string }).url, tag: n.tag }))), { timeout: 10000 })
      .toEqual([payload]);
    // Même étiquette : la notification est remplacée, pas empilée.
    await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ ...payload, body: 'Mise à jour' }) });
    await expect.poll(async () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => n.body))).toEqual(['Mise à jour']);

    // Ouvrir le lien de la notification bascule sur « Maison A », puis le retire de l'adresse.
    await page.goto(payload.url);
    await expect(page.getByTestId('active-household')).toHaveText('Maison A');
    await expect(page).toHaveURL(/\/notifications$/);
    // Un identifiant de foyer étranger est ignoré (aucun accès, aucune bascule).
    await page.goto('/notifications?foyer=00000000-0000-4000-8000-000000000000');
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByTestId('active-household')).toHaveText('Maison A');
  });
});
