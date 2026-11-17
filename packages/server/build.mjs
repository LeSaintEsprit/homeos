import { build } from 'esbuild';
await build({
  entryPoints: { server: 'src/server.ts', cli: 'src/cli.ts' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist',
  external: ['better-sqlite3', 'web-push', 'nodemailer'],
  sourcemap: true,
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  alias: { '@homeos/shared': '../shared/src/index.ts' },
});
console.log('Serveur compilé → dist/server.js');
