import type {
  Activity,
  EntityMap,
  EntityType,
  FieldVersions,
  InventorySession,
  Lot,
  Movement,
  MovementSource,
  MovementType,
  Product,
  ProductAlias,
  ProductCode,
  Purchase,
  QtySource,
  ShoppingItem,
  ShoppingSource,
  Priority,
  ExpirySource,
  ExpiryKind,
} from '../types';
import { ADJUST_REASON_LABELS } from '../types';
import type { DataStore, ExecEnv, FieldConflict, Notice } from './context';
import { DomainError } from './context';
import type { OpPayload, OpType } from './schemas';
import { deriveId } from '../ids';
import { addDays, daysBetween, frDate } from '../time';
import { formatMoney } from '../money';
import { convert, formatQty, roundQty, toStockUnit, unitDef, type UnitCode } from '../units';
import { deOf, normalizeName, similarity } from '../text';
import { isActiveItem, isLotExpired, sortFefo, sumLots, effectiveExpiry } from '../domain';
import { computeInventoryDiff, lotInScope, sessionScope, QTY_EPS } from '../inventory';
import { DEFAULT_NOTIFICATION_PREFS } from '../defaults';

export interface LogEntry {
  type: string;
  summary: string;
  entityType: EntityType | null;
  entityId: string | null;
  important: boolean;
}

export interface Ctx extends ExecEnv {
  store: DataStore;
  opId: string;
  opType: OpType;
  occurredAt: string;
  today: string;
  warnings: Notice[];
  conflicts: FieldConflict[];
  aliases: { type: EntityType; from: string; to: string }[];
  logs: LogEntry[];
  counter: number;
  writes: number;
}

type H<T extends OpType> = (ctx: Ctx, p: OpPayload<T>) => void;

// ───────────────────────────── Utilitaires ─────────────────────────────

function nextId(ctx: Ctx, prefix: string): string {
  ctx.counter += 1;
  return deriveId(ctx.opId, `${prefix}${ctx.counter}`);
}

function warn(ctx: Ctx, code: string, message: string) {
  if (!ctx.warnings.some((w) => w.code === code && w.message === message)) ctx.warnings.push({ code, message });
}

function log(ctx: Ctx, summary: string, entityType: EntityType | null, entityId: string | null, important = false) {
  ctx.logs.push({ type: ctx.opType, summary, entityType, entityId, important });
}

function put<K extends EntityType>(ctx: Ctx, type: K, e: EntityMap[K], touched?: string[]): EntityMap[K] {
  ctx.writes += 1;
  return ctx.store.put(type, e, touched);
}

const LABELS: Partial<Record<EntityType, string>> = {
  product: 'Produit',
  lot: 'Lot',
  category: 'Catégorie',
  location: 'Emplacement',
  store: 'Magasin',
  shoppingItem: 'Article',
  purchase: 'Achat',
  recipe: 'Recette',
  inventorySession: 'Inventaire',
  productCode: 'Code-barres',
  member: 'Membre',
  receipt: 'Ticket',
};

function must<K extends EntityType>(ctx: Ctx, type: K, id: string): EntityMap[K] {
  const real = ctx.store.resolveAlias(type, id);
  const e = ctx.store.get(type, real);
  if (!e) throw new DomainError('not_found', `${LABELS[type] ?? 'Élément'} introuvable (peut-être supprimé par un autre membre).`);
  return e;
}

function checkRef(ctx: Ctx, type: EntityType, id: string | null | undefined): string | null {
  if (id == null) return null;
  return must(ctx, type, id).id;
}

function qp(q: number, unit: UnitCode, name: string): string {
  return `${formatQty(q, unit)} ${deOf(name)}`;
}

function stockQty(ctx: Ctx, p: Product, qty: number, unit: UnitCode | undefined): number {
  const u = unit ?? p.unit;
  const q = toStockUnit(qty, u, p);
  if (q == null) {
    throw new DomainError(
      'unit_incompatible',
      `Impossible de convertir des ${unitDef(u).plural} en ${unitDef(p.unit).plural} pour « ${p.name} » : définissez d'abord le conditionnement du produit.`,
    );
  }
  return q;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Applique un patch champ par champ. Un champ modifié par un AUTRE membre après
 * la version vue par l'utilisateur (baseVersion) n'est pas écrasé : conflit.
 */
function patchWithConflicts<T extends { id: string; fv: FieldVersions }>(
  ctx: Ctx,
  type: EntityType,
  entity: T,
  patch: Record<string, unknown>,
  baseVersion: number,
  labels: Record<string, string>,
): { next: T; touched: string[] } {
  const next = { ...entity } as Record<string, unknown>;
  const touched: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = (entity as Record<string, unknown>)[k];
    if (deepEqual(cur, v)) continue;
    const fvk = entity.fv?.[k];
    if (fvk && fvk[0] > baseVersion && fvk[1] !== ctx.userId) {
      ctx.conflicts.push({ entityType: type, entityId: entity.id, field: k, label: labels[k] ?? k, mine: v, theirs: cur, theirsBy: fvk[1] });
      continue;
    }
    next[k] = v;
    touched.push(k);
  }
  return { next: next as T, touched };
}

const PRODUCT_LABELS: Record<string, string> = {
  name: 'Nom', brand: 'Marque', family: 'Famille', categoryId: 'Catégorie', locationId: 'Emplacement', unit: 'Unité',
  minQty: 'Seuil minimal', idealQty: 'Quantité idéale', packUnit: 'Conditionnement', packSize: 'Taille du conditionnement',
  photoId: 'Photo', defaultStoreId: 'Magasin habituel', notes: 'Commentaires', trackStock: 'Suivi du stock',
  openShelfLifeDays: 'Conservation après ouverture', defaultShelfLifeDays: 'Conservation habituelle',
  manualDailyUse: 'Consommation estimée',
};

const ITEM_LABELS: Record<string, string> = {
  name: 'Nom', quantity: 'Quantité', unit: 'Unité', priority: 'Priorité', comment: 'Commentaire',
  assignedTo: 'Attribution', categoryId: 'Rayon', storeId: 'Magasin', productId: 'Produit',
};

function memberName(ctx: Ctx, userId: string | null | undefined): string {
  if (!userId) return 'un membre';
  const m = ctx.store.list('member', { userId })[0];
  return m?.name ?? 'un membre';
}

// ───────────────────────────── Stock ─────────────────────────────

function lotsOf(ctx: Ctx, productId: string): Lot[] {
  return ctx.store.list('lot', { productId });
}

function totalOf(ctx: Ctx, productId: string): number {
  return sumLots(lotsOf(ctx, productId));
}

interface MoveInfo {
  type: MovementType;
  source: MovementSource;
  inputQty?: number | null;
  inputUnit?: UnitCode | null;
  reason?: string | null;
  note?: string | null;
  flags?: string[];
  revertOf?: string | null;
}

function writeMovement(ctx: Ctx, p: Product, lotId: string | null, delta: number, before: number, info: MoveInfo): Movement {
  const m: Movement = {
    id: nextId(ctx, 'm'),
    householdId: ctx.householdId,
    version: 0,
    productId: p.id,
    lotId,
    type: info.type,
    delta: roundQty(delta),
    quantityBefore: roundQty(before),
    quantityAfter: roundQty(before + delta),
    inputQty: info.inputQty ?? null,
    inputUnit: info.inputUnit ?? null,
    reason: info.reason ?? null,
    note: info.note ?? null,
    source: info.source,
    flags: info.flags ?? [],
    revertOf: info.revertOf ?? null,
    revertedBy: null,
    userId: ctx.userId,
    occurredAt: ctx.occurredAt,
    recordedAt: ctx.now,
    opId: ctx.opId,
  };
  return put(ctx, 'movement', m);
}

/** Modifie la quantité d'un lot et journalise le mouvement correspondant. */
function changeLot(ctx: Ctx, p: Product, lot: Lot, delta: number, info: MoveInfo, lotPatch: Partial<Lot> = {}): Movement {
  const before = totalOf(ctx, p.id);
  const newQ = roundQty(lot.quantity + delta);
  if (newQ < -QTY_EPS) throw new DomainError('negative_stock', `Le stock du lot ne peut pas devenir négatif (« ${p.name} »).`);
  const q = Math.max(0, newQ);
  put(ctx, 'lot', {
    ...lot,
    ...lotPatch,
    quantity: q,
    depletedAt: q === 0 ? (lot.depletedAt ?? ctx.occurredAt) : null,
  });
  return writeMovement(ctx, p, lot.id, delta, before, info);
}

interface NewLotInfo {
  lotId: string;
  expiryDate?: string | null;
  expirySource?: ExpirySource | null;
  expiryKind?: ExpiryKind | null;
  batchNumber?: string | null;
  purchaseDate?: string | null;
  locationId?: string | null;
  qtyApprox?: boolean;
  qtySource: QtySource;
  storeId?: string | null;
  /** Prix total payé pour la quantité ajoutée (centimes). */
  priceCents?: number | null;
  note?: string | null;
}

function checkExpiry(ctx: Ctx, p: Product, expiry: string | null | undefined, purchaseDate: string | null | undefined, isReception: boolean) {
  if (!expiry) return;
  if (purchaseDate && expiry < purchaseDate) {
    warn(ctx, 'expiry_before_purchase', `« ${p.name} » : la date de péremption (${frDate(expiry)}) est antérieure à la date d'achat.`);
  }
  if (daysBetween(ctx.today, expiry) > 3650) {
    throw new DomainError('expiry_incoherent', `Date de péremption incohérente pour « ${p.name} » (plus de 10 ans).`);
  }
  if (isReception && expiry < ctx.today) {
    warn(ctx, 'expired_at_reception', `« ${p.name} » est déjà périmé (${frDate(expiry)}) : vérifiez la date.`);
  }
}

/** Ajoute du stock : crée un lot, ou complète un lot existant du même produit. */
function addStock(ctx: Ctx, p: Product, qty: number, info: NewLotInfo, mv: MoveInfo): { lot: Lot; movement: Movement; created: boolean } {
  if (!(qty > 0)) throw new DomainError('invalid_qty', 'La quantité ajoutée doit être positive.');
  const locationId = checkRef(ctx, 'location', info.locationId);
  const storeId = checkRef(ctx, 'store', info.storeId);
  const existing = ctx.store.get('lot', info.lotId);
  const isReception = mv.type === 'purchase';
  if (existing) {
    if (existing.productId !== p.id) throw new DomainError('lot_mismatch', 'Ce lot appartient à un autre produit.');
    if (info.expiryDate && existing.expiryDate && info.expiryDate !== existing.expiryDate) {
      warn(ctx, 'lot_expiry_differs', `Date différente de celle du lot (${frDate(existing.expiryDate!)}) : la date du lot est conservée.`);
    }
    let unitPrice = existing.unitPriceCents;
    if (info.priceCents != null) {
      const prevTotal = (existing.unitPriceCents ?? 0) * existing.initialQuantity;
      unitPrice = (prevTotal + info.priceCents) / roundQty(existing.initialQuantity + qty);
    }
    const movement = changeLot(ctx, p, existing, qty, mv, {
      initialQuantity: roundQty(existing.initialQuantity + qty),
      unitPriceCents: unitPrice,
      qtyApprox: existing.qtyApprox || !!info.qtyApprox,
    });
    return { lot: ctx.store.get('lot', existing.id)!, movement, created: false };
  }
  checkExpiry(ctx, p, info.expiryDate, info.purchaseDate, isReception);
  const before = totalOf(ctx, p.id);
  const lot: Lot = {
    id: info.lotId,
    householdId: ctx.householdId,
    version: 0,
    productId: p.id,
    quantity: roundQty(qty),
    initialQuantity: roundQty(qty),
    expiryDate: info.expiryDate ?? null,
    expirySource: info.expiryDate ? (info.expirySource ?? 'manual') : null,
    expiryKind: info.expiryDate ? (info.expiryKind ?? null) : null,
    batchNumber: info.batchNumber ?? null,
    purchaseDate: info.purchaseDate ?? (isReception ? ctx.today : null),
    openedAt: null,
    locationId: locationId ?? p.locationId,
    unitPriceCents: info.priceCents != null ? info.priceCents / qty : null,
    storeId,
    qtySource: info.qtySource,
    qtyApprox: !!info.qtyApprox,
    countedAt: info.qtySource === 'count' ? ctx.occurredAt : null,
    note: info.note ?? null,
    createdAt: ctx.occurredAt,
    createdBy: ctx.userId,
    depletedAt: null,
  };
  put(ctx, 'lot', lot);
  const movement = writeMovement(ctx, p, lot.id, qty, before, mv);
  return { lot, movement, created: true };
}

interface TakeOpts extends MoveInfo {
  lotId?: string | null;
  /** Pour les pertes : prendre d'abord les lots périmés. */
  expiredFirst?: boolean;
}

/** Retire une quantité du stock (FEFO par défaut). Ne descend jamais sous zéro. */
function takeFromLots(ctx: Ctx, p: Product, qty: number, opts: TakeOpts): { taken: number; movements: Movement[] } {
  let candidates: Lot[];
  if (opts.lotId) {
    const lot = must(ctx, 'lot', opts.lotId);
    if (lot.productId !== p.id) throw new DomainError('lot_mismatch', 'Ce lot appartient à un autre produit.');
    candidates = [lot];
  } else {
    candidates = sortFefo(lotsOf(ctx, p.id).filter((l) => l.quantity > 0), p, ctx.today, ctx.timezone);
    if (opts.expiredFirst) {
      const exp = candidates.filter((l) => isLotExpired(l, p, ctx.today, ctx.timezone));
      candidates = [...exp, ...candidates.filter((l) => !exp.includes(l))];
    }
  }
  let remaining = roundQty(qty);
  const movements: Movement[] = [];
  for (const lot of candidates) {
    if (remaining <= QTY_EPS) break;
    const fresh = ctx.store.get('lot', lot.id)!;
    const take = roundQty(Math.min(fresh.quantity, remaining));
    if (take <= 0) continue;
    movements.push(changeLot(ctx, p, fresh, -take, opts));
    remaining = roundQty(remaining - take);
  }
  const taken = roundQty(qty - remaining);
  if (remaining > QTY_EPS) {
    warn(
      ctx,
      'shortfall',
      taken > 0
        ? `Stock insuffisant pour « ${p.name} » : seulement ${formatQty(taken, p.unit)} retiré(s) sur ${formatQty(qty, p.unit)} demandé(s). Le stock était peut-être inexact : pensez à un inventaire.`
        : `Le stock de « ${p.name} » était déjà à zéro : rien n'a été retiré. Pensez à vérifier l'inventaire.`,
    );
    if (movements.length > 0) {
      const last = movements[movements.length - 1];
      movements[movements.length - 1] = put(ctx, 'movement', { ...last, flags: [...last.flags, 'shortfall'] });
    } else {
      movements.push(writeMovement(ctx, p, null, 0, totalOf(ctx, p.id), { ...opts, flags: ['shortfall'] }));
    }
  }
  return { taken, movements };
}

// ───────────────────────────── Liste de courses ─────────────────────────────

const PRIORITY_RANK: Record<Priority, number> = { normal: 0, high: 1, urgent: 2 };

interface ShoppingAddInput {
  itemId: string;
  productId?: string | null;
  name: string;
  quantity: number;
  unit: UnitCode;
  categoryId?: string | null;
  storeId?: string | null;
  priority?: Priority;
  comment?: string | null;
  assignedTo?: string | null;
  source: ShoppingSource;
}

function convertItemQty(q: number, from: UnitCode, to: UnitCode, p: Product | null): number | null {
  if (p) {
    const s = toStockUnit(q, from, p);
    if (s == null) return null;
    const t = toStockUnit(1, to, p);
    if (t == null || t === 0) return null;
    return roundQty(s / t);
  }
  return convert(q, from, to);
}

/** Ajout à la liste avec fusion des doublons (mêmes produit ou nom). */
function shoppingAdd(ctx: Ctx, input: ShoppingAddInput): ShoppingItem {
  const product = input.productId ? must(ctx, 'product', input.productId) : null;
  const name = product ? product.name : input.name.trim();
  const categoryId = checkRef(ctx, 'category', input.categoryId ?? product?.categoryId ?? null);
  const storeId = checkRef(ctx, 'store', input.storeId ?? product?.defaultStoreId ?? null);
  const assignedTo = input.assignedTo ?? null;
  if (product && toStockUnit(input.quantity, input.unit, product) == null) {
    warn(ctx, 'unit_unconvertible', `Unité non convertible pour « ${product.name} » : cet article ne sera pas pris en compte dans les prévisions.`);
  }
  if (ctx.store.get('shoppingItem', input.itemId)) {
    throw new DomainError('exists', 'Cet article existe déjà.');
  }
  const norm = normalizeName(name);
  const candidates = (product ? ctx.store.list('shoppingItem', { productId: product.id }) : ctx.store.list('shoppingItem', { productId: null }))
    .filter(isActiveItem)
    .filter((i) => product || normalizeName(i.name) === norm);
  for (const c of candidates) {
    const add = convertItemQty(input.quantity, input.unit, c.unit, product);
    if (add == null) continue;
    const newQty = roundQty(c.quantity + add);
    const priority = PRIORITY_RANK[input.priority ?? 'normal'] > PRIORITY_RANK[c.priority] ? input.priority! : c.priority;
    const comment = input.comment && !(c.comment ?? '').includes(input.comment) ? [c.comment, input.comment].filter(Boolean).join(' · ') : c.comment;
    const status = c.status === 'purchased' ? 'partial' : c.status;
    const touched = ['quantity', 'requests'];
    if (priority !== c.priority) touched.push('priority');
    if (comment !== c.comment) touched.push('comment');
    const merged = put(
      ctx,
      'shoppingItem',
      {
        ...c,
        quantity: newQty,
        priority,
        comment,
        status,
        storeId: c.storeId ?? storeId,
        requests: [...c.requests, { u: ctx.userId, q: input.quantity, unit: input.unit, at: ctx.occurredAt, src: input.source }],
        updatedAt: ctx.now,
        updatedBy: ctx.userId,
      },
      touched,
    );
    ctx.store.addAlias('shoppingItem', input.itemId, c.id);
    ctx.aliases.push({ type: 'shoppingItem', from: input.itemId, to: c.id });
    const others = [...new Set(c.requests.map((r) => r.u).filter((u) => u !== ctx.userId))];
    warn(
      ctx,
      'merged',
      `« ${name} » était déjà dans la liste${others.length ? ` (ajouté par ${others.map((u) => memberName(ctx, u)).join(', ')})` : ''} : quantité portée à ${formatQty(newQty, c.unit)}.`,
    );
    return merged;
  }
  const item: ShoppingItem = {
    id: input.itemId,
    householdId: ctx.householdId,
    version: 0,
    productId: product?.id ?? null,
    name,
    categoryId,
    storeId,
    quantity: roundQty(input.quantity),
    unit: input.unit,
    priority: input.priority ?? 'normal',
    comment: input.comment ?? null,
    assignedTo,
    status: 'pending',
    purchasedQty: 0,
    purchasedBy: null,
    purchasedAt: null,
    priceCents: null,
    receivedAt: null,
    source: input.source,
    requests: [{ u: ctx.userId, q: input.quantity, unit: input.unit, at: ctx.occurredAt, src: input.source }],
    createdAt: ctx.occurredAt,
    createdBy: ctx.userId,
    updatedAt: ctx.now,
    updatedBy: ctx.userId,
    fv: {},
  };
  return put(ctx, 'shoppingItem', item);
}

// ───────────────────────────── Produits ─────────────────────────────

function validatePack(unit: UnitCode, packUnit: UnitCode | null | undefined, packSize: number | null | undefined) {
  if ((packUnit && !packSize) || (!packUnit && packSize)) {
    throw new DomainError('pack_invalid', 'Le conditionnement doit préciser une unité ET une quantité (ex. 1 paquet = 500 g).');
  }
  if (packUnit && packUnit === unit) throw new DomainError('pack_invalid', "Le conditionnement doit être différent de l'unité de stock.");
}

function addCode(
  ctx: Ctx,
  p: Product,
  c: { id: string; code: string; packQty: number; label?: string | null; brand?: string | null; source: ProductCode['source'] },
): ProductCode | null {
  const existing = ctx.store.list('productCode', { code: c.code })[0];
  if (existing) {
    if (existing.productId === p.id) {
      return put(ctx, 'productCode', { ...existing, packQty: c.packQty, label: c.label ?? existing.label, brand: c.brand ?? existing.brand });
    }
    const other = ctx.store.get('product', existing.productId);
    warn(ctx, 'code_taken', `Le code ${c.code} est déjà associé à « ${other?.name ?? 'un autre produit'} » : association ignorée.`);
    return null;
  }
  return put(ctx, 'productCode', {
    id: c.id,
    householdId: ctx.householdId,
    version: 0,
    productId: p.id,
    code: c.code,
    packQty: c.packQty,
    label: c.label ?? null,
    brand: c.brand ?? null,
    source: c.source,
    createdAt: ctx.occurredAt,
    createdBy: ctx.userId,
  });
}

function findSimilarProducts(ctx: Ctx, name: string, excludeId: string): Product[] {
  return ctx.store
    .list('product', { archived: false })
    .filter((p) => p.id !== excludeId && (similarity(p.name, name) >= 0.85 || p.aliases.some((a) => similarity(a.text, name) >= 0.9)));
}

function createProduct(ctx: Ctx, input: OpPayload<'product.create'> | (Omit<OpPayload<'product.create'>, 'initialStock'> & { initialStock?: null })): Product {
  if (ctx.store.get('product', input.id)) throw new DomainError('exists', 'Ce produit existe déjà.');
  validatePack(input.unit, input.packUnit, input.packSize);
  const similar = findSimilarProducts(ctx, input.name, input.id);
  if (similar.length) {
    warn(ctx, 'possible_duplicate', `Produit proche déjà présent : ${similar.map((s) => `« ${s.name} »`).join(', ')}. Vérifiez qu'il ne s'agit pas d'un doublon.`);
  }
  const p: Product = {
    id: input.id,
    householdId: ctx.householdId,
    version: 0,
    name: input.name,
    brand: input.brand ?? null,
    family: input.family ?? null,
    aliases: input.aliases ?? [],
    categoryId: checkRef(ctx, 'category', input.categoryId),
    locationId: checkRef(ctx, 'location', input.locationId),
    unit: input.unit,
    minQty: input.minQty ?? null,
    idealQty: input.idealQty ?? null,
    packUnit: input.packUnit ?? null,
    packSize: input.packSize ?? null,
    photoId: input.photoId ?? null,
    defaultStoreId: checkRef(ctx, 'store', input.defaultStoreId),
    notes: input.notes ?? null,
    trackStock: input.trackStock ?? true,
    openShelfLifeDays: input.openShelfLifeDays ?? null,
    defaultShelfLifeDays: input.defaultShelfLifeDays ?? null,
    manualDailyUse: input.manualDailyUse ?? null,
    archived: false,
    createdAt: ctx.occurredAt,
    createdBy: ctx.userId,
    updatedAt: ctx.now,
    fv: {},
  };
  put(ctx, 'product', p);
  for (const c of input.codes ?? []) addCode(ctx, p, c);
  return p;
}

// ───────────────────────────── Handlers ─────────────────────────────

const householdUpdate: H<'household.update'> = (ctx, { patch, baseVersion }) => {
  const h = must(ctx, 'household', ctx.householdId);
  const flat: Record<string, unknown> = {};
  if (patch.name !== undefined) flat.name = patch.name;
  if (patch.currency !== undefined) flat.currency = patch.currency;
  if (patch.avatar !== undefined) flat.avatar = patch.avatar;
  for (const [k, v] of Object.entries(patch.settings ?? {})) if (v !== undefined) flat[`settings.${k}`] = v;
  const view: Record<string, unknown> & { id: string; fv: FieldVersions } = {
    id: h.id,
    fv: h.fv,
    name: h.name,
    avatar: h.avatar,
    currency: h.currency,
    ...Object.fromEntries(Object.entries(h.settings).map(([k, v]) => [`settings.${k}`, v])),
  };
  const { next, touched } = patchWithConflicts(ctx, 'household', view, flat, baseVersion, { name: 'Nom du foyer', avatar: 'Avatar', currency: 'Devise' });
  if (!touched.length) return;
  const settings = { ...h.settings };
  for (const k of touched) if (k.startsWith('settings.')) (settings as Record<string, unknown>)[k.slice(9)] = next[k];
  put(ctx, 'household', { ...h, name: next.name as string, avatar: (next.avatar as string | null) ?? null, currency: next.currency as string, settings }, touched);
  log(ctx, 'a modifié les réglages du foyer', 'household', h.id);
};

const memberUpdateSelf: H<'member.updateSelf'> = (ctx, p) => {
  const m = ctx.store.list('member', { userId: ctx.userId })[0];
  if (!m) throw new DomainError('not_member', "Vous n'êtes pas membre de ce foyer.");
  const prefs = { ...m.prefs };
  if (p.prefs?.dashboard) prefs.dashboard = p.prefs.dashboard;
  if (p.prefs?.notifReadAt) prefs.notifReadAt = p.prefs.notifReadAt;
  if (p.prefs?.notifications) prefs.notifications = { ...DEFAULT_NOTIFICATION_PREFS, ...p.prefs.notifications };
  if (p.prefs?.clearDismissed) prefs.dismissed = {};
  if (p.prefs?.dismissed) {
    // Conserve au plus 300 alertes masquées, les plus récentes.
    const all = Object.entries({ ...(m.prefs.dismissed ?? {}), ...p.prefs.dismissed }).sort((a, b) => (a[1] < b[1] ? 1 : -1));
    prefs.dismissed = Object.fromEntries(all.slice(0, 300));
  }
  put(ctx, 'member', { ...m, name: p.name ?? m.name, color: p.color ?? m.color, prefs });
};

function upsertSimple<K extends 'category' | 'location' | 'store'>(ctx: Ctx, type: K, data: Record<string, unknown> & { id: string; name: string }, defaults: Record<string, unknown>) {
  const existing = ctx.store.get(type, data.id);
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  if (existing) {
    put(ctx, type, { ...existing, ...clean } as EntityMap[K]);
    log(ctx, `a modifié ${LABELS[type]!.toLowerCase()} « ${data.name} »`, type, data.id);
  } else {
    const sort = ctx.store.list(type).length;
    put(ctx, type, { householdId: ctx.householdId, version: 0, archived: false, sort, ...defaults, ...clean } as unknown as EntityMap[K]);
    log(ctx, `a créé ${type === 'category' ? 'la catégorie' : type === 'location' ? "l'emplacement" : 'le magasin'} « ${data.name} »`, type, data.id);
  }
}

function archiveSimple(ctx: Ctx, type: 'category' | 'location' | 'store' | 'recipe', id: string, archived: boolean) {
  const e = must(ctx, type, id);
  put(ctx, type, { ...e, archived } as never);
  log(ctx, `a ${archived ? 'archivé' : 'restauré'} « ${(e as { name: string }).name} »`, type, id);
}

const productCreate: H<'product.create'> = (ctx, input) => {
  const p = createProduct(ctx, input);
  let summary = `a ajouté le produit « ${p.name} »`;
  if (input.initialStock) {
    const s = input.initialStock;
    const q = stockQty(ctx, p, s.quantity, s.unit);
    const source = input.stockSource ?? 'manual';
    addStock(
      ctx,
      p,
      q,
      {
        lotId: s.lotId,
        expiryDate: s.expiryDate,
        expirySource: s.expirySource,
        expiryKind: s.expiryKind,
        batchNumber: s.batchNumber,
        purchaseDate: s.purchaseDate,
        locationId: s.locationId,
        qtyApprox: s.qtyApprox,
        qtySource: source === 'scan' ? 'scan' : source === 'inventory' ? 'count' : 'manual',
        storeId: s.storeId,
        priceCents: s.priceCents,
      },
      { type: 'add', source, inputQty: s.quantity, inputUnit: s.unit ?? p.unit },
    );
    if (s.priceCents != null) createPurchaseRecord(ctx, p, q, p.unit, s.priceCents, s.storeId ?? null, deriveId(s.lotId, 'p'), s.lotId, null, null);
    summary += ` (${formatQty(q, p.unit)})`;
  }
  log(ctx, summary, 'product', p.id);
};

const productUpdate: H<'product.update'> = (ctx, { id, patch, baseVersion }) => {
  const p = must(ctx, 'product', id);
  const { next, touched } = patchWithConflicts(ctx, 'product', p, patch, baseVersion, PRODUCT_LABELS);
  if (!touched.length) return;
  if (touched.includes('unit')) {
    const hasHistory = lotsOf(ctx, p.id).length > 0 || ctx.store.list('movement', { productId: p.id }).length > 0;
    if (hasHistory) {
      throw new DomainError(
        'unit_locked',
        "Impossible de changer l'unité d'un produit qui a déjà un historique de stock : utilisez un conditionnement (ex. 1 paquet = 500 g) ou créez un nouveau produit.",
      );
    }
  }
  validatePack(next.unit, next.packUnit, next.packSize);
  for (const [k, t] of [['categoryId', 'category'], ['locationId', 'location'], ['defaultStoreId', 'store']] as const) {
    if (touched.includes(k)) checkRef(ctx, t, next[k]);
  }
  if (touched.includes('name')) {
    const similar = findSimilarProducts(ctx, next.name, p.id);
    if (similar.length) warn(ctx, 'possible_duplicate', `Produit proche déjà présent : ${similar.map((s) => `« ${s.name} »`).join(', ')}.`);
  }
  put(ctx, 'product', { ...next, updatedAt: ctx.now }, touched);
  log(ctx, `a modifié « ${next.name} » (${touched.map((t) => PRODUCT_LABELS[t] ?? t).join(', ').toLowerCase()})`, 'product', p.id);
};

const productArchive: H<'product.archive'> = (ctx, { id, archived }) => {
  const p = must(ctx, 'product', id);
  put(ctx, 'product', { ...p, archived, updatedAt: ctx.now }, ['archived']);
  log(ctx, `a ${archived ? 'archivé' : 'restauré'} le produit « ${p.name} »`, 'product', id, archived);
};

const productMerge: H<'product.merge'> = (ctx, { sourceId, targetId }) => {
  const src = must(ctx, 'product', sourceId);
  const dst = must(ctx, 'product', targetId);
  if (src.id === dst.id) throw new DomainError('invalid', 'Impossible de fusionner un produit avec lui-même.');
  const f = toStockUnit(1, src.unit, dst);
  if (f == null) {
    throw new DomainError('unit_incompatible', `Unités incompatibles (${unitDef(src.unit).plural} → ${unitDef(dst.unit).plural}) : fusion impossible sans conditionnement défini.`);
  }
  for (const lot of lotsOf(ctx, src.id)) {
    put(ctx, 'lot', {
      ...lot,
      productId: dst.id,
      quantity: roundQty(lot.quantity * f),
      initialQuantity: roundQty(lot.initialQuantity * f),
      unitPriceCents: lot.unitPriceCents != null ? lot.unitPriceCents / f : null,
    });
  }
  for (const m of ctx.store.list('movement', { productId: src.id })) {
    put(ctx, 'movement', {
      ...m,
      productId: dst.id,
      delta: roundQty(m.delta * f),
      quantityBefore: roundQty(m.quantityBefore * f),
      quantityAfter: roundQty(m.quantityAfter * f),
      note: [m.note, `Fusionné depuis « ${src.name} »`].filter(Boolean).join(' · '),
    });
  }
  for (const c of ctx.store.list('productCode', { productId: src.id })) put(ctx, 'productCode', { ...c, productId: dst.id, packQty: roundQty(c.packQty * f) });
  for (const i of ctx.store.list('shoppingItem', { productId: src.id })) put(ctx, 'shoppingItem', { ...i, productId: dst.id, name: dst.name });
  for (const pu of ctx.store.list('purchase', { productId: src.id })) put(ctx, 'purchase', { ...pu, productId: dst.id });
  const aliases = mergeAliases(dst.aliases, [...src.aliases, { text: src.name, kind: 'name', storeId: null }], dst.name);
  put(ctx, 'product', { ...dst, aliases, updatedAt: ctx.now }, ['aliases']);
  put(ctx, 'product', { ...src, archived: true, updatedAt: ctx.now }, ['archived']);
  ctx.store.addAlias('product', src.id, dst.id);
  ctx.aliases.push({ type: 'product', from: src.id, to: dst.id });
  log(ctx, `a fusionné « ${src.name} » dans « ${dst.name} »`, 'product', dst.id, true);
};

function mergeAliases(base: ProductAlias[], extra: ProductAlias[], productName: string): ProductAlias[] {
  const out = [...base];
  for (const a of extra) {
    const n = normalizeName(a.text);
    if (!n || n === normalizeName(productName)) continue;
    if (out.some((b) => normalizeName(b.text) === n && b.storeId === a.storeId)) continue;
    out.push(a);
  }
  return out.slice(0, 50);
}

const productAddAlias: H<'product.addAlias'> = (ctx, { productId, alias }) => {
  const p = must(ctx, 'product', productId);
  const aliases = mergeAliases(p.aliases, [alias], p.name);
  if (aliases.length === p.aliases.length) return;
  put(ctx, 'product', { ...p, aliases, updatedAt: ctx.now }, ['aliases']);
};

const productRemoveAlias: H<'product.removeAlias'> = (ctx, { productId, text }) => {
  const p = must(ctx, 'product', productId);
  const n = normalizeName(text);
  put(ctx, 'product', { ...p, aliases: p.aliases.filter((a) => normalizeName(a.text) !== n), updatedAt: ctx.now }, ['aliases']);
};

const productCodeAdd: H<'productCode.add'> = (ctx, c) => {
  const p = must(ctx, 'product', c.productId);
  const r = addCode(ctx, p, c);
  if (!r) {
    const existing = ctx.store.list('productCode', { code: c.code })[0];
    const other = existing && ctx.store.get('product', existing.productId);
    throw new DomainError('code_taken', `Ce code-barres est déjà associé à « ${other?.name ?? 'un autre produit'} ».`);
  }
  log(ctx, `a associé le code ${c.code} à « ${p.name} »`, 'product', p.id);
};

const productCodeUpdate: H<'productCode.update'> = (ctx, { id, patch }) => {
  const c = must(ctx, 'productCode', id);
  put(ctx, 'productCode', { ...c, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
};

const productCodeRemove: H<'productCode.remove'> = (ctx, { id }) => {
  const c = must(ctx, 'productCode', id);
  ctx.writes += 1;
  ctx.store.remove('productCode', c.id);
  const p = ctx.store.get('product', c.productId);
  log(ctx, `a dissocié le code ${c.code} de « ${p?.name ?? '?'} »`, 'product', c.productId);
};

function createPurchaseRecord(
  ctx: Ctx,
  p: Product | null,
  quantity: number,
  unit: UnitCode,
  totalCents: number | null,
  storeId: string | null,
  id: string,
  lotId: string | null,
  shoppingItemId: string | null,
  receiptId: string | null,
  extra: Partial<Purchase> = {},
): Purchase {
  const existing = ctx.store.get('purchase', id);
  if (existing) {
    // Lot complété dans la même session de réception : on cumule.
    return put(ctx, 'purchase', {
      ...existing,
      quantity: roundQty(existing.quantity + quantity),
      totalCents: existing.totalCents != null && totalCents != null ? existing.totalCents + totalCents : existing.totalCents ?? totalCents,
    });
  }
  return put(ctx, 'purchase', {
    id,
    householdId: ctx.householdId,
    version: 0,
    productId: p?.id ?? null,
    name: p?.name ?? extra.name ?? '?',
    categoryId: p?.categoryId ?? extra.categoryId ?? null,
    quantity: roundQty(quantity),
    unit,
    totalCents,
    discountCents: extra.discountCents ?? null,
    storeId,
    userId: ctx.userId,
    date: extra.date ?? ctx.today,
    shoppingItemId,
    lotId,
    receiptId,
    note: extra.note ?? null,
    createdAt: ctx.now,
  });
}

const stockAdd: H<'stock.add'> = (ctx, s) => {
  const p = must(ctx, 'product', s.productId);
  const q = stockQty(ctx, p, s.quantity, s.unit);
  const qtySource: QtySource = s.source === 'scan' ? 'scan' : s.source === 'receipt' ? 'receipt' : s.source === 'inventory' ? 'count' : s.source === 'shopping' ? 'shopping' : 'manual';
  const { created, lot } = addStock(
    ctx,
    p,
    q,
    {
      lotId: s.lotId,
      expiryDate: s.expiryDate,
      expirySource: s.expirySource,
      expiryKind: s.expiryKind,
      batchNumber: s.batchNumber,
      purchaseDate: s.purchaseDate,
      locationId: s.locationId,
      qtyApprox: s.qtyApprox,
      qtySource,
      storeId: s.storeId,
      priceCents: s.priceCents,
      note: s.note,
    },
    { type: s.kind, source: s.source, inputQty: s.quantity, inputUnit: s.unit ?? p.unit, note: s.note },
  );
  if (s.kind === 'purchase' && (s.priceCents != null || s.storeId)) {
    createPurchaseRecord(ctx, p, q, p.unit, s.priceCents ?? null, lot.storeId, deriveId(lot.id, 'p'), lot.id, null, null);
  }
  const verb = s.kind === 'purchase' ? 'a réceptionné' : 'a ajouté';
  log(ctx, `${verb} ${qp(q, p.unit, p.name)}${created ? '' : ' (lot complété)'}`, 'product', p.id);
};

const stockConsume: H<'stock.consume'> = (ctx, s) => {
  const p = must(ctx, 'product', s.productId);
  const q = stockQty(ctx, p, s.quantity, s.unit);
  const { taken } = takeFromLots(ctx, p, q, { type: 'consume', source: s.source, lotId: s.lotId, inputQty: s.quantity, inputUnit: s.unit ?? p.unit, note: s.note });
  const after = totalOf(ctx, p.id);
  log(ctx, `a consommé ${qp(taken, p.unit, p.name)}`, 'product', p.id, after === 0 && taken > 0);
};

const stockFinish: H<'stock.finish'> = (ctx, s) => {
  const p = must(ctx, 'product', s.productId);
  const lots = s.lotId ? [must(ctx, 'lot', s.lotId)] : lotsOf(ctx, p.id).filter((l) => l.quantity > 0);
  let total = 0;
  for (const l of lots) {
    if (l.productId !== p.id) throw new DomainError('lot_mismatch', 'Ce lot appartient à un autre produit.');
    if (l.quantity <= 0) continue;
    total += l.quantity;
    changeLot(ctx, p, l, -l.quantity, { type: 'finish', source: s.source, note: s.note });
  }
  if (total === 0) writeMovement(ctx, p, null, 0, totalOf(ctx, p.id), { type: 'finish', source: s.source, note: s.note });
  if (s.addToList) {
    const qty = p.idealQty && p.idealQty > 0 ? p.idealQty : 1;
    const unit = p.idealQty && p.idealQty > 0 ? p.unit : p.packUnit && p.packSize ? p.packUnit : p.unit;
    shoppingAdd(ctx, { itemId: s.itemId ?? deriveId(ctx.opId, 'item'), productId: p.id, name: p.name, quantity: qty, unit, source: 'stock' });
  }
  const remaining = totalOf(ctx, p.id);
  log(ctx, s.lotId && remaining > 0 ? `a terminé un lot de « ${p.name} »` : `a déclaré « ${p.name} » terminé${s.addToList ? ' et l\'a ajouté à la liste' : ''}`, 'product', p.id, remaining === 0);
};

const WASTE_LABELS = { expired: 'périmé', spoiled: 'abîmé', other: 'autre' } as const;

const stockWaste: H<'stock.waste'> = (ctx, s) => {
  const p = must(ctx, 'product', s.productId);
  const info: TakeOpts = { type: 'waste', source: s.source, reason: s.reason, note: s.note, lotId: s.lotId, expiredFirst: s.reason === 'expired' };
  let taken = 0;
  if (s.quantity != null) {
    taken = takeFromLots(ctx, p, stockQty(ctx, p, s.quantity, s.unit), { ...info, inputQty: s.quantity, inputUnit: s.unit ?? p.unit }).taken;
  } else if (s.lotId) {
    const lot = must(ctx, 'lot', s.lotId);
    if (lot.productId !== p.id) throw new DomainError('lot_mismatch', 'Ce lot appartient à un autre produit.');
    taken = lot.quantity;
    if (taken > 0) changeLot(ctx, p, lot, -taken, info);
  } else if (s.reason === 'expired') {
    for (const lot of lotsOf(ctx, p.id).filter((l) => l.quantity > 0 && isLotExpired(l, p, ctx.today, ctx.timezone))) {
      taken += lot.quantity;
      changeLot(ctx, p, lot, -lot.quantity, info);
    }
    if (taken === 0) throw new DomainError('nothing_expired', `Aucun lot périmé pour « ${p.name} ».`);
  } else {
    throw new DomainError('qty_required', 'Précisez la quantité jetée ou le lot concerné.');
  }
  log(ctx, `a jeté ${qp(taken, p.unit, p.name)} (${WASTE_LABELS[s.reason]})`, 'product', p.id);
};

const stockAdjust: H<'stock.adjust'> = (ctx, s) => {
  const p = must(ctx, 'product', s.productId);
  const newQty = s.unit ? stockQty(ctx, p, s.quantity, s.unit) : s.quantity;
  const expected = s.unit ? stockQty(ctx, p, s.expected, s.unit) : s.expected;
  const info: MoveInfo = { type: 'adjust', source: s.source, reason: s.reason, note: s.note, inputQty: s.quantity, inputUnit: s.unit ?? p.unit };
  const counted = s.reason === 'count';
  const lotMeta = (l: Lot): Partial<Lot> => ({
    qtyApprox: !!s.approx,
    qtySource: counted ? 'count' : l.qtySource,
    countedAt: counted ? ctx.occurredAt : l.countedAt,
  });
  if (s.lotId) {
    const lot = must(ctx, 'lot', s.lotId);
    if (lot.productId !== p.id) throw new DomainError('lot_mismatch', 'Ce lot appartient à un autre produit.');
    if (Math.abs(lot.quantity - expected) > QTY_EPS) {
      ctx.conflicts.push({
        entityType: 'lot', entityId: lot.id, field: 'quantity', label: `Quantité de « ${p.name} »`,
        base: expected, mine: newQty, theirs: lot.quantity,
      });
      return;
    }
    changeLot(ctx, p, lot, roundQty(newQty - lot.quantity), info, lotMeta(lot));
  } else {
    const current = totalOf(ctx, p.id);
    if (Math.abs(current - expected) > QTY_EPS) {
      ctx.conflicts.push({
        entityType: 'product', entityId: p.id, field: 'stock', label: `Stock de « ${p.name} »`,
        base: expected, mine: newQty, theirs: current,
      });
      return;
    }
    const delta = roundQty(newQty - current);
    if (delta < 0) {
      takeFromLots(ctx, p, -delta, info);
    } else if (delta > 0) {
      const target = sortFefo(lotsOf(ctx, p.id).filter((l) => !isLotExpired(l, p, ctx.today, ctx.timezone)), p, ctx.today, ctx.timezone).pop();
      if (target) changeLot(ctx, p, target, delta, info, lotMeta(target));
      else addStock(ctx, p, delta, { lotId: deriveId(ctx.opId, 'lot'), qtySource: counted ? 'count' : 'manual', qtyApprox: s.approx }, info);
    } else {
      writeMovement(ctx, p, null, 0, current, info);
    }
    for (const l of lotsOf(ctx, p.id).filter((x) => x.quantity > 0)) put(ctx, 'lot', { ...l, ...lotMeta(l) });
  }
  const label = ADJUST_REASON_LABELS[s.reason].toLowerCase();
  log(ctx, `a corrigé le stock de « ${p.name} » à ${s.approx ? 'environ ' : ''}${formatQty(newQty, p.unit)} (${label})`, 'product', p.id, Math.abs(newQty - expected) > QTY_EPS);
};

const stockOpen: H<'stock.open'> = (ctx, s) => {
  const p = must(ctx, 'product', s.productId);
  let lot: Lot | undefined;
  if (s.lotId) {
    lot = must(ctx, 'lot', s.lotId);
    if (lot.productId !== p.id) throw new DomainError('lot_mismatch', 'Ce lot appartient à un autre produit.');
  } else {
    lot = sortFefo(lotsOf(ctx, p.id).filter((l) => l.quantity > 0 && !l.openedAt), p, ctx.today, ctx.timezone)[0];
    if (!lot) {
      const opened = lotsOf(ctx, p.id).find((l) => l.quantity > 0 && l.openedAt);
      if (opened) {
        warn(ctx, 'already_open', `« ${p.name} » est déjà ouvert.`);
        return;
      }
      throw new DomainError('no_stock', `Aucun « ${p.name} » en stock à ouvrir.`);
    }
  }
  if (lot.openedAt) {
    warn(ctx, 'already_open', `Ce lot de « ${p.name} » est déjà ouvert.`);
    return;
  }
  const discrete = !unitDef(p.unit).continuous;
  if (discrete && lot.quantity > 1 + QTY_EPS) {
    // Ouvrir 1 bouteille sur 6 : on isole l'unité ouverte dans un nouveau lot.
    changeLot(ctx, p, lot, -1, { type: 'open', source: s.source, reason: 'split' });
    addStock(
      ctx,
      p,
      1,
      {
        lotId: deriveId(ctx.opId, 'open'),
        expiryDate: lot.expiryDate,
        expirySource: lot.expirySource,
        expiryKind: lot.expiryKind,
        batchNumber: lot.batchNumber,
        purchaseDate: lot.purchaseDate,
        locationId: lot.locationId,
        qtySource: lot.qtySource,
        storeId: lot.storeId,
        priceCents: lot.unitPriceCents,
      },
      { type: 'open', source: s.source, reason: 'split' },
    );
    const opened = ctx.store.get('lot', deriveId(ctx.opId, 'open'))!;
    put(ctx, 'lot', { ...opened, openedAt: ctx.occurredAt, createdAt: lot.createdAt });
  } else {
    put(ctx, 'lot', { ...lot, openedAt: ctx.occurredAt });
    writeMovement(ctx, p, lot.id, 0, totalOf(ctx, p.id), { type: 'open', source: s.source });
  }
  const eff = p.openShelfLifeDays != null ? addDays(ctx.today, p.openShelfLifeDays) : null;
  log(ctx, `a ouvert « ${p.name} »${eff ? ` (à consommer avant le ${frDate(eff)})` : ''}`, 'product', p.id);
};

const stockMove: H<'stock.move'> = (ctx, s) => {
  const lot = must(ctx, 'lot', s.lotId);
  const p = must(ctx, 'product', lot.productId);
  const loc = must(ctx, 'location', s.locationId);
  const from = lot.locationId ?? p.locationId;
  if (from === loc.id) return;
  if (s.quantity != null && s.quantity < lot.quantity - QTY_EPS) {
    const q = roundQty(s.quantity);
    changeLot(ctx, p, lot, -q, { type: 'move', source: 'manual', reason: `from:${from ?? ''}` });
    const newLotId = deriveId(ctx.opId, 'move');
    addStock(
      ctx,
      p,
      q,
      {
        lotId: newLotId,
        expiryDate: lot.expiryDate,
        expirySource: lot.expirySource,
        expiryKind: lot.expiryKind,
        batchNumber: lot.batchNumber,
        purchaseDate: lot.purchaseDate,
        locationId: loc.id,
        qtySource: lot.qtySource,
        qtyApprox: lot.qtyApprox,
        storeId: lot.storeId,
        priceCents: lot.unitPriceCents != null ? lot.unitPriceCents * q : null,
      },
      { type: 'move', source: 'manual', reason: `from:${from ?? ''}` },
    );
    const nl = ctx.store.get('lot', newLotId)!;
    put(ctx, 'lot', { ...nl, openedAt: lot.openedAt, createdAt: lot.createdAt });
  } else {
    put(ctx, 'lot', { ...lot, locationId: loc.id });
    writeMovement(ctx, p, lot.id, 0, totalOf(ctx, p.id), { type: 'move', source: 'manual', reason: `from:${from ?? ''}` });
  }
  log(ctx, `a rangé ${qp(s.quantity ?? lot.quantity, p.unit, p.name)} dans « ${loc.name} »`, 'product', p.id);
};

const stockReportMissing: H<'stock.reportMissing'> = (ctx, s) => {
  const p = must(ctx, 'product', s.productId);
  const current = totalOf(ctx, p.id);
  writeMovement(ctx, p, null, 0, current, { type: 'missing', source: 'manual' });
  if (current > QTY_EPS) {
    warn(ctx, 'stock_mismatch', `Le stock théorique de « ${p.name} » indiquait encore ${formatQty(current, p.unit)} : pensez à corriger l'inventaire.`);
  }
  const qty = s.quantity ?? (p.idealQty && p.idealQty > 0 ? p.idealQty : 1);
  const unit = s.unit ?? (s.quantity == null && !(p.idealQty && p.idealQty > 0) && p.packUnit && p.packSize ? p.packUnit : p.unit);
  shoppingAdd(ctx, { itemId: s.itemId, productId: p.id, name: p.name, quantity: qty, unit, priority: 'high', source: 'missing' });
  log(ctx, `a signalé « ${p.name} » manquant`, 'product', p.id, true);
};

const lotUpdate: H<'lot.update'> = (ctx, { lotId, patch }) => {
  const lot = must(ctx, 'lot', lotId);
  const p = must(ctx, 'product', lot.productId);
  const next: Lot = { ...lot };
  if (patch.expiryDate !== undefined) {
    next.expiryDate = patch.expiryDate;
    next.expirySource = patch.expiryDate ? (patch.expirySource ?? 'manual') : null;
    next.expiryKind = patch.expiryDate ? (patch.expiryKind ?? lot.expiryKind) : null;
    checkExpiry(ctx, p, patch.expiryDate, patch.purchaseDate ?? lot.purchaseDate, false);
  } else if (patch.expiryKind !== undefined) next.expiryKind = patch.expiryKind;
  if (patch.batchNumber !== undefined) next.batchNumber = patch.batchNumber;
  if (patch.purchaseDate !== undefined) next.purchaseDate = patch.purchaseDate;
  if (patch.note !== undefined) next.note = patch.note;
  put(ctx, 'lot', next);
  const what = patch.expiryDate !== undefined ? `la date de péremption (${patch.expiryDate ?? 'aucune'})` : 'un lot';
  log(ctx, `a modifié ${what} de « ${p.name} »`, 'product', p.id);
};

const movementRevertOp: H<'movement.revertOp'> = (ctx, { targetOpId, reason }) => {
  const movements = ctx.store.list('movement', { opId: targetOpId }).filter((m) => m.type !== 'revert');
  if (!movements.length) throw new DomainError('not_found', 'Aucun mouvement de stock à annuler pour cette action.');
  const pending = movements.filter((m) => !m.revertedBy);
  if (!pending.length) {
    warn(ctx, 'already_reverted', 'Cette action a déjà été annulée.');
    return;
  }
  // Ordre inverse : on défait d'abord le dernier mouvement de l'action.
  const seqOf = (id: string) => Number(/~m(\d+)$/.exec(id)?.[1] ?? 0);
  const ordered = [...pending].sort((a, b) => seqOf(b.id) - seqOf(a.id));
  let product: Product | null = null;
  for (const m of ordered) {
    const p = must(ctx, 'product', m.productId);
    product = p;
    let rev: Movement;
    if (m.lotId && m.delta !== 0) {
      const lot = must(ctx, 'lot', m.lotId);
      if (lot.quantity - m.delta < -QTY_EPS) {
        throw new DomainError(
          'revert_impossible',
          `Impossible d'annuler : une partie de « ${p.name} » a déjà été utilisée depuis. Corrigez plutôt la quantité.`,
        );
      }
      rev = changeLot(ctx, p, lot, -m.delta, { type: 'revert', source: 'manual', reason: reason ?? null, revertOf: m.id });
    } else {
      if (m.lotId && m.type === 'open') {
        const lot = must(ctx, 'lot', m.lotId);
        put(ctx, 'lot', { ...lot, openedAt: null });
      }
      if (m.lotId && m.type === 'move' && m.reason?.startsWith('from:')) {
        const lot = must(ctx, 'lot', m.lotId);
        put(ctx, 'lot', { ...lot, locationId: m.reason.slice(5) || null });
      }
      rev = writeMovement(ctx, p, m.lotId, 0, totalOf(ctx, p.id), { type: 'revert', source: 'manual', reason: reason ?? null, revertOf: m.id });
    }
    put(ctx, 'movement', { ...ctx.store.get('movement', m.id)!, revertedBy: rev.id });
  }
  log(ctx, `a annulé une action sur « ${product?.name ?? '?'} »`, 'product', product?.id ?? null, true);
};

const shoppingAddH: H<'shopping.add'> = (ctx, p) => {
  const item = shoppingAdd(ctx, p);
  const merged = item.id !== p.itemId;
  log(ctx, `a ${merged ? 'complété' : 'ajouté'} ${qp(p.quantity, p.unit, item.name)} ${merged ? 'dans' : 'à'} la liste`, 'shoppingItem', item.id);
};

const shoppingUpdate: H<'shopping.update'> = (ctx, { itemId, patch, baseVersion }) => {
  const item = must(ctx, 'shoppingItem', itemId);
  const { next, touched } = patchWithConflicts(ctx, 'shoppingItem', item, patch, baseVersion, ITEM_LABELS);
  if (!touched.length) return;
  if (touched.includes('categoryId')) checkRef(ctx, 'category', next.categoryId);
  if (touched.includes('storeId')) checkRef(ctx, 'store', next.storeId);
  if (touched.includes('productId') && next.productId) next.name = must(ctx, 'product', next.productId).name;
  if (touched.includes('quantity') && next.status === 'purchased' && next.quantity > next.purchasedQty + QTY_EPS) next.status = 'partial';
  if (touched.includes('quantity') && next.status === 'partial' && next.purchasedQty + QTY_EPS >= next.quantity) next.status = 'purchased';
  put(ctx, 'shoppingItem', { ...next, updatedAt: ctx.now, updatedBy: ctx.userId }, touched);
  if (touched.includes('assignedTo')) {
    log(ctx, next.assignedTo ? `a confié « ${next.name} » à ${memberName(ctx, next.assignedTo)}` : `a retiré l'attribution de « ${next.name} »`, 'shoppingItem', item.id);
  } else {
    log(ctx, `a modifié « ${next.name} » dans la liste (${touched.map((t) => ITEM_LABELS[t] ?? t).join(', ').toLowerCase()})`, 'shoppingItem', item.id);
  }
};

const shoppingSetPurchased: H<'shopping.setPurchased'> = (ctx, { itemId, purchasedQty, priceCents }) => {
  const item = must(ctx, 'shoppingItem', itemId);
  if (item.status === 'done' || item.status === 'removed') {
    warn(ctx, 'item_closed', `« ${item.name} » a déjà été ${item.status === 'done' ? 'réceptionné' : 'retiré de la liste'}.`);
    return;
  }
  if ((item.status === 'purchased' || item.status === 'partial') && purchasedQty > 0 && item.purchasedBy && item.purchasedBy !== ctx.userId) {
    warn(ctx, 'already_purchased', `« ${item.name} » avait déjà été coché par ${memberName(ctx, item.purchasedBy)}.`);
  }
  const q = roundQty(purchasedQty);
  const status = q <= QTY_EPS ? 'pending' : q + QTY_EPS >= item.quantity ? 'purchased' : 'partial';
  put(
    ctx,
    'shoppingItem',
    {
      ...item,
      purchasedQty: q,
      status,
      purchasedBy: q > 0 ? ctx.userId : null,
      purchasedAt: q > 0 ? ctx.occurredAt : null,
      priceCents: priceCents !== undefined ? priceCents : item.priceCents,
      updatedAt: ctx.now,
      updatedBy: ctx.userId,
    },
    ['purchasedQty', 'status'],
  );
  log(ctx, q > 0 ? `a acheté ${qp(q, item.unit, item.name)}${status === 'partial' ? ' (partiel)' : ''}` : `a décoché « ${item.name} »`, 'shoppingItem', item.id);
};

const shoppingRemove: H<'shopping.remove'> = (ctx, { itemId }) => {
  const item = must(ctx, 'shoppingItem', itemId);
  if (item.status === 'removed') return;
  put(ctx, 'shoppingItem', { ...item, status: 'removed', updatedAt: ctx.now, updatedBy: ctx.userId }, ['status']);
  log(ctx, `a retiré « ${item.name} » de la liste`, 'shoppingItem', item.id);
};

const shoppingRestore: H<'shopping.restore'> = (ctx, { itemId }) => {
  const item = must(ctx, 'shoppingItem', itemId);
  if (item.status !== 'removed') return;
  put(ctx, 'shoppingItem', { ...item, status: item.purchasedQty > 0 ? 'partial' : 'pending', updatedAt: ctx.now, updatedBy: ctx.userId }, ['status']);
  log(ctx, `a remis « ${item.name} » dans la liste`, 'shoppingItem', item.id);
};

const shoppingReceive: H<'shopping.receive'> = (ctx, r) => {
  const item = must(ctx, 'shoppingItem', r.itemId);
  if (item.status === 'done' || item.status === 'removed') {
    warn(ctx, 'item_closed', `« ${item.name} » a déjà été ${item.status === 'done' ? 'réceptionné' : 'retiré'}.`);
    return;
  }
  let product: Product | null = null;
  if (r.createProduct) product = createProduct(ctx, r.createProduct);
  else if (r.productId ?? item.productId) product = must(ctx, 'product', (r.productId ?? item.productId)!);
  const storeId = checkRef(ctx, 'store', r.storeId ?? item.storeId);
  if (r.receivedQty <= QTY_EPS) {
    put(ctx, 'shoppingItem', { ...item, status: 'pending', purchasedQty: 0, purchasedBy: null, purchasedAt: null, updatedAt: ctx.now, updatedBy: ctx.userId }, ['status']);
    log(ctx, `a indiqué que « ${item.name} » n'a pas été acheté`, 'shoppingItem', item.id);
    return;
  }
  let lotId: string | null = null;
  if (product && !r.skipStock) {
    const q = stockQty(ctx, product, r.receivedQty, r.unit);
    addStock(
      ctx,
      product,
      q,
      {
        lotId: r.lotId,
        expiryDate: r.expiryDate,
        expirySource: r.expirySource,
        expiryKind: r.expiryKind,
        batchNumber: r.batchNumber,
        purchaseDate: r.date ?? ctx.today,
        locationId: r.locationId,
        qtySource: 'shopping',
        storeId,
        priceCents: r.totalCents,
      },
      { type: 'purchase', source: 'shopping', inputQty: r.receivedQty, inputUnit: r.unit },
    );
    lotId = r.lotId;
  }
  createPurchaseRecord(ctx, product, r.receivedQty, r.unit, r.totalCents ?? null, storeId, r.purchaseId, lotId, item.id, null, {
    name: item.name,
    categoryId: item.categoryId,
    date: r.date ?? ctx.today,
  });
  const receivedInItemUnit = convertItemQty(r.receivedQty, r.unit, item.unit, product);
  const remaining = receivedInItemUnit == null ? 0 : roundQty(item.quantity - receivedInItemUnit);
  if (remaining > QTY_EPS) {
    put(ctx, 'shoppingItem', {
      ...item,
      productId: product?.id ?? item.productId,
      quantity: remaining,
      status: 'pending',
      purchasedQty: 0,
      purchasedBy: null,
      purchasedAt: null,
      updatedAt: ctx.now,
      updatedBy: ctx.userId,
    }, ['quantity', 'status']);
    warn(ctx, 'partial_received', `Il reste ${formatQty(remaining, item.unit)} de « ${item.name} » à acheter : l'article reste dans la liste.`);
  } else {
    put(ctx, 'shoppingItem', { ...item, productId: product?.id ?? item.productId, status: 'done', receivedAt: ctx.occurredAt, updatedAt: ctx.now, updatedBy: ctx.userId }, ['status']);
  }
  log(ctx, `a réceptionné ${qp(r.receivedQty, r.unit, item.name)}${product && !r.skipStock ? ' (stock mis à jour)' : ''}`, 'shoppingItem', item.id);
};

const purchaseCreate: H<'purchase.create'> = (ctx, p) => {
  if (ctx.store.get('purchase', p.id)) throw new DomainError('exists', 'Cet achat existe déjà.');
  const product = p.productId ? must(ctx, 'product', p.productId) : null;
  put(ctx, 'purchase', {
    id: p.id,
    householdId: ctx.householdId,
    version: 0,
    productId: product?.id ?? null,
    name: product?.name ?? p.name,
    categoryId: checkRef(ctx, 'category', p.categoryId ?? product?.categoryId),
    quantity: p.quantity,
    unit: p.unit,
    totalCents: p.totalCents,
    discountCents: p.discountCents ?? null,
    storeId: checkRef(ctx, 'store', p.storeId),
    userId: ctx.userId,
    date: p.date,
    shoppingItemId: null,
    lotId: null,
    receiptId: null,
    note: p.note ?? null,
    createdAt: ctx.now,
  });
  log(ctx, `a enregistré un achat : ${qp(p.quantity, p.unit, product?.name ?? p.name)}`, 'purchase', p.id);
};

const purchaseUpdate: H<'purchase.update'> = (ctx, { id, patch }) => {
  const pu = must(ctx, 'purchase', id);
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<Purchase>;
  if (clean.storeId !== undefined) checkRef(ctx, 'store', clean.storeId);
  if (clean.categoryId !== undefined) checkRef(ctx, 'category', clean.categoryId);
  if (clean.productId) clean.name = must(ctx, 'product', clean.productId).name;
  put(ctx, 'purchase', { ...pu, ...clean });
  log(ctx, `a modifié l'achat « ${clean.name ?? pu.name} »`, 'purchase', id);
};

const purchaseDelete: H<'purchase.delete'> = (ctx, { id }) => {
  const pu = must(ctx, 'purchase', id);
  ctx.writes += 1;
  ctx.store.remove('purchase', pu.id);
  log(ctx, `a supprimé l'achat « ${pu.name} » du ${frDate(pu.date)}`, 'purchase', id, true);
};

const receiptApply: H<'receipt.apply'> = (ctx, r) => {
  if (ctx.store.get('receipt', r.id)) throw new DomainError('exists', 'Ce ticket a déjà été enregistré.');
  const storeId = checkRef(ctx, 'store', r.storeId);
  const lines = [];
  let stocked = 0;
  for (const l of r.lines) {
    let product: Product | null = null;
    if (l.createProduct) product = createProduct(ctx, l.createProduct);
    else if (l.productId) product = must(ctx, 'product', l.productId);
    let lotId: string | null = null;
    if (l.stock) {
      if (!product) throw new DomainError('product_required', `Ligne « ${l.label} » : associez un produit pour l'ajouter au stock.`);
      const q = stockQty(ctx, product, l.quantity, l.unit);
      addStock(
        ctx,
        product,
        q,
        {
          lotId: l.lotId,
          expiryDate: l.expiryDate,
          expirySource: l.expirySource,
          purchaseDate: r.date,
          locationId: l.locationId,
          qtySource: 'receipt',
          storeId,
          priceCents: l.totalCents ?? null,
        },
        { type: 'purchase', source: 'receipt', inputQty: l.quantity, inputUnit: l.unit, note: `Ticket du ${frDate(r.date)}` },
      );
      lotId = l.lotId;
      stocked++;
    }
    createPurchaseRecord(ctx, product, l.quantity, l.unit, l.totalCents ?? null, storeId, l.purchaseId, lotId, null, r.id, {
      name: l.label,
      date: r.date,
      discountCents: l.discountCents ?? null,
    });
    if (product && l.learnAlias && normalizeName(l.label) !== normalizeName(product.name)) {
      const fresh = ctx.store.get('product', product.id)!;
      const aliases = mergeAliases(fresh.aliases, [{ text: l.label, kind: 'receipt', storeId }], fresh.name);
      if (aliases.length !== fresh.aliases.length) put(ctx, 'product', { ...fresh, aliases, updatedAt: ctx.now }, ['aliases']);
    }
    lines.push({
      id: l.id,
      label: l.label,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceCents: l.unitPriceCents ?? null,
      totalCents: l.totalCents ?? null,
      discountCents: l.discountCents ?? null,
      productId: product?.id ?? null,
      purchaseId: l.purchaseId,
      lotId,
      stocked: !!lotId,
    });
  }
  const sum = r.lines.reduce((s, l) => s + (l.totalCents ?? 0), 0);
  if (r.totalCents != null && Math.abs(sum - r.totalCents) > Math.max(2, r.totalCents * 0.01)) {
    const cur = ctx.store.get('household', ctx.householdId)?.currency ?? 'EUR';
    warn(ctx, 'receipt_total_mismatch', `Le total des lignes (${formatMoney(sum, cur)}) diffère du total du ticket (${formatMoney(r.totalCents, cur)}).`);
  }
  put(ctx, 'receipt', {
    id: r.id,
    householdId: ctx.householdId,
    version: 0,
    storeId,
    date: r.date,
    totalCents: r.totalCents ?? null,
    lines,
    createdAt: ctx.now,
    createdBy: ctx.userId,
  });
  log(ctx, `a enregistré un ticket de caisse (${r.lines.length} lignes${stocked ? `, ${stocked} mises en stock` : ''})`, 'receipt', r.id);
};

function mustSession(ctx: Ctx, id: string): InventorySession {
  const s = must(ctx, 'inventorySession', id);
  if (s.status !== 'open') throw new DomainError('session_closed', 'Cet inventaire est déjà terminé.');
  return s;
}

const inventoryStart: H<'inventory.start'> = (ctx, p) => {
  if (ctx.store.get('inventorySession', p.id)) throw new DomainError('exists', 'Cet inventaire existe déjà.');
  for (const l of p.locationIds) checkRef(ctx, 'location', l);
  put(ctx, 'inventorySession', {
    id: p.id,
    householdId: ctx.householdId,
    version: 0,
    kind: p.kind,
    status: 'open',
    title: p.title,
    locations: p.locationIds.map((locationId) => ({ locationId, status: 'todo' as const })),
    lines: [],
    createdAt: ctx.occurredAt,
    createdBy: ctx.userId,
    updatedAt: ctx.now,
    appliedAt: null,
    appliedBy: null,
  });
  log(ctx, `a commencé l'inventaire « ${p.title} »`, 'inventorySession', p.id);
};

const inventoryUpsertLine: H<'inventory.upsertLine'> = (ctx, { sessionId, line }) => {
  const s = mustSession(ctx, sessionId);
  if (line.productId) line.productId = checkRef(ctx, 'product', line.productId);
  if (line.locationId) checkRef(ctx, 'location', line.locationId);
  if (!line.productId && !line.name) throw new DomainError('invalid', 'Une ligne doit désigner un produit.');
  const prev = s.lines.find((l) => l.id === line.id);
  const full = {
    id: line.id,
    productId: line.productId ?? null,
    name: line.name ?? null,
    code: line.code ?? null,
    quantity: roundQty(line.quantity),
    unit: line.unit,
    qtyApprox: !!line.qtyApprox,
    locationId: line.locationId ?? null,
    expiryDate: line.expiryDate ?? null,
    expirySource: line.expiryDate ? (line.expirySource ?? 'manual') : null,
    expiryKind: line.expiryDate ? (line.expiryKind ?? null) : null,
    batchNumber: line.batchNumber ?? null,
    countedBy: prev?.countedBy ?? ctx.userId,
    countedAt: ctx.occurredAt,
  };
  if (!prev && s.lines.length >= 3000) throw new DomainError('too_many', 'Inventaire trop volumineux (3000 lignes maximum).');
  const lines = prev ? s.lines.map((l) => (l.id === line.id ? full : l)) : [...s.lines, full];
  const locations = s.locations.map((l) => (l.locationId === full.locationId && l.status === 'todo' ? { ...l, status: 'in_progress' as const } : l));
  put(ctx, 'inventorySession', { ...s, lines, locations, updatedAt: ctx.now });
};

const inventoryRemoveLine: H<'inventory.removeLine'> = (ctx, { sessionId, lineId }) => {
  const s = mustSession(ctx, sessionId);
  put(ctx, 'inventorySession', { ...s, lines: s.lines.filter((l) => l.id !== lineId), updatedAt: ctx.now });
};

const inventorySetLocation: H<'inventory.setLocation'> = (ctx, { sessionId, locationId, status }) => {
  const s = mustSession(ctx, sessionId);
  checkRef(ctx, 'location', locationId);
  const exists = s.locations.some((l) => l.locationId === locationId);
  const locations = exists ? s.locations.map((l) => (l.locationId === locationId ? { ...l, status } : l)) : [...s.locations, { locationId, status }];
  put(ctx, 'inventorySession', { ...s, locations, updatedAt: ctx.now });
};

const inventoryApply: H<'inventory.apply'> = (ctx, { sessionId, decisions }) => {
  const s = mustSession(ctx, sessionId);
  const unresolved = s.lines.filter((l) => !l.productId);
  if (unresolved.length) {
    throw new DomainError('unresolved_lines', `${unresolved.length} ligne(s) ne sont associées à aucun produit : créez ou associez les produits avant de valider.`);
  }
  const diffs = computeInventoryDiff(s, (id) => ctx.store.get('product', id), (pid) => lotsOf(ctx, pid));
  const scope = sessionScope(s);
  let applied = 0;
  let corrected = 0;
  for (const d of decisions) {
    const diff = diffs.find((x) => x.productId === ctx.store.resolveAlias('product', d.productId));
    if (!diff || !d.apply) continue;
    const p = must(ctx, 'product', diff.productId);
    if (Math.abs(diff.expected - d.expected) > QTY_EPS) {
      ctx.conflicts.push({
        entityType: 'product', entityId: p.id, field: 'stock', label: `Stock de « ${p.name} »`,
        base: d.expected, mine: diff.counted, theirs: diff.expected,
      });
      continue;
    }
    if (diff.unconvertible.length) {
      warn(ctx, 'unit_unconvertible', `« ${p.name} » : ${diff.unconvertible.length} ligne(s) dans une unité non convertible ont été ignorées.`);
    }
    const info: MoveInfo = { type: 'adjust', source: 'inventory', reason: 'count', note: `Inventaire « ${s.title} »` };
    const inScope = () => lotsOf(ctx, p.id).filter((l) => l.quantity > 0 && lotInScope(l, p, scope));
    if (diff.expected <= QTY_EPS && diff.counted > QTY_EPS) {
      // Rien en stock dans ce périmètre : un lot par ligne comptée (dates/emplacements distincts).
      for (const line of diff.lines) {
        const q = toStockUnit(line.quantity, line.unit, p);
        if (q == null || q <= QTY_EPS) continue;
        addStock(
          ctx,
          p,
          q,
          {
            lotId: deriveId(ctx.opId, `inv-${line.id}`),
            expiryDate: line.expiryDate,
            expirySource: line.expirySource,
            expiryKind: line.expiryKind,
            batchNumber: line.batchNumber,
            locationId: line.locationId ?? p.locationId,
            qtySource: 'count',
            qtyApprox: line.qtyApprox,
          },
          { ...info, inputQty: line.quantity, inputUnit: line.unit },
        );
      }
    } else if (diff.delta < -QTY_EPS) {
      let toRemove = -diff.delta;
      for (const lot of sortFefo(inScope(), p, ctx.today, ctx.timezone)) {
        if (toRemove <= QTY_EPS) break;
        const take = Math.min(lot.quantity, toRemove);
        changeLot(ctx, p, lot, -take, info);
        toRemove = roundQty(toRemove - take);
      }
    } else if (diff.delta > QTY_EPS) {
      const dates = [...new Set(diff.lines.map((l) => l.expiryDate).filter(Boolean))] as string[];
      const line = diff.lines.find((l) => l.expiryDate === dates[0]) ?? diff.lines[0];
      addStock(
        ctx,
        p,
        diff.delta,
        {
          lotId: deriveId(ctx.opId, `inv-${p.id}`),
          expiryDate: dates.length === 1 ? dates[0] : null,
          expirySource: dates.length === 1 ? line.expirySource : null,
          expiryKind: dates.length === 1 ? line.expiryKind : null,
          locationId: line.locationId ?? p.locationId,
          qtySource: 'count',
          qtyApprox: diff.approx,
        },
        info,
      );
    } else {
      writeMovement(ctx, p, null, 0, totalOf(ctx, p.id), info);
    }
    for (const lot of inScope()) put(ctx, 'lot', { ...lot, countedAt: ctx.occurredAt, qtySource: 'count', qtyApprox: diff.approx });
    applied++;
    if (Math.abs(diff.delta) > QTY_EPS) corrected++;
  }
  const fresh = ctx.store.get('inventorySession', s.id)!;
  put(ctx, 'inventorySession', { ...fresh, status: 'applied', appliedAt: ctx.now, appliedBy: ctx.userId, updatedAt: ctx.now });
  log(ctx, `a validé l'inventaire « ${s.title} » (${applied} produit(s) vérifié(s), ${corrected} correction(s))`, 'inventorySession', s.id, corrected > 0);
};

const inventoryCancel: H<'inventory.cancel'> = (ctx, { sessionId }) => {
  const s = mustSession(ctx, sessionId);
  put(ctx, 'inventorySession', { ...s, status: 'cancelled', updatedAt: ctx.now });
  log(ctx, `a abandonné l'inventaire « ${s.title} »`, 'inventorySession', s.id);
};

const recipeUpsert: H<'recipe.upsert'> = (ctx, r) => {
  const existing = ctx.store.get('recipe', r.id);
  for (const i of r.ingredients) if (i.productId) i.productId = checkRef(ctx, 'product', i.productId);
  put(ctx, 'recipe', {
    id: r.id,
    householdId: ctx.householdId,
    version: 0,
    name: r.name,
    servings: r.servings,
    ingredients: r.ingredients.map((i) => ({ productId: i.productId ?? null, name: i.name, quantity: i.quantity, unit: i.unit, optional: i.optional })),
    instructions: r.instructions ?? null,
    tags: r.tags,
    archived: existing?.archived ?? false,
    createdAt: existing?.createdAt ?? ctx.occurredAt,
    createdBy: existing?.createdBy ?? ctx.userId,
  });
  log(ctx, `a ${existing ? 'modifié' : 'créé'} la recette « ${r.name} »`, 'recipe', r.id);
};

const recipeCook: H<'recipe.cook'> = (ctx, { recipeId, servings }) => {
  const r = must(ctx, 'recipe', recipeId);
  const factor = servings / r.servings;
  for (const ing of r.ingredients) {
    if (!ing.productId) continue;
    const p = ctx.store.get('product', ctx.store.resolveAlias('product', ing.productId));
    if (!p) continue;
    const q = toStockUnit(ing.quantity * factor, ing.unit, p);
    if (q == null) {
      warn(ctx, 'unit_unconvertible', `« ${ing.name} » : unité non convertible, ingrédient non déduit du stock.`);
      continue;
    }
    takeFromLots(ctx, p, q, { type: 'consume', source: 'recipe', inputQty: ing.quantity * factor, inputUnit: ing.unit, note: `Recette « ${r.name} »` });
  }
  log(ctx, `a cuisiné « ${r.name} » (${servings} part${servings > 1 ? 's' : ''})`, 'recipe', r.id);
};

export const HANDLERS: { [K in OpType]: H<K> } = {
  'household.update': householdUpdate,
  'member.updateSelf': memberUpdateSelf,
  'category.upsert': (ctx, p) => upsertSimple(ctx, 'category', p, { icon: 'package', color: '#7A7F87' }),
  'category.archive': (ctx, p) => archiveSimple(ctx, 'category', p.id, p.archived),
  'location.upsert': (ctx, p) => upsertSimple(ctx, 'location', p, { icon: 'box', kind: 'other' }),
  'location.archive': (ctx, p) => archiveSimple(ctx, 'location', p.id, p.archived),
  'store.upsert': (ctx, p) => upsertSimple(ctx, 'store', p, { color: '#1F7A64', address: null, notes: null, categoryOrder: [] }),
  'store.archive': (ctx, p) => archiveSimple(ctx, 'store', p.id, p.archived),
  'product.create': productCreate,
  'product.update': productUpdate,
  'product.archive': productArchive,
  'product.merge': productMerge,
  'product.addAlias': productAddAlias,
  'product.removeAlias': productRemoveAlias,
  'productCode.add': productCodeAdd,
  'productCode.update': productCodeUpdate,
  'productCode.remove': productCodeRemove,
  'stock.add': stockAdd,
  'stock.consume': stockConsume,
  'stock.finish': stockFinish,
  'stock.waste': stockWaste,
  'stock.adjust': stockAdjust,
  'stock.open': stockOpen,
  'stock.move': stockMove,
  'stock.reportMissing': stockReportMissing,
  'lot.update': lotUpdate,
  'movement.revertOp': movementRevertOp,
  'shopping.add': shoppingAddH,
  'shopping.update': shoppingUpdate,
  'shopping.setPurchased': shoppingSetPurchased,
  'shopping.remove': shoppingRemove,
  'shopping.restore': shoppingRestore,
  'shopping.receive': shoppingReceive,
  'purchase.create': purchaseCreate,
  'purchase.update': purchaseUpdate,
  'purchase.delete': purchaseDelete,
  'receipt.apply': receiptApply,
  'inventory.start': inventoryStart,
  'inventory.upsertLine': inventoryUpsertLine,
  'inventory.removeLine': inventoryRemoveLine,
  'inventory.setLocation': inventorySetLocation,
  'inventory.apply': inventoryApply,
  'inventory.cancel': inventoryCancel,
  'recipe.upsert': recipeUpsert,
  'recipe.archive': (ctx, p) => archiveSimple(ctx, 'recipe', p.id, p.archived),
  'recipe.cook': recipeCook,
};

export function buildActivity(ctx: Ctx, entry: LogEntry, index: number): Activity {
  return {
    id: deriveId(ctx.opId, `act${index}`),
    householdId: ctx.householdId,
    version: 0,
    userId: ctx.userId,
    type: entry.type,
    summary: entry.summary,
    entityType: entry.entityType,
    entityId: entry.entityId,
    at: ctx.occurredAt,
    opId: ctx.opId,
    important: entry.important,
  };
}

export { effectiveExpiry };
