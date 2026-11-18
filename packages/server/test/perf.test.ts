import { afterEach, describe, expect, it } from 'vitest';
import { SqlStore } from '../src/sqlStore';
import { Client, id, makeServer, type TestServer } from './helpers';

let s: TestServer;
afterEach(async () => s?.close());

describe('performances serveur (foyer volumineux)', () => {
  it('première synchronisation complète de 1 000 produits et 50 000 mouvements en quelques secondes', async () => {
    s = makeServer();
    const a = new Client(s);
    await a.register('a@x.fr', 'A');
    const hid = await a.createHousehold('Grande maison');
    const user = (await a.req('GET', '/api/auth/me')).json.user.id as string;
    // Données insérées directement (même couche d'accès que les opérations, sans en rejouer 50 000).
    s.db.tx(() => {
      const store = new SqlStore(s.db, hid, user);
      const t0 = Date.parse('2026-01-01T08:00:00Z');
      for (let i = 0; i < 1000; i++) {
        const pid = id();
        store.put('product', {
          id: pid, householdId: hid, version: 0, name: `Produit ${i}`, brand: null, family: null, aliases: [], categoryId: null, locationId: null, unit: 'piece',
          minQty: null, idealQty: null, packUnit: null, packSize: null, photoId: null, defaultStoreId: null, notes: null, trackStock: true, openShelfLifeDays: null,
          defaultShelfLifeDays: null, manualDailyUse: null, archived: false, createdAt: new Date(t0).toISOString(), createdBy: user, updatedAt: new Date(t0).toISOString(), fv: {},
        });
        const lotId = id();
        let q = 0;
        for (let k = 0; k < 50; k++) {
          const delta = k % 2 ? -1 : 2;
          const at = new Date(t0 + k * 86400e3).toISOString();
          store.put('movement', {
            id: id(), householdId: hid, version: 0, opId: id(), productId: pid, lotId: null, type: delta > 0 ? 'purchase' : 'consume', delta, quantityBefore: q, quantityAfter: q + delta,
            reason: null, note: null, userId: user, occurredAt: at, createdAt: at, source: 'manual', flags: [], revertOf: null, revertedBy: null, inputQty: null, inputUnit: null,
          } as never);
          q += delta;
        }
        void lotId;
      }
    });
    const t = performance.now();
    const st = await a.state(hid);
    const ms = performance.now() - t;
    console.log(`synchronisation initiale : ${Math.round(ms)} ms`);
    expect(st.product.size).toBe(1000);
    expect(st.movement.size).toBe(50_000);
    expect(ms).toBeLessThan(8000);
  }, 60_000);
});
