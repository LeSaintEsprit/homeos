import { CalendarClock, Gauge } from 'lucide-react';
import { formatMoney, type Confidence, type ExpiryStatus, type LotInsight, type PriceEstimate } from '@homeos/shared';
import { formatShortDate } from '../lib/format';

const CONF: Record<Confidence, { label: string; tone: string; title: string }> = {
  high: { label: 'Fiable', tone: 'success', title: 'Confiance élevée : nombreuses données récentes et cohérentes.' },
  medium: { label: 'Assez fiable', tone: 'info', title: 'Confiance moyenne : données suffisantes mais encore limitées.' },
  low: { label: 'Indicatif', tone: 'warning', title: 'Confiance faible : peu de données, à prendre comme une indication.' },
  none: { label: 'Sans données', tone: '', title: 'Aucune donnée exploitable : aucune estimation n’est faite.' },
};

/** Niveau de confiance d'une estimation : jamais une estimation présentée comme exacte. */
export function ConfidenceBadge({ c, prefix = '' }: { c: Confidence; prefix?: string }) {
  const d = CONF[c];
  return (
    <span className={`badge ${d.tone}`} title={d.title} data-testid="confidence">
      <Gauge size={12} /> {prefix}{d.label}
    </span>
  );
}

export const EXPIRY_SOURCE_LABEL: Record<string, string> = { gs1: 'lue dans le code', manual: 'saisie', ocr: 'reconnue et confirmée', estimated: 'estimée' };

export function expiryTone(st: ExpiryStatus): string {
  return st === 'expired' || st === 'today' || st === 'urgent' ? 'danger' : st === 'soon' ? 'warning' : st === 'ok' ? 'success' : '';
}

/** Date effective d'un lot avec son type (DLC/DDM), sa source et sa fiabilité. */
export function ExpiryBadge({ li }: { li: LotInsight }) {
  const lot = li.lot;
  if (!li.effectiveExpiry) return <span className="badge">Date inconnue</span>;
  const opened = !!lot.openedAt && li.effectiveExpiry !== lot.expiryDate;
  const kind = opened ? 'Ouvert' : lot.expiryKind === 'ddm' ? 'DDM' : 'DLC';
  const when = li.status === 'today' ? "aujourd'hui" : formatShortDate(li.effectiveExpiry);
  const estimated = lot.expirySource === 'estimated';
  return (
    <span
      className={`badge ${expiryTone(li.status)}`}
      title={opened ? 'Date calculée : conservation après ouverture' : `Date ${EXPIRY_SOURCE_LABEL[lot.expirySource ?? 'manual'] ?? ''}`}
    >
      <CalendarClock size={12} /> {li.status === 'expired' ? `${kind} dépassée (${formatShortDate(li.effectiveExpiry)})` : `${kind} ${when}`}
      {estimated && ' · estimée'}
    </span>
  );
}

/** Prix d'une estimation : connu, estimé (≈) ou inconnu — jamais inventé. */
export function PriceHint({ price, cents, currency }: { price: PriceEstimate | null; cents: number | null; currency: string }) {
  if (cents == null || !price) return <span className="xsmall subtle" title="Aucun prix enregistré pour ce produit">prix inconnu</span>;
  return (
    <span className="xsmall num" style={{ color: 'var(--text-3)' }} title={`Estimation ${price.basis}`}>
      ≈ {formatMoney(cents, currency)}
    </span>
  );
}
