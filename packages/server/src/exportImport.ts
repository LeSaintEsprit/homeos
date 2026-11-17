import { randomUUID } from 'node:crypto';
import { ENTITY_TYPES, auditHousehold, emptyCollections, type AnyEntity, type EntityType, type EntityCollections } from '@homeos/shared';
import type { Db } from './db';
import { SqlStore, loadHousehold } from './sqlStore';
import { HttpError } from './households';

export const EXPORT_FORMAT = 'homeos-export';
export const EXPORT_VERSION = 1;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  householdId: string;
  householdName: string;
  entities: Partial<Record<EntityType, AnyEntity[]>>;
  photos: { id: string; mime: string; data: string }[];
}

export function exportHousehold(db: Db, householdId: string, withPhotos: boolean): ExportFile {
  const data = loadHousehold(db, householdId);
  const h = data.get('household')![0] as { name: string };
  const photos = withPhotos
    ? (db.prep('SELECT id, mime, data FROM photos WHERE householdId = ?').all(householdId) as { id: string; mime: string; data: Buffer }[]).map((p) => ({
        id: p.id,
        mime: p.mime,
        data: p.data.toString('base64'),
      }))
    : [];
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    householdId,
    householdName: h.name,
    entities: Object.fromEntries(ENTITY_TYPES.map((t) => [t, data.get(t) ?? []])),
    photos,
  };
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // Séparateur « ; » et BOM UTF-8 : ouverture directe dans Excel/LibreOffice en français.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}

export function exportCsv(db: Db, householdId: string, kind: 'inventaire' | 'achats' | 'mouvements'): string {
  const data = loadHousehold(db, householdId);
  const byId = (t: EntityType) => new Map((data.get(t) ?? []).map((e) => [e.id, e as unknown as Record<string, unknown>]));
  const products = byId('product');
  const cats = byId('category');
  const locs = byId('location');
  const stores = byId('store');
  const members = new Map((data.get('member') ?? []).map((m) => [(m as unknown as { userId: string }).userId, (m as unknown as { name: string }).name]));
  const name = (m: Map<string, Record<string, unknown>>, id: unknown) => (id ? String(m.get(String(id))?.name ?? '') : '');
  const fmt = (n: unknown) => (n == null ? '' : String(n).replace('.', ','));
  if (kind === 'inventaire') {
    const rows = (data.get('lot') ?? [])
      .map((l) => l as unknown as Record<string, unknown>)
      .filter((l) => (l.quantity as number) > 0)
      .map((l) => {
        const p = products.get(String(l.productId))!;
        return [p?.name, name(cats, p?.categoryId), name(locs, l.locationId ?? p?.locationId), fmt(l.quantity), p?.unit, l.expiryDate, l.expirySource, l.openedAt ? 'oui' : 'non', l.purchaseDate, l.qtyApprox ? 'approximative' : l.qtySource];
      });
    return toCsv(['Produit', 'Catégorie', 'Emplacement', 'Quantité', 'Unité', 'Péremption', 'Source de la date', 'Ouvert', "Date d'achat", 'Fiabilité quantité'], rows);
  }
  if (kind === 'achats') {
    const rows = (data.get('purchase') ?? []).map((x) => {
      const p = x as unknown as Record<string, unknown>;
      return [p.date, p.name, fmt(p.quantity), p.unit, p.totalCents == null ? '' : fmt((p.totalCents as number) / 100), name(stores, p.storeId), members.get(String(p.userId)) ?? '', name(cats, p.categoryId)];
    });
    return toCsv(['Date', 'Produit', 'Quantité', 'Unité', 'Prix (€)', 'Magasin', 'Membre', 'Catégorie'], rows);
  }
  const rows = (data.get('movement') ?? []).map((x) => {
    const m = x as unknown as Record<string, unknown>;
    return [m.occurredAt, name(products, m.productId), m.type, fmt(m.delta), fmt(m.quantityBefore), fmt(m.quantityAfter), members.get(String(m.userId)) ?? '', m.source, m.reason, m.revertedBy ? 'annulé' : '', m.id];
  });
  return toCsv(['Date', 'Produit', 'Type', 'Variation', 'Avant', 'Après', 'Membre', 'Source', 'Motif', 'Annulation', 'Identifiant'], rows);
}

/** Remplace récursivement toute valeur égale à un identifiant connu. */
function remap(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remap(v, map));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === 'fv' ? {} : remap(v, map);
    return out;
  }
  return value;
}

export interface ImportReport {
  householdId: string;
  counts: Record<string, number>;
  issues: { severity: string; message: string }[];
}

/**
 * Importe un export comme NOUVEAU foyer : tous les identifiants sont régénérés
 * (aucune collision possible avec des données existantes), l'importateur devient
 * propriétaire, les autres membres sont conservés comme anciens membres inactifs.
 */
export function importHousehold(db: Db, file: unknown, user: { id: string; name: string; email: string }): ImportReport {
  const f = file as ExportFile;
  if (!f || f.format !== EXPORT_FORMAT || typeof f.version !== 'number') throw new HttpError(400, 'invalid_file', "Ce fichier n'est pas un export HOMEOS.");
  if (f.version > EXPORT_VERSION) throw new HttpError(400, 'version', 'Export créé par une version plus récente de HOMEOS.');
  const ents = f.entities ?? {};
  const households = (ents.household ?? []) as AnyEntity[];
  if (households.length !== 1) throw new HttpError(400, 'invalid_file', 'Export invalide : foyer manquant.');
  const map = new Map<string, string>();
  const newHh = randomUUID();
  map.set(households[0].id, newHh);
  for (const t of ENTITY_TYPES) for (const e of (ents[t] ?? []) as AnyEntity[]) if (t !== 'household') map.set(e.id, randomUUID());
  for (const p of f.photos ?? []) map.set(p.id, randomUUID());
  const counts: Record<string, number> = {};
  db.tx(() => {
    const store = new SqlStore(db, newHh, user.id);
    const order: EntityType[] = ['household', 'member', 'category', 'location', 'store', 'product', 'productCode', 'lot', 'movement', 'shoppingItem', 'purchase', 'receipt', 'inventorySession', 'activity', 'recipe'];
    for (const t of order) {
      const list = ((ents[t] ?? []) as AnyEntity[]).slice().sort((a, b) => a.version - b.version);
      for (const e of list) {
        const next = remap(e, map) as AnyEntity & Record<string, unknown>;
        next.householdId = newHh;
        if (t === 'household') next.name = `${String(next.name)} (import)`;
        if (t === 'member') {
          const isMe = next.userId === user.id;
          next.active = isMe;
          if (isMe) next.role = 'owner';
        }
        store.put(t, next as never);
      }
      counts[t] = list.length;
    }
    const me = db.prep('SELECT id FROM members WHERE householdId = ? AND userId = ?').get(newHh, user.id);
    if (!me) {
      store.put('member', {
        id: randomUUID(), householdId: newHh, version: 0, userId: user.id, name: user.name, email: user.email, role: 'owner', color: '#1F7A64', active: true,
        joinedAt: new Date().toISOString(), prefs: {},
      });
    }
    for (const p of f.photos ?? []) {
      db.prep('INSERT INTO photos(id, householdId, mime, data, createdAt) VALUES (?, ?, ?, ?, ?)').run(map.get(p.id), newHh, p.mime, Buffer.from(p.data, 'base64'), new Date().toISOString());
    }
    const fk = db.raw.pragma('foreign_key_check') as unknown[];
    if (fk.length) throw new HttpError(400, 'invalid_file', `Export incohérent : ${fk.length} référence(s) cassée(s). Import annulé.`);
  });
  return { householdId: newHh, counts, issues: integrityReport(db, newHh).map((i) => ({ severity: i.severity, message: i.message })) };
}

export function collectionsOf(db: Db, householdId: string): EntityCollections {
  const c = emptyCollections();
  for (const [t, list] of loadHousehold(db, householdId)) for (const e of list) (c[t] as Map<string, AnyEntity>).set(e.id, e);
  return c;
}

/** Contrôle d'intégrité d'un foyer : SQLite + invariants métier. */
export function integrityReport(db: Db, householdId: string) {
  const issues = auditHousehold(collectionsOf(db, householdId), new Date().toISOString());
  const fk = db.raw.pragma('foreign_key_check') as unknown[];
  if (fk.length) issues.unshift({ code: 'foreign_keys', severity: 'error', message: `${fk.length} référence(s) cassée(s) dans la base.` });
  return issues;
}
