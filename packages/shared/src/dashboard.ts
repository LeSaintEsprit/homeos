/** Tableau de bord personnalisable (par membre et par foyer) et compteur de notifications. */
import type { DashboardPrefs } from './types';
import type { Alert } from './engine/notifications';

export type WidgetId = 'prevoir' | 'indicateurs' | 'liste' | 'peremption' | 'depenses' | 'mouvements';

export const DASHBOARD_WIDGETS: { id: WidgetId; label: string; description: string }[] = [
  { id: 'prevoir', label: 'Ce que votre maison doit prévoir', description: 'Achats à prévoir et produits à consommer en priorité' },
  { id: 'indicateurs', label: 'Indicateurs', description: 'Produits suivis, stocks faibles, épuisés, à acheter, bientôt périmés' },
  { id: 'liste', label: 'Liste de courses', description: 'Articles à acheter et coût estimé' },
  { id: 'peremption', label: 'À consommer en priorité', description: 'Lots dont la date approche' },
  { id: 'depenses', label: 'Dépenses du mois', description: 'Dépensé, budget, projection' },
  { id: 'mouvements', label: 'Derniers mouvements', description: 'Activité récente du foyer' },
];

const IDS = new Set<string>(DASHBOARD_WIDGETS.map((w) => w.id));

/**
 * Ordre effectif des widgets : ordre enregistré (identifiants inconnus ignorés),
 * puis les widgets apparus depuis, à leur place par défaut. Les masqués sont exclus de `visible`.
 */
export function resolveDashboard(prefs: DashboardPrefs | undefined): { order: WidgetId[]; visible: WidgetId[]; hidden: WidgetId[] } {
  const saved = (prefs?.order ?? []).filter((id, i, a): id is WidgetId => IDS.has(id) && a.indexOf(id) === i);
  const order = [...saved];
  for (const w of DASHBOARD_WIDGETS) if (!order.includes(w.id)) order.push(w.id);
  const hidden = (prefs?.hidden ?? []).filter((id): id is WidgetId => IDS.has(id));
  return { order, visible: order.filter((id) => !hidden.includes(id)), hidden };
}

/** Déplace un widget d'un cran ; renvoie les préférences complètes à enregistrer. */
export function moveWidget(prefs: DashboardPrefs | undefined, id: WidgetId, delta: -1 | 1): DashboardPrefs {
  const { order, hidden } = resolveDashboard(prefs);
  const i = order.indexOf(id);
  const j = i + delta;
  if (i >= 0 && j >= 0 && j < order.length) [order[i], order[j]] = [order[j], order[i]];
  return { order, hidden };
}

export function toggleWidget(prefs: DashboardPrefs | undefined, id: WidgetId, visible: boolean): DashboardPrefs {
  const { order, hidden } = resolveDashboard(prefs);
  return { order, hidden: visible ? hidden.filter((h) => h !== id) : [...new Set([...hidden, id])] };
}

/**
 * Pastille de la cloche : alertes importantes en cours (critiques et avertissements)
 * et modifications des autres membres non encore consultées.
 */
export function alertBadgeCount(alerts: Alert[], readAt: string | undefined): number {
  return alerts.filter((a) => (a.kind === 'important_change' ? !readAt || a.at > readAt : a.severity !== 'info')).length;
}
