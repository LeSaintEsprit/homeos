/**
 * Reconnaissance de texte sur l'appareil (Tesseract.js, modèle français).
 * Moteur et modèle servis par HOMEOS (/engines/ocr/) : aucune photo ni requête
 * ne part vers un service extérieur. Chargé à la première utilisation, puis conservé.
 */
import type { Worker } from 'tesseract.js';

export interface OcrProgress {
  stage: 'loading' | 'recognizing';
  /** 0 à 1 */
  progress: number;
}

let workerP: Promise<Worker> | null = null;
let listener: ((p: OcrProgress) => void) | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      return createWorker('fra', OEM.LSTM_ONLY, {
        workerPath: '/engines/ocr/worker.min.js',
        corePath: '/engines/ocr/core',
        langPath: '/engines/ocr/lang',
        workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => {
          if (!listener) return;
          listener({ stage: m.status.startsWith('recognizing') ? 'recognizing' : 'loading', progress: m.progress ?? 0 });
        },
      });
    })().catch((e) => {
      workerP = null;
      throw e;
    });
  }
  return workerP;
}

/** Réduit une photo trop grande (mémoire du téléphone) en conservant la lisibilité. */
async function prepare(file: Blob, maxSide: number): Promise<Blob | HTMLCanvasElement> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale >= 1) {
    bmp.close();
    return file;
  }
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

/** Lit le texte d'une photo. `kind` adapte la résolution (étiquette ou ticket complet). */
export async function recognizeText(file: Blob, kind: 'label' | 'receipt', onProgress?: (p: OcrProgress) => void): Promise<string> {
  listener = onProgress ?? null;
  try {
    onProgress?.({ stage: 'loading', progress: 0 });
    const worker = await getWorker();
    const img = await prepare(file, kind === 'receipt' ? 2400 : 1600);
    const { data } = await worker.recognize(img);
    return data.text ?? '';
  } finally {
    listener = null;
  }
}
