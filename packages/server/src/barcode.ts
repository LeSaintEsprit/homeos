import { normalizeOffProduct, parseScannedCode, type ExternalProduct } from '@homeos/shared';
import type { Db } from './db';
import type { Config } from './config';

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  headers: { get(name: string): string | null };
}>;

export interface LookupResult {
  status: 'found' | 'not_found' | 'unavailable' | 'invalid';
  product: ExternalProduct | null;
  cached: boolean;
  /** Image locale servie par HOMEOS (aucune requête tierce depuis les appareils). */
  imagePath: string | null;
}

const SOURCES: { key: ExternalProduct['source']; host: string; label: string }[] = [
  { key: 'off', host: 'https://world.openfoodfacts.org', label: 'Open Food Facts' },
  { key: 'obf', host: 'https://world.openbeautyfacts.org', label: 'Open Beauty Facts' },
  { key: 'opf', host: 'https://world.openproductsfacts.org', label: 'Open Products Facts' },
];
const FIELDS = 'code,product_name,product_name_fr,generic_name_fr,brands,quantity,product_quantity,product_quantity_unit,categories_tags,image_front_small_url,image_front_url';
const FOUND_TTL = 30 * 86_400_000;
const MISS_TTL = 7 * 86_400_000;

/**
 * Recherche d'un code-barres dans les bases ouvertes (via le serveur, avec cache).
 * Respect des conditions d'utilisation : User-Agent identifiant l'application,
 * limitation à 60 requêtes/minute (limite publiée : 100/min en lecture).
 */
export class BarcodeService {
  private stamps: number[] = [];

  constructor(
    private db: Db,
    private config: Config,
    private fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  private allow(): boolean {
    const now = Date.now();
    this.stamps = this.stamps.filter((t) => now - t < 60_000);
    if (this.stamps.length >= 60) return false;
    this.stamps.push(now);
    return true;
  }

  async lookup(rawCode: string): Promise<LookupResult> {
    const parsed = parseScannedCode(rawCode);
    const code = parsed.code;
    if (!/^\d{8,14}$/.test(code) || parsed.validCheckDigit === false) return { status: 'invalid', product: null, cached: false, imagePath: null };
    const row = this.db.prep('SELECT data, fetchedAt, image IS NOT NULL AS hasImage FROM barcode_cache WHERE code = ?').get(code) as
      | { data: string | null; fetchedAt: string; hasImage: number }
      | undefined;
    if (row) {
      const age = Date.now() - Date.parse(row.fetchedAt);
      const product = row.data ? (JSON.parse(row.data) as ExternalProduct) : null;
      if ((product && age < FOUND_TTL) || (!product && age < MISS_TTL)) {
        return { status: product ? 'found' : 'not_found', product, cached: true, imagePath: row.hasImage ? `/api/barcode/${code}/image` : null };
      }
    }
    if (!this.config.offEnabled) return { status: 'unavailable', product: null, cached: false, imagePath: null };
    let unavailable = false;
    for (const src of SOURCES) {
      if (!this.allow()) {
        unavailable = true;
        break;
      }
      try {
        const res = await this.fetchImpl(`${src.host}/api/v2/product/${code}.json?fields=${FIELDS}`, {
          headers: { 'User-Agent': this.config.offUserAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (res.status === 404) continue;
        if (!res.ok) {
          unavailable = true;
          continue;
        }
        const body = (await res.json()) as { status?: number; product?: Record<string, unknown> };
        if (body.status !== 1 || !body.product) continue;
        const product = normalizeOffProduct(code, src.key, body.product as never);
        if (!product) continue;
        const image = await this.fetchImage(product.imageUrl);
        this.db
          .prep('INSERT INTO barcode_cache(code, data, image, imageMime, fetchedAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET data = excluded.data, image = excluded.image, imageMime = excluded.imageMime, fetchedAt = excluded.fetchedAt')
          .run(code, JSON.stringify(product), image?.data ?? null, image?.mime ?? null, new Date().toISOString());
        return { status: 'found', product, cached: false, imagePath: image ? `/api/barcode/${code}/image` : null };
      } catch {
        unavailable = true;
      }
    }
    if (unavailable) return { status: 'unavailable', product: null, cached: false, imagePath: null };
    this.db
      .prep('INSERT INTO barcode_cache(code, data, fetchedAt) VALUES (?, NULL, ?) ON CONFLICT(code) DO UPDATE SET data = NULL, fetchedAt = excluded.fetchedAt')
      .run(code, new Date().toISOString());
    return { status: 'not_found', product: null, cached: false, imagePath: null };
  }

  private async fetchImage(url: string | null): Promise<{ data: Buffer; mime: string } | null> {
    if (!url || !/^https:\/\/images\.open(food|beauty|products)facts\.org\//.test(url)) return null;
    try {
      const res = await this.fetchImpl(url, { headers: { 'User-Agent': this.config.offUserAgent }, signal: AbortSignal.timeout(6000) });
      const mime = res.headers.get('content-type') ?? '';
      if (!res.ok || !/^image\/(jpeg|png|webp)/.test(mime)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length < 400_000 ? { data: buf, mime: mime.split(';')[0] } : null;
    } catch {
      return null;
    }
  }

  image(code: string): { data: Buffer; mime: string } | null {
    const r = this.db.prep('SELECT image, imageMime FROM barcode_cache WHERE code = ?').get(code) as { image: Buffer | null; imageMime: string | null } | undefined;
    return r?.image ? { data: r.image, mime: r.imageMime ?? 'image/jpeg' } : null;
  }
}
