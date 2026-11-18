import { expect, type Browser, type Page } from '@playwright/test';

let n = 0;
export const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;

export async function register(page: Page, name: string, email: string, code?: string) {
  await page.goto(code ? `/inscription?code=${code}` : '/inscription');
  await page.fill('input[autocomplete=name]', name);
  await page.fill('input[type=email]', email);
  await page.fill('#pw', 'motdepasse-solide');
  await page.click('button:has-text("Créer mon compte")');
  await page.waitForURL((u) => !u.pathname.startsWith('/inscription'));
}

export async function createHousehold(page: Page, name: string) {
  await page.waitForURL(/bienvenue|foyers\/nouveau|\/$/);
  if (page.url().includes('bienvenue')) await page.click('text=Créer un nouveau foyer');
  else if (!page.url().includes('foyers/nouveau')) await page.goto('/foyers/nouveau');
  await page.fill('input[placeholder="Maison familiale"]', name);
  await page.click('button:has-text("Continuer")');
  await page.click('button:has-text("Continuer")');
  await page.click('button:has-text("Créer mon foyer")');
  await expect(page.getByTestId('active-household')).toHaveText(name);
}

export async function inviteCode(page: Page, role: 'Administrateur' | 'Membre' | 'Lecture seule' = 'Membre'): Promise<string> {
  await page.goto('/famille');
  await page.click('button:has-text("Inviter")');
  // Titre exact de la carte : la description d'« Administrateur » contient aussi « membres ».
  await page.locator('.option-card').filter({ has: page.locator('.strong', { hasText: new RegExp(`^${role}$`) }) }).click();
  await expect(page.locator('.option-card[aria-pressed=true] .strong')).toHaveText(role);
  await page.click('button:has-text("Créer l’invitation")');
  const code = (await page.getByTestId('invite-code').textContent())!.trim();
  await page.click('button:has-text("Terminé")');
  return code;
}

export async function newUser(browser: Browser) {
  const ctx = await browser.newContext();
  return { ctx, page: await ctx.newPage() };
}

export const DAY = 86_400_000;
export const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
export const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

/**
 * Prépare un historique via l'API de synchronisation (mêmes opérations que l'interface),
 * avec l'heure réelle de chaque action : c'est ce qu'envoie un appareil resté hors ligne.
 */
export async function seed(page: Page, build: (op: (type: string, payload: Record<string, unknown>, daysAgo?: number) => void, ids: { cat: Record<string, string>; loc: Record<string, string> }) => void) {
  const base = await page.evaluate(async () => {
    const me = await (await fetch('/api/auth/me')).json();
    const hid = me.households[0].id as string;
    const st = await (await fetch(`/api/households/${hid}/sync/pull?since=0`)).json();
    return { hid, changes: st.changes as { t: string; e: { id: string; name: string } }[] };
  });
  const cat = Object.fromEntries(base.changes.filter((c) => c.t === 'category').map((c) => [c.e.name, c.e.id]));
  const loc = Object.fromEntries(base.changes.filter((c) => c.t === 'location').map((c) => [c.e.name, c.e.id]));
  const ops: unknown[] = [];
  build((type, payload, daysAgo = 0) => ops.push({ opId: crypto.randomUUID(), type, payload, clientTime: ago(daysAgo) }), { cat, loc });
  const res = await page.evaluate(
    async ({ hid, ops }) => (await fetch(`/api/households/${hid}/sync/push`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-homeos': '1' }, body: JSON.stringify({ ops }) })).json(),
    { hid: base.hid, ops },
  );
  const rejected = (res.results as { status: string; error?: { message: string } }[]).filter((r) => r.status !== 'applied');
  expect(rejected, JSON.stringify(rejected)).toHaveLength(0);
}

export const uid = () => crypto.randomUUID();
