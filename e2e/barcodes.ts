import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/full';

const require = createRequire(import.meta.url);
let ready: Promise<unknown> | null = null;

/** Génère une vraie image PNG de code-barres (zxing-wasm) pour simuler une photo. */
export async function barcodePng(text: string, format: string, options?: string): Promise<string> {
  ready ??= prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/full/zxing_full.wasm')).buffer }, fireImmediately: true });
  await ready;
  const w = await writeBarcode(text, { format: format as never, options, scale: 4 } as never);
  if (!w.image) throw new Error(w.error);
  const dir = join('e2e', '.data', 'codes');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${format}-${Buffer.from(text).toString('hex').slice(0, 40)}.png`);
  writeFileSync(file, Buffer.from(await w.image.arrayBuffer()));
  return file;
}
