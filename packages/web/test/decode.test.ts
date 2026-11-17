/** Chaîne complète : image d'un code → lecture zxing-wasm → analyse GS1/GTIN HOMEOS. */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareZXingModule, readBarcodes, writeBarcode } from 'zxing-wasm/full';
import { parseScannedCode } from '@homeos/shared';
import { READER_OPTIONS } from '../src/lib/scan/readerOptions';

const require = createRequire(import.meta.url);
const TODAY = new Date('2026-11-17T10:00:00Z');

beforeAll(async () => {
  await prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/full/zxing_full.wasm')).buffer }, fireImmediately: true });
});

async function roundTrip(text: string, format: string, options?: string) {
  const w = await writeBarcode(text, { format: format as never, options, scale: 4 } as never);
  expect(w.error).toBe('');
  const r = await readBarcodes(w.image!, READER_OPTIONS);
  expect(r.length).toBeGreaterThan(0);
  return r[0].text;
}

describe('lecture réelle des codes-barres (zxing-wasm)', () => {
  it('EAN-13 : code produit sans date', async () => {
    const p = parseScannedCode(await roundTrip('3017620422003', 'EAN13'), TODAY);
    expect(p).toMatchObject({ code: '3017620422003', isGs1: false, expiry: null, validCheckDigit: true });
  });
  it('GS1 DataMatrix : GTIN, date limite, numéro de lot', async () => {
    const text = await roundTrip('(01)03017620422003(17)270315(10)LOT42', 'DataMatrix', 'gs1');
    const p = parseScannedCode(text, TODAY);
    expect(p).toMatchObject({ isGs1: true, code: '3017620422003', expiry: '2027-03-15', batch: 'LOT42' });
  });
  it('GS1-128 : DDM et poids net', async () => {
    const text = await roundTrip('(01)03017620422003(15)261200(3103)000450', 'Code128', 'gs1');
    const p = parseScannedCode(text, TODAY);
    expect(p).toMatchObject({ code: '3017620422003', bestBefore: '2026-12-31', netWeightKg: 0.45 });
  });
  it('QR GS1 Digital Link', async () => {
    const p = parseScannedCode(await roundTrip('https://id.gs1.org/01/03017620422003/10/B7?17=270101', 'QRCode'), TODAY);
    expect(p).toMatchObject({ code: '3017620422003', batch: 'B7', expiry: '2027-01-01' });
  });
});
