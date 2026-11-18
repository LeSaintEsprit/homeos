import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

/**
 * Moteur OCR auto-hébergé : Tesseract.js (worker + cœur WebAssembly LSTM) et modèle
 * français, servis par HOMEOS sous /engines/ocr/ (aucun CDN externe : les photos et les
 * requêtes ne quittent jamais le serveur du foyer). Chargés à la demande, hors précache.
 */
function ocrAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const pkg = (name: string) => dirname(require.resolve(`${name}/package.json`));
  const files: Record<string, string> = {
    'engines/ocr/worker.min.js': join(pkg('tesseract.js'), 'dist/worker.min.js'),
    'engines/ocr/core/tesseract-core-lstm.wasm.js': join(pkg('tesseract.js-core'), 'tesseract-core-lstm.wasm.js'),
    'engines/ocr/core/tesseract-core-simd-lstm.wasm.js': join(pkg('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'),
    'engines/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js': join(pkg('tesseract.js-core'), 'tesseract-core-relaxedsimd-lstm.wasm.js'),
    'engines/ocr/lang/fra.traineddata.gz': join(pkg('@tesseract.js-data/fra'), '4.0.0_best_int/fra.traineddata.gz'),
  };
  for (const f of Object.values(files)) if (!existsSync(f)) throw new Error(`Fichier OCR introuvable : ${f}`);
  return {
    name: 'homeos-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/^\//, '');
        const src = files[path];
        if (!src) return next();
        res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        createReadStream(src).pipe(res);
      });
    },
    generateBundle() {
      for (const [fileName, src] of Object.entries(files)) this.emitFile({ type: 'asset', fileName, source: readFileSync(src) });
    },
  };
}

export default defineConfig({
  resolve: {
    alias: { '@homeos/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900, assetsInlineLimit: 0 },
  plugins: [
    react(),
    ocrAssets(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest,wasm}'], globIgnores: ['engines/**'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
      manifest: {
        name: 'HOMEOS — la maison sous contrôle',
        short_name: 'HOMEOS',
        description: 'Stocks, courses et approvisionnement de la maison, en famille.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F5F3EE',
        theme_color: '#14532D',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Scanner', url: '/scanner', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Liste de courses', url: '/courses', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
    }),
  ],
});
