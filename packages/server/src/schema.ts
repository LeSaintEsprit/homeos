import type { EntityType } from '@homeos/shared';

export type ColKind = 'text' | 'real' | 'int' | 'bool' | 'json';

export interface TableDef {
  table: string;
  cols: Record<string, ColKind>;
  /** Contraintes et colonnes SQL supplémentaires (FK, CHECK). */
  extra?: string[];
  indexes?: string[];
}

const FK = (col: string, table: string) => `FOREIGN KEY (${col}) REFERENCES ${table}(id) DEFERRABLE INITIALLY DEFERRED`;

/** Registre des tables d'entités synchronisées (nom de colonne = nom de champ). */
export const TABLES: Record<EntityType, TableDef> = {
  household: {
    table: 'households',
    cols: { name: 'text', currency: 'text', settings: 'json', createdAt: 'text', fv: 'json' },
  },
  member: {
    table: 'members',
    cols: { userId: 'text', name: 'text', email: 'text', role: 'text', color: 'text', active: 'bool', joinedAt: 'text', prefs: 'json' },
    extra: ["CHECK (role IN ('owner','admin','member','viewer'))"],
    indexes: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_members_user ON members(householdId, userId)', 'CREATE INDEX IF NOT EXISTS ix_members_userid ON members(userId)'],
  },
  category: { table: 'categories', cols: { name: 'text', icon: 'text', color: 'text', sort: 'int', archived: 'bool' } },
  location: { table: 'locations', cols: { name: 'text', icon: 'text', kind: 'text', sort: 'int', archived: 'bool' } },
  store: {
    table: 'stores',
    cols: { name: 'text', address: 'text', notes: 'text', categoryOrder: 'json', color: 'text', sort: 'int', archived: 'bool' },
  },
  product: {
    table: 'products',
    cols: {
      name: 'text', brand: 'text', family: 'text', aliases: 'json', categoryId: 'text', locationId: 'text', unit: 'text',
      minQty: 'real', idealQty: 'real', packUnit: 'text', packSize: 'real', photoId: 'text', defaultStoreId: 'text', notes: 'text',
      trackStock: 'bool', openShelfLifeDays: 'int', defaultShelfLifeDays: 'int', manualDailyUse: 'real', archived: 'bool',
      createdAt: 'text', createdBy: 'text', updatedAt: 'text', fv: 'json',
    },
    extra: [
      FK('categoryId', 'categories'), FK('locationId', 'locations'), FK('defaultStoreId', 'stores'),
      'CHECK (minQty IS NULL OR minQty >= 0)', 'CHECK (idealQty IS NULL OR idealQty >= 0)', 'CHECK (packSize IS NULL OR packSize > 0)',
    ],
  },
  productCode: {
    table: 'productCodes',
    cols: { productId: 'text', code: 'text', packQty: 'real', label: 'text', brand: 'text', source: 'text', createdAt: 'text', createdBy: 'text' },
    extra: [FK('productId', 'products'), 'CHECK (packQty > 0)'],
    indexes: ['CREATE UNIQUE INDEX IF NOT EXISTS ux_codes ON productCodes(householdId, code)', 'CREATE INDEX IF NOT EXISTS ix_codes_product ON productCodes(productId)'],
  },
  lot: {
    table: 'lots',
    cols: {
      productId: 'text', quantity: 'real', initialQuantity: 'real', expiryDate: 'text', expirySource: 'text', expiryKind: 'text',
      batchNumber: 'text', purchaseDate: 'text', openedAt: 'text', locationId: 'text', unitPriceCents: 'real', storeId: 'text',
      qtySource: 'text', qtyApprox: 'bool', countedAt: 'text', note: 'text', createdAt: 'text', createdBy: 'text', depletedAt: 'text',
    },
    extra: [FK('productId', 'products'), FK('locationId', 'locations'), FK('storeId', 'stores'), 'CHECK (quantity >= 0)', 'CHECK (initialQuantity >= 0)'],
    indexes: ['CREATE INDEX IF NOT EXISTS ix_lots_product ON lots(productId)'],
  },
  movement: {
    table: 'movements',
    cols: {
      productId: 'text', lotId: 'text', type: 'text', delta: 'real', quantityBefore: 'real', quantityAfter: 'real', inputQty: 'real',
      inputUnit: 'text', reason: 'text', note: 'text', source: 'text', flags: 'json', revertOf: 'text', revertedBy: 'text', userId: 'text',
      occurredAt: 'text', recordedAt: 'text', opId: 'text',
    },
    extra: [FK('productId', 'products'), FK('lotId', 'lots'), 'CHECK (quantityAfter >= -0.000001)'],
    indexes: ['CREATE INDEX IF NOT EXISTS ix_mv_product ON movements(productId)', 'CREATE INDEX IF NOT EXISTS ix_mv_op ON movements(opId)', 'CREATE INDEX IF NOT EXISTS ix_mv_lot ON movements(lotId)'],
  },
  shoppingItem: {
    table: 'shoppingItems',
    cols: {
      productId: 'text', name: 'text', categoryId: 'text', storeId: 'text', quantity: 'real', unit: 'text', priority: 'text', comment: 'text',
      assignedTo: 'text', status: 'text', purchasedQty: 'real', purchasedBy: 'text', purchasedAt: 'text', priceCents: 'int', receivedAt: 'text',
      source: 'text', requests: 'json', createdAt: 'text', createdBy: 'text', updatedAt: 'text', updatedBy: 'text', fv: 'json',
    },
    extra: [FK('productId', 'products'), 'CHECK (quantity > 0)', 'CHECK (purchasedQty >= 0)'],
    indexes: ['CREATE INDEX IF NOT EXISTS ix_items_product ON shoppingItems(productId)'],
  },
  purchase: {
    table: 'purchases',
    cols: {
      productId: 'text', name: 'text', categoryId: 'text', quantity: 'real', unit: 'text', totalCents: 'int', discountCents: 'int', storeId: 'text',
      userId: 'text', date: 'text', shoppingItemId: 'text', lotId: 'text', receiptId: 'text', note: 'text', createdAt: 'text',
    },
    extra: ['CHECK (totalCents IS NULL OR totalCents >= 0)'],
    indexes: ['CREATE INDEX IF NOT EXISTS ix_pu_product ON purchases(productId)'],
  },
  receipt: { table: 'receipts', cols: { storeId: 'text', date: 'text', totalCents: 'int', lines: 'json', createdAt: 'text', createdBy: 'text' } },
  inventorySession: {
    table: 'inventorySessions',
    cols: {
      kind: 'text', status: 'text', title: 'text', locations: 'json', lines: 'json', createdAt: 'text', createdBy: 'text', updatedAt: 'text',
      appliedAt: 'text', appliedBy: 'text',
    },
  },
  activity: {
    table: 'activities',
    cols: { userId: 'text', type: 'text', summary: 'text', entityType: 'text', entityId: 'text', at: 'text', opId: 'text', important: 'bool' },
  },
  recipe: {
    table: 'recipes',
    cols: { name: 'text', servings: 'int', ingredients: 'json', instructions: 'text', tags: 'json', archived: 'bool', createdAt: 'text', createdBy: 'text' },
  },
};

const SQL_TYPE: Record<ColKind, string> = { text: 'TEXT', real: 'REAL', int: 'INTEGER', bool: 'INTEGER', json: 'TEXT' };

export function entityTableDDL(type: EntityType): string[] {
  const def = TABLES[type];
  const cols = Object.entries(def.cols).map(([c, k]) => `  ${c} ${SQL_TYPE[k]}`);
  const hhFk = type === 'household' ? [] : ['  FOREIGN KEY (householdId) REFERENCES households(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED'];
  const ddl = `CREATE TABLE IF NOT EXISTS ${def.table} (
  id TEXT PRIMARY KEY,
  householdId TEXT NOT NULL,
  version INTEGER NOT NULL,
${[...cols, ...hhFk, ...(def.extra ?? []).map((e) => `  ${e}`)].join(',\n')}
)`;
  return [ddl, `CREATE INDEX IF NOT EXISTS ix_${def.table}_hv ON ${def.table}(householdId, version)`, ...(def.indexes ?? [])];
}

export const SERVER_DDL = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    passwordHash TEXT NOT NULL,
    isServerAdmin INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    tokenHash TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL,
    userAgent TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(userId)`,
  `CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    householdId TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
    createdBy TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    maxUses INTEGER NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0,
    revokedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS processed_ops (
    opId TEXT PRIMARY KEY,
    householdId TEXT NOT NULL,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    result TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS id_aliases (
    householdId TEXT NOT NULL,
    type TEXT NOT NULL,
    fromId TEXT NOT NULL,
    toId TEXT NOT NULL,
    PRIMARY KEY (householdId, type, fromId)
  )`,
  `CREATE TABLE IF NOT EXISTS tombstones (
    householdId TEXT NOT NULL,
    type TEXT NOT NULL,
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    PRIMARY KEY (householdId, type, id)
  )`,
  `CREATE INDEX IF NOT EXISTS ix_tomb_hv ON tombstones(householdId, version)`,
  `CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    householdId TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS barcode_cache (
    code TEXT PRIMARY KEY,
    data TEXT,
    image BLOB,
    imageMime TEXT,
    fetchedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    userAgent TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS notification_log (
    key TEXT NOT NULL,
    userId TEXT NOT NULL,
    sentAt TEXT NOT NULL,
    PRIMARY KEY (key, userId)
  )`,
];
