// Vérifie que toutes les dépendances livrées (hors outils de développement) ont une licence
// libre et gratuite. Usage : node scripts/check-licenses.mjs
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = /^(MIT|MIT-0|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|BlueOak-1\.0\.0|MPL-2\.0|CC0-1\.0|CC-BY-4\.0|Unlicense|Python-2\.0|OFL-1\.1|WTFPL|Zlib)$/;
const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const seen = new Map();
const walk = (deps, path) => {
  for (const [name, d] of Object.entries(deps ?? {})) {
    if (seen.has(name) || !d.version) continue;
    if (name.startsWith('@homeos/')) { walk(d.dependencies, name); continue; } // paquets du projet lui-même
    let license = '?';
    try {
      const dir = d.path ?? join('node_modules', name);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? ((pkg.licenses ?? []).map((l) => l.type).join(' OR ') || '?'));
    } catch {
      /* paquet introuvable */
    }
    seen.set(name, { version: d.version, license, via: path });
    walk(d.dependencies, name);
  }
};
walk(tree.dependencies, 'racine');
const ok = (l) => l.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/).some((x) => ALLOWED.test(x.trim()));
const bad = [...seen].filter(([, v]) => !ok(v.license));
const counts = {};
for (const [, v] of seen) counts[v.license] = (counts[v.license] ?? 0) + 1;
console.log(`${seen.size} dépendances livrées. Licences :`, counts);
if (bad.length) {
  console.log('À examiner :', bad.map(([n, v]) => `${n}@${v.version} (${v.license}, via ${v.via})`));
  process.exit(1);
}
console.log('Toutes les licences sont libres et gratuites.');
