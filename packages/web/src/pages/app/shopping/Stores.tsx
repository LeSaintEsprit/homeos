import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, MapPin, Pencil, Plus, ShoppingBasket, Store as StoreIcon } from 'lucide-react';
import {
  STORE_COLORS, formatMoney, formatQty, groupByAisle, moveAisle, newId, storeSummary,
  type Product, type Purchase, type ShoppingItem, type Store,
} from '@homeos/shared';
import { useCatalog, useHousehold } from '../../../lib/hooks';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { formatShortDate } from '../../../lib/format';
import { EmptyState } from '../../../ui/Controls';
import { Field, TextField } from '../../../ui/Field';
import { Sheet } from '../../../ui/Sheet';
import { PageHead } from '../Shell';

export function StoreEditSheet({ store, open, onClose, onSaved }: { store: Store | null; open: boolean; onClose: () => void; onSaved?: (id: string) => void }) {
  const run = useRun();
  const { stores } = useCatalog();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [color, setColor] = useState<string>(STORE_COLORS[0]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const key = open ? (store?.id ?? 'new') : null;
  if (key !== loaded) {
    setLoaded(key);
    setName(store?.name ?? '');
    setAddress(store?.address ?? '');
    setNotes(store?.notes ?? '');
    setColor(store?.color ?? STORE_COLORS[stores.length % STORE_COLORS.length]);
  }
  const save = async () => {
    if (!name.trim()) return;
    const id = store?.id ?? newId();
    const out = await run('store.upsert', { id, name: name.trim(), address: address.trim() || null, notes: notes.trim() || null, color }, { success: 'Magasin enregistré' });
    if (out.ok) {
      onClose();
      onSaved?.(id);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={store ? 'Modifier le magasin' : 'Nouveau magasin'} footer={<button className="btn primary" onClick={() => void save()} disabled={!name.trim()}>Enregistrer</button>}>
      <TextField label="Nom" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus placeholder="Ex. Marché du samedi" />
      <TextField label="Adresse" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} placeholder="Facultative" />
      <Field label="Notes">
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} placeholder="Horaires, carte de fidélité, rayon bio au fond…" />
      </Field>
      <Field label="Couleur">
        <div className="row wrap" style={{ ['--gap' as string]: '8px' }}>
          {STORE_COLORS.map((c) => (
            <button key={c} type="button" className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Couleur ${c}`} aria-pressed={c === color} />
          ))}
        </div>
      </Field>
    </Sheet>
  );
}

export function StoresPage() {
  const view = useView();
  const navigate = useNavigate();
  const canWrite = useCan('catalog.write');
  const { stores } = useCatalog();
  const { currency } = useHousehold();
  const [creating, setCreating] = useState(false);
  const purchases = useMemo(() => [...view.purchase.values()] as Purchase[], [view.purchase]);
  const pending = useMemo(() => ([...view.shoppingItem.values()] as ShoppingItem[]).filter((i) => i.status === 'pending' || i.status === 'partial'), [view.shoppingItem]);
  return (
    <>
      <PageHead
        title="Magasins"
        eyebrow={<Link to="/courses" className="row" style={{ ['--gap' as string]: '4px' }}><ArrowLeft size={14} /> Courses</Link>}
        actions={canWrite && <button className="btn" onClick={() => setCreating(true)}><Plus size={18} /> Magasin</button>}
      />
      {stores.length === 0 ? (
        <EmptyState icon={<StoreIcon size={28} />} title="Aucun magasin" action={canWrite && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={18} /> Ajouter un magasin</button>}>
          Ajoutez vos magasins pour répartir la liste, suivre l'ordre des rayons et comparer les prix.
        </EmptyState>
      ) : (
        <div className="card pad-0">
          {stores.map((s) => {
            const sum = storeSummary(s.id, purchases);
            const n = pending.filter((i) => i.storeId === s.id).length;
            return (
              <button key={s.id} className="list-row" onClick={() => navigate(`/courses/magasins/${s.id}`)} data-testid="store-row">
                <span className="thumb" style={{ ['--tint' as string]: s.color, width: 42, height: 42 }}><StoreIcon size={20} /></span>
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>{s.name}</span>
                  <span className="sub">
                    {sum.visits ? `${sum.visits} passage${sum.visits > 1 ? 's' : ''} · dernier ${formatShortDate(sum.lastVisit!)}` : 'Aucun achat enregistré'}
                    {sum.avgBasketCents != null && ` · panier moyen ${formatMoney(sum.avgBasketCents, currency)}`}
                  </span>
                </span>
                {n > 0 && <span className="badge info">{n} à acheter</span>}
              </button>
            );
          })}
        </div>
      )}
      <StoreEditSheet store={null} open={creating} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/courses/magasins/${id}`)} />
    </>
  );
}

export function StoreDetailPage() {
  const { id = '' } = useParams();
  const view = useView();
  const run = useRun();
  const navigate = useNavigate();
  const canCatalog = useCan('catalog.write');
  const canShop = useCan('shopping.write');
  const { categories, category } = useCatalog();
  const { currency } = useHousehold();
  const [editing, setEditing] = useState(false);
  const store = view.store.get(id) as Store | undefined;
  const purchases = useMemo(() => [...view.purchase.values()] as Purchase[], [view.purchase]);
  const sum = useMemo(() => storeSummary(id, purchases), [id, purchases]);
  const aisles = useMemo(
    () => (store ? groupByAisle(categories.map((c) => ({ id: c.id, categoryId: c.id, status: 'pending', priority: 'normal', name: c.name }) as unknown as ShoppingItem), categories, store).map((g) => g.categoryId) : []),
    [store, categories],
  );
  if (!store) return <EmptyState icon={<StoreIcon size={28} />} title="Magasin introuvable" action={<Link className="btn" to="/courses/magasins">Retour</Link>} />;
  const onList = new Set(([...view.shoppingItem.values()] as ShoppingItem[]).filter((i) => i.status === 'pending' || i.status === 'partial').map((i) => i.productId));
  const move = (cid: string, d: -1 | 1) => void run('store.upsert', { id: store.id, name: store.name, categoryOrder: moveAisle(store, categories, cid, d) });
  const addUsual = (productId: string) => {
    const p = view.product.get(productId) as Product | undefined;
    if (!p) return;
    void run('shopping.add', { itemId: newId(), productId: p.id, name: p.name, quantity: 1, unit: p.packSize && p.packUnit ? p.packUnit : p.unit, storeId: store.id, source: 'manual' }, { success: `« ${p.name} » ajouté à la liste` });
  };
  return (
    <>
      <PageHead
        title={store.name}
        eyebrow={<Link to="/courses/magasins" className="row" style={{ ['--gap' as string]: '4px' }}><ArrowLeft size={14} /> Magasins</Link>}
        actions={<>
          {canCatalog && <button className="btn ghost icon" onClick={() => setEditing(true)} aria-label="Modifier le magasin"><Pencil size={18} /></button>}
          {canShop && <button className="btn primary" onClick={() => navigate(`/courses/magasin?magasin=${store.id}`)}><ShoppingBasket size={18} /> Faire les courses ici</button>}
        </>}
      />
      {(store.address || store.notes) && (
        <div className="card stack" style={{ ['--gap' as string]: '6px' }}>
          {store.address && <div className="row small"><MapPin size={16} className="subtle" /> {store.address}</div>}
          {store.notes && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{store.notes}</div>}
        </div>
      )}
      <div className="stat-grid" style={{ marginTop: 12 }}>
        <div className="stat"><span className="stat-label">Passages</span><strong className="num">{sum.visits}</strong></div>
        <div className="stat"><span className="stat-label">Dépensé</span><strong className="num">{formatMoney(sum.knownCents, currency)}</strong></div>
        <div className="stat"><span className="stat-label">Panier moyen</span><strong className="num">{sum.avgBasketCents != null ? formatMoney(sum.avgBasketCents, currency) : '—'}</strong></div>
      </div>
      {sum.unpricedCount > 0 && <div className="xsmall subtle" style={{ marginTop: 6 }}>Montants calculés sur les prix connus uniquement · {sum.unpricedCount} achat(s) sans prix non comptés.</div>}

      <div className="grid-2" style={{ marginTop: 8 }}>
        <section>
          <div className="section-title">Produits habituels</div>
          {sum.usual.length === 0 ? (
            <div className="card small muted">Les produits achetés au moins deux fois ici apparaîtront ici.</div>
          ) : (
            <div className="card pad-0">
              {sum.usual.map((u) => (
                <div key={u.productId ?? u.name} className="list-row">
                  <span className="meta">
                    <span className="title" style={{ display: 'block' }}>{u.name}</span>
                    <span className="sub">{u.count} achats · dernier {formatShortDate(u.lastDate)}</span>
                  </span>
                  {canShop && u.productId && view.product.get(u.productId) && (
                    onList.has(u.productId)
                      ? <span className="badge">Dans la liste</span>
                      : <button className="btn sm" onClick={() => addUsual(u.productId!)} aria-label={`Ajouter ${u.name} à la liste`}><Plus size={15} /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        <section>
          <div className="section-title">Ordre des rayons</div>
          <div className="card pad-0" data-testid="aisle-order">
            {aisles.map((cid, i) => (
              <div key={cid} className="list-row" style={{ paddingBlock: 8 }}>
                <span className="num subtle small" style={{ width: 20 }}>{i + 1}</span>
                <span className="meta"><span className="title">{category(cid)?.name}</span></span>
                {canCatalog && (
                  <>
                    <button className="btn ghost icon sm" onClick={() => move(cid, -1)} disabled={i === 0} aria-label={`Monter ${category(cid)?.name}`}><ArrowUp size={16} /></button>
                    <button className="btn ghost icon sm" onClick={() => move(cid, 1)} disabled={i === aisles.length - 1} aria-label={`Descendre ${category(cid)?.name}`}><ArrowDown size={16} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="xsmall subtle" style={{ marginTop: 6 }}>Le mode courses suit cet ordre de parcours.</div>
        </section>
      </div>

      <div className="section-title">Derniers achats</div>
      {sum.recent.length === 0 ? (
        <div className="card small muted">Aucun achat enregistré dans ce magasin. Les réceptions de courses et les tickets de caisse alimentent cet historique.</div>
      ) : (
        <div className="card pad-0">
          {sum.recent.map((p) => (
            <div key={p.id} className="list-row" style={{ paddingBlock: 10 }}>
              <span className="meta">
                <span className="title" style={{ display: 'block' }}>{p.name}</span>
                <span className="sub">{formatShortDate(p.date)} · <span className="num">{formatQty(p.quantity, p.unit)}</span></span>
              </span>
              <span className="num small">{p.totalCents != null ? formatMoney(p.totalCents, currency) : <span className="subtle">prix inconnu</span>}</span>
            </div>
          ))}
        </div>
      )}
      <StoreEditSheet store={store} open={editing} onClose={() => setEditing(false)} />
    </>
  );
}
