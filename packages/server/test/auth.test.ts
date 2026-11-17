import { afterEach, describe, expect, it } from 'vitest';
import { Client, makeServer, type TestServer } from './helpers';

let s: TestServer;
afterEach(async () => s?.close());

describe('comptes : inscription et politique de la plateforme', () => {
  it('premier compte libre (administrateur du serveur), puis inscription sur code uniquement', async () => {
    s = makeServer({ registration: 'invite' });
    const admin = new Client(s);
    const r1 = await admin.register('admin@x.fr', 'Admin');
    expect(r1.status).toBe(200);
    expect(r1.json.user.isServerAdmin).toBe(true);
    // Un inconnu sans code est refusé.
    const stranger = new Client(s);
    expect((await stranger.register('x@x.fr', 'X')).json.error.code).toBe('invite_required');
    // Invitation de foyer → rejoint directement le foyer.
    const hid = await admin.createHousehold('Maison familiale');
    const code = await admin.invite(hid);
    const papa = new Client(s);
    const r2 = await papa.register('papa@x.fr', 'Papa', code);
    expect(r2.status).toBe(200);
    expect(r2.json.joinedHouseholdId).toBe(hid);
    expect(r2.json.user.isServerAdmin).toBe(false);
    // Invitation plateforme → la sœur crée son propre foyer.
    const pi = await admin.req('POST', '/api/platform-invitations', { days: 7, maxUses: 1 });
    expect(pi.status).toBe(200);
    const soeur = new Client(s);
    const r3 = await soeur.register('soeur@x.fr', 'Sœur', pi.json.invitation.code);
    expect(r3.status).toBe(200);
    expect(r3.json.households).toEqual([]);
    const hSoeur = await soeur.createHousehold('Maison de ma sœur');
    expect((await soeur.req('GET', '/api/auth/me')).json.households.map((h: { id: string }) => h.id)).toEqual([hSoeur]);
    // Code plateforme à usage unique.
    expect((await new Client(s).register('autre@x.fr', 'Autre', pi.json.invitation.code)).json.error.code).toBe('invalid_invitation');
  });

  it('inscription fermée et adresse déjà utilisée', async () => {
    s = makeServer({ registration: 'closed' });
    const a = new Client(s);
    expect((await a.register('a@x.fr', 'A')).status).toBe(200);
    expect((await new Client(s).register('b@x.fr', 'B')).json.error.code).toBe('registration_closed');
    s.config.registration = 'open';
    expect((await new Client(s).register('A@x.fr', 'Bis')).json.error.code).toBe('email_taken');
  });

  it('valide les champs', async () => {
    s = makeServer();
    const c = new Client(s);
    const r = await c.req('POST', '/api/auth/register', { email: 'pas-un-email', password: 'court', name: '' });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/e-mail|mot de passe|Nom/);
  });
});

describe('comptes : connexion et sessions', () => {
  it('connexion, session, déconnexion', async () => {
    s = makeServer();
    const a = new Client(s);
    await a.register('a@x.fr', 'A');
    expect((await a.req('GET', '/api/auth/me')).status).toBe(200);
    expect((await a.req('POST', '/api/auth/logout')).status).toBe(200);
    expect((await a.req('GET', '/api/auth/me')).status).toBe(401);
    const bad = await a.login('a@x.fr', 'mauvais-mot-de-passe');
    expect(bad.status).toBe(401);
    expect(bad.json.error.message).toBe('Adresse e-mail ou mot de passe incorrect.');
    // Même message pour un compte inexistant (pas d'énumération).
    expect((await a.login('inconnu@x.fr', 'nimporte')).json.error.message).toBe('Adresse e-mail ou mot de passe incorrect.');
    expect((await a.login('a@x.fr')).status).toBe(200);
    // Cookie sécurisé.
    const reg = await new Client(s).register('c@x.fr', 'C');
    expect(String([reg.headers['set-cookie']].flat()[0])).toMatch(/HttpOnly/i);
    expect(String([reg.headers['set-cookie']].flat()[0])).toMatch(/SameSite=Lax/i);
  });

  it('limite les tentatives de connexion', async () => {
    s = makeServer();
    const a = new Client(s);
    await a.register('a@x.fr', 'A');
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await a.login('a@x.fr', 'faux-mot-de-passe')).status);
    expect(statuses.slice(0, 10).every((x) => x === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await a.login('a@x.fr')).status).toBe(429); // même le bon mot de passe pendant le blocage
  });

  it('protection CSRF : en-tête obligatoire et origine vérifiée', async () => {
    s = makeServer();
    const a = new Client(s);
    await a.register('a@x.fr', 'A');
    const noHeader = await s.app.inject({ method: 'POST', url: '/api/households', payload: { name: 'X' }, headers: { cookie: a.cookie } });
    expect(noHeader.statusCode).toBe(403);
    const evil = await a.req('POST', '/api/households', { name: 'X' }, { origin: 'https://site-malveillant.example' });
    expect(evil.status).toBe(403);
    expect((await a.req('POST', '/api/households', { name: 'X' })).status).toBe(200);
  });

  it('changement de mot de passe : déconnecte les autres appareils', async () => {
    s = makeServer();
    const phone = new Client(s);
    await phone.register('a@x.fr', 'A');
    const pc = new Client(s);
    await pc.login('a@x.fr');
    expect((await phone.req('POST', '/api/auth/password', { current: 'faux', next: 'nouveau-mot-de-passe' })).status).toBe(400);
    expect((await phone.req('POST', '/api/auth/password', { current: 'motdepasse-solide', next: 'nouveau-mot-de-passe' })).status).toBe(200);
    expect((await pc.req('GET', '/api/auth/me')).status).toBe(401);
    expect((await phone.req('GET', '/api/auth/me')).status).toBe(200);
    expect((await new Client(s).login('a@x.fr', 'nouveau-mot-de-passe')).status).toBe(200);
  });

  it('profil : nom et e-mail répercutés dans les foyers', async () => {
    s = makeServer();
    const a = new Client(s);
    await a.register('a@x.fr', 'Alice');
    const hid = await a.createHousehold('Maison');
    expect((await a.req('PATCH', '/api/auth/profile', { name: 'Alice Martin' })).status).toBe(200);
    expect((await a.req('POST', '/api/auth/email', { email: 'alice@x.fr', password: 'faux' })).status).toBe(400);
    expect((await a.req('POST', '/api/auth/email', { email: 'alice@x.fr', password: 'motdepasse-solide' })).status).toBe(200);
    const st = await a.state(hid);
    const m = [...st.member.values()][0];
    expect([m.name, m.email]).toEqual(['Alice Martin', 'alice@x.fr']);
    expect((await new Client(s).login('alice@x.fr')).status).toBe(200);
  });
});

describe('comptes : mot de passe oublié', () => {
  it('sans e-mail configuré : lien à usage unique généré par l\'administrateur du serveur', async () => {
    s = makeServer({}, { noMail: true });
    const admin = new Client(s);
    await admin.register('admin@x.fr', 'Admin');
    const user = new Client(s);
    await user.register('maman@x.fr', 'Maman');
    expect((await user.req('POST', '/api/auth/forgot', { email: 'maman@x.fr' })).json.mode).toBe('admin');
    // Un simple utilisateur ne peut pas générer de lien.
    expect((await user.req('POST', '/api/admin/reset-link', { email: 'admin@x.fr' })).status).toBe(403);
    const link = (await admin.req('POST', '/api/admin/reset-link', { email: 'maman@x.fr' })).json.link as string;
    const token = link.split('/').pop()!;
    expect((await new Client(s).req('GET', `/api/auth/reset/${token}`)).json.email).toBe('maman@x.fr');
    const fresh = new Client(s);
    expect((await fresh.req('POST', '/api/auth/reset', { token, password: 'mot-de-passe-neuf' })).status).toBe(200);
    expect((await fresh.req('GET', '/api/auth/me')).json.user.email).toBe('maman@x.fr');
    // Usage unique, anciennes sessions fermées.
    expect((await new Client(s).req('POST', '/api/auth/reset', { token, password: 'encore-un-autre' })).status).toBe(400);
    expect((await user.req('GET', '/api/auth/me')).status).toBe(401);
    expect((await new Client(s).login('maman@x.fr', 'mot-de-passe-neuf')).status).toBe(200);
  });

  it('avec SMTP : lien envoyé par e-mail, même réponse pour une adresse inconnue', async () => {
    s = makeServer();
    const u = new Client(s);
    await u.register('papa@x.fr', 'Papa');
    const r1 = await new Client(s).req('POST', '/api/auth/forgot', { email: 'papa@x.fr' });
    const r2 = await new Client(s).req('POST', '/api/auth/forgot', { email: 'inconnu@x.fr' });
    expect(r1.json).toEqual(r2.json);
    await new Promise((r) => setTimeout(r, 10));
    expect(s.mailer.sent).toHaveLength(1);
    expect(s.mailer.sent[0].to).toBe('papa@x.fr');
    const token = /reinitialiser\/([A-Za-z0-9_-]+)/.exec(s.mailer.sent[0].text)![1];
    expect((await new Client(s).req('POST', '/api/auth/reset', { token, password: 'mot-de-passe-neuf' })).status).toBe(200);
  });
});

describe('comptes : protection des données personnelles', () => {
  it('export des données personnelles et suppression du compte avec anonymisation', async () => {
    s = makeServer();
    const a = new Client(s);
    await a.register('a@x.fr', 'Alice');
    const b = new Client(s);
    await b.register('b@x.fr', 'Bob');
    const hid = await a.createHousehold('Maison commune');
    await b.req('POST', `/api/invitations/${await a.invite(hid)}/accept`);
    const solo = await b.createHousehold('Studio de Bob');
    await b.ok(hid, 'product.create', { id: crypto.randomUUID(), name: 'Café', unit: 'paquet', initialStock: { lotId: crypto.randomUUID(), quantity: 2 } });
    const pd = await b.req('GET', '/api/auth/personal-data');
    expect(pd.json.user.email).toBe('b@x.fr');
    expect(pd.json.households).toHaveLength(2);
    const plan = (await b.req('GET', '/api/auth/account/deletion-plan')).json;
    expect(plan.soleHouseholds.map((h: { id: string }) => h.id)).toEqual([solo]);
    expect((await b.req('POST', '/api/auth/account/delete', { password: 'motdepasse-solide', confirm: 'SUPPRIMER' })).json.error.code).toBe('sole_households');
    expect((await b.req('POST', '/api/auth/account/delete', { password: 'motdepasse-solide', confirm: 'SUPPRIMER', deleteSoleHouseholds: true })).status).toBe(200);
    expect((await b.login('b@x.fr')).status).toBe(401);
    expect(s.db.raw.prepare('SELECT COUNT(*) n FROM households WHERE id = ?').get(solo)).toEqual({ n: 0 });
    // L'historique du foyer commun est conservé, attribué à « Ancien membre ».
    const st = await a.state(hid);
    const bob = [...st.member.values()].find((m) => m.name === 'Ancien membre')!;
    expect(bob.active).toBe(false);
    expect(bob.email).toBe('');
    expect([...st.movement.values()].some((m) => m.userId === bob.userId)).toBe(true);
  });

  it('le dernier administrateur d\'un foyer partagé doit d\'abord transmettre ses droits', async () => {
    s = makeServer();
    const a = new Client(s);
    await a.register('a@x.fr', 'Alice');
    const b = new Client(s);
    await b.register('b@x.fr', 'Bob');
    const hid = await a.createHousehold('Maison');
    await b.req('POST', `/api/invitations/${await a.invite(hid)}/accept`);
    const r = await a.req('POST', '/api/auth/account/delete', { password: 'motdepasse-solide', confirm: 'SUPPRIMER', deleteSoleHouseholds: true });
    expect(r.json.error.code).toBe('last_admin');
  });
});
