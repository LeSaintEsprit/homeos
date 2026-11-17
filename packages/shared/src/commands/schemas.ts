import { z } from 'zod';
import { UNIT_CODES, type UnitCode } from '../units';
import { isDateStr } from '../time';
import { ID_RE } from '../ids';

const id = z.string().regex(ID_RE, 'Identifiant invalide');
const name = z.string().trim().min(1, 'Nom obligatoire').max(120, 'Nom trop long');
const shortText = z.string().trim().max(500).nullable().optional();
const unit = z.enum(UNIT_CODES as [UnitCode, ...UnitCode[]]);
const qty = z.number().min(0, 'Quantité négative').max(10_000_000);
const posQty = z.number().gt(0, 'La quantité doit être positive').max(10_000_000);
const date = z.string().refine(isDateStr, 'Date invalide (AAAA-MM-JJ)');
const cents = z.number().int().min(0).max(100_000_000);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide');
const icon = z.string().trim().min(1).max(40);
const priority = z.enum(['normal', 'high', 'urgent']);
const source = z.enum(['manual', 'stock', 'recommendation', 'missing', 'recipe']);
const optId = id.nullable().optional();
const baseVersion = z.number().int().min(0);
/** Avatar du foyer : emoji (ou courte chaîne) ou « photo:<id> ». */
export const avatar = z.string().trim().min(1).max(60).refine((v) => !v.startsWith('photo:') || ID_RE.test(v.slice(6)), 'Avatar invalide');
export const currency = z.enum(['EUR', 'CHF', 'CAD', 'USD', 'GBP', 'XOF', 'XAF', 'MAD']);
const code = z.string().trim().regex(/^[0-9A-Za-z-]{4,48}$/, 'Code-barres invalide');
const expirySource = z.enum(['manual', 'gs1', 'ocr', 'estimated']);
const expiryKind = z.enum(['dlc', 'ddm']);
const batch = z.string().trim().max(40).nullable().optional();
const mvSource = z.enum(['manual', 'scan', 'shopping', 'receipt', 'inventory', 'recipe', 'import', 'system']);
const alias = z.object({
  text: z.string().trim().min(1).max(120),
  kind: z.enum(['name', 'receipt']),
  storeId: id.nullable().default(null),
});
const codeInput = z.object({
  id,
  code,
  packQty: posQty.default(1),
  label: z.string().trim().max(80).nullable().optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  source: z.enum(['off', 'obf', 'opf', 'manual']).default('manual'),
});

const productFields = {
  name,
  brand: z.string().trim().max(80).nullable().optional(),
  family: z.string().trim().max(80).nullable().optional(),
  aliases: z.array(alias).max(50).optional(),
  categoryId: optId,
  locationId: optId,
  unit,
  minQty: qty.nullable().optional(),
  idealQty: qty.nullable().optional(),
  packUnit: unit.nullable().optional(),
  packSize: posQty.nullable().optional(),
  photoId: optId,
  defaultStoreId: optId,
  notes: z.string().trim().max(2000).nullable().optional(),
  trackStock: z.boolean().optional(),
  openShelfLifeDays: z.number().int().min(0).max(3650).nullable().optional(),
  defaultShelfLifeDays: z.number().int().min(0).max(3650).nullable().optional(),
  manualDailyUse: qty.nullable().optional(),
};

const lotInfo = {
  expiryDate: date.nullable().optional(),
  expirySource: expirySource.nullable().optional(),
  expiryKind: expiryKind.nullable().optional(),
  batchNumber: batch,
  purchaseDate: date.nullable().optional(),
  locationId: optId,
};

const initialStock = z.object({
  lotId: id,
  quantity: posQty,
  unit: unit.optional(),
  ...lotInfo,
  qtyApprox: z.boolean().optional(),
  priceCents: cents.nullable().optional(),
  storeId: optId,
});

const productPatch = z
  .object({
    name: name.optional(),
    brand: productFields.brand,
    family: productFields.family,
    categoryId: optId,
    locationId: optId,
    unit: unit.optional(),
    minQty: productFields.minQty,
    idealQty: productFields.idealQty,
    packUnit: productFields.packUnit,
    packSize: productFields.packSize,
    photoId: optId,
    defaultStoreId: optId,
    notes: productFields.notes,
    trackStock: z.boolean().optional(),
    openShelfLifeDays: productFields.openShelfLifeDays,
    defaultShelfLifeDays: productFields.defaultShelfLifeDays,
    manualDailyUse: productFields.manualDailyUse,
  })
  .strict();

const settingsPatch = z
  .object({
    shoppingIntervalDays: z.number().int().min(1).max(60).optional(),
    safetyDays: z.number().int().min(0).max(30).optional(),
    expirySoonDays: z.number().int().min(1).max(60).optional(),
    expiryUrgentDays: z.number().int().min(0).max(14).optional(),
    forgottenDays: z.number().int().min(7).max(730).optional(),
    forgottenFreshDays: z.number().int().min(2).max(60).optional(),
    monthlyBudgetCents: cents.nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();

const notifKind = z.enum([
  'stock_out', 'stock_low', 'expiring', 'to_buy', 'shopping_unfinished',
  'important_change', 'unusual_spending', 'inventory_check', 'data_issue',
]);

const ingredient = z.object({
  productId: optId,
  name,
  quantity: posQty,
  unit,
  optional: z.boolean().default(false),
});

const inventoryLine = z.object({
  id,
  productId: optId,
  name: z.string().trim().max(120).nullable().optional(),
  code: code.nullable().optional(),
  quantity: qty,
  unit,
  qtyApprox: z.boolean().default(false),
  ...lotInfo,
});

const receiptLine = z.object({
  id,
  label: z.string().trim().min(1).max(160),
  quantity: posQty,
  unit,
  unitPriceCents: cents.nullable().optional(),
  totalCents: cents.nullable().optional(),
  discountCents: cents.nullable().optional(),
  productId: optId,
  createProduct: z.object({ id, ...productFields }).nullable().optional(),
  /** Ajouter cette ligne au stock (uniquement après validation par l'utilisateur). */
  stock: z.boolean().default(false),
  purchaseId: id,
  lotId: id,
  expiryDate: date.nullable().optional(),
  expirySource: expirySource.nullable().optional(),
  locationId: optId,
  learnAlias: z.boolean().default(true),
});

export const OP_SCHEMAS = {
  'household.update': z.object({
    patch: z
      .object({ name: name.optional(), avatar: avatar.nullable().optional(), currency: currency.optional(), settings: settingsPatch.optional() })
      .strict(),
    baseVersion,
  }),
  'member.updateSelf': z.object({
    name: name.optional(),
    color: color.optional(),
    prefs: z
      .object({
        dashboard: z.object({ order: z.array(z.string().max(40)).max(40), hidden: z.array(z.string().max(40)).max(40) }).optional(),
        notifReadAt: z.string().max(40).optional(),
        notifications: z
          .object({
            muted: z.array(notifKind).max(20),
            digest: z.enum(['off', 'daily', 'weekly']),
            digestHour: z.number().int().min(0).max(23),
            pushImportant: z.boolean(),
          })
          .optional(),
        dismissed: z.record(z.string().max(160), z.string().max(10)).optional(),
      })
      .optional(),
  }),
  'category.upsert': z.object({ id, name, icon: icon.optional(), color: color.optional(), sort: z.number().int().optional() }),
  'category.archive': z.object({ id, archived: z.boolean() }),
  'location.upsert': z.object({
    id,
    name,
    icon: icon.optional(),
    kind: z.enum(['fridge', 'freezer', 'pantry', 'other']).optional(),
    sort: z.number().int().optional(),
  }),
  'location.archive': z.object({ id, archived: z.boolean() }),
  'store.upsert': z.object({
    id,
    name,
    address: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    categoryOrder: z.array(id).max(100).optional(),
    color: color.optional(),
    sort: z.number().int().optional(),
  }),
  'store.archive': z.object({ id, archived: z.boolean() }),
  'product.create': z.object({
    id,
    ...productFields,
    codes: z.array(codeInput).max(20).optional(),
    initialStock: initialStock.nullable().optional(),
    stockSource: mvSource.optional(),
  }),
  'product.update': z.object({ id, patch: productPatch, baseVersion }),
  'product.archive': z.object({ id, archived: z.boolean() }),
  'product.merge': z.object({ sourceId: id, targetId: id }),
  'product.addAlias': z.object({ productId: id, alias }),
  'product.removeAlias': z.object({ productId: id, text: z.string().max(120) }),
  'productCode.add': codeInput.extend({ productId: id }),
  'productCode.update': z.object({
    id,
    patch: z
      .object({
        packQty: posQty.optional(),
        label: z.string().trim().max(80).nullable().optional(),
        brand: z.string().trim().max(80).nullable().optional(),
      })
      .strict(),
  }),
  'productCode.remove': z.object({ id }),
  'stock.add': z.object({
    productId: id,
    /** Nouveau lot, ou lot existant du même produit à compléter (scan à la chaîne). */
    lotId: id,
    quantity: posQty,
    unit: unit.optional(),
    kind: z.enum(['add', 'purchase']).default('add'),
    ...lotInfo,
    qtyApprox: z.boolean().optional(),
    priceCents: cents.nullable().optional(),
    storeId: optId,
    note: shortText,
    source: mvSource.default('manual'),
  }),
  'stock.consume': z.object({
    productId: id,
    quantity: posQty,
    unit: unit.optional(),
    lotId: optId,
    note: shortText,
    source: mvSource.default('manual'),
  }),
  'stock.finish': z.object({
    productId: id,
    lotId: optId,
    addToList: z.boolean().optional(),
    itemId: optId,
    note: shortText,
    source: mvSource.default('manual'),
  }),
  'stock.waste': z.object({
    productId: id,
    lotId: optId,
    quantity: posQty.nullable().optional(),
    unit: unit.optional(),
    reason: z.enum(['expired', 'spoiled', 'other']),
    note: shortText,
    source: mvSource.default('manual'),
  }),
  'stock.adjust': z.object({
    productId: id,
    lotId: optId,
    /** Quantité que l'utilisateur voyait (contrôle de concurrence). */
    expected: qty,
    quantity: qty,
    unit: unit.optional(),
    reason: z.enum(['count', 'unlogged', 'error', 'loss']),
    /** Quantité approximative (« il en reste environ la moitié »). */
    approx: z.boolean().optional(),
    note: shortText,
    source: mvSource.default('manual'),
  }),
  'stock.open': z.object({ productId: id, lotId: optId, source: mvSource.default('manual') }),
  'stock.move': z.object({ lotId: id, locationId: id, quantity: posQty.nullable().optional() }),
  'stock.reportMissing': z.object({ productId: id, itemId: id, quantity: posQty.nullable().optional(), unit: unit.optional() }),
  'lot.update': z.object({
    lotId: id,
    patch: z
      .object({
        expiryDate: date.nullable().optional(),
        expirySource: expirySource.nullable().optional(),
        expiryKind: expiryKind.nullable().optional(),
        batchNumber: batch,
        purchaseDate: date.nullable().optional(),
        note: shortText,
      })
      .strict(),
  }),
  'movement.revertOp': z.object({ targetOpId: z.string().regex(ID_RE), reason: shortText }),
  'shopping.add': z.object({
    itemId: id,
    productId: optId,
    name,
    quantity: posQty,
    unit,
    categoryId: optId,
    storeId: optId,
    priority: priority.optional(),
    comment: shortText,
    assignedTo: optId,
    source: source.default('manual'),
  }),
  'shopping.update': z.object({
    itemId: id,
    patch: z
      .object({
        name: name.optional(),
        quantity: posQty.optional(),
        unit: unit.optional(),
        priority: priority.optional(),
        comment: shortText,
        assignedTo: optId,
        categoryId: optId,
        storeId: optId,
        productId: optId,
      })
      .strict(),
    baseVersion,
  }),
  'shopping.setPurchased': z.object({ itemId: id, purchasedQty: qty, priceCents: cents.nullable().optional() }),
  'shopping.remove': z.object({ itemId: id }),
  'shopping.restore': z.object({ itemId: id }),
  'shopping.receive': z.object({
    itemId: id,
    receivedQty: qty,
    unit,
    totalCents: cents.nullable().optional(),
    storeId: optId,
    date: date.optional(),
    lotId: id,
    purchaseId: id,
    expiryDate: date.nullable().optional(),
    expirySource: expirySource.nullable().optional(),
    expiryKind: expiryKind.nullable().optional(),
    batchNumber: batch,
    locationId: optId,
    productId: optId,
    createProduct: z.object({ id, ...productFields }).nullable().optional(),
    skipStock: z.boolean().optional(),
  }),
  'purchase.create': z.object({
    id,
    name,
    productId: optId,
    categoryId: optId,
    quantity: posQty,
    unit,
    totalCents: cents.nullable(),
    discountCents: cents.nullable().optional(),
    storeId: optId,
    date,
    note: shortText,
  }),
  'purchase.update': z.object({
    id,
    patch: z
      .object({
        name: name.optional(),
        quantity: posQty.optional(),
        unit: unit.optional(),
        totalCents: cents.nullable().optional(),
        discountCents: cents.nullable().optional(),
        storeId: optId,
        date: date.optional(),
        note: shortText,
        categoryId: optId,
        productId: optId,
      })
      .strict(),
  }),
  'purchase.delete': z.object({ id }),
  'receipt.apply': z.object({
    id,
    storeId: optId,
    date,
    totalCents: cents.nullable().optional(),
    lines: z.array(receiptLine).min(1).max(200),
  }),
  'inventory.start': z.object({
    id,
    kind: z.enum(['initial', 'check']),
    title: z.string().trim().min(1).max(80),
    locationIds: z.array(id).max(60),
  }),
  'inventory.upsertLine': z.object({ sessionId: id, line: inventoryLine }),
  'inventory.removeLine': z.object({ sessionId: id, lineId: id }),
  'inventory.setLocation': z.object({
    sessionId: id,
    locationId: id,
    status: z.enum(['todo', 'in_progress', 'done', 'skipped']),
  }),
  'inventory.apply': z.object({
    sessionId: id,
    decisions: z
      .array(
        z.object({
          productId: id,
          /** Stock théorique vu par l'utilisateur au moment de la validation. */
          expected: qty,
          apply: z.boolean(),
        }),
      )
      .max(2000),
  }),
  'inventory.cancel': z.object({ sessionId: id }),
  'recipe.upsert': z.object({
    id,
    name,
    servings: z.number().int().min(1).max(100),
    ingredients: z.array(ingredient).max(80),
    instructions: z.string().trim().max(20000).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
  }),
  'recipe.archive': z.object({ id, archived: z.boolean() }),
  'recipe.cook': z.object({ recipeId: id, servings: z.number().int().min(1).max(100) }),
} as const;

export type OpType = keyof typeof OP_SCHEMAS;
export type OpPayload<T extends OpType> = z.output<(typeof OP_SCHEMAS)[T]>;
export type OpInput<T extends OpType> = z.input<(typeof OP_SCHEMAS)[T]>;

export const OP_TYPES = Object.keys(OP_SCHEMAS) as OpType[];

/** Enveloppe d'une opération émise par un appareil. */
export interface Op<T extends OpType = OpType> {
  opId: string;
  type: T;
  payload: OpInput<T>;
  /** Instant où l'action a eu lieu sur l'appareil (ISO). */
  clientTime: string;
}

export const OpEnvelopeSchema = z.object({
  opId: id,
  type: z.enum(OP_TYPES as [OpType, ...OpType[]]),
  payload: z.unknown(),
  clientTime: z.string().max(40),
});
