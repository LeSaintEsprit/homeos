import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive, ArrowLeft, Barcode, Box, Check, CircleSlash, Combine, Edit3, MapPin, Minus, PackageOpen, Plus, ScanLine, Tag, Trash2, Undo2, Wrench, ShoppingCart, CalendarClock, Info,
} from 'lucide-react';
import {
  ADJUST_REASON_LABELS, CONFIDENCE_LABELS, MOVEMENT_LABELS, WASTE_REASON_LABELS, type WasteReason, consumptionText, formatQty, newId, normalizeName, similarity,
  type AdjustReason, type Lot, type Movement, type Product, type ProductInsight,
} from '@homeos/shared';
import { useCatalog, useForecast, useMembers } from '../../../lib/hooks';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { formatDate, formatShortDate, relativeTime } from '../../../lib/format';
import { Sheet } from '../../../ui/Sheet';
import { useConfirm } from '../../../ui/Confirm';
import { Avatar } from '../../../ui/Avatar';
import { ProductForm } from './ProductForm';
import { StockActionSheet, type StockAction } from './ActionSheets';
import { ProductThumb, StatusChips } from './InventoryPage';

const EXPIRY_SOURCE: Record<string, string> = { gs1: 'lue dans le code', manual: 'saisie', ocr: 'reconnue et confirmée', estimated: 'estimée' };
const QTY_SOURCE: Record<string, string> = { count: 'comptée', scan: 'scannée', receipt: 'ticket de caisse', shopping: 'réception des courses', manual: 'saisie', import: 'importée', computed: 'calculée' };

function LotCard({ lot, product, ins, onAction, canWrite }: { lot: Lot; product: Product; ins: ProductInsight; onAction: (a: StockAction, l: Lot) => void; canWrite: boolean }) {
  const li = ins.lots.find((x) => x.lot.id === lot.id);
  const { location, store } = useCatalog();
  const loc = location(lot.locationId ?? product.locationId);
  const st = li?.status ?? 'unknown';
  const tone = st === 'expired' || st === 'today' || st === 'urgent' ? 'danger' : st === 'soon' ? 'warning' : st === 'ok' ? 'success' : '';
  return (
    <div className="lot-card" data-testid="lot-card">
      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="strong num" style={{ fontSize: 'var(--fs-lg)' }}>
            {lot.qtyApprox ? '≈ ' : ''}{formatQty(lot.quantity, product.unit)}
            <span className="small subtle" style={{ fontWeight: 600 }}> / {formatQty(lot.initialQuantity, product.unit)}</span>
          </div>
          <div className="xsmall subtle">Quantité {QTY_SOURCE[lot.qtySource] ?? lot.qtySource}{lot.countedAt ? ` · comptée ${relativeTime(lot.countedAt)}` : ''}</div>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '4px', alignItems: 'flex-end' }}>
          {li?.effectiveExpiry ? (
            <span className={`badge ${tone}`}>
              <CalendarClock size={13} /> {st === 'expired' ? 'Périmé' : `${lot.expiryKind === 'ddm' ? 'DDM' : 'DLC'} ${formatShortDate(li.effectiveExpiry)}`}
            </span>
          ) : (
            <span className="badge">Date inconnue</span>
          )}
          {lot.openedAt && <span className="badge info"><PackageOpen size={13} /> Ouvert {relativeTime(lot.openedAt)}</span>}
        </div>
      </div>
      <div className="xsmall muted" style={{ marginTop: 6 }}>
        {loc && <><MapPin size={12} style={{ verticalAlign: '-1px' }} /> {loc.name} · </>}
        {lot.expiryDate && <>date {EXPIRY_SOURCE[lot.expirySource ?? 'manual']} · </>}
        {lot.purchaseDate && <>acheté le {formatShortDate(lot.purchaseDate)}</>}
        {store(lot.storeId) && <> · {store(lot.storeId)!.name}</>}
        {lot.batchNumber && <> · lot {lot.batchNumber}</>}
        {li && li.atRiskQty > 0 && <span style={{ color: 'var(--danger)', fontWeight: 700 }}> · risque de gaspillage ≈ {formatQty(li.atRiskQty, product.unit)}</span>}
      </div>
      {canWrite && (
        <div className="row wrap" style={{ ['--gap' as string]: '6px', marginTop: 10 }}>
          <button className="chip" onClick={() => onAction('consume', lot)}><Minus size={14} /> Consommer</button>
          {!lot.openedAt && <button className="chip" onClick={() => onAction('open', lot)}><PackageOpen size={14} /> Ouvrir</button>}
          <button className="chip" onClick={() => onAction('adjust', lot)}><Wrench size={14} /> Corriger</button>
          <button className="chip" onClick={() => onAction('expiry', lot)}><CalendarClock size={14} /> Date</button>
          <button className="chip" onClick={() => onAction('move', lot)}><MapPin size={14} /> Déplacer</button>
          <button className="chip" onClick={() => onAction('waste', lot)}><Trash2 size={14} /> Jeter</button>
        </div>
      )}
    </div>
  );
}

/** Une action peut produire plusieurs mouvements (FEFO sur plusieurs lots, ouverture d'une unité) : affichés en une ligne. */
function groupByAction(list: Movement[]): Movement[] {
  const groups = new Map<string, Movement[]>();
  for (const m of list) groups.set(m.opId, [...(groups.get(m.opId) ?? []), m]);
  const out: Movement[] = [];
  for (const g of groups.values()) {
    const asc = [...g].sort((a, b) => a.version - b.version);
    const first = asc[0];
    const last = asc[asc.length - 1];
    out.push({
      ...first,
      delta: asc.reduce((s, x) => s + x.delta, 0),
      quantityAfter: last.quantityAfter,
      flags: [...new Set(asc.flatMap((x) => x.flags))],
      revertedBy: asc.every((x) => x.revertedBy || x.delta === 0) && asc.some((x) => x.revertedBy) ? first.revertedBy ?? last.revertedBy : null,
      note: first.note,
      reason: asc.find((x) => x.reason && !x.reason.startsWith('from:') && x.reason !== 'split')?.reason ?? null,
    });
  }
  return out.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : b.version - a.version));
}

function MovementRow({ m, product, onUndo, canWrite }: { m: Movement; product: Product; onUndo: (m: Movement) => void; canWrite: boolean }) {
  const members = useMembers();
  const who = members.get(m.userId);
  const sign = m.delta > 0 ? '+' : m.delta < 0 ? '−' : '';
  const reason = m.type === 'adjust' && m.reason ? ADJUST_REASON_LABELS[m.reason as AdjustReason] : m.type === 'waste' && m.reason ? WASTE_REASON_LABELS[m.reason as WasteReason]?.toLowerCase() : null;
  const undoable = canWrite && !m.revertedBy && m.type !== 'revert' && (m.delta !== 0 || m.type === 'open' || m.type === 'move') && !m.opId.startsWith('server');
  const label = m.type === 'open' ? `Ouverture${product.unit !== 'g' && product.unit !== 'ml' ? ` d'${formatQty(1, product.unit).replace(/^1\s/, 'une ')}` : ''}` : MOVEMENT_LABELS[m.type];
  return (
    <div className={`list-row mv ${m.revertedBy ? 'reverted' : ''}`} data-testid="movement-row">
      <Avatar name={who?.name ?? '?'} color={who?.color} size={30} />
      <span className="meta">
        <span>
          <strong>{label}</strong>
          {m.delta !== 0 && <span className={`num ${m.delta > 0 ? 'pos' : 'neg'}`}> {sign}{formatQty(Math.abs(m.delta), product.unit)}</span>}
          {reason && <span className="subtle"> · {reason}</span>}
          {m.source === 'scan' && <span className="badge" style={{ marginLeft: 6 }}><ScanLine size={11} /> scan</span>}
          {m.flags.includes('shortfall') && <span className="badge warning" style={{ marginLeft: 6 }}>stock insuffisant</span>}
          {m.revertedBy && <span className="badge" style={{ marginLeft: 6 }}>annulé</span>}
        </span>
        <span className="sub" style={{ display: 'block' }}>
          {who?.name ?? 'Ancien membre'} · {relativeTime(m.occurredAt)} · <span className="num">{formatQty(m.quantityBefore, product.unit)} → {formatQty(m.quantityAfter, product.unit)}</span>
          {m.note ? ` · ${m.note}` : ''}
        </span>
      </span>
      {undoable && <button className="btn ghost icon sm" aria-label="Annuler ce mouvement" onClick={() => onUndo(m)}><Undo2 size={17} /></button>}
    </div>
  );
}

function Insights({ ins }: { ins: ProductInsight }) {
  const p = ins.product;
  const c = ins.consumption;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title"><h3>Analyse</h3><span className="badge">{ins.quality.label}</span></div>
      <div className="stack" style={{ ['--gap' as string]: '10px' }}>
        {ins.recommendation && (
          <div className={`alert ${ins.recommendation.urgency === 'now' ? 'warning' : 'info'}`}>
            <ShoppingCart size={18} />
            <span>
              {ins.recommendation.explanation}
              <span className="xsmall" style={{ display: 'block', fontWeight: 500, marginTop: 4 }}>{ins.recommendation.detail} Confiance : {CONFIDENCE_LABELS[ins.recommendation.confidence]}.</span>
            </span>
          </div>
        )}
        {ins.coveredByList && <div className="alert success"><Check size={18} /><span>Déjà prévu dans la liste de courses ({formatQty(ins.onList, p.unit)}).</span></div>}
        <div className="kv"><span>Consommation</span><strong>{c.dailyRate != null ? consumptionText(c, p.unit) : 'Pas encore assez de données'}</strong></div>
        <div className="kv">
          <span>Autonomie</span>
          <strong>{ins.daysLeft != null && c.reliable ? `≈ ${Math.max(0, Math.round(ins.daysLeft))} jour(s)${ins.runOutDate ? ` (vers le ${formatShortDate(ins.runOutDate)})` : ''}` : ins.total === 0 ? 'Épuisé' : 'Inconnue'}</strong>
        </div>
        {ins.cadence && <div className="kv"><span>Achats</span><strong>environ tous les {Math.round(ins.cadence.medianIntervalDays)} jours{ins.cadence.regular ? ' (régulier)' : ''}</strong></div>}
        {p.minQty != null && <div className="kv"><span>Seuil minimal</span><strong>{formatQty(p.minQty, p.unit)}</strong></div>}
        {p.idealQty != null && <div className="kv"><span>Quantité idéale</span><strong>{formatQty(p.idealQty, p.unit)}</strong></div>}
        {ins.quality.reasons.length > 0 && <div className="alert info"><Info size={18} /><span>Stock à vérifier : {ins.quality.reasons.join(' ; ')}.</span></div>}
        {c.dailyRate == null && p.minQty == null && <div className="xsmall subtle">Sans historique ni seuil, HOMEOS ne fait aucune supposition : définissez un seuil minimal pour être alerté.</div>}
      </div>
    </div>
  );
}

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const view = useView();
  const forecast = useForecast();
  const run = useRun();
  const canWrite = useCan('stock.write');
  const canCatalog = useCan('catalog.write');
  const canShop = useCan('shopping.write');
  const { category, location } = useCatalog();
  const { ask, node } = useConfirm();
  const [action, setAction] = useState<{ a: StockAction; lot: Lot | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newAlias, setNewAlias] = useState('');

  const product = view.product.get(id) as Product | undefined;
  const ins = forecast.byId.get(id);
  const lots = useMemo(() => [...view.lot.values()].filter((l) => l.productId === id && l.quantity > 0), [view.lot, id]);
  const movements = useMemo(() => groupByAction([...view.movement.values()].filter((m) => m.productId === id)), [view.movement, id]);
  const codes = useMemo(() => [...view.productCode.values()].filter((c) => c.productId === id), [view.productCode, id]);
  const candidates = useMemo(
    () =>
      product
        ? [...view.product.values()]
            .filter((p) => p.id !== id && !p.archived)
            .map((p) => ({ p, s: Math.max(similarity(p.name, product.name), normalizeName(p.family ?? '-') === normalizeName(product.family ?? '+') ? 0.6 : 0) }))
            .sort((a, b) => b.s - a.s)
            .slice(0, 12)
        : [],
    [view.product, id, product],
  );

  if (!product) {
    return (
      <div className="empty">
        <h3>Produit introuvable</h3>
        <button className="btn" onClick={() => navigate('/inventaire')}>Retour à l'inventaire</button>
      </div>
    );
  }
  const cat = category(product.categoryId);
  const loc = location(product.locationId);
  const undo = async (m: Movement) => {
    if (!(await ask('Annuler cette action ?', `Le mouvement « ${MOVEMENT_LABELS[m.type]} » sera compensé par un mouvement d'annulation. L'historique est conservé.`, 'Annuler l’action'))) return;
    await run('movement.revertOp', { targetOpId: m.opId }, { success: 'Action annulée' });
  };
  const addToList = () => {
    const reco = forecast.recommendations.find((r) => r.productId === product.id);
    const unit = reco?.displayUnit ?? (product.packUnit && product.packSize ? product.packUnit : product.unit);
    return run('shopping.add', { itemId: newId(), productId: product.id, name: product.name, quantity: reco?.displayQty ?? 1, unit, source: 'stock' }, { success: `« ${product.name} » ajouté à la liste` });
  };
  const archive = async () => {
    if (!product.archived && !(await ask('Archiver ce produit ?', 'Il disparaîtra de l’inventaire et des prévisions. Son historique est conservé et vous pourrez le restaurer.', 'Archiver'))) return;
    await run('product.archive', { id: product.id, archived: !product.archived }, { success: product.archived ? 'Produit restauré' : 'Produit archivé' });
  };
  const merge = async (dup: Product) => {
    if (!(await ask(`Fusionner « ${dup.name} » ?`, `Les lots, l'historique, les codes-barres et les achats de « ${dup.name} » seront rattachés à « ${product.name} ». « ${dup.name} » sera archivé et conservé comme nom alternatif. Vérifiez qu'il s'agit bien du même produit.`, 'Fusionner'))) return;
    const out = await run('product.merge', { sourceId: dup.id, targetId: product.id }, { success: 'Produits fusionnés' });
    if (out.ok) setMerging(false);
  };

  return (
    <>
      <button className="btn ghost sm" onClick={() => navigate('/inventaire')} style={{ marginBottom: 8 }}><ArrowLeft size={17} /> Inventaire</button>
      <div className="card hero product-hero">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <ProductThumb photoId={product.photoId} icon={cat?.icon} color={cat?.color} size={72} />
          <div className="grow" style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 'var(--fs-xl)' }} data-testid="product-name">{product.name}</h1>
            <div className="small muted">{[product.brand, cat?.name, loc?.name].filter(Boolean).join(' · ')}</div>
            {product.archived && <span className="badge warning" style={{ marginTop: 6 }}>Archivé</span>}
          </div>
          {canCatalog && <button className="btn ghost icon" onClick={() => setEditing(true)} aria-label="Modifier le produit"><Edit3 size={20} /></button>}
        </div>
        <div className="big-qty">
          <span className="num" data-testid="detail-qty">{ins?.quality.approx ? '≈ ' : ''}{formatQty(ins?.total ?? 0, product.unit)}</span>
          {ins && ins.expiredQty > 0 && <span className="small" style={{ color: 'var(--danger)', fontWeight: 700 }}>dont {formatQty(ins.expiredQty, product.unit)} périmé(s)</span>}
        </div>
        {ins && <div className="chips"><StatusChips ins={ins} max={4} /></div>}
        {ins && !product.archived && (ins.onList > 0 ? (
          <Link to="/courses" className="small strong row" style={{ ['--gap' as string]: '6px', marginTop: 10 }} data-testid="on-list">
            <ShoppingCart size={15} /> Dans la liste de courses : {formatQty(ins.onList, product.unit)}
          </Link>
        ) : canShop && (
          <button className="btn soft sm" style={{ marginTop: 10 }} onClick={() => void addToList()} data-testid="add-to-list"><ShoppingCart size={15} /> Ajouter à la liste</button>
        ))}
        {canWrite && !product.archived && (
          <div className="action-grid">
            <button className="action" onClick={() => setAction({ a: 'consume', lot: null })} disabled={!lots.length}><Minus size={20} /> Consommer</button>
            <button className="action" onClick={() => setAction({ a: 'add', lot: null })}><Plus size={20} /> Ajouter</button>
            <button className="action" onClick={() => setAction({ a: 'open', lot: null })} disabled={!lots.length}><PackageOpen size={20} /> Ouvrir</button>
            <button className="action" onClick={() => setAction({ a: 'finish', lot: null })}><CircleSlash size={20} /> Terminé</button>
            <button className="action" onClick={() => setAction({ a: 'adjust', lot: null })}><Wrench size={20} /> Corriger</button>
            <button className="action" onClick={() => setAction({ a: 'missing', lot: null })}><ShoppingCart size={20} /> Manquant</button>
          </div>
        )}
      </div>

      {ins && <Insights ins={ins} />}

      <div className="section-title">Lots en stock · {lots.length}</div>
      {lots.length === 0 ? (
        <div className="card flat muted small">Aucun lot en stock.</div>
      ) : (
        <div className="stack" style={{ ['--gap' as string]: '10px' }}>
          {(ins?.lots.map((l) => l.lot) ?? lots).map((l) => <LotCard key={l.id} lot={l} product={product} ins={ins!} canWrite={canWrite} onAction={(a, lot) => setAction({ a, lot })} />)}
        </div>
      )}

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-title"><h3 className="row" style={{ ['--gap' as string]: '8px' }}><Barcode size={18} /> Codes-barres</h3></div>
          {codes.length === 0 && <div className="small muted">Aucun code associé.</div>}
          {codes.map((c) => (
            <div key={c.id} className="row spread small" style={{ padding: '6px 0' }}>
              <span><span className="num strong">{c.code}</span>{c.label ? ` · ${c.label}` : ''}{c.brand ? ` · ${c.brand}` : ''}{c.packQty !== 1 ? ` · ${formatQty(c.packQty, product.unit)} par scan` : ''}</span>
              {canCatalog && <button className="btn ghost icon sm" aria-label="Retirer le code" onClick={() => void run('productCode.remove', { id: c.id })}><Trash2 size={15} /></button>}
            </div>
          ))}
          {canCatalog && (
            <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); if (newCode.trim()) void run('productCode.add', { id: newId(), productId: product.id, code: newCode.trim(), packQty: 1, source: 'manual' }, { success: 'Code associé' }).then((o) => o.ok && setNewCode('')); }}>
              <input className="input" inputMode="numeric" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Ajouter un code" aria-label="Nouveau code-barres" />
              <button className="btn" disabled={!newCode.trim()}>Ajouter</button>
            </form>
          )}
        </div>
        <div className="card">
          <div className="card-title"><h3 className="row" style={{ ['--gap' as string]: '8px' }}><Tag size={18} /> Noms alternatifs</h3></div>
          {product.aliases.length === 0 && <div className="small muted">Utile pour la recherche et les tickets de caisse.</div>}
          <div className="row wrap" style={{ ['--gap' as string]: '6px' }}>
            {product.aliases.map((a) => (
              <span key={a.text + a.storeId} className="badge">
                {a.text}{a.kind === 'receipt' ? ' (ticket)' : ''}
                {canCatalog && <button className="x" aria-label={`Retirer ${a.text}`} onClick={() => void run('product.removeAlias', { productId: product.id, text: a.text })}>×</button>}
              </span>
            ))}
          </div>
          {canCatalog && (
            <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); if (newAlias.trim()) void run('product.addAlias', { productId: product.id, alias: { text: newAlias.trim(), kind: 'name', storeId: null } }).then((o) => o.ok && setNewAlias('')); }}>
              <input className="input" value={newAlias} onChange={(e) => setNewAlias(e.target.value)} placeholder="Ex. Lait 1/2 écrémé" aria-label="Nouveau nom alternatif" />
              <button className="btn" disabled={!newAlias.trim()}>Ajouter</button>
            </form>
          )}
        </div>
      </div>

      <div className="section-title">Historique · {movements.length} action{movements.length > 1 ? 's' : ''}</div>
      <div className="card pad-0">
        {movements.length === 0 ? <div className="small muted" style={{ padding: 16 }}>Aucun mouvement.</div> : movements.slice(0, 150).map((m) => <MovementRow key={m.id} m={m} product={product} canWrite={canWrite} onUndo={(x) => void undo(x)} />)}
      </div>
      {product.notes && <div className="card flat small" style={{ marginTop: 16 }}><strong>Commentaires :</strong> {product.notes}</div>}

      {canCatalog && (
        <div className="row wrap" style={{ marginTop: 20 }}>
          <button className="btn" onClick={() => setMerging(true)}><Combine size={17} /> Fusionner un doublon</button>
          <button className="btn" onClick={() => void archive()}><Archive size={17} /> {product.archived ? 'Restaurer' : 'Archiver'}</button>
        </div>
      )}
      <div className="xsmall subtle" style={{ marginTop: 12 }}><Box size={12} style={{ verticalAlign: '-2px' }} /> Créé le {formatDate(product.createdAt)} · unité de stock : {formatQty(1, product.unit).replace(/^1\s?/, '')}</div>

      <StockActionSheet action={action?.a ?? null} lot={action?.lot ?? null} product={product} lots={lots} onClose={() => setAction(null)} />
      <Sheet open={editing} onClose={() => setEditing(false)} title="Modifier le produit">
        {editing && <ProductForm product={product} onDone={() => setEditing(false)} />}
      </Sheet>
      <Sheet open={merging} onClose={() => setMerging(false)} title="Fusionner un doublon">
        <p className="small muted">Choisissez le produit en double à rattacher à « {product.name} ». La fusion n'est jamais automatique : vérifiez qu'il s'agit bien du même article.</p>
        <div className="card pad-0 flat">
          {candidates.map(({ p, s }) => (
            <button key={p.id} className="list-row" onClick={() => void merge(p)}>
              <span className="meta"><span className="title" style={{ display: 'block' }}>{p.name}</span><span className="sub">{p.brand ?? ''} {s >= 0.8 ? '· très proche' : s >= 0.5 ? '· proche' : ''}</span></span>
              <Combine size={18} className="subtle" />
            </button>
          ))}
        </div>
      </Sheet>
      {node}
    </>
  );
}

export function NewProductPage() {
  const navigate = useNavigate();
  return (
    <>
      <button className="btn ghost sm" onClick={() => navigate(-1)} style={{ marginBottom: 8 }}><ArrowLeft size={17} /> Retour</button>
      <h1 style={{ marginBottom: 16 }}>Nouveau produit</h1>
      <div className="card"><ProductForm onDone={(pid) => navigate(`/inventaire/${pid}`, { replace: true })} /></div>
    </>
  );
}

