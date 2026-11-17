/**
 * Lecture des codes-barres avec zxing-cpp compilé en WebAssembly. Le fichier .wasm est
 * servi par HOMEOS (aucun CDN) et mis en cache par le service worker.
 */
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { READER_OPTIONS } from './readerOptions';

let prepared = false;
function prepare() {
  if (prepared) return;
  prepared = true;
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
}

export interface Decoded {
  text: string;
  format: string;
}

export async function decode(input: ImageData | Blob): Promise<Decoded | null> {
  prepare();
  const results = await readBarcodes(input, READER_OPTIONS);
  const r = results.find((x) => x.isValid && x.text);
  return r ? { text: r.text, format: r.format } : null;
}
