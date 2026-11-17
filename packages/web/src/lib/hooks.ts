import { useMemo } from 'react';
import {
  DEFAULT_SETTINGS, analyzeHousehold, dateInTz, type Category, type Household, type HouseholdForecast, type Location, type Member, type Product, type Store,
} from '@homeos/shared';
import { session, activeHousehold } from './session';
import { useObservable } from './store';
import { useView } from './sync/react';

export function useHousehold() {
  const view = useView();
  const s = useObservable(session);
  const ref = activeHousehold(s)!;
  const h = view.household.get(ref.id) as Household | undefined;
  const settings = h?.settings ?? DEFAULT_SETTINGS;
  return { id: ref.id, name: h?.name ?? ref.name, currency: h?.currency ?? ref.currency, settings, tz: settings.timezone, userId: s.me!.user.id };
}

export function useToday(): string {
  const { tz } = useHousehold();
  return dateInTz(new Date(), tz);
}

/** Analyse complète du foyer (moteur partagé), recalculée quand les données changent. */
export function useForecast(): HouseholdForecast {
  const view = useView();
  const { settings } = useHousehold();
  return useMemo(() => {
    const now = new Date().toISOString();
    return analyzeHousehold({
      products: [...view.product.values()],
      lots: [...view.lot.values()],
      movements: [...view.movement.values()],
      items: [...view.shoppingItem.values()],
      purchases: [...view.purchase.values()],
      locations: [...view.location.values()],
      settings,
      now,
      today: dateInTz(now, settings.timezone),
    });
  }, [view.product, view.lot, view.movement, view.shoppingItem, view.purchase, view.location, settings]);
}

export function useCatalog() {
  const view = useView();
  return useMemo(() => {
    const sort = <T extends { sort: number; name: string; archived: boolean }>(m: Map<string, T>) =>
      [...m.values()].filter((x) => !x.archived).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'fr'));
    return {
      categories: sort(view.category as Map<string, Category>),
      locations: sort(view.location as Map<string, Location>),
      stores: sort(view.store as Map<string, Store>),
      category: (id: string | null | undefined) => (id ? (view.category.get(id) as Category | undefined) : undefined),
      location: (id: string | null | undefined) => (id ? (view.location.get(id) as Location | undefined) : undefined),
      store: (id: string | null | undefined) => (id ? (view.store.get(id) as Store | undefined) : undefined),
    };
  }, [view.category, view.location, view.store]);
}

export function useMembers() {
  const view = useView();
  return useMemo(() => new Map([...view.member.values()].map((m) => [m.userId, m as Member])), [view.member]);
}

export function useProducts(): Product[] {
  const view = useView();
  return useMemo(() => [...view.product.values()] as Product[], [view.product]);
}

/** Saisie décimale française (« 0,5 ») → nombre, ou null. */
export function parseQty(s: string): number | null {
  const v = Number(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

export function photoUrl(hid: string, photoId: string | null | undefined): string | null {
  if (!photoId) return null;
  return `/api/households/${hid}/photos/${photoId}`;
}
