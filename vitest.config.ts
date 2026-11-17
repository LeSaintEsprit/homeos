import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@homeos/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    server: { deps: { inline: ['zxing-wasm'] } },
    environment: 'node',
    testTimeout: 20000,
  },
});
