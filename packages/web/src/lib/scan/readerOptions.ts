import type { ReaderOptions } from 'zxing-wasm/reader';

/** Formats lus : 1D du commerce et de la logistique, 2D (QR, DataMatrix), GS1 DataBar. */
export const READER_OPTIONS: ReaderOptions = {
  formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'ITF', 'ITF14', 'DataBar', 'DataBarExp', 'DataBarLtd', 'QRCode', 'DataMatrix'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
  // « HRI » : les données GS1 sont restituées sous la forme (01)…(17)…, analysées ensuite.
  textMode: 'HRI',
};
