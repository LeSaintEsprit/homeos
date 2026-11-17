import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifyBackupFile } from '../src/backup';
import { Client, id, makeServer, total, type TestServer } from './helpers';

let s: TestServer;
afterEach(async () => s?.close());

async function seeded() {
  s = makeServer();
  const admin = new Client(s);
  await admin.register('admin@x.fr', 'Admin');
  const A = await admin.createHousehold('Maison A');
  const lait = id();
  await admin.ok(A, 'product.create', { id: lait, name: 'Lait', unit: 'bouteille', minQty: 2, initialStock: { lotId: id(), quantity: 6, expiryDate: '2026-12-01', priceCents: 600 } });
  await admin.ok(A, 'stock.consume', { productId: lait, quantity: 1 });
  await admin.ok(A, 'shopping.add', { itemId: id(), productId: lait, name: 'Lait', quantity: 2, unit: 'bouteille' });
  const sister = new Client(s);
  await sister.register('soeur@x.fr', 'Sœur');
  const B = await sister.createHousehold('Maison B');
  const riz = id();
  await sister.ok(B, 'product.create', { id: riz, name: 'Riz', unit: 'kg', initialStock: { lotId: id(), quantity: 2 } });
  return { admin, sister, A, B, lait, riz };
}

const snapshot = async (c: Client, h: string) => {
  const st = await c.state(h);
  return {
    products: [...st.product.values()].map((p) => [p.name, p.minQty]).sort(),
    lots: [...st.lot.values()].map((l) => [l.quantity, l.expiryDate, l.unitPriceCents]).sort(),
    movements: st.movement.size,
    items: [...st.shoppingItem.values()].map((i) => [i.name, i.quantity]),
    purchases: [...st.purchase.values()].map((p) => p.totalCents),
  };
};

describe('sauvegardes', () => {
  it('chaque sauvegarde est vérifiée (intégrité, clés étrangères, lecture) et documentée', async () => {
    const { admin } = await seeded();
    const r = await admin.req('POST', '/api/admin/backups');
    const b = r.json.backup;
    expect(b).toMatchObject({ reason: 'manual', verified: true, verifyError: null });
    expect(b.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.counts).toMatchObject({ households: 2, products: 2, users: 2 });
    // Une sauvegarde = un fichier autonome (+ sa fiche), sans fichiers -wal/-shm à côté.
    expect(readdirSync(s.config.backupDir).sort()).toEqual([b.name, `${b.name}.json`]);
    expect((await admin.req('GET', '/api/admin/backups')).json.backups.map((x: { name: string }) => x.name)).toContain(b.name);
    const dl = await admin.req('GET', `/api/admin/backups/${b.name}`);
    expect(dl.status).toBe(200);
    expect(dl.body.slice(0, 15)).toBe('SQLite format 3');
  });

  it('une sauvegarde corrompue est détectée et sa restauration refusée', async () => {
    const { admin } = await seeded();
    const b = (await admin.req('POST', '/api/admin/backups')).json.backup;
    const path = join(s.config.backupDir, b.name);
    const buf = readFileSync(path);
    buf.fill(0x41, 4096, 8192);
    writeFileSync(path, buf);
    expect(verifyBackupFile(path).ok).toBe(false);
    const r = await admin.req('POST', `/api/admin/backups/${b.name}/restore`, { confirm: 'RESTAURER' });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/invalide/);
  });

  it('PREUVE : sauvegarde → modifications → restauration → données identiques à la sauvegarde', async () => {
    const { admin, sister, A, B, lait } = await seeded();
    const beforeA = await snapshot(admin, A);
    const beforeB = await snapshot(sister, B);
    const epoch0 = (await admin.req('GET', '/api/health')).json.epoch;
    const b = (await admin.req('POST', '/api/admin/backups')).json.backup;
    // Modifications postérieures à la sauvegarde.
    await admin.ok(A, 'stock.consume', { productId: lait, quantity: 3 });
    await admin.ok(A, 'product.create', { id: id(), name: 'Ajouté après', unit: 'piece' });
    expect((await snapshot(admin, A)).products).toHaveLength(2);
    // Seul l'administrateur du serveur peut restaurer toute l'instance.
    expect((await sister.req('POST', `/api/admin/backups/${b.name}/restore`, { confirm: 'RESTAURER' })).status).toBe(403);
    const r = await admin.req('POST', `/api/admin/backups/${b.name}/restore`, { confirm: 'RESTAURER' });
    expect(r.status).toBe(200);
    expect(r.json.safetyBackup).toMatch(/pre-restore/);
    expect(r.json.epoch).not.toBe(epoch0);
    expect(await snapshot(admin, A)).toEqual(beforeA);
    expect(await snapshot(sister, B)).toEqual(beforeB);
    expect((await admin.req('GET', `/api/households/${A}/integrity`)).json.ok).toBe(true);
    // La sauvegarde de sécurité prise avant la restauration contient bien l'état modifié.
    expect(verifyBackupFile(join(s.config.backupDir, r.json.safetyBackup)).counts.products).toBe(3);
  });

  it('restauration d\'UN foyer sans toucher aux autres familles', async () => {
    const { admin, sister, A, B, riz } = await seeded();
    await admin.req('POST', '/api/admin/backups');
    // La sœur perd des données par erreur…
    await sister.ok(B, 'stock.finish', { productId: riz });
    await sister.ok(B, 'product.archive', { id: riz, archived: true });
    // … pendant que la Maison A continue sa vie.
    await admin.ok(A, 'product.create', { id: id(), name: 'Nouveau dans A', unit: 'piece' });
    const list = (await sister.req('GET', `/api/households/${B}/backups`)).json.backups;
    expect(list).toHaveLength(1);
    // A ne voit pas les sauvegardes de B par cette route.
    expect((await admin.req('GET', `/api/households/${B}/backups`)).status).toBe(404);
    const r = await sister.req('POST', `/api/households/${B}/restore`, { backup: list[0].name });
    expect(r.status).toBe(200);
    const restored = await sister.state(r.json.householdId);
    expect([...restored.household.values()][0].name).toMatch(/^Maison B \(restauré du /);
    expect([...restored.product.values()].map((p) => [p.name, p.archived])).toEqual([['Riz', false]]);
    expect(total(restored, [...restored.product.values()][0].id)).toBe(2);
    // La Maison A est intacte et n'apparaît pas dans la restauration.
    expect((await snapshot(admin, A)).products).toEqual([['Lait', 2], ['Nouveau dans A', null]]);
    expect(JSON.stringify([...restored.product.values()])).not.toContain('Lait');
  });

  it('rotation : 14 quotidiennes, 12 mensuelles, sauvegardes manuelles conservées 30 jours', async () => {
    s = makeServer({ backupKeepDaily: 3, backupKeepMonthly: 2 });
    const mk = (name: string, reason: string, createdAt: string) => {
      writeFileSync(join(s.config.backupDir, name), 'x');
      writeFileSync(join(s.config.backupDir, `${name}.json`), JSON.stringify({ name, reason, createdAt, sizeBytes: 1, sha256: '', verified: true, verifyError: null, counts: {} }));
    };
    const days = ['2026-08-03', '2026-09-02', '2026-10-01', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
    days.forEach((d) => mk(`homeos-auto-${d.replace(/-/g, '')}T020000Z.db`, 'auto', `${d}T02:00:00.000Z`));
    mk('homeos-manual-20260101T020000Z.db', 'manual', '2026-01-01T02:00:00.000Z');
    mk('homeos-manual-20261115T020000Z.db', 'manual', new Date(Date.now() - 86_400_000).toISOString());
    s.backups.rotate();
    const kept = s.backups.list().map((b) => b.name).sort();
    // 3 quotidiennes (11, 12, 13/11) + la première de chacun des 2 derniers mois (01/10, 10/11) + la manuelle récente.
    expect(kept).toEqual([
      'homeos-auto-20261001T020000Z.db',
      'homeos-auto-20261110T020000Z.db',
      'homeos-auto-20261111T020000Z.db',
      'homeos-auto-20261112T020000Z.db',
      'homeos-auto-20261113T020000Z.db',
      'homeos-manual-20261115T020000Z.db',
    ]);
  });
});

describe('export et import', () => {
  it('aller-retour JSON : même contenu, nouveaux identifiants, intégrité vérifiée', async () => {
    const { admin, A } = await seeded();
    await admin.req('POST', `/api/households/${A}/photos`, { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
    const exp = await admin.req('GET', `/api/households/${A}/export`);
    expect(exp.headers['content-disposition']).toMatch(/attachment; filename="homeos-/);
    expect(exp.json.photos).toHaveLength(1);
    const imp = await admin.req('POST', '/api/households/import', exp.json);
    expect(imp.status).toBe(200);
    expect(imp.json.issues.filter((i: { severity: string }) => i.severity === 'error')).toEqual([]);
    const a = await snapshot(admin, A);
    const b = await snapshot(admin, imp.json.householdId);
    expect(b).toEqual(a);
    expect(s.backups.list().some((x) => x.reason === 'pre-import')).toBe(true);
    expect((await admin.req('POST', '/api/households/import', { format: 'autre' })).json.error.code).toBe('invalid_file');
  });

  it('exports CSV lisibles par un tableur français', async () => {
    const { admin, A } = await seeded();
    const inv = await admin.req('GET', `/api/households/${A}/export/inventaire.csv`);
    expect(inv.headers['content-type']).toMatch(/text\/csv/);
    expect(inv.body.charCodeAt(0)).toBe(0xfeff);
    expect(inv.body).toContain('Produit;Catégorie;Emplacement;Quantité');
    expect(inv.body).toContain('Lait;');
    const mv = (await admin.req('GET', `/api/households/${A}/export/mouvements.csv`)).body;
    expect(mv.split('\r\n')).toHaveLength(3);
    const ach = (await admin.req('GET', `/api/households/${A}/export/achats.csv`)).body;
    expect(ach).toContain('6');
  });

  it('un membre en lecture seule ne peut pas exporter', async () => {
    const { admin, A } = await seeded();
    const v = new Client(s);
    await v.register('v@x.fr', 'V', await admin.invite(A, { role: 'viewer' }));
    expect((await v.req('GET', `/api/households/${A}/export`)).status).toBe(403);
  });
});
