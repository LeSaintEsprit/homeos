import { afterEach, describe, expect, it } from 'vitest';
import { Client, id, makeServer, type TestServer } from './helpers';

let s: TestServer;
afterEach(async () => s?.close());

async function family() {
  s = makeServer();
  const admin = new Client(s);
  await admin.register('moi@x.fr', 'Moi');
  const hid = await admin.createHousehold('Maison familiale', {
    avatar: '🏡',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    settings: { shoppingIntervalDays: 5, monthlyBudgetCents: 60000 },
    notifications: { digest: 'weekly', digestHour: 19 },
  });
  return { admin, hid };
}

describe('création du foyer', () => {
  it('nom, avatar, devise, paramètres, préférences de notification ; le créateur est administrateur', async () => {
    const { admin, hid } = await family();
    const st = await admin.state(hid);
    const h = st.household.get(hid)!;
    expect(h).toMatchObject({ name: 'Maison familiale', avatar: '🏡', currency: 'EUR', createdBy: admin.userId });
    expect(h.settings).toMatchObject({ shoppingIntervalDays: 5, monthlyBudgetCents: 60000, timezone: 'Europe/Paris' });
    const me = [...st.member.values()][0];
    expect(me.role).toBe('admin');
    expect(me.prefs.notifications).toMatchObject({ digest: 'weekly', digestHour: 19 });
    expect(st.category.size).toBe(9);
    expect([...st.location.values()].map((l) => l.name)).toContain('Cuisine');
  });

  it('refuse une devise ou un fuseau inconnus', async () => {
    const { admin } = await family();
    expect((await admin.req('POST', '/api/households', { name: 'X', currency: 'ZZZ' })).status).toBe(400);
    expect((await admin.req('POST', '/api/households', { name: 'X', timezone: 'Mars/Olympus' })).status).toBe(400);
  });
});

describe('invitations', () => {
  it('code, lien (aperçu), rôle attribué, accès immédiat aux données', async () => {
    const { admin, hid } = await family();
    await admin.ok(hid, 'product.create', { id: id(), name: 'Lait', unit: 'bouteille' });
    const r = await admin.req('POST', `/api/households/${hid}/invitations`, { role: 'viewer', days: 3, maxUses: 2 });
    expect(r.json.link).toMatch(/\/invitation\/[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    const code: string = r.json.invitation.code;
    const preview = await new Client(s).req('GET', `/api/invitations/${code.toLowerCase().replace('-', ' ')}`);
    expect(preview.json).toMatchObject({ kind: 'household', householdName: 'Maison familiale', householdAvatar: '🏡', inviterName: 'Moi', role: 'viewer' });
    const papa = new Client(s);
    await papa.register('papa@x.fr', 'Papa', code);
    const st = await papa.state(hid);
    expect([...st.product.values()].map((p) => p.name)).toEqual(['Lait']);
    expect([...st.member.values()].find((m) => m.userId === papa.userId)!.role).toBe('viewer');
  });

  it('expiration, nombre d\'utilisations, révocation', async () => {
    const { admin, hid } = await family();
    const code = await admin.invite(hid, { maxUses: 1 });
    const a = new Client(s);
    await a.register('a@x.fr', 'A', code);
    expect((await new Client(s).register('b@x.fr', 'B', code)).json.error.code).toBe('invalid_invitation');
    const r = await admin.req('POST', `/api/households/${hid}/invitations`, {});
    await admin.req('DELETE', `/api/households/${hid}/invitations/${r.json.invitation.id}`);
    expect((await new Client(s).req('GET', `/api/invitations/${r.json.invitation.code}`)).status).toBe(404);
    s.db.raw.prepare("UPDATE invitations SET expiresAt = '2000-01-01T00:00:00Z'").run();
    const c3 = await admin.invite(hid);
    s.db.raw.prepare("UPDATE invitations SET expiresAt = '2000-01-01T00:00:00Z' WHERE code = ?").run(c3);
    expect((await new Client(s).register('c@x.fr', 'C', c3)).json.error.code).toBe('invalid_invitation');
  });

  it('invitation par e-mail : envoi si SMTP, réservée à cette adresse', async () => {
    const { admin, hid } = await family();
    const r = await admin.req('POST', `/api/households/${hid}/invitations`, { email: 'maman@x.fr', role: 'member' });
    expect(r.json.emailSent).toBe(true);
    expect(r.json.mailto).toMatch(/^mailto:maman%40x\.fr\?subject=/);
    expect(s.mailer.sent[0]).toMatchObject({ to: 'maman@x.fr' });
    expect(s.mailer.sent[0].text).toContain(r.json.invitation.code);
    const intrus = new Client(s);
    expect((await intrus.register('intrus@x.fr', 'Intrus', r.json.invitation.code)).json.error.code).toBe('invitation_email');
    expect((await new Client(s).register('maman@x.fr', 'Maman', r.json.invitation.code)).status).toBe(200);
  });

  it('sans SMTP : lien mailto pré-rempli pour l\'application de messagerie', async () => {
    s = makeServer({}, { noMail: true });
    const admin = new Client(s);
    await admin.register('moi@x.fr', 'Moi');
    const hid = await admin.createHousehold('Maison');
    const r = await admin.req('POST', `/api/households/${hid}/invitations`, { email: 'papa@x.fr' });
    expect(r.json.emailSent).toBe(false);
    expect(decodeURIComponent(r.json.mailto)).toContain(r.json.invitation.code);
  });

  it('un membre ne peut ni inviter ni voir les invitations', async () => {
    const { admin, hid } = await family();
    const m = new Client(s);
    await m.register('m@x.fr', 'M', await admin.invite(hid, { role: 'member' }));
    expect((await m.req('POST', `/api/households/${hid}/invitations`, {})).status).toBe(403);
    expect((await m.req('GET', `/api/households/${hid}/invitations`)).status).toBe(403);
    expect((await m.req('POST', '/api/platform-invitations', {})).status).toBe(403);
  });

  it('un membre existant rejoint un second foyer avec un code', async () => {
    const { admin, hid } = await family();
    const soeur = new Client(s);
    await soeur.register('soeur@x.fr', 'Sœur');
    const h2 = await soeur.createHousehold('Chez ma sœur');
    const code = await soeur.invite(h2);
    expect((await admin.req('POST', `/api/invitations/${code}/accept`)).status).toBe(200);
    const mine = (await admin.req('GET', '/api/auth/me')).json.households.map((h: { name: string; role: string }) => `${h.name}:${h.role}`);
    expect(mine).toEqual(['Maison familiale:admin', 'Chez ma sœur:member']);
    expect((await admin.req('POST', `/api/invitations/${await soeur.invite(h2)}/accept`)).json.error.code).toBe('already_member');
    void hid;
  });
});

describe('rôles et membres', () => {
  it('trois rôles ; au moins un administrateur ; la lecture seule ne modifie rien', async () => {
    const { admin, hid } = await family();
    const papa = new Client(s);
    await papa.register('papa@x.fr', 'Papa', await admin.invite(hid, { role: 'viewer' }));
    const r = await papa.op(hid, 'product.create', { id: id(), name: 'X', unit: 'piece' });
    expect(r.status).toBe('rejected');
    expect(r.error!.code).toBe('forbidden');
    expect((await admin.req('PATCH', `/api/households/${hid}/members/${papa.userId}`, { role: 'owner' })).status).toBe(400);
    expect((await admin.req('PATCH', `/api/households/${hid}/members/${papa.userId}`, { role: 'member' })).status).toBe(200);
    expect((await papa.op(hid, 'product.create', { id: id(), name: 'X', unit: 'piece' })).status).toBe('applied');
    // Un membre ne gère pas les rôles ni les paramètres.
    expect((await papa.req('PATCH', `/api/households/${hid}/members/${admin.userId}`, { role: 'viewer' })).status).toBe(403);
    const hv = (await papa.state(hid)).household.get(hid)!.version;
    expect((await papa.op(hid, 'household.update', { patch: { name: 'Piraté' }, baseVersion: hv })).error!.code).toBe('forbidden');
    // Dernier administrateur protégé.
    expect((await admin.req('PATCH', `/api/households/${hid}/members/${admin.userId}`, { role: 'member' })).json.error.code).toBe('last_admin');
    await admin.req('PATCH', `/api/households/${hid}/members/${papa.userId}`, { role: 'admin' });
    expect((await admin.req('PATCH', `/api/households/${hid}/members/${admin.userId}`, { role: 'member' })).status).toBe(200);
  });

  it('retrait d\'un membre et départ volontaire', async () => {
    const { admin, hid } = await family();
    const a = new Client(s);
    await a.register('a@x.fr', 'A', await admin.invite(hid));
    const b = new Client(s);
    await b.register('b@x.fr', 'B', await admin.invite(hid));
    expect((await a.req('DELETE', `/api/households/${hid}/members/${b.userId}`)).status).toBe(403);
    expect((await admin.req('DELETE', `/api/households/${hid}/members/${b.userId}`)).status).toBe(200);
    expect((await b.req('GET', `/api/households/${hid}/sync/pull?since=0`)).status).toBe(404);
    expect((await a.req('DELETE', `/api/households/${hid}/members/${a.userId}`)).status).toBe(200);
    expect((await a.req('GET', '/api/auth/me')).json.households).toEqual([]);
    expect((await admin.req('DELETE', `/api/households/${hid}/members/${admin.userId}`)).json.error.code).toBe('last_admin');
    const st = await admin.state(hid);
    expect([...st.activity.values()].map((x) => x.summary)).toEqual(expect.arrayContaining(['a quitté le foyer', 'a retiré B du foyer']));
  });

  it('suppression du foyer : administrateur, confirmation du nom, sauvegarde préalable', async () => {
    const { admin, hid } = await family();
    const m = new Client(s);
    await m.register('m@x.fr', 'M', await admin.invite(hid));
    expect((await m.req('DELETE', `/api/households/${hid}`, { confirmName: 'Maison familiale' })).status).toBe(403);
    expect((await admin.req('DELETE', `/api/households/${hid}`, { confirmName: 'Maison' })).json.error.code).toBe('confirm');
    expect((await admin.req('DELETE', `/api/households/${hid}`, { confirmName: 'Maison familiale' })).status).toBe(200);
    expect(s.backups.list().some((b) => b.reason === 'pre-delete' && b.verified)).toBe(true);
    expect((await m.req('GET', `/api/households/${hid}/sync/pull?since=0`)).status).toBe(404);
    for (const t of ['products', 'members', 'categories', 'activities']) {
      expect(s.db.raw.prepare(`SELECT COUNT(*) n FROM ${t} WHERE householdId = ?`).get(hid)).toEqual({ n: 0 });
    }
  });
});
