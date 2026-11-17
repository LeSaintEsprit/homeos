import { defineConfig, devices } from '@playwright/test';

const PORT = 18090;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
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
      HOMEOS_DATA_DIR: 'e2e/.data',
      HOMEOS_WEB_DIR: 'packages/web/dist',
      HOMEOS_REGISTRATION: 'open',
      HOMEOS_SCHEDULERS: '0',
      // Tous les navigateurs de test partagent une adresse IP : limites anti-abus relevées.
      HOMEOS_RATE_LIMIT_MULTIPLIER: '50',
      LOG_LEVEL: 'warn',
    },
  },
});
