import { defineConfig, devices } from '@playwright/test';

const PORT = 18090;
/** Dossier de données propre à chaque exécution (le serveur démarre avant globalSetup). */
const DATA_DIR = process.env.HOMEOS_E2E_DATA ?? `e2e/.data/run-${Date.now()}`;
process.env.HOMEOS_E2E_DATA = DATA_DIR;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node packages/server/dist/server.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      HOMEOS_DATA_DIR: DATA_DIR,
      HOMEOS_WEB_DIR: 'packages/web/dist',
      HOMEOS_REGISTRATION: 'open',
      HOMEOS_SCHEDULERS: '0',
      // Tous les navigateurs de test partagent une adresse IP : limites anti-abus relevées.
      HOMEOS_RATE_LIMIT_MULTIPLIER: '50',
      // Pas d'appel aux bases produits externes pendant les tests (réponses simulées côté serveur).
      HOMEOS_OFF_DISABLED: '1',
      LOG_LEVEL: 'warn',
    },
  },
});
