import { afterEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/barcode';
import { Client, id, makeServer, type TestServer } from './helpers';

let s: TestServer;
afterEach(async () => s?.close());

const NUTELLA = {
  code: '3017620422003',
  status: 1,
  product: {
    brands: 'Ferrero, Nutella', categories_tags: ['en:breakfasts', 'en:spreads', 'fr:pates-a-tartiner'], code: '3017620422003',
    generic_name_fr: 'Pâte à tartiner aux noisettes et au cacao', image_front_small_url: 'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.200.jpg',
    product_name: 'Nutella', product_name_fr: 'Nutella', product_quantity: 400, product_quantity_unit: 'g', quantity: '400 g e',
  },
};

function fakeFetch(routes: Record<string, { status: number; json?: unknown; body?: Buffer; type?: string }>, calls: { url: string; ua?: string }[]): FetchLike {
  return async (url, init) => {
    calls.push({ url, ua: init?.headers?.['User-Agent'] });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const r = key ? routes[key] : { status: 404, json: { status: 0 } };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
      arrayBuffer: async () => (r.body ?? Buffer.alloc(0)).buffer.slice(0) as ArrayBuffer,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? (r.type ?? 'application/json') : null) },
    };
  };
}

async function user() {
  const c = new Client(s);
  await c.register('a@x.fr', 'A');
  return c;
}

describe('recherche de codes-barres (Open Food / Beauty / Products Facts)', () => {
  it('trouve un produit alimentaire, stocke sa photo localement, respecte le User-Agent', async () => {
    const calls: { url: string; ua?: string }[] = [];
    s = makeServer({ offEnabled: true }, {
      fetchImpl: fakeFetch(
        {
          'openfoodfacts.org/api/v2/product/3017620422003': { status: 200, json: NUTELLA },
          'images.openfoodfacts.org': { status: 200, body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), type: 'image/jpeg' },
        },
        calls,
      ),
    });
    const c = await user();
    const r = await c.req('GET', '/api/barcode/3017620422003');
    expect(r.json.status).toBe('found');
    expect(r.json.product).toMatchObject({ name: 'Nutella', brand: 'Nutella', unit: 'g', amount: 400, categoryKey: 'epicerie', source: 'off' });
    expect(r.json.imagePath).toBe('/api/barcode/3017620422003/image');
    expect('cached' in r.json).toBe(false);
    expect(calls[0].ua).toMatch(/^HomeOS\//);
    expect((await c.req('GET', r.json.imagePath)).headers['content-type']).toBe('image/jpeg');
    // Deuxième recherche : servie par le cache, aucun appel externe.
    const n = calls.length;
    expect((await c.req('GET', '/api/barcode/03017620422003')).json.status).toBe('found');
    expect(calls.length).toBe(n);
  });

  it('produits d\'hygiène et d\'entretien : bascule vers Open Beauty Facts puis Open Products Facts', async () => {
    const calls: { url: string }[] = [];
    s = makeServer({ offEnabled: true }, {
      fetchImpl: fakeFetch(
        {
          'openfoodfacts.org/api/v2/product/3600523631575': { status: 200, json: { status: 0 } },
          'openbeautyfacts.org/api/v2/product/3600523631575': { status: 200, json: { status: 1, product: { product_name: 'Shampooing doux', brands: 'Marque', quantity: '250 ml', categories_tags: ['en:shampoos'] } } },
        },
        calls,
      ),
    });
    const r = await (await user()).req('GET', '/api/barcode/3600523631575');
    expect(r.json.product).toMatchObject({ name: 'Shampooing doux', source: 'obf', unit: 'ml', amount: 250, categoryKey: 'hygiene' });
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['world.openfoodfacts.org', 'world.openbeautyfacts.org']);
  });

  it('code inconnu partout, code invalide, service indisponible', async () => {
    const calls: { url: string }[] = [];
    s = makeServer({ offEnabled: true }, { fetchImpl: fakeFetch({ '5000112548167': { status: 503 } }, calls) });
    const c = await user();
    expect((await c.req('GET', '/api/barcode/3560070000005')).json.status).toBe('not_found');
    expect(calls).toHaveLength(3);
    expect((await c.req('GET', '/api/barcode/3560070000005')).json.status).toBe('not_found');
    expect(calls).toHaveLength(3); // absence mise en cache
    expect((await c.req('GET', '/api/barcode/3017620422004')).json.status).toBe('invalid');
    expect((await c.req('GET', '/api/barcode/5000112548167')).json.status).toBe('unavailable');
    expect((await new Client(s).req('GET', '/api/barcode/3017620422003')).status).toBe(401);
  });
});

describe('notifications push', () => {
  async function household() {
    s = makeServer();
    const a = new Client(s);
    await a.register('a@x.fr', 'A');
    const hid = await a.createHousehold('Maison', { timezone: 'UTC' });
    const b = new Client(s);
    await b.register('b@x.fr', 'B', await a.invite(hid));
    await a.req('POST', '/api/push/subscribe', { endpoint: 'https://push.example/a', keys: { p256dh: 'k', auth: 'x' } });
    await b.req('POST', '/api/push/subscribe', { endpoint: 'https://push.example/b', keys: { p256dh: 'k', auth: 'x' } });
    const p = id();
    await a.ok(hid, 'product.create', { id: p, name: 'Café', unit: 'paquet', minQty: 2, initialStock: { lotId: id(), quantity: 1 } });
    return { a, b, hid, p };
  }

  it('récapitulatif quotidien à l\'heure choisie, envoyé une seule fois par jour', async () => {
    const { a, hid } = await household();
    const at = new Date('2026-11-17T08:05:00Z');
    await a.ok(hid, 'member.updateSelf', { prefs: { notifications: { muted: [], digest: 'daily', digestHour: 8, pushImportant: false } } });
    s.pushes.length = 0;
    // A l'a choisi ; B a les préférences par défaut (quotidien à 8 h) : chacun reçoit le sien.
    expect(await s.push.runDigests(at)).toBe(2);
    expect(s.pushes.map((p) => p.endpoint).sort()).toEqual(['https://push.example/a', 'https://push.example/b']);
    expect(s.pushes[0].payload.title).toContain('point du jour');
    expect(s.pushes[0].payload.body).toContain('Café');
    expect(await s.push.runDigests(new Date('2026-11-17T08:20:00Z'))).toBe(0);
    expect(await s.push.runDigests(new Date('2026-11-17T09:05:00Z'))).toBe(0);
    expect(await s.push.runDigests(new Date('2026-11-18T08:05:00Z'))).toBe(2);
  });

  it('préférences : types désactivés, récapitulatif désactivé', async () => {
    const { a, b, hid } = await household();
    await a.ok(hid, 'member.updateSelf', { prefs: { notifications: { muted: ['stock_low', 'to_buy', 'inventory_check', 'data_issue'], digest: 'daily', digestHour: 8, pushImportant: false } } });
    await b.ok(hid, 'member.updateSelf', { prefs: { notifications: { muted: [], digest: 'off', digestHour: 8, pushImportant: false } } });
    s.pushes.length = 0;
    expect(await s.push.runDigests(new Date('2026-11-17T08:05:00Z'))).toBe(0);
  });

  it('alerte immédiate des autres membres pour une modification importante', async () => {
    const { a, b, hid, p } = await household();
    await a.ok(hid, 'member.updateSelf', { prefs: { notifications: { muted: [], digest: 'off', digestHour: 8, pushImportant: true } } });
    s.pushes.length = 0;
    await b.ok(hid, 'stock.reportMissing', { productId: p, itemId: id() });
    await new Promise((r) => setTimeout(r, 20));
    expect(s.pushes.map((x) => x.endpoint)).toEqual(['https://push.example/a']);
    expect(s.pushes[0].payload.body).toBe('B a signalé « Café » manquant');
  });
});
