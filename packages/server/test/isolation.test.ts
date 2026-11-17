/**
 * Isolation multi-foyers (MASTER_SPEC §6.3, exigence M4§8).
 * Maison A : A1, A2 ; Maison B : B1, B2 ; C : membre des deux maisons.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, id, makeServer, total, type TestServer } from './helpers';

let s: TestServer;
let A1: Client, A2: Client, B1: Client, B2: Client, C: Client;
let A: string, B: string;
const ids: Record<string, string> = {};
let opA = '';

beforeAll(async () => {
  s = makeServer();
  A1 = new Client(s);
  await A1.register('a1@x.fr', 'A1');
  A = await A1.createHousehold('Maison A');
  A2 = new Client(s);
  await A2.register('a2@x.fr', 'A2', await A1.invite(A));
  B1 = new Client(s);
  await B1.register('b1@x.fr', 'B1');
  B = await B1.createHousehold('Maison B');
  B2 = new Client(s);
  await B2.register('b2@x.fr', 'B2', await B1.invite(B));
  C = new Client(s);
  await C.register('c@x.fr', 'C', await A1.invite(A));
  await C.req('POST', `/api/invitations/${await B1.invite(B)}/accept`);

  // Données de A.
  for (const [k, name] of [['laitA', 'Lait de A'], ['cafeA', 'Café de A']]) {
    ids[k] = id();
    await A1.ok(A, 'product.create', { id: ids[k], name, unit: 'piece', initialStock: { lotId: (ids[`lot_${k}`] = id()), quantity: 5 } });
  }
  ids.itemA = id();
  await A2.ok(A, 'shopping.add', { itemId: ids.itemA, productId: ids.laitA, name: 'Lait de A', quantity: 2, unit: 'piece' });
  ids.storeA = id();
  await A1.ok(A, 'store.upsert', { id: ids.storeA, name: 'Magasin de A' });
  ids.purchaseA = id();
  await A1.ok(A, 'purchase.create', { id: ids.purchaseA, name: 'Achat secret de A', quantity: 1, unit: 'piece', totalCents: 999, date: '2026-11-10' });
  ids.recipeA = id();
  await A1.ok(A, 'recipe.upsert', { id: ids.recipeA, name: 'Recette de A', servings: 2, ingredients: [] });
  ids.sessionA = id();
  await A1.ok(A, 'inventory.start', { id: ids.sessionA, kind: 'check', title: 'Inventaire de A', locationIds: [] });
  A1.queue('stock.consume', { productId: ids.laitA, quantity: 1 });
  opA = A1.outbox[0].opId;
  await A1.flush(A);
  const photo = await A1.req('POST', `/api/households/${A}/photos`, { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' });
  ids.photoA = photo.json.id;

  // Données de B.
  ids.pateB = id();
  await B1.ok(B, 'product.create', { id: ids.pateB, name: 'Pâtes de B', unit: 'paquet', initialStock: { lotId: id(), quantity: 3 } });
  ids.itemB = id();
  await B2.ok(B, 'shopping.add', { itemId: ids.itemB, name: 'Pain de B', quantity: 1, unit: 'piece' });
});
afterAll(async () => s?.close());

const names = async (c: Client, h: string) => {
  const st = await c.state(h);
  return { products: [...st.product.values()].map((p) => p.name).sort(), items: [...st.shoppingItem.values()].map((i) => i.name).sort(), st };
};

describe('isolation des foyers — visibilité', () => {
  it('A1 et A2 voient les données de A (et seulement elles)', async () => {
    for (const c of [A1, A2]) {
      const n = await names(c, A);
      expect(n.products).toEqual(['Café de A', 'Lait de A']);
      expect(n.items).toEqual(['Lait de A']);
      expect(JSON.stringify([...n.st.product.values(), ...n.st.shoppingItem.values(), ...n.st.activity.values()])).not.toMatch(/de B/);
    }
  });

  it('B1 et B2 voient les données de B (et seulement elles)', async () => {
    for (const c of [B1, B2]) {
      const n = await names(c, B);
      expect(n.products).toEqual(['Pâtes de B']);
      expect(n.items).toEqual(['Pain de B']);
      const all = JSON.stringify(Object.fromEntries(Object.entries(n.st).map(([k, v]) => [k, [...v.values()]])));
      expect(all).not.toMatch(/de A|Maison A|a1@x\.fr|a2@x\.fr/);
    }
  });

  it('un utilisateur membre des deux maisons passe de l\'une à l\'autre sans mélange', async () => {
    const me = (await C.req('GET', '/api/auth/me')).json.households.map((h: { name: string }) => h.name);
    expect(me).toEqual(['Maison A', 'Maison B']);
    const a = await names(C, A);
    const b = await names(C, B);
    expect(a.products).toEqual(['Café de A', 'Lait de A']);
    expect(b.products).toEqual(['Pâtes de B']);
    expect(b.items).toEqual(['Pain de B']);
    expect([...b.st.member.values()].map((m) => m.name).sort()).toEqual(['B1', 'B2', 'C']);
  });
});

describe('isolation des foyers — accès directs par API', () => {
  const routes = (h: string) => [
    ['GET', `/api/households/${h}`],
    ['GET', `/api/households/${h}/sync/pull?since=0`],
    ['POST', `/api/households/${h}/sync/push`, { ops: [] }],
    ['GET', `/api/households/${h}/events`],
    ['GET', `/api/households/${h}/export`],
    ['GET', `/api/households/${h}/export/inventaire.csv`],
    ['GET', `/api/households/${h}/integrity`],
    ['GET', `/api/households/${h}/invitations`],
    ['POST', `/api/households/${h}/invitations`, {}],
    ['GET', `/api/households/${h}/backups`],
    ['POST', `/api/households/${h}/restore`, { backup: 'x' }],
    ['POST', `/api/households/${h}/photos`, { dataUrl: 'data:image/png;base64,AAAA' }],
    ['PATCH', `/api/households/${h}/members/${'x'}`, { role: 'admin' }],
    ['DELETE', `/api/households/${h}`, { confirmName: 'x' }],
  ] as const;

  it('A1 ne peut accéder à aucune route de B (404, sans révéler son existence)', async () => {
    for (const [m, url, body] of routes(B)) {
      const r = await A1.req(m, url, body);
      expect([r.status, url]).toEqual([404, url]);
    }
  });

  it('B1 ne peut accéder à aucune route de A', async () => {
    for (const [m, url, body] of routes(A)) {
      const r = await B1.req(m, url, body);
      expect([r.status, url]).toEqual([404, url]);
    }
    expect((await B1.req('GET', `/api/households/${A}/photos/${ids.photoA}`)).status).toBe(404);
    // Même avec son propre foyer dans l'URL, une photo de A est introuvable.
    expect((await B1.req('GET', `/api/households/${B}/photos/${ids.photoA}`)).status).toBe(404);
    expect((await A1.req('GET', `/api/households/${A}/photos/${ids.photoA}`)).status).toBe(200);
  });

  it('un non-connecté n\'accède à rien', async () => {
    const anon = new Client(s);
    for (const [m, url, body] of routes(A)) expect((await anon.req(m, url, body)).status).toBe(401);
  });
});

describe('isolation des foyers — falsification d\'identifiants', () => {
  it('B1 ne peut ni lire, ni modifier, ni écraser des entités de A via son propre foyer', async () => {
    const attempts: [string, unknown][] = [
      ['stock.consume', { productId: ids.laitA, quantity: 1 }],
      ['stock.add', { productId: ids.laitA, lotId: id(), quantity: 100 }],
      ['stock.add', { productId: ids.pateB, lotId: ids.lot_laitA, quantity: 1 }],
      ['stock.finish', { productId: ids.laitA }],
      ['stock.adjust', { productId: ids.laitA, expected: 4, quantity: 0, reason: 'count' }],
      ['stock.move', { lotId: ids.lot_laitA, locationId: id() }],
      ['lot.update', { lotId: ids.lot_laitA, patch: { note: 'piraté' } }],
      ['product.update', { id: ids.laitA, patch: { name: 'Piraté' }, baseVersion: 0 }],
      ['product.archive', { id: ids.laitA, archived: true }],
      ['product.merge', { sourceId: ids.laitA, targetId: ids.pateB }],
      ['product.merge', { sourceId: ids.pateB, targetId: ids.laitA }],
      ['product.create', { id: ids.laitA, name: 'Écrasement', unit: 'piece' }],
      ['productCode.add', { id: id(), productId: ids.laitA, code: '3017620422003' }],
      ['shopping.setPurchased', { itemId: ids.itemA, purchasedQty: 1 }],
      ['shopping.remove', { itemId: ids.itemA }],
      ['shopping.add', { itemId: ids.itemA, name: 'Écrasement', quantity: 1, unit: 'piece' }],
      ['shopping.add', { itemId: id(), productId: ids.laitA, name: 'x', quantity: 1, unit: 'piece' }],
      ['shopping.add', { itemId: id(), name: 'x', quantity: 1, unit: 'piece', storeId: ids.storeA }],
      ['purchase.update', { id: ids.purchaseA, patch: { totalCents: 1 } }],
      ['purchase.delete', { id: ids.purchaseA }],
      ['recipe.cook', { recipeId: ids.recipeA, servings: 2 }],
      ['inventory.upsertLine', { sessionId: ids.sessionA, line: { id: id(), productId: ids.pateB, quantity: 1, unit: 'paquet' } }],
      ['inventory.cancel', { sessionId: ids.sessionA }],
      ['movement.revertOp', { targetOpId: opA }],
      ['store.archive', { id: ids.storeA, archived: true }],
    ];
    const codes: string[] = [];
    for (const [type, payload] of attempts) {
      const r = await B1.op(B, type, payload);
      // Rejet pour la bonne raison (entité introuvable ou écrasement refusé), pas pour une donnée mal formée.
      expect([type, r.status, r.error?.code === 'invalid']).toEqual([type, 'rejected', false]);
      codes.push(`${type}:${r.error?.code}`);
    }
    expect(new Set(codes.map((c) => c.split(':')[1]))).toEqual(new Set(['not_found', 'internal']));
    // Rien n'a changé dans A.
    const st = await A1.state(A);
    expect(st.product.get(ids.laitA)!).toMatchObject({ name: 'Lait de A', archived: false });
    expect(total(st, ids.laitA)).toBe(4);
    expect(st.shoppingItem.get(ids.itemA)!.status).toBe('pending');
    expect(st.purchase.get(ids.purchaseA)!.totalCents).toBe(999);
    expect(st.inventorySession.get(ids.sessionA)!.status).toBe('open');
    expect([...st.movement.values()].filter((m) => m.type === 'revert')).toHaveLength(0);
    expect(st.store.get(ids.storeA)!.archived).toBe(false);
    // Et rien de A n'est apparu dans B.
    const sb = await B1.state(B);
    expect([...sb.product.values()].map((p) => p.name)).toEqual(['Pâtes de B']);
  });

  it('la base refuse physiquement une référence inter-foyers (clés étrangères composites)', () => {
    const insert = () =>
      s.db.tx(() =>
        s.db.raw
          .prepare(
            `INSERT INTO lots (id, householdId, version, productId, quantity, initialQuantity, qtySource, qtyApprox, createdAt, createdBy)
             VALUES (?, ?, 1, ?, 1, 1, 'manual', 0, '2026-01-01', 'x')`,
          )
          .run(id(), B, ids.laitA),
      );
    expect(insert).toThrow(/FOREIGN KEY/);
  });

  it('un utilisateur retiré perd immédiatement ses autorisations', async () => {
    const tmp = new Client(s);
    await tmp.register('tmp@x.fr', 'Temporaire', await A1.invite(A));
    expect((await tmp.req('GET', `/api/households/${A}/sync/pull?since=0`)).status).toBe(200);
    const address = await s.app.listen({ port: 0, host: '127.0.0.1' });
    const ctrl = new AbortController();
    const res = await fetch(`${address}/api/households/${A}/events`, { headers: { cookie: tmp.cookie }, signal: ctrl.signal });
    const reader = res.body!.getReader();
    let text = '';
    const reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
    })();
    await new Promise((r) => setTimeout(r, 50));
    expect((await A1.req('DELETE', `/api/households/${A}/members/${tmp.userId}`)).status).toBe(200);
    await Promise.race([reading, new Promise((r) => setTimeout(r, 2000))]);
    ctrl.abort();
    expect(text).toContain('event: revoked');
    expect((await tmp.req('GET', `/api/households/${A}/sync/pull?since=0`)).status).toBe(404);
    expect((await tmp.op(A, 'shopping.add', { itemId: id(), name: 'x', quantity: 1, unit: 'piece' }).catch((e) => e.message))).toMatch(/push 404/);
    expect((await tmp.req('GET', '/api/auth/me')).json.households).toEqual([]);
  });

  it('les notifications d\'un foyer ne parviennent qu\'à ses membres', async () => {
    const fake = { endpoint: 'https://push.example/b2', keys: { p256dh: 'x', auth: 'y' } };
    await B2.req('POST', '/api/push/subscribe', fake);
    s.pushes.length = 0;
    await A1.ok(A, 'stock.finish', { productId: ids.cafeA });
    await new Promise((r) => setTimeout(r, 20));
    expect(s.pushes.filter((p) => p.endpoint === fake.endpoint)).toHaveLength(0);
  });

  it('import d\'un export : identifiants régénérés, aucune collision avec le foyer d\'origine', async () => {
    const exp = (await A1.req('GET', `/api/households/${A}/export`)).json;
    const imp = await B1.req('POST', '/api/households/import', exp);
    expect(imp.status).toBe(200);
    const newH = imp.json.householdId;
    const st = await B1.state(newH);
    expect([...st.product.values()].map((p) => p.name).sort()).toEqual(['Café de A', 'Lait de A']);
    expect(st.product.has(ids.laitA)).toBe(false);
    // L'original est intact et B1 n'a pas obtenu l'accès à A.
    expect((await B1.req('GET', `/api/households/${A}/sync/pull?since=0`)).status).toBe(404);
    expect(total(await A1.state(A), ids.laitA)).toBe(4);
    // Les membres de A ne sont pas actifs dans la copie importée par B1.
    expect([...st.member.values()].filter((m) => m.active).map((m) => m.userId)).toEqual([B1.userId]);
  });
});
