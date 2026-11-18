import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, CheckCircle2, ChevronRight, ClipboardList, PackagePlus, Plus, ScanLine, SkipForward, Trash2, Undo2 } from 'lucide-react';
import {
  compatibleUnits, computeInventoryDiff, formatQty, lotLocation, movedSinceCount, newId, normalizeName, sessionProgress, similarity,
  type InventoryLine, type InventorySession, type Location, type Lot, type Movement, type Product, type UnitCode,
} from '@homeos/shared';
import { useCatalog, useMembers, parseQty } from '../../../lib/hooks';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { formatShortDate, relativeTime } from '../../../lib/format';
import { toast } from '../../../lib/toast';
import { EmptyState, Segmented, Switch } from '../../../ui/Controls';
import { Field, TextField } from '../../../ui/Field';
import { Sheet } from '../../../ui/Sheet';
import { useConfirm } from '../../../ui/Confirm';
import { NamedIcon } from '../../../ui/icons';
import { QtyInput } from './ActionSheets';
import { UnitSelect } from './ProductForm';
import { PageHead } from '../Shell';

const LOC_STATUS: Record<string, { label: string; tone: string }> = {
  todo: { label: 'À faire', tone: '' },
  in_progress: { label: 'En cours', tone: 'info' },
  done: { label: 'Terminé', tone: 'success' },
  skipped: { label: 'Ignoré', tone: '' },
};

function NewSessionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useRun();
  const navigate = useNavigate();
  const { locations } = useCatalog();
  const [kind, setKind] = useState<'initial' | 'check'>('initial');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const chosen = kind === 'initial' ? locations.map((l) => l.id) : [...picked];
  const start = async () => {
    const id = newId();
    const t = title.trim() || (kind === 'initial' ? 'Inventaire initial' : `Contrôle — ${chosen.map((c) => locations.find((l) => l.id === c)?.name).join(', ')}`.slice(0, 80));
    const out = await run('inventory.start', { id, kind, title: t, locationIds: chosen }, { success: 'Inventaire commencé' });
    if (out.ok) {
      onClose();
      navigate(`/inventaire/inventaires/${id}`);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Nouvel inventaire" footer={<button className="btn primary" onClick={() => void start()} disabled={!chosen.length} data-testid="start-session">Commencer</button>}>
      <div className="stack" style={{ ['--gap' as string]: '10px' }}>
        <button className={`option-card ${kind === 'initial' ? 'selected' : ''}`} onClick={() => setKind('initial')} aria-pressed={kind === 'initial'}>
          <span className="oc-icon"><ClipboardList size={20} /></span>
          <span><span className="strong">Inventaire initial guidé</span><br /><span className="xsmall muted">Espace par espace, pour enregistrer tout ce que vous avez déjà. Vous pouvez faire une pause et reprendre plus tard, sur n'importe quel appareil.</span></span>
        </button>
        <button className={`option-card ${kind === 'check' ? 'selected' : ''}`} onClick={() => setKind('check')} aria-pressed={kind === 'check'}>
          <span className="oc-icon"><CheckCircle2 size={20} /></span>
          <span><span className="strong">Inventaire de contrôle</span><br /><span className="xsmall muted">Recomptez un ou plusieurs espaces : les écarts avec le stock enregistré vous sont présentés avant toute correction.</span></span>
        </button>
      </div>
      {kind === 'check' && (
        <Field label="Espaces à recompter">
          <div className="chips-wrap">
            {locations.map((l) => (
              <button key={l.id} type="button" className="chip" aria-pressed={picked.has(l.id)} onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}>
                <NamedIcon name={l.icon} size={14} /> {l.name}
              </button>
            ))}
          </div>
        </Field>
      )}
      <TextField label="Nom (facultatif)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={kind === 'initial' ? 'Inventaire initial' : 'Contrôle du réfrigérateur'} />
    </Sheet>
  );
}

export function SessionsPage() {
  const view = useView();
  const navigate = useNavigate();
  const canWrite = useCan('inventory.write');
  const [creating, setCreating] = useState(false);
  const sessions = useMemo(() => ([...view.inventorySession.values()] as InventorySession[]).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)), [view.inventorySession]);
  const open = sessions.filter((s) => s.status === 'open');
  const past = sessions.filter((s) => s.status !== 'open').slice(0, 30);
  return (
    <>
      <PageHead
        title="Inventaires"
        eyebrow={<Link to="/inventaire" className="row" style={{ ['--gap' as string]: '4px' }}><ArrowLeft size={14} /> Inventaire</Link>}
        actions={canWrite && <button className="btn primary" onClick={() => setCreating(true)} data-testid="new-session"><Plus size={18} /> Nouvel inventaire</button>}
      />
      {open.length === 0 && past.length === 0 && (
        <EmptyState icon={<ClipboardList size={28} />} title="Aucun inventaire" action={canWrite && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={18} /> Commencer</button>}>
          L'inventaire initial guidé vous aide à enregistrer ce que vous avez déjà, espace par espace. Les inventaires de contrôle corrigent le stock après vérification.
        </EmptyState>
      )}
      {open.length > 0 && (
        <>
          <div className="section-title">En cours</div>
          <div className="card pad-0">
            {open.map((s) => {
              const pct = sessionProgress(s);
              return (
                <button key={s.id} className="list-row" onClick={() => navigate(`/inventaire/inventaires/${s.id}`)} data-testid="session-row">
                  <span className="meta">
                    <span className="title" style={{ display: 'block' }}>{s.title}</span>
                    <span className="sub">{s.lines.length} ligne{s.lines.length > 1 ? 's' : ''} · modifié {relativeTime(s.updatedAt)}</span>
                    <span className="bar" style={{ marginTop: 6 }}><span style={{ width: `${pct}%`, background: 'var(--primary)' }} /></span>
                  </span>
                  <strong className="num small">{pct} %</strong>
                  <ChevronRight size={18} className="subtle" />
                </button>
              );
            })}
          </div>
        </>
      )}
      {past.length > 0 && (
        <>
          <div className="section-title">Historique</div>
          <div className="card pad-0">
            {past.map((s) => (
              <button key={s.id} className="list-row" onClick={() => navigate(`/inventaire/inventaires/${s.id}`)}>
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>{s.title}</span>
                  <span className="sub">{s.status === 'applied' ? `Validé ${relativeTime(s.appliedAt!)}` : 'Abandonné'} · {s.lines.length} ligne(s)</span>
                </span>
                <span className={`badge ${s.status === 'applied' ? 'success' : ''}`}>{s.status === 'applied' ? 'Validé' : 'Abandonné'}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <NewSessionSheet open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

/** Saisie manuelle d'une ligne : produit existant (recherche) ou nouveau produit à créer à la validation. */
function LineSheet({ session, locationId, initial, onClose }: { session: InventorySession; locationId: string; initial: { line?: InventoryLine; product?: Product; qty?: number } | null; onClose: () => void }) {
  const view = useView();
  const run = useRun();
  const [q, setQ] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<UnitCode>('piece');
  const [approx, setApprox] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [loaded, setLoaded] = useState<object | null>(null);
  if (initial && loaded !== initial) {
    setLoaded(initial);
    const p = initial.product ?? (initial.line?.productId ? (view.product.get(initial.line.productId) as Product | undefined) : undefined) ?? null;
    setProduct(p);
    setNewName(initial.line && !initial.line.productId ? initial.line.name : null);
    setQ('');
    setQty(String(initial.line?.quantity ?? initial.qty ?? 1).replace('.', ','));
    setUnit(initial.line?.unit ?? p?.unit ?? 'piece');
    setApprox(initial.line?.qtyApprox ?? false);
    setExpiry(initial.line?.expiryDate ?? '');
  }
  const products = useMemo(() => [...view.product.values()].filter((p) => !p.archived) as Product[], [view.product]);
  const matches = useMemo(() => {
    const n = normalizeName(q);
    if (n.length < 2) return [];
    return products
      .map((p) => ({ p, s: normalizeName(p.name).includes(n) ? 1 : Math.max(similarity(p.name, q), ...p.aliases.map((a) => similarity(a.text, q))) }))
      .filter((x) => x.s >= 0.5)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.p);
  }, [q, products]);
  if (!initial) return null;
  const editing = initial.line;
  const save = async () => {
    const n = parseQty(qty);
    if (n == null || n < 0 || (!product && !newName)) return;
    const out = await run('inventory.upsertLine', {
      sessionId: session.id,
      line: {
        id: editing?.id ?? newId(),
        productId: product?.id ?? null,
        name: product ? null : newName,
        quantity: n,
        unit,
        qtyApprox: approx,
        locationId,
        expiryDate: expiry || null,
        expirySource: expiry ? 'manual' : null,
      },
    });
    if (out.ok) onClose();
  };
  return (
    <Sheet open={!!initial} onClose={onClose} title={editing ? 'Modifier la ligne' : 'Compter un produit'} footer={<button className="btn primary" onClick={() => void save()} disabled={!product && !newName} data-testid="line-save">Enregistrer</button>}>
      {product || newName ? (
        <div className="row spread card flat" style={{ padding: 12 }}>
          <span>
            <strong>{product?.name ?? newName}</strong>
            {!product && <span className="xsmall muted" style={{ display: 'block' }}>Nouveau produit : il sera créé à la validation</span>}
          </span>
          {!editing && <button className="btn ghost sm" onClick={() => { setProduct(null); setNewName(null); }}>Changer</button>}
        </div>
      ) : (
        <>
          <TextField label="Produit" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher ou saisir un nom…" autoFocus data-testid="line-search" />
          {matches.length > 0 && (
            <div className="suggest">
              {matches.map((p) => (
                <button key={p.id} type="button" className="suggest-item" onClick={() => { setProduct(p); setUnit(p.unit); }}>{p.name}</button>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && (
            <button className="btn soft block" onClick={() => setNewName(q.trim())} data-testid="line-new-product"><PackagePlus size={17} /> Nouveau produit « {q.trim()} »</button>
          )}
        </>
      )}
      {(product || newName) && (
        <>
          {product ? (
            <QtyInput value={qty} onChange={setQty} unit={unit} units={compatibleUnits(product)} onUnit={setUnit} label="Quantité comptée" />
          ) : (
            <div className="grid-2 always">
              <Field label="Quantité comptée"><input className="input num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
              <Field label="Unité"><UnitSelect value={unit} onChange={(u) => u && setUnit(u)} /></Field>
            </div>
          )}
          <div className="row spread">
            <span className="small">Quantité approximative (« environ »)</span>
            <Switch label="Approximative" checked={approx} onChange={setApprox} />
          </div>
          <Field label="Date de péremption (facultative)">
            <input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
        </>
      )}
    </Sheet>
  );
}

function LocationPanel({ session, loc }: { session: InventorySession; loc: Location }) {
  const view = useView();
  const run = useRun();
  const navigate = useNavigate();
  const [line, setLine] = useState<{ line?: InventoryLine; product?: Product; qty?: number } | null>(null);
  const lines = session.lines.filter((l) => l.locationId === loc.id);
  const counted = new Set(lines.map((l) => l.productId).filter(Boolean));
  const status = session.locations.find((l) => l.locationId === loc.id)?.status ?? 'todo';
  const closed = session.status !== 'open';
  // Produits enregistrés dans cet espace mais pas encore comptés.
  const expected = useMemo(() => {
    const m = new Map<string, { product: Product; qty: number }>();
    for (const lot of view.lot.values() as Iterable<Lot>) {
      if (lot.quantity <= 0) continue;
      const p = view.product.get(lot.productId) as Product | undefined;
      if (!p || p.archived || lotLocation(lot, p) !== loc.id || counted.has(p.id)) continue;
      const cur = m.get(p.id) ?? { product: p, qty: 0 };
      cur.qty += lot.quantity;
      m.set(p.id, cur);
    }
    return [...m.values()].sort((a, b) => a.product.name.localeCompare(b.product.name, 'fr'));
  }, [view.lot, view.product, loc.id, counted]);
  const setStatus = (st: 'todo' | 'in_progress' | 'done' | 'skipped', msg?: string) => run('inventory.setLocation', { sessionId: session.id, locationId: loc.id, status: st }, msg ? { success: msg } : {});
  const absent = (p: Product) =>
    run('inventory.upsertLine', { sessionId: session.id, line: { id: newId(), productId: p.id, quantity: 0, unit: p.unit, qtyApprox: false, locationId: loc.id } });
  const nameOf = (l: InventoryLine) => (l.productId ? (view.product.get(l.productId) as Product | undefined)?.name : l.name) ?? '?';
  return (
    <div className="stack" data-testid="location-panel">
      {!closed && (
        <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
          <button className="btn primary" onClick={() => navigate(`/scanner?inventaire=${session.id}&emplacement=${loc.id}`)} data-testid="scan-here"><ScanLine size={18} /> Scanner ici</button>
          <button className="btn" onClick={() => setLine({})} data-testid="add-line"><Plus size={18} /> Compter à la main</button>
        </div>
      )}
      <div>
        <div className="section-title" style={{ marginTop: 4 }}>Compté dans « {loc.name} » · {lines.length}</div>
        {lines.length === 0 ? (
          <div className="card small muted">Rien n'est encore compté dans cet espace.</div>
        ) : (
          <div className="card pad-0" data-testid="counted-lines">
            {lines.map((l) => (
              <div key={l.id} className="list-row" data-testid="counted-line">
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>{nameOf(l)}{!l.productId && <span className="badge warning" style={{ marginLeft: 6 }}>nouveau</span>}</span>
                  <span className="sub">
                    <span className="num">{l.qtyApprox ? '≈ ' : ''}{l.quantity === 0 ? 'absent (0)' : formatQty(l.quantity, l.unit)}</span>
                    {l.expiryDate && ` · ${formatShortDate(l.expiryDate)}`}
                    {l.code && ' · scanné'}
                  </span>
                </span>
                {!closed && (
                  <>
                    <button className="btn ghost sm" onClick={() => setLine({ line: l })}>Modifier</button>
                    <button className="btn ghost icon sm" onClick={() => void run('inventory.removeLine', { sessionId: session.id, lineId: l.id })} aria-label={`Retirer ${nameOf(l)}`}><Trash2 size={16} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {!closed && expected.length > 0 && (
        <div>
          <div className="section-title">Enregistrés ici mais pas encore comptés · {expected.length}</div>
          <div className="xsmall muted" style={{ margin: '-4px 4px 8px' }}>Comptez-les, ou indiquez qu'ils sont absents. Ceux que vous laissez de côté ne seront pas modifiés.</div>
          <div className="card pad-0" data-testid="expected-lines">
            {expected.map(({ product, qty }) => (
              <div key={product.id} className="list-row" data-testid="expected-line">
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>{product.name}</span>
                  <span className="sub">enregistré : <span className="num">{formatQty(qty, product.unit)}</span></span>
                </span>
                <button className="btn sm" onClick={() => setLine({ product, qty })}>Compter</button>
                <button className="btn ghost sm" onClick={() => void absent(product)} aria-label={`${product.name} absent`}>Absent</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {!closed && (
        <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
          {status !== 'done' ? (
            <button className="btn soft" onClick={() => void setStatus('done', `« ${loc.name} » terminé`)} data-testid="location-done"><Check size={17} /> Espace terminé</button>
          ) : (
            <button className="btn ghost" onClick={() => void setStatus('in_progress')}><Undo2 size={17} /> Rouvrir cet espace</button>
          )}
          {status !== 'skipped' && status !== 'done' && <button className="btn ghost" onClick={() => void setStatus('skipped', `« ${loc.name} » ignoré`)}><SkipForward size={17} /> Ignorer cet espace</button>}
        </div>
      )}
      <LineSheet session={session} locationId={loc.id} initial={line} onClose={() => setLine(null)} />
    </div>
  );
}

function ReviewTab({ session }: { session: InventorySession }) {
  const view = useView();
  const run = useRun();
  const navigate = useNavigate();
  const { location } = useCatalog();
  const { ask, node } = useConfirm();
  const members = useMembers();
  // Choix explicites de l'utilisateur ; par défaut : corriger, sauf si le produit a bougé depuis son comptage.
  const [decided, setDecided] = useState<Map<string, boolean>>(new Map());
  const [conflicts, setConflicts] = useState<string[]>([]);
  const unresolved = session.lines.filter((l) => !l.productId);
  const diffs = useMemo(
    () => computeInventoryDiff(session, (id) => view.product.get(id) as Product | undefined, (pid) => ([...view.lot.values()] as Lot[]).filter((l) => l.productId === pid)),
    [session, view.product, view.lot],
  );
  const moved = useMemo(() => {
    const all = [...view.movement.values()] as Movement[];
    return new Map(diffs.map((d) => [d.productId, movedSinceCount(session, d, view.product.get(d.productId) as Product | undefined, all, (id) => view.lot.get(id) as Lot | undefined)]));
  }, [diffs, session, view.movement, view.product, view.lot]);
  const isMoved = (pid: string) => (moved.get(pid)?.length ?? 0) > 0;
  const willApply = (pid: string) => decided.get(pid) ?? !isMoved(pid);
  const changed = diffs.filter((d) => Math.abs(d.delta) > 1e-9 || isMoved(d.productId));
  const same = diffs.filter((d) => Math.abs(d.delta) <= 1e-9 && !isMoved(d.productId));
  const closed = session.status !== 'open';
  const createProduct = async (l: InventoryLine) => {
    const id = newId();
    const out = await run('product.create', { id, name: l.name!, unit: l.unit, locationId: l.locationId });
    if (!out.ok) return;
    await run('inventory.upsertLine', { sessionId: session.id, line: { ...l, productId: id, name: null } }, { success: `« ${l.name} » créé` });
  };
  const apply = async () => {
    const n = changed.filter((d) => willApply(d.productId) && Math.abs(d.delta) > 1e-9).length;
    if (!(await ask('Valider l’inventaire ?', `${n} produit${n > 1 ? 's' : ''} ser${n > 1 ? 'ont' : 'a'} corrigé${n > 1 ? 's' : ''} et ${same.length} confirmé${same.length > 1 ? 's' : ''}. Chaque correction est enregistrée dans l’historique et peut être annulée.`, 'Valider'))) return;
    const out = await run('inventory.apply', { sessionId: session.id, decisions: diffs.map((d) => ({ productId: d.productId, expected: d.expected, apply: willApply(d.productId) })) });
    if (!out.ok) return;
    if (out.result.conflicts.length) {
      setConflicts(out.result.conflicts.map((c) => c.label.replace(/^Stock de /, '')));
      toast(`${out.result.conflicts.length} produit(s) ont bougé pendant l'inventaire et n'ont pas été corrigés : recomptez-les.`, 'warning', { ms: 8000 });
    } else toast('Inventaire validé : stock à jour');
  };
  const recount = async () => {
    const id = newId();
    const out = await run('inventory.start', { id, kind: 'check', title: `Recomptage — ${session.title}`.slice(0, 80), locationIds: session.locations.map((l) => l.locationId) });
    if (out.ok) navigate(`/inventaire/inventaires/${id}`);
  };
  return (
    <div className="stack">
      {unresolved.length > 0 && (
        <div>
          <div className="section-title">Nouveaux produits à créer · {unresolved.length}</div>
          <div className="card pad-0" data-testid="unresolved">
            {unresolved.map((l) => (
              <div key={l.id} className="list-row">
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>{l.name}</span>
                  <span className="sub">{formatQty(l.quantity, l.unit)} · {location(l.locationId)?.name ?? '—'}</span>
                </span>
                {!closed && <button className="btn sm" onClick={() => void createProduct(l)} data-testid="create-unresolved"><PackagePlus size={15} /> Créer</button>}
              </div>
            ))}
          </div>
          <div className="xsmall muted" style={{ marginTop: 6 }}>L'inventaire ne peut être validé tant que ces lignes ne sont pas rattachées à un produit.</div>
        </div>
      )}
      <div>
        <div className="section-title">Écarts à corriger · {changed.length}</div>
        {changed.length === 0 ? (
          <div className="card small muted">Aucun écart : le stock enregistré correspond au comptage.</div>
        ) : (
          <div className="card pad-0" data-testid="diffs">
            {changed.map((d) => {
              const p = view.product.get(d.productId) as Product;
              return (
                <label key={d.productId} className="list-row diff-row" data-testid="diff-row">
                  {!closed && <input type="checkbox" checked={willApply(d.productId)} onChange={(e) => setDecided((m) => new Map(m).set(d.productId, e.target.checked))} aria-label={`Corriger ${p.name}`} />}
                  <span className="meta">
                    <span className="title" style={{ display: 'block' }}>{p.name}</span>
                    <span className="sub">
                      enregistré <span className="num">{formatQty(d.expected, p.unit)}</span> → compté <span className="num">{d.approx ? '≈ ' : ''}{formatQty(d.counted, p.unit)}</span>
                      {d.unconvertible.length > 0 && ` · ${d.unconvertible.length} ligne(s) d'unité non convertible ignorée(s)`}
                    </span>
                    {isMoved(d.productId) && (
                      <span className="xsmall" style={{ display: 'block', color: 'var(--warning)', fontWeight: 700 }} data-testid="moved-since">
                        A changé depuis le comptage ({moved.get(d.productId)!.map((m) => `${members.get(m.userId)?.name ?? 'un membre'} : ${m.delta > 0 ? '+' : '−'}${formatQty(Math.abs(m.delta), p.unit)}`).join(', ')}) : recomptez avant de corriger.
                      </span>
                    )}
                  </span>
                  <strong className={`num ${d.delta < 0 ? 'neg' : 'pos'}`}>{Math.abs(d.delta) < 1e-9 ? '=' : `${d.delta > 0 ? '+' : '−'}${formatQty(Math.abs(d.delta), p.unit)}`}</strong>
                </label>
              );
            })}
          </div>
        )}
      </div>
      {same.length > 0 && <div className="small muted">{same.length} produit{same.length > 1 ? 's' : ''} conforme{same.length > 1 ? 's' : ''} : leur stock sera marqué « compté » à la validation.</div>}
      {conflicts.length > 0 && (
        <div className="alert warning" data-testid="session-conflicts">
          <span className="grow">Non corrigés car modifiés pendant l'inventaire : {conflicts.join(', ')}.</span>
          <button className="btn sm" onClick={() => void recount()}>Recompter</button>
        </div>
      )}
      {!closed && (
        <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
          <button className="btn primary" onClick={() => void apply()} disabled={unresolved.length > 0 || diffs.length === 0} data-testid="apply-session"><CheckCircle2 size={18} /> Valider l'inventaire</button>
          <button className="btn ghost" onClick={async () => { if (await ask('Abandonner cet inventaire ?', 'Le comptage sera conservé dans l’historique mais le stock ne sera pas modifié.', 'Abandonner', true)) await run('inventory.cancel', { sessionId: session.id }, { success: 'Inventaire abandonné' }); }}>Abandonner</button>
        </div>
      )}
      {node}
    </div>
  );
}

export function SessionPage() {
  const { id = '' } = useParams();
  const view = useView();
  const [params, setParams] = useSearchParams();
  const { location } = useCatalog();
  const s = view.inventorySession.get(id) as InventorySession | undefined;
  if (!s) return <EmptyState icon={<ClipboardList size={28} />} title="Inventaire introuvable" action={<Link className="btn" to="/inventaire/inventaires">Retour</Link>} />;
  const tab = params.get('vue') === 'ecarts' || s.status !== 'open' ? 'ecarts' : 'espaces';
  const pct = sessionProgress(s);
  const current = params.get('espace');
  const locs = s.locations.map((l) => ({ ...l, loc: location(l.locationId) })).filter((l): l is typeof l & { loc: Location } => !!l.loc);
  const currentLoc = locs.find((l) => l.locationId === current)?.loc;
  return (
    <>
      <PageHead
        title={s.title}
        eyebrow={<Link to="/inventaire/inventaires" className="row" style={{ ['--gap' as string]: '4px' }}><ArrowLeft size={14} /> Inventaires</Link>}
      />
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row spread small">
          <span>{s.status === 'open' ? `${s.kind === 'initial' ? 'Inventaire initial' : 'Contrôle'} · ${s.lines.length} ligne${s.lines.length > 1 ? 's' : ''}` : s.status === 'applied' ? `Validé ${relativeTime(s.appliedAt!)}` : 'Abandonné'}</span>
          <strong className="num" data-testid="session-progress">{pct} %</strong>
        </div>
        <div className="bar big" style={{ marginTop: 8 }}><span style={{ width: `${pct}%` }} /></div>
      </div>
      {s.status === 'open' && (
        <Segmented label="Étape" value={tab} onChange={(t) => setParams(t === 'espaces' ? {} : { vue: t })} options={[{ value: 'espaces', label: 'Espaces' }, { value: 'ecarts', label: 'Écarts et validation' }]} />
      )}
      <div style={{ marginTop: 12 }}>
        {tab === 'ecarts' ? (
          <ReviewTab session={s} />
        ) : currentLoc ? (
          <>
            <button className="btn ghost sm" onClick={() => setParams({})} style={{ marginBottom: 8 }}><ArrowLeft size={16} /> Tous les espaces</button>
            <h2 className="row" style={{ fontSize: 'var(--fs-lg)', marginBottom: 12, ['--gap' as string]: '8px' }}><NamedIcon name={currentLoc.icon} /> {currentLoc.name}</h2>
            <LocationPanel session={s} loc={currentLoc} />
          </>
        ) : (
          <>
            <div className="card pad-0" data-testid="session-locations">
              {locs.map((l) => {
                const n = s.lines.filter((x) => x.locationId === l.locationId).length;
                const st = LOC_STATUS[l.status];
                return (
                  <button key={l.locationId} className="list-row" onClick={() => setParams({ espace: l.locationId })} data-testid="session-location">
                    <span className="thumb" style={{ width: 40, height: 40, ['--tint' as string]: 'var(--primary)' }}><NamedIcon name={l.loc.icon} size={19} /></span>
                    <span className="meta">
                      <span className="title" style={{ display: 'block' }}>{l.loc.name}</span>
                      <span className="sub">{n} ligne{n > 1 ? 's' : ''}</span>
                    </span>
                    <span className={`badge ${st.tone}`}>{st.label}</span>
                    <ChevronRight size={18} className="subtle" />
                  </button>
                );
              })}
            </div>
            <p className="xsmall subtle" style={{ marginTop: 10 }}>Le comptage est enregistré au fur et à mesure et partagé avec le foyer : vous pouvez reprendre sur un autre appareil. Le stock n'est modifié qu'à la validation.</p>
            <button className="btn primary block" style={{ marginTop: 8 }} onClick={() => setParams({ vue: 'ecarts' })} data-testid="go-review">Voir les écarts et valider</button>
          </>
        )}
      </div>
    </>
  );
}
