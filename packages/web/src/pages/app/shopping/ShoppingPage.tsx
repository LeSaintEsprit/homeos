import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, History, PackageCheck, Receipt, Wallet, Plus, RotateCcw, ShoppingBasket, ShoppingCart, Sparkles, Store as StoreIcon, Trash2 } from 'lucide-react';
import {
  checkAddToList, estimateListCost, formatQty, unitLabel, isActiveItem, newId, normalizeName, remainingToBuy, compatibleUnits, formatMoney,
  type Priority, type Product, type Purchase, type ShoppingItem, type UnitCode, type ItemCost,
} from '@homeos/shared';
import { useCatalog, useForecast, useHousehold, useMembers, parseQty } from '../../../lib/hooks';
import { useCan, useEngine, useRun, useView } from '../../../lib/sync/react';
import { relativeTime } from '../../../lib/format';
import { Avatar } from '../../../ui/Avatar';
import { EmptyState, Segmented } from '../../../ui/Controls';
import { Sheet } from '../../../ui/Sheet';
import { Field } from '../../../ui/Field';
import { QtyInput } from '../inventory/ActionSheets';
import { UnitSelect } from '../inventory/ProductForm';
import { PageHead } from '../Shell';
import { ReceptionTab } from './Reception';

const PRIORITY_LABEL: Record<Priority, string> = { normal: 'Normale', high: 'Haute', urgent: 'Urgente' };

export function PriceTag({ cost, currency }: { cost?: ItemCost; currency: string }) {
  if (!cost) return null;
  if (cost.kind === 'unknown') return <span className="xsmall subtle" title="Aucun prix enregistré pour ce produit">prix inconnu</span>;
  return (
    <span className="xsmall num" title={cost.basis ?? undefined} style={{ color: cost.kind === 'known' ? 'var(--text-2)' : 'var(--text-3)' }}>
      {cost.kind === 'estimated' ? '≈ ' : ''}{formatMoney(cost.cents, currency)}
    </span>
  );
}

/** Saisie rapide avec suggestions du catalogue et contrôle anti-doublon. */
function AddBar() {
  const view = useView();
  const run = useRun();
  const forecast = useForecast();
  const { settings } = useHousehold();
  const [text, setText] = useState('');
  const [qty, setQty] = useState('1');
  const [picked, setPicked] = useState<Product | null>(null);
  const [unit, setUnit] = useState<UnitCode>('piece');
  const products = useMemo(() => [...view.product.values()].filter((p) => !p.archived) as Product[], [view.product]);
  const matches = useMemo(() => {
    const n = normalizeName(text);
    if (!n || picked) return [];
    return products.filter((p) => normalizeName(p.name).includes(n) || p.aliases.some((a) => normalizeName(a.text).includes(n))).slice(0, 6);
  }, [text, products, picked]);
  const check = picked ? checkAddToList(forecast.byId.get(picked.id), settings) : null;
  const pick = (p: Product) => {
    setPicked(p);
    setText(p.name);
    setUnit(p.packUnit && p.packSize ? p.packUnit : p.unit);
  };
  const add = async () => {
    const q = parseQty(qty);
    if (!text.trim() || !q || q <= 0) return;
    const exact = picked ?? products.find((p) => normalizeName(p.name) === normalizeName(text));
    const out = await run(
      'shopping.add',
      { itemId: newId(), productId: exact?.id ?? null, name: text.trim(), quantity: q, unit: exact && !picked ? (exact.packUnit && exact.packSize ? exact.packUnit : exact.unit) : unit, source: 'manual' },
      { success: `« ${exact?.name ?? text.trim()} » ajouté à la liste` },
    );
    if (out.ok) {
      setText('');
      setQty('1');
      setPicked(null);
      setUnit('piece');
    }
  };
  return (
    <div className="card add-bar">
      <form onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <div className="row" style={{ ['--gap' as string]: '8px' }}>
          <input className="input grow" value={text} onChange={(e) => { setText(e.target.value); setPicked(null); }} placeholder="Ajouter un article…" aria-label="Article à ajouter" data-testid="add-item" autoComplete="off" />
          <button className="btn primary icon" aria-label="Ajouter" disabled={!text.trim()} data-testid="add-submit"><Plus size={20} /></button>
        </div>
        {text.trim() && (
          <div className="row" style={{ ['--gap' as string]: '8px', marginTop: 8 }}>
            <span className="small muted">Quantité</span>
            <input className="input num" style={{ width: 80, textAlign: 'center' }} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantité" data-testid="add-qty" />
            {picked ? (
              <select className="select grow" value={unit} onChange={(e) => setUnit(e.target.value as UnitCode)} aria-label="Unité">
                {compatibleUnits(picked).map((u) => <option key={u} value={u}>{unitLabel(u, 2)}</option>)}
              </select>
            ) : (
              <div className="grow"><UnitSelect value={unit} onChange={(u) => u && setUnit(u)} /></div>
            )}
          </div>
        )}
      </form>
      {matches.length > 0 && (
        <div className="suggest" role="listbox">
          {matches.map((p) => (
            <button key={p.id} type="button" className="suggest-item" onClick={() => pick(p)} role="option" aria-selected="false">
              {p.name} <span className="subtle small">· en stock : {formatQty(forecast.byId.get(p.id)?.usable ?? 0, p.unit)}</span>
            </button>
          ))}
        </div>
      )}
      {check?.message && <div className={`alert ${check.level === 'warning' ? 'warning' : 'info'}`} style={{ marginTop: 10 }} data-testid="add-check">{check.message}</div>}
    </div>
  );
}

export function ItemSheet({ item, onClose }: { item: ShoppingItem | null; onClose: () => void }) {
  const run = useRun();
  const engine = useEngine();
  const view = useView();
  const members = useMembers();
  const { categories, stores } = useCatalog();
  const product = item?.productId ? (view.product.get(item.productId) as Product | undefined) : undefined;
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState<UnitCode>('piece');
  const [bought, setBought] = useState('');
  const [comment, setComment] = useState('');
  // Formulaire chargé à l'ouverture seulement : une synchronisation en arrière-plan
  // n'efface jamais une saisie en cours. La version vue à l'ouverture sert de référence
  // pour détecter les modifications concurrentes d'autres membres (conflit par champ).
  const [loaded, setLoaded] = useState('');
  const [base, setBase] = useState(0);
  if (!item && loaded) setLoaded('');
  if (item && loaded !== item.id) {
    setLoaded(item.id);
    setBase(engine.confirmedVersion('shoppingItem', item.id));
    setQty(String(item.quantity).replace('.', ','));
    setUnit(item.unit);
    setBought(String(item.purchasedQty || '').replace('.', ','));
    setComment(item.comment ?? '');
  }
  if (!item) return null;
  const patch = (p: Record<string, unknown>, msg?: string) => run('shopping.update', { itemId: item.id, patch: p, baseVersion: base }, msg ? { success: msg } : {});
  const save = async () => {
    const q = parseQty(qty);
    const changes: Record<string, unknown> = {};
    if (q && q > 0 && (q !== item.quantity || unit !== item.unit)) {
      changes.quantity = q;
      changes.unit = unit;
    }
    if ((comment.trim() || null) !== item.comment) changes.comment = comment.trim() || null;
    if (Object.keys(changes).length) await patch(changes, 'Article modifié');
    const b = parseQty(bought) ?? 0;
    if (b !== item.purchasedQty) await run('shopping.setPurchased', { itemId: item.id, purchasedQty: b });
    onClose();
  };
  const requesters = [...new Set(item.requests.map((r) => r.u))].map((u) => members.get(u)?.name ?? 'Ancien membre');
  return (
    <Sheet open={!!item} onClose={onClose} title={item.name} footer={<><button className="btn danger-soft" onClick={() => void run('shopping.remove', { itemId: item.id }, { success: 'Article retiré de la liste' }).then(onClose)}><Trash2 size={16} /> Retirer</button><button className="btn primary" onClick={() => void save()}>Enregistrer</button></>}>
      <div className="small muted">Demandé par {requesters.join(', ')} · {relativeTime(item.createdAt)}</div>
      <QtyInput value={qty} onChange={setQty} unit={unit} units={product ? compatibleUnits(product) : [item.unit]} onUnit={setUnit} label="Quantité à acheter" />
      <Field label="Déjà acheté (achat partiel)" hint="Laissez vide si rien n'a encore été pris.">
        <input className="input num" inputMode="decimal" value={bought} onChange={(e) => setBought(e.target.value)} placeholder="0" />
      </Field>
      <Field label="Priorité">
        <Segmented label="Priorité" value={item.priority} onChange={(v) => void patch({ priority: v })} options={(['normal', 'high', 'urgent'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
      </Field>
      <div className="grid-2">
        <Field label="Magasin">
          <select className="select" value={item.storeId ?? ''} onChange={(e) => void patch({ storeId: e.target.value || null })}>
            <option value="">N'importe lequel</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Rayon">
          <select className="select" value={item.categoryId ?? ''} onChange={(e) => void patch({ categoryId: e.target.value || null })}>
            <option value="">—</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Confié à">
          <select className="select" value={item.assignedTo ?? ''} onChange={(e) => void patch({ assignedTo: e.target.value || null })}>
            <option value="">Personne</option>
            {[...members.values()].filter((m) => m.active && m.role !== 'viewer').map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Commentaire">
        <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ex. marque, taille…" maxLength={500} />
      </Field>
    </Sheet>
  );
}

function ItemRow({ item, cost, onOpen }: { item: ShoppingItem; cost?: ItemCost; onOpen: () => void }) {
  const run = useRun();
  const members = useMembers();
  const { currency } = useHousehold();
  const canWrite = useCan('shopping.write');
  const done = item.status === 'purchased';
  const assignee = item.assignedTo ? members.get(item.assignedTo) : undefined;
  const contributors = new Set(item.requests.map((r) => r.u)).size;
  const toggle = () => void run('shopping.setPurchased', { itemId: item.id, purchasedQty: done ? 0 : item.quantity });
  return (
    <div className={`shop-row ${done ? 'done' : ''}`} data-testid="shop-item">
      <button className="check" role="checkbox" aria-checked={done} aria-label={`${done ? 'Décocher' : 'Cocher'} ${item.name}`} onClick={toggle} disabled={!canWrite}>
        {done && <Check size={18} strokeWidth={3} />}
      </button>
      <button className="meta" onClick={onOpen} disabled={!canWrite}>
        <span className="title">{item.name}</span>
        <span className="sub">
          {item.priority !== 'normal' && <span className={`badge ${item.priority === 'urgent' ? 'danger' : 'warning'}`}>{PRIORITY_LABEL[item.priority]}</span>}
          {item.status === 'partial' && <span className="badge info">{formatQty(item.purchasedQty, item.unit)} pris</span>}
          {contributors > 1 && <span className="badge">{contributors} demandes</span>}
          {item.comment && <span className="subtle">{item.comment}</span>}
        </span>
      </button>
      <span className="right">
        <strong className="num" data-testid="shop-qty">{formatQty(item.quantity, item.unit)}</strong>
        <PriceTag cost={cost} currency={currency} />
      </span>
      {assignee && <span title={`Confié à ${assignee.name}`} data-testid="assignee" aria-label={`Confié à ${assignee.name}`} role="img"><Avatar name={assignee.name} color={assignee.color} size={26} /></span>}
    </div>
  );
}

export function useShoppingGroups(items: ShoppingItem[], by: 'store' | 'category') {
  const { categories, stores, category, store } = useCatalog();
  return useMemo(() => {
    const order = by === 'store' ? stores.map((s) => s.id) : categories.map((c) => c.id);
    const m = new Map<string, ShoppingItem[]>();
    for (const i of items) {
      const k = (by === 'store' ? i.storeId : i.categoryId) ?? '';
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()]
      .sort((a, b) => (order.indexOf(a[0]) + 1 || 999) - (order.indexOf(b[0]) + 1 || 999))
      .map(([k, list]) => ({
        key: k,
        title: (by === 'store' ? store(k)?.name : category(k)?.name) ?? (by === 'store' ? 'Magasin indifférent' : 'Autres articles'),
        list: list.sort((a, b) => (a.status === 'purchased' ? 1 : 0) - (b.status === 'purchased' ? 1 : 0) || a.name.localeCompare(b.name, 'fr')),
      }));
  }, [items, by, categories, stores, category, store]);
}

function ListTab() {
  const view = useView();
  const forecast = useForecast();
  const run = useRun();
  const navigate = useNavigate();
  const canWrite = useCan('shopping.write');
  const { currency } = useHousehold();
  const [by, setBy] = useState<'category' | 'store'>('category');
  const [open, setOpen] = useState<ShoppingItem | null>(null);
  const items = useMemo(() => ([...view.shoppingItem.values()] as ShoppingItem[]).filter(isActiveItem), [view.shoppingItem]);
  const toBuy = items.filter((i) => i.status !== 'purchased');
  const groups = useShoppingGroups(items, by);
  const products = useMemo(() => new Map([...view.product.values()].map((p) => [p.id, p as Product])), [view.product]);
  const cost = useMemo(() => estimateListCost(items, products, [...view.purchase.values()]), [items, products, view.purchase]);
  const costs = useMemo(() => new Map(cost.items.map((c) => [c.itemId, c])), [cost]);
  const recos = forecast.recommendations.slice(0, 8);
  const toReceive = items.filter((i) => i.purchasedQty > 0).length;
  const addReco = (r: (typeof recos)[number], success?: string) => {
    const p = products.get(r.productId)!;
    return run('shopping.add', { itemId: newId(), productId: p.id, name: p.name, quantity: r.displayQty, unit: r.displayUnit, source: 'recommendation', priority: r.urgency === 'now' ? 'high' : 'normal' }, success ? { success } : {});
  };
  const addAllRecos = async () => {
    for (const r of recos) await addReco(r);
  };
  // Remet en mémoire l'article ouvert (sa version a pu changer).
  const current = open ? (view.shoppingItem.get(open.id) as ShoppingItem | undefined) ?? null : null;
  return (
    <>
      {canWrite && <AddBar />}
      {toReceive > 0 && (
        <button className="alert success banner-btn" onClick={() => navigate('/courses?tab=reception')}>
          <PackageCheck size={18} /> <span className="grow">{toReceive} article(s) acheté(s) à ranger dans le stock</span> <strong>Réceptionner</strong>
        </button>
      )}
      {canWrite && recos.length > 0 && (
        <div className="card reco-card">
          <div className="row spread" style={{ marginBottom: 8 }}>
            <span className="strong row" style={{ ['--gap' as string]: '6px' }}><Sparkles size={17} color="var(--accent)" /> À prévoir selon vos stocks</span>
            {recos.length > 1 && <button className="btn sm soft" onClick={() => void addAllRecos()} data-testid="add-all-recos">Tout ajouter</button>}
          </div>
          {recos.map((r) => {
            const p = products.get(r.productId)!;
            return (
              <div key={r.productId} className="reco-line">
                <span className="grow small">{r.explanation}</span>
                <button className="btn sm" onClick={() => void addReco(r, `« ${p.name} » ajouté`)} aria-label={`Ajouter ${p.name}`}><Plus size={15} /></button>
              </div>
            );
          })}
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState icon={<ShoppingCart size={28} />} title="La liste est vide">Ajoutez des articles ci-dessus, depuis l'inventaire (« Terminé », « Manquant ») ou depuis les recommandations.</EmptyState>
      ) : (
        <>
          <div className="row spread" style={{ margin: '14px 0 6px' }}>
            <span className="small muted">
              {toBuy.length} à acheter · <span className="num">{cost.knownCents + cost.estimatedCents > 0 ? `≈ ${formatMoney(cost.knownCents + cost.estimatedCents, currency)}` : ''}</span>
              {cost.unknownCount > 0 && ` · ${cost.unknownCount} prix inconnu${cost.unknownCount > 1 ? 's' : ''}`}
            </span>
            <Segmented label="Regrouper" value={by} onChange={setBy} options={[{ value: 'category', label: 'Rayon' }, { value: 'store', label: 'Magasin' }]} />
          </div>
          {groups.map((g) => (
            <section key={g.key}>
              <div className="section-title">{g.title} · {g.list.length}</div>
              <div className="card pad-0">{g.list.map((i) => <ItemRow key={i.id} item={i} cost={costs.get(i.id)} onOpen={() => setOpen(i)} />)}</div>
            </section>
          ))}
        </>
      )}
      <ItemSheet item={current} onClose={() => setOpen(null)} />
    </>
  );
}

type HistoryEntry =
  | { kind: 'purchase'; at: string; p: Purchase }
  | { kind: 'removed'; at: string; i: ShoppingItem };

function HistoryTab() {
  const view = useView();
  const run = useRun();
  const members = useMembers();
  const { store } = useCatalog();
  const { currency } = useHousehold();
  const canWrite = useCan('shopping.write');
  const entries = useMemo(() => {
    const list: HistoryEntry[] = [
      ...([...view.purchase.values()] as Purchase[]).map((p) => ({ kind: 'purchase' as const, at: p.createdAt, p })),
      ...([...view.shoppingItem.values()] as ShoppingItem[]).filter((i) => i.status === 'removed').map((i) => ({ kind: 'removed' as const, at: i.updatedAt, i })),
    ];
    return list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 150);
  }, [view.purchase, view.shoppingItem]);
  if (!entries.length) return <EmptyState icon={<History size={28} />} title="Aucun historique">Les achats rangés dans le stock et les articles retirés de la liste apparaîtront ici.</EmptyState>;
  return (
    <div className="card pad-0" style={{ marginTop: 12 }}>
      {entries.map((e) =>
        e.kind === 'purchase' ? (
          <div key={e.p.id} className="list-row" data-testid="history-item">
            <span className="meta">
              <span className="title" style={{ display: 'block' }}>{e.p.name}</span>
              <span className="sub">
                {e.p.lotId ? 'Acheté et rangé' : 'Achat enregistré'} · <span className="num">{formatQty(e.p.quantity, e.p.unit)}</span> · {members.get(e.p.userId)?.name ?? 'Ancien membre'}
                {e.p.storeId && store(e.p.storeId) ? ` · ${store(e.p.storeId)!.name}` : ''} · {relativeTime(e.at)}
              </span>
            </span>
            <span className="num small">{e.p.totalCents != null ? formatMoney(e.p.totalCents, currency) : <span className="subtle">prix inconnu</span>}</span>
          </div>
        ) : (
          <div key={e.i.id} className="list-row" data-testid="history-item">
            <span className="meta">
              <span className="title" style={{ display: 'block' }}>{e.i.name} <span className="num subtle small">· {formatQty(e.i.quantity, e.i.unit)}</span></span>
              <span className="sub">Retiré de la liste · {members.get(e.i.updatedBy)?.name ?? 'Ancien membre'} · {relativeTime(e.at)}</span>
            </span>
            {canWrite && <button className="btn ghost sm" onClick={() => void run('shopping.restore', { itemId: e.i.id }, { success: 'Remis dans la liste' })}><RotateCcw size={15} /> Remettre</button>}
          </div>
        ),
      )}
    </div>
  );
}

export function ShoppingPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const view = useView();
  const tab = (params.get('tab') as 'liste' | 'reception' | 'historique') ?? 'liste';
  const active = ([...view.shoppingItem.values()] as ShoppingItem[]).filter(isActiveItem);
  const toReceive = active.filter((i) => i.purchasedQty > 0).length;
  const left = active.filter((i) => remainingToBuy(i) > 0).length;
  return (
    <>
      <PageHead
        title="Courses"
        eyebrow={`${left} article${left > 1 ? 's' : ''} à acheter`}
        actions={<>
          <button className="btn ghost" onClick={() => navigate('/courses/ticket')} aria-label="Ticket de caisse" data-testid="open-receipt"><Receipt size={18} /><span className="hide-sm">Ticket</span></button>
          <button className="btn ghost" onClick={() => navigate('/depenses')} aria-label="Dépenses" data-testid="open-expenses"><Wallet size={18} /><span className="hide-sm">Dépenses</span></button>
          <button className="btn ghost" onClick={() => navigate('/courses/magasins')} aria-label="Magasins"><StoreIcon size={18} /><span className="hide-sm">Magasins</span></button>
          {left > 0 && <button className="btn primary" onClick={() => navigate('/courses/magasin')} data-testid="start-shopping"><ShoppingBasket size={18} /> Mode courses</button>}
        </>}
      />
      <Segmented
        label="Onglet"
        value={tab}
        onChange={(t) => setParams(t === 'liste' ? {} : { tab: t })}
        options={[
          { value: 'liste', label: 'Liste' },
          { value: 'reception', label: <>Réception{toReceive ? <span className="count-dot">{toReceive}</span> : null}</> },
          { value: 'historique', label: 'Historique' },
        ]}
      />
      <div style={{ marginTop: 12 }}>{tab === 'liste' ? <ListTab /> : tab === 'reception' ? <ReceptionTab /> : <HistoryTab />}</div>
      <div className="xsmall subtle center" style={{ marginTop: 20 }}><StoreIcon size={12} style={{ verticalAlign: '-2px' }} /> Les prix « ≈ » sont estimés à partir de vos achats enregistrés ; aucun prix n'est inventé.</div>
    </>
  );
}

