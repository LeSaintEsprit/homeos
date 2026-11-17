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
  await page.click(`.option-card:has-text("${role}")`);
  await page.click('button:has-text("Créer l’invitation")');
  const code = (await page.getByTestId('invite-code').textContent())!.trim();
  await page.click('button:has-text("Terminé")');
  return code;
}

export async function newUser(browser: Browser) {
  const ctx = await browser.newContext();
  return { ctx, page: await ctx.newPage() };
}
