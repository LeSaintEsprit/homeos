/** Test de fumée (audit) : le serveur démarre et le cycle de base fonctionne. */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';

process.env.NODE_ENV = 'test';
const dir = mkdtempSync(join(tmpdir(), 'homeos-smoke-'));
const { app } = buildApp({ config: loadConfig({}, { dataDir: dir, dbPath: join(dir, 'h.db'), backupDir: join(dir, 'b'), schedulers: false, offEnabled: false }) });
afterAll(() => app.close());

function cookieOf(res: { headers: Record<string, unknown> }) {
  const c = res.headers['set-cookie'];
  return String(Array.isArray(c) ? c[0] : c).split(';')[0];
}
const H = { 'x-homeos': '1' };

describe('smoke', () => {
  it('inscription, foyer, push, pull', async () => {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { email: 'a1@x.fr', password: 'motdepasse1', name: 'A1' } });
    expect(reg.statusCode).toBe(200);
    const cookie = cookieOf(reg);
    const hh = await app.inject({ method: 'POST', url: '/api/households', headers: { ...H, cookie }, payload: { name: 'Maison A' } });
    expect(hh.statusCode).toBe(200);
    const hid = hh.json().id;
    const pid = randomUUID();
    const push = await app.inject({
      method: 'POST', url: `/api/households/${hid}/sync/push`, headers: { ...H, cookie },
      payload: { ops: [
        { opId: randomUUID(), type: 'product.create', clientTime: new Date().toISOString(), payload: { id: pid, name: 'Lait', unit: 'bouteille', initialStock: { lotId: randomUUID(), quantity: 2 } } },
        { opId: randomUUID(), type: 'stock.consume', clientTime: new Date().toISOString(), payload: { productId: pid, quantity: 1 } },
      ] },
    });
    expect(push.statusCode).toBe(200);
    expect(push.json().results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied']);
    const pull = await app.inject({ method: 'GET', url: `/api/households/${hid}/sync/pull?since=0`, headers: { cookie } });
    expect(pull.statusCode).toBe(200);
    const lots = pull.json().changes.filter((c: { t: string }) => c.t === 'lot');
    expect(lots[0].e.quantity).toBe(1);
    const integ = await app.inject({ method: 'GET', url: `/api/households/${hid}/integrity`, headers: { cookie } });
    expect(integ.json().ok).toBe(true);
  });
});
