import { useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, ArrowLeft, Combine, Info, ShieldCheck, Undo2, ClipboardList } from 'lucide-react';
import { auditHousehold, lotLocation, newId, type AuditIssue, type Lot, type Movement, type Product } from '@homeos/shared';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { relativeTime } from '../../../lib/format';
import { EmptyState } from '../../../ui/Controls';
import { useConfirm } from '../../../ui/Confirm';
import { PageHead } from '../Shell';

const SEV = {
  error: { icon: AlertOctagon, title: 'Erreurs', cls: 'critical' },
  warning: { icon: AlertTriangle, title: 'À vérifier', cls: 'warning' },
  info: { icon: Info, title: 'Suggestions', cls: 'info' },
} as const;

/**
 * Contrôle de cohérence : anomalies détectées dans les données du foyer.
 * Rien n'est corrigé automatiquement ; chaque anomalie propose l'action utile.
 */
export function AuditPage() {
  const view = useView();
  const run = useRun();
  const navigate = useNavigate();
  const canStock = useCan('stock.write');
  const canInventory = useCan('inventory.write');
  const { ask, node } = useConfirm();
  const [stamp] = useState(() => new Date().toISOString());
  const issues = useMemo(() => auditHousehold(view, new Date().toISOString()), [view]);
  const product = (id?: string) => (id ? (view.product.get(id) as Product | undefined) : undefined);
  const undoMovement = async (i: AuditIssue) => {
    const ms = (i.movementIds ?? []).map((id) => view.movement.get(id) as Movement | undefined).filter(Boolean) as Movement[];
    const last = ms.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))[0];
    if (!last) return;
    if (!(await ask('Annuler le second mouvement ?', `Le mouvement du ${new Date(last.occurredAt).toLocaleString('fr-FR')} sera compensé par une annulation. L'historique est conservé.`, 'Annuler ce mouvement'))) return;
    await run('movement.revertOp', { targetOpId: last.opId, reason: 'Double saisie détectée par le contrôle de cohérence' }, { success: 'Mouvement annulé' });
  };
  const recount = async (productId: string) => {
    const p = product(productId);
    if (!p) return;
    const locs = new Set(([...view.lot.values()] as Lot[]).filter((l) => l.productId === productId && l.quantity > 0).map((l) => lotLocation(l, p)).filter(Boolean) as string[]);
    if (p.locationId) locs.add(p.locationId);
    const id = newId();
    const out = await run('inventory.start', { id, kind: 'check', title: `Contrôle — ${p.name}`.slice(0, 80), locationIds: [...locs] });
    if (out.ok) navigate(`/inventaire/inventaires/${id}`);
  };
  const actions = (i: AuditIssue) => {
    const p = product(i.productId);
    const list: ReactElement[] = [];
    if (i.code === 'duplicate_movements' && canStock) list.push(<button key="u" className="btn sm" onClick={() => void undoMovement(i)}><Undo2 size={15} /> Annuler le doublon</button>);
    if ((i.code === 'shortfall' || i.code === 'lot_sum_mismatch' || i.code === 'negative_qty') && p && canInventory) list.push(<button key="r" className="btn sm" onClick={() => void recount(p.id)}><ClipboardList size={15} /> Recompter</button>);
    if (i.code === 'possible_duplicate' && p) list.push(<Link key="m" className="btn sm" to={`/inventaire/${p.id}?fusion=${i.otherProductId}`}><Combine size={15} /> Comparer et fusionner</Link>);
    if (i.code === 'inventory_stale') {
      const s = [...view.inventorySession.values()].find((x) => x.status === 'open' && i.message.includes(`« ${x.title} »`));
      if (s) list.push(<Link key="s" className="btn sm" to={`/inventaire/inventaires/${s.id}`}>Reprendre</Link>);
    }
    if (p && i.code !== 'possible_duplicate') list.push(<Link key="p" className="btn ghost sm" to={`/inventaire/${p.id}`}>Voir le produit</Link>);
    return list;
  };
  return (
    <>
      <PageHead
        title="Contrôle de cohérence"
        eyebrow={<Link to="/inventaire" className="row" style={{ ['--gap' as string]: '4px' }}><ArrowLeft size={14} /> Inventaire</Link>}
      />
      <p className="small muted" style={{ marginTop: -8, marginBottom: 12 }}>
        HOMEOS vérifie en permanence ses propres données (quantités, mouvements, dates, doublons). Rien n'est corrigé sans vous : chaque anomalie propose une action, et toute correction reste annulable. Dernier contrôle {relativeTime(stamp)}.
      </p>
      {issues.length === 0 ? (
        <EmptyState icon={<ShieldCheck size={28} />} title="Aucune anomalie">Les quantités correspondent aux mouvements enregistrés et aucune incohérence n'a été détectée.</EmptyState>
      ) : (
        (['error', 'warning', 'info'] as const).map((sev) => {
          const list = issues.filter((i) => i.severity === sev);
          if (!list.length) return null;
          const S = SEV[sev];
          return (
            <section key={sev} data-testid={`audit-${sev}`}>
              <div className="section-title">{S.title} · {list.length}</div>
              <div className="card pad-0">
                {list.map((i, k) => (
                  <div key={`${i.code}-${k}`} className="alert-row" data-testid="audit-issue" data-code={i.code}>
                    <span className={`sev ${S.cls}`}><S.icon size={18} /></span>
                    <span className="body">
                      <span className="small" style={{ display: 'block' }}>{i.message}</span>
                      <span className="row wrap" style={{ ['--gap' as string]: '6px', marginTop: 8 }}>{actions(i)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
      {node}
    </>
  );
}
