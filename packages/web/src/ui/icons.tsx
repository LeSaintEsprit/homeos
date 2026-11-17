import {
  Apple, Archive, Baby, Bath, Battery, Bed, Beef, Box, Candy, Car, Carrot, Cat, Coffee, Cookie, CookingPot, Croissant, CupSoda, Dog, DoorClosed,
  Droplets, Egg, Fish, House, IceCreamCone, Lamp, Leaf, Lightbulb, Milk, Package, Pill, Pizza, Refrigerator, Sandwich, ShelvingUnit, Shirt,
  Snowflake, Soup, SprayCan, Warehouse, WashingMachine, Wheat, Wine, type LucideIcon,
} from 'lucide-react';

/** Icônes disponibles pour les catégories et emplacements (sous-ensemble de Lucide). */
export const ICONS: Record<string, LucideIcon> = {
  milk: Milk, apple: Apple, wheat: Wheat, 'cup-soda': CupSoda, snowflake: Snowflake, droplets: Droplets, 'spray-can': SprayCan, package: Package,
  house: House, beef: Beef, fish: Fish, carrot: Carrot, croissant: Croissant, egg: Egg, cookie: Cookie, candy: Candy, baby: Baby, dog: Dog, cat: Cat,
  wine: Wine, coffee: Coffee, pill: Pill, shirt: Shirt, battery: Battery, lightbulb: Lightbulb, leaf: Leaf, sandwich: Sandwich, pizza: Pizza, soup: Soup,
  'ice-cream-cone': IceCreamCone, refrigerator: Refrigerator, archive: Archive, warehouse: Warehouse, car: Car, 'washing-machine': WashingMachine,
  bath: Bath, box: Box, 'cooking-pot': CookingPot, lamp: Lamp, bed: Bed, 'door-closed': DoorClosed, 'shelving-unit': ShelvingUnit,
};

export function NamedIcon({ name, size = 20 }: { name: string | null | undefined; size?: number }) {
  const I = (name && ICONS[name]) || Package;
  return <I size={size} />;
}
