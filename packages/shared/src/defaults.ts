import type { HouseholdSettings, LocationKind } from './types';

export const DEFAULT_SETTINGS: HouseholdSettings = {
  shoppingIntervalDays: 7,
  safetyDays: 2,
  expirySoonDays: 7,
  expiryUrgentDays: 2,
  forgottenDays: 90,
  forgottenFreshDays: 10,
  monthlyBudgetCents: null,
  timezone: 'Europe/Paris',
};

export interface DefaultCategory {
  key: string;
  name: string;
  icon: string;
  color: string;
}

/** Catégories initiales (elles servent aussi de rayons en mode courses). */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { key: 'frais', name: 'Produits frais', icon: 'milk', color: '#3B82C4' },
  { key: 'alimentation', name: 'Alimentation', icon: 'apple', color: '#3E9B5F' },
  { key: 'epicerie', name: 'Épicerie', icon: 'wheat', color: '#C08A2E' },
  { key: 'boissons', name: 'Boissons', icon: 'cup-soda', color: '#D0623A' },
  { key: 'surgeles', name: 'Produits surgelés', icon: 'snowflake', color: '#4AA8C9' },
  { key: 'hygiene', name: 'Hygiène', icon: 'droplets', color: '#9A6BC2' },
  { key: 'entretien', name: 'Entretien', icon: 'spray-can', color: '#2E8C8C' },
  { key: 'consommables', name: 'Consommables', icon: 'package', color: '#7A7F87' },
  { key: 'autres', name: 'Autres produits domestiques', icon: 'house', color: '#A0785A' },
];

export interface DefaultLocation {
  key: string;
  name: string;
  icon: string;
  kind: LocationKind;
}

export const DEFAULT_LOCATIONS: DefaultLocation[] = [
  { key: 'cuisine', name: 'Cuisine', icon: 'cooking-pot', kind: 'pantry' },
  { key: 'frigo', name: 'Réfrigérateur', icon: 'refrigerator', kind: 'fridge' },
  { key: 'congel', name: 'Congélateur', icon: 'snowflake', kind: 'freezer' },
  { key: 'placard', name: 'Placards', icon: 'archive', kind: 'pantry' },
  { key: 'cellier', name: 'Cellier', icon: 'warehouse', kind: 'pantry' },
  { key: 'garage', name: 'Garage', icon: 'car', kind: 'other' },
  { key: 'buanderie', name: 'Buanderie', icon: 'washing-machine', kind: 'other' },
  { key: 'sdb', name: 'Salle de bain', icon: 'bath', kind: 'other' },
  { key: 'autres', name: 'Autres', icon: 'box', kind: 'other' },
];

export const MEMBER_COLORS = [
  '#1F7A64', '#C2562E', '#3B6FC4', '#9A4FB5', '#C4932B', '#2E8C9A', '#B5426B', '#5E7A2E',
];

export const STORE_COLORS = ['#1F7A64', '#C2562E', '#3B6FC4', '#9A4FB5', '#C4932B', '#2E8C9A'];

export const CATEGORY_ICONS = [
  'milk', 'apple', 'wheat', 'cup-soda', 'snowflake', 'droplets', 'spray-can', 'package', 'house',
  'beef', 'fish', 'carrot', 'croissant', 'egg', 'cookie', 'candy', 'baby', 'dog', 'cat', 'wine',
  'coffee', 'pill', 'shirt', 'battery', 'lightbulb', 'leaf', 'sandwich', 'pizza', 'soup', 'ice-cream-cone',
];

export const LOCATION_ICONS = [
  'refrigerator', 'snowflake', 'archive', 'warehouse', 'car', 'washing-machine', 'bath', 'box',
  'cooking-pot', 'lamp', 'bed', 'door-closed', 'shelving-unit', 'package', 'house',
];

import type { NotificationPrefs } from './types';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  muted: [],
  digest: 'daily',
  digestHour: 8,
  pushImportant: true,
};
