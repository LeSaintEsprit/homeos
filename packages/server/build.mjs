import { build } from 'esbuild';
await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/server.js',
  external: ['better-sqlite3', 'web-push'],
  sourcemap: true,
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  alias: { '@homeos/shared': '../shared/src/index.ts' },
});
console.log('Serveur compilé → dist/server.js');
