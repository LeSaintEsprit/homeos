import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, MoreHorizontal, Plus, Sun, X } from 'lucide-react';
import {
  formatMoney, formatQty, groupByAisle, itemsForStore, newId, normalizeName, parseEuros,
  type ShoppingItem, type Store, type UnitCode,
} from '@homeos/shared';
import { useCatalog, useHousehold, useMembers, parseQty } from '../../../lib/hooks';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { Sheet } from '../../../ui/Sheet';
import { Field } from '../../../ui/Field';
import { QtyInput } from '../inventory/ActionSheets';

/** Maintient l'écran allumé pendant les courses (Screen Wake Lock, si disponible). */
function useWakeLock(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void>; addEventListener: (e: string, f: () => void) => void }> } }).wakeLock;
    if (!wl) return;
    let sentinel: { release: () => Promise<void> } | null = null;
    let alive = true;
    const acquire = async () => {
      try {
        const s = await wl.request('screen');
        if (!alive) return void s.release();
        sentinel = s;
        setActive(true);
        s.addEventListener('release', () => setActive(false));
      } catch {
        setActive(false);
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
  return active;
}

/** Détail d'un article en magasin : achat partiel, prix payé. */
function InStoreSheet({ item, onClose }: { item: ShoppingItem | null; onClose: () => void }) {
  const run = useRun();
  const { currency } = useHousehold();
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [loaded, setLoaded] = useState('');
  if (item && loaded !== item.id) {
    setLoaded(item.id);
    setQty(String(item.purchasedQty || item.quantity).replace('.', ','));
    setPrice(item.priceCents != null ? (item.priceCents / 100).toFixed(2).replace('.', ',') : '');
  }
  if (!item) return null;
  const save = async () => {
    const q = parseQty(qty) ?? 0;
    const cents = price.trim() ? parseEuros(price) : null;
    const out = await run('shopping.setPurchased', { itemId: item.id, purchasedQty: q, priceCents: cents });
    if (out.ok) {
      setLoaded('');
      onClose();
    }
  };
  return (
    <Sheet
      open={!!item}
      onClose={() => { setLoaded(''); onClose(); }}
      title={item.name}
      footer={<button className="btn primary" onClick={() => void save()} data-testid="instore-save">Valider</button>}
    >
      <div className="small muted">Demandé : <span className="num">{formatQty(item.quantity, item.unit)}</span>{item.comment ? ` · ${item.comment}` : ''}</div>
      <QtyInput value={qty} onChange={setQty} unit={item.unit} label="Quantité prise" autoFocus />
      {(parseQty(qty) ?? 0) < item.quantity && (parseQty(qty) ?? 0) > 0 && (
        <div className="alert info">Achat partiel : il restera {formatQty(item.quantity - (parseQty(qty) ?? 0), item.unit)} à trouver ailleurs.</div>
      )}
      <Field label={`Prix payé pour cet article (${currency === 'EUR' ? '€' : currency})`} hint="Facultatif. Sans prix, la dépense sera indiquée comme inconnue.">
        <input className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="—" />
      </Field>
      <button className="btn ghost block" onClick={() => void run('shopping.setPurchased', { itemId: item.id, purchasedQty: 0 }).then(() => { setLoaded(''); onClose(); })}>
        Pas trouvé / pas pris
      </button>
    </Sheet>
  );
}

function ModeRow({ item, onMore }: { item: ShoppingItem; onMore: () => void }) {
  const run = useRun();
  const members = useMembers();
  const { userId, currency } = useHousehold();
  const done = item.status === 'purchased';
  const partial = item.status === 'partial';
  const by = item.purchasedBy && item.purchasedBy !== userId ? members.get(item.purchasedBy)?.name : null;
  const toggle = () => void run('shopping.setPurchased', { itemId: item.id, purchasedQty: done || partial ? 0 : item.quantity });
  return (
    <div className={`mode-row ${done ? 'done' : ''} ${partial ? 'partial' : ''}`} data-testid="mode-item">
      <button className="mode-hit" onClick={toggle} role="checkbox" aria-checked={done ? true : partial ? 'mixed' : false} aria-label={`${item.name}, ${formatQty(item.quantity, item.unit)}`}>
        <span className="big-check">{(done || partial) && <Check size={26} strokeWidth={3} />}</span>
        <span className="mode-meta">
          <span className="mode-title">{item.name}</span>
          <span className="mode-sub">
            {partial && <span className="badge info">{formatQty(item.purchasedQty, item.unit)} pris</span>}
            {item.priority === 'urgent' && <span className="badge danger">Urgent</span>}
            {item.priority === 'high' && <span className="badge warning">Prioritaire</span>}
            {by && <span className="badge" data-testid="checked-by">Pris par {by}</span>}
            {item.priceCents != null && <span className="num">{formatMoney(item.priceCents, currency)}</span>}
            {item.comment && <span>{item.comment}</span>}
          </span>
        </span>
        <span className="mode-qty num">{formatQty(item.quantity, item.unit)}</span>
      </button>
      <button className="btn ghost icon" onClick={onMore} aria-label={`Quantité ou prix pour ${item.name}`}><MoreHorizontal size={22} /></button>
    </div>
  );
}

export function ShoppingModePage() {
  const view = useView();
  const run = useRun();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { id: hid } = useHousehold();
  const { categories, stores, category } = useCatalog();
  const canWrite = useCan('shopping.write');
  const wake = useWakeLock();
  const storageKey = `homeos-shop-store-${hid}`;
  const storeId = params.get('magasin') ?? localStorage.getItem(storageKey) ?? '';
  const store = stores.find((s) => s.id === storeId) ?? null;
  const [more, setMore] = useState<string | null>(null);
  const [extra, setExtra] = useState('');
  const all = useMemo(() => [...view.shoppingItem.values()] as ShoppingItem[], [view.shoppingItem]);
  const items = useMemo(() => itemsForStore(all, store?.id ?? null), [all, store]);
  const groups = useMemo(() => groupByAisle(items, categories, store as Store | null), [items, categories, store]);
  const elsewhere = store ? all.filter((i) => i.storeId && i.storeId !== store.id && (i.status === 'pending' || i.status === 'partial')).length : 0;
  const taken = items.filter((i) => i.status === 'purchased').length;
  const pct = items.length ? Math.round((taken / items.length) * 100) : 0;
  const pickStore = (id: string) => {
    if (id) localStorage.setItem(storageKey, id);
    else localStorage.removeItem(storageKey);
    setParams(id ? { magasin: id } : {}, { replace: true });
  };
  const addExtra = async () => {
    const name = extra.trim();
    if (!name) return;
    // Déjà dans la liste : on coche l'article existant plutôt que de créer un doublon.
    const existing = items.find((i) => normalizeName(i.name) === normalizeName(name));
    if (existing) {
      if (existing.status !== 'purchased') await run('shopping.setPurchased', { itemId: existing.id, purchasedQty: existing.quantity }, { success: `« ${existing.name} » était déjà dans la liste : coché` });
      setExtra('');
      return;
    }
    const itemId = newId();
    const out = await run('shopping.add', { itemId, productId: null, name, quantity: 1, unit: 'piece' as UnitCode, storeId: store?.id ?? null, source: 'manual' });
    if (out.ok) {
      // Ajouté en magasin = déjà dans le panier.
      const target = out.result.aliases?.find((a) => a.from === itemId)?.to ?? itemId;
      await run('shopping.setPurchased', { itemId: target, purchasedQty: 1 }, { success: `« ${name} » ajouté au panier` });
      setExtra('');
    }
  };
  const current = more ? ((view.shoppingItem.get(more) as ShoppingItem | undefined) ?? null) : null;
  const purchasedAny = all.some((i) => (i.status === 'purchased' || i.status === 'partial') && i.purchasedQty > 0);
  return (
    <div className="shop-mode" role="dialog" aria-modal="true" aria-label="Mode courses">
      <header className="shop-mode-head">
        <button className="btn ghost icon" onClick={() => navigate('/courses')} aria-label="Quitter le mode courses"><X size={22} /></button>
        <select className="select store-pick" value={store?.id ?? ''} onChange={(e) => pickStore(e.target.value)} aria-label="Magasin">
          <option value="">Tous les magasins</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="num strong" data-testid="mode-progress">{taken}/{items.length}</span>
      </header>
      <div className="progress" aria-hidden><span style={{ width: `${pct}%` }} /></div>
      <div className="shop-mode-body">
        {wake && <div className="xsmall subtle center"><Sun size={12} style={{ verticalAlign: '-2px' }} /> L'écran reste allumé pendant les courses.</div>}
        {elsewhere > 0 && <div className="xsmall muted center">{elsewhere} article(s) prévu(s) dans un autre magasin ne sont pas affichés.</div>}
        {items.length === 0 && <div className="empty"><h3>Rien à acheter ici</h3><p className="muted">La liste est vide pour ce magasin.</p></div>}
        {groups.map((g) => (
          <section key={g.categoryId}>
            <div className="section-title">{category(g.categoryId)?.name ?? 'Autres articles'}</div>
            <div className="card pad-0">{g.items.map((i) => <ModeRow key={i.id} item={i} onMore={() => setMore(i.id)} />)}</div>
          </section>
        ))}
        {canWrite && (
          <form className="row" style={{ marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); void addExtra(); }}>
            <input className="input grow" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ajouter un article pris en magasin…" aria-label="Article pris en plus" />
            <button className="btn icon" aria-label="Ajouter au panier" disabled={!extra.trim()}><Plus size={20} /></button>
          </form>
        )}
      </div>
      <footer className="shop-mode-foot">
        <button className="btn primary lg block" onClick={() => navigate(purchasedAny ? '/courses?tab=reception' : '/courses')} data-testid="finish-shopping">
          {purchasedAny ? 'Terminer et ranger les achats' : 'Terminer'}
        </button>
      </footer>
      <InStoreSheet item={current} onClose={() => setMore(null)} />
    </div>
  );
}
