import { afterEach, describe, expect, it } from 'vitest';
import { auditHousehold } from '@homeos/shared';
import { Client, id, makeServer, total, type TestServer } from './helpers';

let s: TestServer;
afterEach(async () => s?.close());

async function setup() {
  s = makeServer();
  const alice = new Client(s);
  await alice.register('alice@x.fr', 'Alice');
  const hid = await alice.createHousehold('Maison');
  const bob = new Client(s);
  await bob.register('bob@x.fr', 'Bob', await alice.invite(hid));
  return { alice, bob, hid };
}

describe('synchronisation', () => {
  it('rejeu idempotent : une opération renvoyée (réseau coupé) n\'est appliquée qu\'une fois', async () => {
    const { alice, hid } = await setup();
    const pid = id();
    await alice.ok(hid, 'product.create', { id: pid, name: 'Lait', unit: 'bouteille', initialStock: { lotId: id(), quantity: 6 } });
    const op = { opId: id(), type: 'stock.consume', payload: { productId: pid, quantity: 1 }, clientTime: new Date().toISOString() };
    const r1 = await alice.req('POST', `/api/households/${hid}/sync/push`, { ops: [op] });
    const r2 = await alice.req('POST', `/api/households/${hid}/sync/push`, { ops: [op, op] });
    expect(r1.json.results[0].status).toBe('applied');
    expect(r2.json.results).toEqual([r1.json.results[0], r1.json.results[0]]);
    expect(total(await alice.state(hid), pid)).toBe(5);
  });

  it('une opération rejetée reste rejetée au rejeu (aucune application partielle)', async () => {
    const { alice, hid } = await setup();
    const op = { opId: id(), type: 'stock.consume', payload: { productId: 'inexistant-0001', quantity: 1 }, clientTime: new Date().toISOString() };
    const r1 = (await alice.req('POST', `/api/households/${hid}/sync/push`, { ops: [op] })).json.results[0];
    const r2 = (await alice.req('POST', `/api/households/${hid}/sync/push`, { ops: [op] })).json.results[0];
    expect(r1.status).toBe('rejected');
    expect(r2).toEqual(r1);
  });

  it('consommations simultanées de deux membres : quantités cohérentes, jamais négatives', async () => {
    const { alice, bob, hid } = await setup();
    const pid = id();
    await alice.ok(hid, 'product.create', { id: pid, name: 'Yaourts', unit: 'pot', initialStock: { lotId: id(), quantity: 10 } });
    for (let i = 0; i < 6; i++) alice.queue('stock.consume', { productId: pid, quantity: 1 });
    for (let i = 0; i < 6; i++) bob.queue('stock.consume', { productId: pid, quantity: 1 });
    const [ra, rb] = await Promise.all([alice.flush(hid), bob.flush(hid)]);
    const all = [...ra, ...rb];
    expect(all.every((r) => r.status === 'applied')).toBe(true);
    expect(all.filter((r) => r.warnings.some((w) => w.code === 'shortfall'))).toHaveLength(2);
    const st = await alice.state(hid);
    expect(total(st, pid)).toBe(0);
    expect(auditHousehold(st, new Date().toISOString()).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('file hors ligne : l\'ordre des opérations d\'un appareil est respecté', async () => {
    const { bob, hid } = await setup();
    const pid = id();
    const lot = id();
    const item = id();
    bob.queue('product.create', { id: pid, name: 'Pâtes', unit: 'paquet' });
    bob.queue('stock.add', { productId: pid, lotId: lot, quantity: 3 });
    bob.queue('stock.consume', { productId: pid, quantity: 1 });
    bob.queue('shopping.add', { itemId: item, productId: pid, name: 'Pâtes', quantity: 2, unit: 'paquet' });
    bob.queue('shopping.setPurchased', { itemId: item, purchasedQty: 2 });
    const res = await bob.flush(hid);
    expect(res.map((r) => r.status)).toEqual(['applied', 'applied', 'applied', 'applied', 'applied']);
    expect(bob.outbox).toHaveLength(0);
    const st = await bob.state(hid);
    expect(total(st, pid)).toBe(2);
    expect(st.shoppingItem.get(item)!.status).toBe('purchased');
  });

  it('doublons ajoutés hors ligne par deux membres : fusion et redirection de l\'identifiant', async () => {
    const { alice, bob, hid } = await setup();
    const pid = id();
    await alice.ok(hid, 'product.create', { id: pid, name: 'Lait', unit: 'bouteille' });
    const itemA = id();
    const itemB = id();
    alice.queue('shopping.add', { itemId: itemA, productId: pid, name: 'Lait', quantity: 2, unit: 'bouteille' });
    bob.queue('shopping.add', { itemId: itemB, productId: pid, name: 'Lait', quantity: 1, unit: 'bouteille' });
    bob.queue('shopping.update', { itemId: itemB, patch: { comment: 'Bio' }, baseVersion: 0 });
    await alice.flush(hid);
    const rb = await bob.flush(hid);
    expect(rb[0].aliases).toEqual([{ type: 'shoppingItem', from: itemB, to: itemA }]);
    expect(rb[1].status).toBe('applied');
    const items = [...(await alice.state(hid)).shoppingItem.values()];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: itemA, quantity: 3, comment: 'Bio' });
  });

  it('modification concurrente d\'un même champ : conflit signalé, pas d\'écrasement', async () => {
    const { alice, bob, hid } = await setup();
    const pid = id();
    await alice.ok(hid, 'product.create', { id: pid, name: 'Café', unit: 'g' });
    const v = (await alice.state(hid)).product.get(pid)!.version;
    await alice.ok(hid, 'product.update', { id: pid, patch: { minQty: 250 }, baseVersion: v });
    const r = await bob.op(hid, 'product.update', { id: pid, patch: { minQty: 500, notes: 'Moulu' }, baseVersion: v });
    expect(r.conflicts).toEqual([expect.objectContaining({ field: 'minQty', mine: 500, theirs: 250, theirsBy: alice.userId })]);
    const p = (await alice.state(hid)).product.get(pid)!;
    expect([p.minQty, p.notes]).toEqual([250, 'Moulu']);
  });

  it('pull paginé et suppressions (pierres tombales)', async () => {
    const { alice, hid } = await setup();
    const pid = id();
    await alice.ok(hid, 'product.create', { id: pid, name: 'Eau', unit: 'bouteille' });
    for (let i = 0; i < 30; i++) await alice.ok(hid, 'stock.add', { productId: pid, lotId: id(), quantity: 1 });
    const code = id();
    await alice.ok(hid, 'productCode.add', { id: code, productId: pid, code: '3274080005003' });
    const full = await alice.state(hid, 2000);
    const paged = await alice.state(hid, 7);
    expect(paged.lot.size).toBe(30);
    expect(paged.movement.size).toBe(full.movement.size);
    expect(paged.productCode.has(code)).toBe(true);
    await alice.ok(hid, 'productCode.remove', { id: code });
    expect((await alice.state(hid, 5)).productCode.has(code)).toBe(false);
    // Pull incrémental depuis un curseur : seulement les nouveautés.
    const seq = (await alice.req('GET', `/api/households/${hid}/sync/pull?since=0`)).json.seq;
    await alice.ok(hid, 'stock.consume', { productId: pid, quantity: 1 });
    const inc = (await alice.req('GET', `/api/households/${hid}/sync/pull?since=${seq}`)).json;
    expect(inc.changes.map((c: { t: string }) => c.t).sort()).toEqual(['activity', 'lot', 'movement']);
  });

  it('refuse une opération hors ligne trop ancienne (garantie d\'idempotence)', async () => {
    const { alice, hid } = await setup();
    alice.queue('category.upsert', { id: id(), name: 'Vieille' }, new Date(Date.now() - 200 * 86_400_000).toISOString());
    const [r] = await alice.flush(hid);
    expect(r.status).toBe('rejected');
    expect(r.error!.code).toBe('too_old');
  });

  it('temps réel : un membre est notifié des changements d\'un autre (SSE)', async () => {
    const { alice, bob, hid } = await setup();
    const address = await s.app.listen({ port: 0, host: '127.0.0.1' });
    const ctrl = new AbortController();
    const res = await fetch(`${address}/api/households/${hid}/events`, { headers: { cookie: bob.cookie }, signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const events: string[] = [];
    const read = (async () => {
      let buf = '';
      while (!events.includes('change')) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        for (const m of buf.matchAll(/event: (\w+)/g)) if (!events.includes(m[1])) events.push(m[1]);
      }
    })();
    await new Promise((r) => setTimeout(r, 50));
    await alice.ok(hid, 'shopping.add', { itemId: id(), name: 'Pain', quantity: 1, unit: 'piece' });
    await Promise.race([read, new Promise((r) => setTimeout(r, 2000))]);
    ctrl.abort();
    expect(events).toEqual(['hello', 'change']);
  });
});
