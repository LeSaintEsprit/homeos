/**
 * Semaine familiale simulée sur la pile complète (HTTP + SQLite) : deux membres,
 * trois appareils, périodes hors ligne, renvois réseau. Invariants vérifiés chaque soir.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeHousehold, computeInventoryDiff, DEFAULT_SETTINGS, type EntityCollections } from '@homeos/shared';
import { Client, id, makeServer, total, type TestServer } from './helpers';

let s: TestServer;
afterAll(async () => s?.close());

describe('semaine familiale (pile complète)', () => {
  it('quantités cohérentes chaque jour, sur tous les appareils', async () => {
    s = makeServer();
    const alicePhone = new Client(s);
    await alicePhone.register('alice@x.fr', 'Alice');
    const H = await alicePhone.createHousehold('Maison', { timezone: 'Europe/Paris' });
    const alicePc = new Client(s);
    await alicePc.login('alice@x.fr');
    const bobPhone = new Client(s);
    await bobPhone.register('bob@x.fr', 'Bob', await alicePhone.invite(H));
    const devices = [alicePhone, alicePc, bobPhone];

    const st0 = await alicePhone.state(H);
    const loc = (n: string) => [...st0.location.values()].find((l) => l.name === n)!.id;
    const cat = (n: string) => [...st0.category.values()].find((c) => c.name === n)!.id;
    const store = id();
    await alicePc.ok(H, 'store.upsert', { id: store, name: 'Leclerc', address: 'Zone commerciale' });

    const expected: Record<string, number> = {};
    const P = { lait: id(), pates: id(), yaourt: id(), pq: id(), cafe: id() };

    /** Fin de journée : tous les appareils se synchronisent ; contrôles. */
    async function evening(day: string) {
      for (const d of devices) await d.flush(H);
      const integ = (await alicePhone.req('GET', `/api/households/${H}/integrity`)).json;
      expect([day, integ.issues.filter((i: { severity: string }) => i.severity === 'error')]).toEqual([day, []]);
      const views = await Promise.all(devices.map((d) => d.state(H)));
      for (const [k, pid] of Object.entries(P)) {
        if (!(k in expected)) continue;
        for (const v of views) expect([day, k, total(v, pid)]).toEqual([day, k, expected[k]]);
      }
      // Toutes les vues sont identiques (mêmes entités, mêmes versions).
      const sig = (v: EntityCollections) => JSON.stringify([...v.lot.values()].map((l) => [l.id, l.version, l.quantity]).sort());
      expect(new Set(views.map(sig)).size).toBe(1);
      for (const l of views[0].lot.values()) expect(l.quantity).toBeGreaterThanOrEqual(0);
      return views[0];
    }

    // ── Lundi : inventaire initial guidé sur deux appareils (reprise de la même session).
    await alicePhone.ok(H, 'product.create', { id: P.lait, name: 'Lait', unit: 'bouteille', locationId: loc('Réfrigérateur'), categoryId: cat('Produits frais'), minQty: 2, idealQty: 6, openShelfLifeDays: 3 });
    await alicePhone.ok(H, 'product.create', { id: P.pates, name: 'Pâtes', unit: 'g', packUnit: 'paquet', packSize: 500, locationId: loc('Placards'), minQty: 500, idealQty: 2000 });
    await alicePhone.ok(H, 'product.create', { id: P.yaourt, name: 'Yaourt nature', unit: 'pot', locationId: loc('Réfrigérateur'), minQty: 4, idealQty: 12 });
    await alicePhone.ok(H, 'product.create', { id: P.pq, name: 'Papier toilette', unit: 'rouleau', locationId: loc('Salle de bain'), minQty: 4, idealQty: 12 });
    await alicePhone.ok(H, 'productCode.add', { id: id(), productId: P.lait, code: '3428272950014', label: 'Bouteille 1 L' });
    const inv = id();
    await alicePhone.ok(H, 'inventory.start', { id: inv, kind: 'initial', title: 'Inventaire de départ', locationIds: [loc('Réfrigérateur'), loc('Placards'), loc('Salle de bain')] });
    await alicePhone.ok(H, 'inventory.upsertLine', { sessionId: inv, line: { id: id(), productId: P.lait, quantity: 1.5, unit: 'bouteille', qtyApprox: true, locationId: loc('Réfrigérateur'), expiryDate: '2026-11-20' } });
    await alicePhone.ok(H, 'inventory.upsertLine', { sessionId: inv, line: { id: id(), productId: P.yaourt, quantity: 6, unit: 'pot', locationId: loc('Réfrigérateur'), expiryDate: '2026-11-18' } });
    await alicePhone.ok(H, 'inventory.setLocation', { sessionId: inv, locationId: loc('Réfrigérateur'), status: 'done' });
    // Reprise sur le PC (session synchronisée).
    await alicePc.ok(H, 'inventory.upsertLine', { sessionId: inv, line: { id: id(), productId: P.pates, quantity: 1.5, unit: 'paquet', locationId: loc('Placards') } });
    await alicePc.ok(H, 'inventory.upsertLine', { sessionId: inv, line: { id: id(), productId: P.pq, quantity: 9, unit: 'rouleau', locationId: loc('Salle de bain') } });
    const sess = (await alicePc.state(H)).inventorySession.get(inv)!;
    const st = await alicePc.state(H);
    const diffs = computeInventoryDiff(sess, (pid) => st.product.get(pid), (pid) => [...st.lot.values()].filter((l) => l.productId === pid));
    await alicePc.ok(H, 'inventory.apply', { sessionId: inv, decisions: diffs.map((d) => ({ productId: d.productId, expected: d.expected, apply: true })) });
    Object.assign(expected, { lait: 1.5, yaourt: 6, pates: 750, pq: 9 });
    await evening('lundi');

    // ── Mardi : Bob hors ligne au petit-déjeuner, Alice consomme en ligne.
    bobPhone.queue('stock.consume', { productId: P.lait, quantity: 0.5, source: 'scan' });
    bobPhone.queue('stock.consume', { productId: P.pates, quantity: 250 });
    await alicePhone.ok(H, 'stock.consume', { productId: P.yaourt, quantity: 2 });
    // Liste : recommandations ajoutées par Alice, Bob ajoute du lait hors ligne (fusion attendue).
    const sMar = await alicePhone.state(H);
    const forecast = analyzeHousehold({
      products: [...sMar.product.values()], lots: [...sMar.lot.values()], movements: [...sMar.movement.values()], items: [...sMar.shoppingItem.values()],
      purchases: [...sMar.purchase.values()], locations: [...sMar.location.values()], settings: DEFAULT_SETTINGS, now: new Date().toISOString(), today: new Date().toISOString().slice(0, 10),
    });
    for (const r of forecast.recommendations) {
      const p = sMar.product.get(r.productId)!;
      await alicePhone.ok(H, 'shopping.add', { itemId: id(), productId: p.id, name: p.name, quantity: r.displayQty, unit: r.displayUnit, source: 'recommendation', storeId: store });
    }
    bobPhone.queue('shopping.add', { itemId: id(), productId: P.lait, name: 'Lait', quantity: 1, unit: 'bouteille' });
    Object.assign(expected, { lait: 1, pates: 500, yaourt: 4 });
    const sTue = await evening('mardi');
    expect([...sTue.shoppingItem.values()].filter((i) => i.productId === P.lait)).toHaveLength(1);

    // ── Mercredi : courses par Bob (rupture partielle de yaourts), réception avec prix et dates.
    const pending = [...(await bobPhone.state(H)).shoppingItem.values()].filter((i) => i.status === 'pending');
    for (const i of pending) await bobPhone.ok(H, 'shopping.setPurchased', { itemId: i.id, purchasedQty: i.productId === P.yaourt ? Math.max(0, i.quantity - 4) || i.quantity : i.quantity });
    // Rien n'entre en stock avant la réception.
    for (const k of Object.keys(expected)) expect(total(await bobPhone.state(H), P[k as keyof typeof P])).toBe(expected[k]);
    const bought = [...(await bobPhone.state(H)).shoppingItem.values()].filter((i) => i.status === 'purchased' || i.status === 'partial');
    for (const i of bought) {
      const receive = { itemId: i.id, receivedQty: i.purchasedQty, unit: i.unit, totalCents: Math.round(i.purchasedQty * 99), storeId: store, lotId: id(), purchaseId: id(), expiryDate: i.productId === P.lait ? '2026-12-02' : null };
      // Le réseau coupe après l'envoi : l'appareil renvoie la même opération.
      bobPhone.queue('shopping.receive', receive);
      const dup = { ...bobPhone.outbox[bobPhone.outbox.length - 1] };
      await bobPhone.flush(H);
      bobPhone.outbox.push(dup);
      await bobPhone.flush(H);
      const key = (Object.entries(P).find(([, v]) => v === i.productId) ?? [])[0];
      if (key) {
        const prod = (await bobPhone.state(H)).product.get(i.productId!)!;
        const qtyStock = i.unit === prod.unit ? i.purchasedQty : i.purchasedQty * (prod.packSize ?? 1);
        expected[key] = Math.round((expected[key] + qtyStock) * 1e6) / 1e6;
      }
    }
    const sWed = await evening('mercredi');
    expect([...sWed.purchase.values()].every((p) => p.storeId === store && p.totalCents != null && p.userId === bobPhone.userId)).toBe(true);

    // ── Jeudi : Alice ouvre une bouteille de lait (unité isolée), jette les yaourts périmés si besoin.
    await alicePhone.ok(H, 'stock.open', { productId: P.lait });
    const opened = [...(await alicePhone.state(H)).lot.values()].filter((l) => l.productId === P.lait && l.openedAt && l.quantity > 0);
    expect(opened).toHaveLength(1);
    expect(opened[0].quantity).toBeLessThanOrEqual(1);
    await evening('jeudi');

    // ── Vendredi : double scan accidentel sur le PC, annulé.
    const scan2 = alicePc.queue('stock.consume', { productId: P.pq, quantity: 1, source: 'scan' });
    alicePc.queue('stock.consume', { productId: P.pq, quantity: 1, source: 'scan' });
    await alicePc.flush(H);
    await alicePc.ok(H, 'movement.revertOp', { targetOpId: scan2, reason: 'Double scan' });
    expected.pq -= 1;
    await evening('vendredi');

    // ── Samedi : correction approximative par Alice pendant que Bob consomme hors ligne → conflit, puis résolution.
    const lotP = [...(await alicePhone.state(H)).lot.values()].find((l) => l.productId === P.pates && l.quantity > 0)!;
    bobPhone.queue('stock.consume', { productId: P.pates, quantity: 100 });
    await bobPhone.flush(H);
    const conflict = await alicePhone.op(H, 'stock.adjust', { productId: P.pates, lotId: lotP.id, expected: lotP.quantity, quantity: 300, reason: 'unlogged', approx: true });
    expect(conflict.status).toBe('conflict');
    const fresh = (await alicePhone.state(H)).lot.get(lotP.id)!;
    await alicePhone.ok(H, 'stock.adjust', { productId: P.pates, lotId: lotP.id, expected: fresh.quantity, quantity: 300, reason: 'unlogged', approx: true });
    expected.pates = Math.round((expected.pates - 100 - (fresh.quantity - 300)) * 1e6) / 1e6;
    await evening('samedi');

    // ── Dimanche : inventaire correctif du réfrigérateur avec un écart.
    const check = id();
    await bobPhone.ok(H, 'inventory.start', { id: check, kind: 'check', title: 'Frigo du dimanche', locationIds: [loc('Réfrigérateur')] });
    const counted = expected.yaourt - 1;
    await bobPhone.ok(H, 'inventory.upsertLine', { sessionId: check, line: { id: id(), productId: P.yaourt, quantity: counted, unit: 'pot', locationId: loc('Réfrigérateur') } });
    const s2 = await bobPhone.state(H);
    const d2 = computeInventoryDiff(s2.inventorySession.get(check)!, (pid) => s2.product.get(pid), (pid) => [...s2.lot.values()].filter((l) => l.productId === pid));
    expect(d2[0].delta).toBe(-1);
    await bobPhone.ok(H, 'inventory.apply', { sessionId: check, decisions: [{ productId: P.yaourt, expected: d2[0].expected, apply: true }] });
    expected.yaourt = counted;
    const sSun = await evening('dimanche');

    // Bilan : chaque mouvement est daté, attribué, cohérent ; aucun doublon de réception malgré les renvois.
    const moves = [...sSun.movement.values()];
    expect(moves.every((m) => m.userId && m.occurredAt && m.opId && Math.abs(m.quantityBefore + m.delta - m.quantityAfter) < 1e-6)).toBe(true);
    const receptions = moves.filter((m) => m.type === 'purchase');
    expect(new Set(receptions.map((m) => m.opId)).size).toBe(receptions.length);
    expect([...sSun.purchase.values()]).toHaveLength(bought.length);
  });
});
