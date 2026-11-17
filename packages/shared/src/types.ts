import type { UnitCode } from './units';

export type Role = 'admin' | 'member' | 'viewer';

export const ROLES: Role[] = ['admin', 'member', 'viewer'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  member: 'Membre',
  viewer: 'Lecture seule',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Gère le foyer, les membres et les autorisations ; accès à toutes les fonctionnalités.',
  member: 'Gère les produits, les stocks, les scans, la liste de courses et les achats ; consulte les statistiques.',
  viewer: 'Consulte les stocks, les listes et les informations du foyer, sans rien modifier.',
};

/**
 * Permissions nommées. Chaque opération et chaque route sensible exige une permission ;
 * chaque rôle accorde un ensemble de permissions. Des permissions plus fines (par
 * membre) pourront être ajoutées sans modifier les opérations.
 */
export type Permission =
  | 'data.read'
  | 'self.update'
  | 'catalog.write'
  | 'stock.write'
  | 'shopping.write'
  | 'purchase.write'
  | 'inventory.write'
  | 'recipe.write'
  | 'data.export'
  | 'household.settings'
  | 'members.manage'
  | 'data.import'
  | 'household.delete'
  | 'platform.invite';

export const PERMISSION_LABELS: Record<Permission, string> = {
  'data.read': 'Consulter les données du foyer',
  'self.update': 'Modifier son profil et ses préférences',
  'catalog.write': 'Gérer les produits, catégories, emplacements et magasins',
  'stock.write': 'Modifier les stocks (scans, mouvements)',
  'shopping.write': 'Gérer la liste de courses',
  'purchase.write': 'Enregistrer des achats et des tickets',
  'inventory.write': 'Réaliser des inventaires',
  'recipe.write': 'Gérer les recettes',
  'data.export': 'Exporter les données du foyer',
  'household.settings': 'Modifier les paramètres du foyer',
  'members.manage': 'Inviter, retirer des membres et gérer les rôles',
  'data.import': 'Restaurer ou importer des données',
  'household.delete': 'Supprimer le foyer',
  'platform.invite': "Inviter une autre famille à créer son foyer",
};

const MEMBER_PERMS: Permission[] = [
  'data.read', 'self.update', 'catalog.write', 'stock.write', 'shopping.write', 'purchase.write', 'inventory.write', 'recipe.write', 'data.export',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: ['data.read', 'self.update'],
  member: MEMBER_PERMS,
  admin: [...MEMBER_PERMS, 'household.settings', 'members.manage', 'data.import', 'household.delete', 'platform.invite'],
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2 };

export function isRole(r: unknown): r is Role {
  return r === 'admin' || r === 'member' || r === 'viewer';
}

/** Version par champ : [version, userId] de la dernière modification. */
export type FieldVersions = Record<string, [number, string]>;

export interface BaseEntity {
  id: string;
  householdId: string;
  /** Numéro de séquence global de la dernière écriture (attribué par le serveur). */
  version: number;
}

export interface HouseholdSettings {
  /** Nombre de jours entre deux courses habituelles. */
  shoppingIntervalDays: number;
  /** Marge de sécurité ajoutée à l'horizon de prévision. */
  safetyDays: number;
  /** Alerte « bientôt périmé ». */
  expirySoonDays: number;
  /** Alerte « urgent ». */
  expiryUrgentDays: number;
  /** Produit « oublié » : aucun mouvement depuis N jours. */
  forgottenDays: number;
  /** Idem pour le réfrigérateur. */
  forgottenFreshDays: number;
  /** Budget mensuel des courses (centimes) ou null. */
  monthlyBudgetCents: number | null;
  timezone: string;
}

export interface Household extends BaseEntity {
  name: string;
  /** Avatar : un emoji, ou « photo:<id> » pour une photo du foyer. */
  avatar: string | null;
  currency: string;
  settings: HouseholdSettings;
  createdAt: string;
  createdBy: string;
  fv: FieldVersions;
}

export interface DashboardPrefs {
  order: string[];
  hidden: string[];
}

export type NotificationKind =
  | 'stock_out'
  | 'stock_low'
  | 'expiring'
  | 'to_buy'
  | 'shopping_unfinished'
  | 'important_change'
  | 'unusual_spending'
  | 'inventory_check'
  | 'data_issue';

export interface NotificationPrefs {
  /** Types désactivés pour ce membre. */
  muted: NotificationKind[];
  /** Récapitulatif push. */
  digest: 'off' | 'daily' | 'weekly';
  /** Heure locale d'envoi du récapitulatif (0-23). */
  digestHour: number;
  /** Alertes push immédiates pour les événements importants. */
  pushImportant: boolean;
}

export interface MemberPrefs {
  dashboard?: DashboardPrefs;
  notifReadAt?: string;
  notifications?: NotificationPrefs;
  /** Alertes masquées : clé de déduplication → date (AAAA-MM-JJ). */
  dismissed?: Record<string, string>;
}

export interface Member extends BaseEntity {
  userId: string;
  name: string;
  email: string;
  role: Role;
  color: string;
  active: boolean;
  joinedAt: string;
  prefs: MemberPrefs;
}

export interface Category extends BaseEntity {
  name: string;
  icon: string;
  color: string;
  sort: number;
  archived: boolean;
}

export type LocationKind = 'fridge' | 'freezer' | 'pantry' | 'other';

export interface Location extends BaseEntity {
  name: string;
  icon: string;
  kind: LocationKind;
  sort: number;
  archived: boolean;
}

export interface Store extends BaseEntity {
  name: string;
  address: string | null;
  notes: string | null;
  /** Ordre des rayons (catégories) dans ce magasin. */
  categoryOrder: string[];
  color: string;
  sort: number;
  archived: boolean;
}

export type AliasKind = 'name' | 'receipt';

export interface ProductAlias {
  text: string;
  kind: AliasKind;
  storeId: string | null;
}

export interface Product extends BaseEntity {
  name: string;
  brand: string | null;
  /** Famille de variantes (ex. « Yaourts ») pour regrouper des produits proches. */
  family: string | null;
  /** Noms alternatifs et libellés de tickets de caisse appris. */
  aliases: ProductAlias[];
  categoryId: string | null;
  locationId: string | null;
  unit: UnitCode;
  minQty: number | null;
  idealQty: number | null;
  packUnit: UnitCode | null;
  packSize: number | null;
  photoId: string | null;
  defaultStoreId: string | null;
  notes: string | null;
  /** Suivi pour le réapprovisionnement automatique. */
  trackStock: boolean;
  /** Durée de conservation après ouverture (jours). */
  openShelfLifeDays: number | null;
  /** Durée de conservation habituelle à l'achat (jours), pour proposer une date. */
  defaultShelfLifeDays: number | null;
  /** Consommation estimée saisie par l'utilisateur (unité de stock / jour). */
  manualDailyUse: number | null;
  archived: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  fv: FieldVersions;
}

export type CodeSource = 'off' | 'obf' | 'opf' | 'manual';

/** Code-barres associé à un produit (plusieurs codes possibles par produit). */
export interface ProductCode extends BaseEntity {
  productId: string;
  code: string;
  /** Quantité (unité de stock du produit) représentée par un scan de ce code. */
  packQty: number;
  /** Format d'emballage lisible (« Bouteille 1 L », « Pack de 6 »). */
  label: string | null;
  brand: string | null;
  source: CodeSource;
  createdAt: string;
  createdBy: string;
}

/** Provenance de la quantité d'un lot (niveau de fiabilité). */
export type QtySource = 'count' | 'scan' | 'manual' | 'receipt' | 'shopping' | 'import' | 'computed';
/** Provenance de la date de péremption. */
export type ExpirySource = 'manual' | 'gs1' | 'ocr' | 'estimated';
export type ExpiryKind = 'dlc' | 'ddm';

export interface Lot extends BaseEntity {
  productId: string;
  quantity: number;
  initialQuantity: number;
  expiryDate: string | null;
  expirySource: ExpirySource | null;
  /** DLC (date limite, sécurité) ou DDM (date de durabilité minimale). */
  expiryKind: ExpiryKind | null;
  batchNumber: string | null;
  purchaseDate: string | null;
  openedAt: string | null;
  locationId: string | null;
  /** Prix par unité de stock (centimes, peut être fractionnaire). */
  unitPriceCents: number | null;
  storeId: string | null;
  qtySource: QtySource;
  /** Quantité approximative (« il en reste environ la moitié »). */
  qtyApprox: boolean;
  /** Dernier comptage physique de ce lot. */
  countedAt: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string;
  depletedAt: string | null;
}

export type MovementType =
  | 'add'
  | 'purchase'
  | 'consume'
  | 'finish'
  | 'waste'
  | 'adjust'
  | 'open'
  | 'move'
  | 'missing'
  | 'revert'
  | 'import';

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  add: 'Ajout',
  purchase: 'Achat',
  consume: 'Consommation',
  finish: 'Terminé',
  waste: 'Jeté',
  adjust: 'Correction',
  open: 'Ouverture',
  move: 'Déplacement',
  missing: 'Signalé manquant',
  revert: 'Annulation',
  import: 'Import',
};

export type AdjustReason = 'count' | 'unlogged' | 'error' | 'loss';

export const ADJUST_REASON_LABELS: Record<AdjustReason, string> = {
  count: 'Inventaire physique',
  unlogged: 'Consommation non enregistrée',
  error: 'Erreur de saisie',
  loss: 'Perte / casse',
};

export type MovementSource = 'manual' | 'scan' | 'shopping' | 'receipt' | 'inventory' | 'recipe' | 'import' | 'system';
export type WasteReason = 'expired' | 'spoiled' | 'other';

export const WASTE_REASON_LABELS: Record<WasteReason, string> = { expired: 'Périmé', spoiled: 'Abîmé', other: 'Autre' };

export interface Movement extends BaseEntity {
  productId: string;
  lotId: string | null;
  type: MovementType;
  /** Variation dans l'unité de stock (négative pour une sortie). */
  delta: number;
  /** Stock total du produit avant le mouvement. */
  quantityBefore: number;
  /** Stock total du produit après le mouvement. */
  quantityAfter: number;
  inputQty: number | null;
  inputUnit: UnitCode | null;
  reason: string | null;
  note: string | null;
  source: MovementSource;
  /** Anomalies détectées à l'application (ex. « shortfall » : stock insuffisant). */
  flags: string[];
  /** Mouvement annulé par celui-ci. */
  revertOf: string | null;
  /** Mouvement d'annulation qui a compensé celui-ci. */
  revertedBy: string | null;
  userId: string;
  occurredAt: string;
  recordedAt: string;
  opId: string;
}

export type ShoppingStatus = 'pending' | 'partial' | 'purchased' | 'done' | 'removed';
export type Priority = 'normal' | 'high' | 'urgent';
export type ShoppingSource = 'manual' | 'stock' | 'recommendation' | 'missing' | 'recipe';

export interface ShoppingRequest {
  u: string;
  q: number;
  unit: UnitCode;
  at: string;
  src: ShoppingSource;
}

export interface ShoppingItem extends BaseEntity {
  productId: string | null;
  name: string;
  categoryId: string | null;
  /** Magasin auquel l'article est affecté (répartition multi-magasins). */
  storeId: string | null;
  quantity: number;
  unit: UnitCode;
  priority: Priority;
  comment: string | null;
  assignedTo: string | null;
  status: ShoppingStatus;
  purchasedQty: number;
  purchasedBy: string | null;
  purchasedAt: string | null;
  priceCents: number | null;
  receivedAt: string | null;
  source: ShoppingSource;
  requests: ShoppingRequest[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  fv: FieldVersions;
}

export interface Purchase extends BaseEntity {
  productId: string | null;
  name: string;
  categoryId: string | null;
  quantity: number;
  unit: UnitCode;
  /** Prix total payé en centimes (remise déduite), null si inconnu. */
  totalCents: number | null;
  /** Remise / promotion appliquée (centimes). */
  discountCents: number | null;
  storeId: string | null;
  userId: string;
  date: string;
  shoppingItemId: string | null;
  lotId: string | null;
  receiptId: string | null;
  note: string | null;
  createdAt: string;
}

export interface ReceiptLine {
  id: string;
  label: string;
  quantity: number;
  unit: UnitCode;
  unitPriceCents: number | null;
  totalCents: number | null;
  discountCents: number | null;
  productId: string | null;
  purchaseId: string | null;
  lotId: string | null;
  /** Réception en stock effectuée pour cette ligne. */
  stocked: boolean;
}

export interface Receipt extends BaseEntity {
  storeId: string | null;
  date: string;
  totalCents: number | null;
  lines: ReceiptLine[];
  createdAt: string;
  createdBy: string;
}

export type InventoryKind = 'initial' | 'check';
export type InventoryStatus = 'open' | 'applied' | 'cancelled';

export interface InventoryLocationProgress {
  locationId: string;
  status: 'todo' | 'in_progress' | 'done' | 'skipped';
}

export interface InventoryLine {
  id: string;
  productId: string | null;
  /** Libellé provisoire pour un produit pas encore créé. */
  name: string | null;
  code: string | null;
  quantity: number;
  unit: UnitCode;
  qtyApprox: boolean;
  locationId: string | null;
  expiryDate: string | null;
  expirySource: ExpirySource | null;
  expiryKind: ExpiryKind | null;
  batchNumber: string | null;
  countedBy: string;
  countedAt: string;
}

export interface InventorySession extends BaseEntity {
  kind: InventoryKind;
  status: InventoryStatus;
  title: string;
  locations: InventoryLocationProgress[];
  lines: InventoryLine[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  appliedAt: string | null;
  appliedBy: string | null;
}

export interface Activity extends BaseEntity {
  userId: string;
  type: string;
  summary: string;
  entityType: string | null;
  entityId: string | null;
  at: string;
  opId: string;
  important: boolean;
}

export interface RecipeIngredient {
  productId: string | null;
  name: string;
  quantity: number;
  unit: UnitCode;
  optional: boolean;
}

export interface Recipe extends BaseEntity {
  name: string;
  servings: number;
  ingredients: RecipeIngredient[];
  instructions: string | null;
  tags: string[];
  archived: boolean;
  createdAt: string;
  createdBy: string;
}

export interface EntityMap {
  household: Household;
  member: Member;
  category: Category;
  location: Location;
  store: Store;
  product: Product;
  productCode: ProductCode;
  lot: Lot;
  movement: Movement;
  shoppingItem: ShoppingItem;
  purchase: Purchase;
  receipt: Receipt;
  inventorySession: InventorySession;
  activity: Activity;
  recipe: Recipe;
}

export type EntityType = keyof EntityMap;

export const ENTITY_TYPES: EntityType[] = [
  'household',
  'member',
  'category',
  'location',
  'store',
  'product',
  'productCode',
  'lot',
  'movement',
  'shoppingItem',
  'purchase',
  'receipt',
  'inventorySession',
  'activity',
  'recipe',
];

export type AnyEntity = EntityMap[EntityType];

/** Entités du foyer regroupées par type (réplique locale / export). */
export type EntityCollections = { [K in EntityType]: Map<string, EntityMap[K]> };

export function emptyCollections(): EntityCollections {
  const out = {} as Record<EntityType, Map<string, AnyEntity>>;
  for (const t of ENTITY_TYPES) out[t] = new Map();
  return out as EntityCollections;
}
