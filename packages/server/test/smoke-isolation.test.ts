/** Sondage d'isolation (audit) — la suite complète A1/A2/B1/B2 sera écrite en phase 1. */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';

process.env.NODE_ENV = 'test';
const dir = mkdtempSync(join(tmpdir(), 'homeos-iso-'));
const { app, db } = buildApp({ config: loadConfig({}, { dataDir: dir, dbPath: join(dir, 'h.db'), backupDir: join(dir, 'b'), schedulers: false, offEnabled: false, registration: 'open' }) });
afterAll(() => app.close());
const H = { 'x-homeos': '1' };
const ck = (r: { headers: Record<string, unknown> }) => String([r.headers['set-cookie']].flat()[0]).split(';')[0];
const op = (type: string, payload: unknown) => ({ opId: randomUUID(), type, clientTime: new Date().toISOString(), payload });

describe('isolation (sondage)', () => {
  it('B ne peut ni lire, ni écrire, ni écraser les données de A', async () => {
    const a = ck(await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { email: 'a1@x.fr', password: 'motdepasse1', name: 'A1' } }));
    const b = ck(await app.inject({ method: 'POST', url: '/api/auth/register', headers: H, payload: { email: 'b1@x.fr', password: 'motdepasse1', name: 'B1' } }));
    const ha = (await app.inject({ method: 'POST', url: '/api/households', headers: { ...H, cookie: a }, payload: { name: 'Maison A' } })).json().id;
    const hb = (await app.inject({ method: 'POST', url: '/api/households', headers: { ...H, cookie: b }, payload: { name: 'Maison B' } })).json().id;
    const pid = randomUUID();
    await app.inject({ method: 'POST', url: `/api/households/${ha}/sync/push`, headers: { ...H, cookie: a }, payload: { ops: [op('product.create', { id: pid, name: 'Secret A', unit: 'piece', initialStock: { lotId: randomUUID(), quantity: 3 } })] } });
    // Lecture directe du foyer A par B.
    expect((await app.inject({ method: 'GET', url: `/api/households/${ha}/sync/pull?since=0`, headers: { cookie: b } })).statusCode).toBe(404);
    // Écriture directe dans le foyer A par B.
    expect((await app.inject({ method: 'POST', url: `/api/households/${ha}/sync/push`, headers: { ...H, cookie: b }, payload: { ops: [op('stock.consume', { productId: pid, quantity: 1 })] } })).statusCode).toBe(404);
    // B vise un produit de A depuis son propre foyer (identifiant falsifié).
    const r1 = (await app.inject({ method: 'POST', url: `/api/households/${hb}/sync/push`, headers: { ...H, cookie: b }, payload: { ops: [op('stock.consume', { productId: pid, quantity: 1 })] } })).json();
    expect(r1.results[0].status).toBe('rejected');
    // B tente de créer un produit avec l'identifiant d'un produit de A (écrasement).
    const r2 = (await app.inject({ method: 'POST', url: `/api/households/${hb}/sync/push`, headers: { ...H, cookie: b }, payload: { ops: [op('product.create', { id: pid, name: 'Piraté', unit: 'piece' })] } })).json();
    expect(r2.results[0].status).toBe('rejected');
    const row = db.raw.prepare('SELECT name, householdId FROM products WHERE id = ?').get(pid) as { name: string; householdId: string };
    expect(row).toEqual({ name: 'Secret A', householdId: ha });
    expect((db.raw.prepare('SELECT SUM(quantity) q FROM lots WHERE productId = ?').get(pid) as { q: number }).q).toBe(3);
    // Rien de A dans le flux de B.
    const pullB = (await app.inject({ method: 'GET', url: `/api/households/${hb}/sync/pull?since=0`, headers: { cookie: b } })).json();
    expect(JSON.stringify(pullB)).not.toContain('Secret A');
  });
});
