import { useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Minus, Package, Plus, ScanLine, Search, X } from 'lucide-react';
import { defaultStep, formatQty, normalizeName, unitDef, type ProductInsight } from '@homeos/shared';
import { useCatalog, useForecast, useHousehold, photoUrl } from '../../../lib/hooks';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { formatShortDate } from '../../../lib/format';
import { EmptyState, Segmented } from '../../../ui/Controls';
import { NamedIcon } from '../../../ui/icons';
import { PageHead } from '../Shell';

type Filter = 'all' | 'low' | 'out' | 'expiring' | 'opened';

export function StatusChips({ ins, max = 2 }: { ins: ProductInsight; max?: number }) {
  const chips: ReactElement[] = [];
  if (ins.status === 'out') chips.push(<span key="out" className="badge danger">Épuisé</span>);
  else if (ins.status === 'low') chips.push(<span key="low" className="badge warning">Stock faible</span>);
  else if (ins.status === 'soon') chips.push(<span key="soon" className="badge accent">Bientôt fini</span>);
  const e = ins.nextExpiry;
  if (e && (e.status === 'expired' || e.status === 'today' || e.status === 'urgent' || e.status === 'soon')) {
    const label = e.status === 'expired' ? 'Périmé' : e.status === 'today' ? "Périme aujourd'hui" : `Périme le ${formatShortDate(e.effectiveExpiry!)}`;
    chips.push(<span key="exp" className={`badge ${e.status === 'soon' ? 'warning' : 'danger'}`}>{label}</span>);
  }
  if (ins.openedLots.length) chips.push(<span key="open" className="badge info">Ouvert</span>);
  if (ins.forgotten) chips.push(<span key="forg" className="badge">Oublié ?</span>);
  return <>{chips.slice(0, max)}</>;
}

export function ProductThumb({ photoId, icon, color, size = 46 }: { photoId: string | null; icon?: string; color?: string; size?: number }) {
  const { id } = useHousehold();
  const url = photoUrl(id, photoId);
  return (
    <span className="thumb" style={{ width: size, height: size, ['--tint' as string]: color ?? 'var(--primary)' }}>
      {url ? <img src={url} alt="" loading="lazy" /> : <NamedIcon name={icon} size={Math.round(size * 0.46)} />}
    </span>
  );
}

function ProductRow({ ins }: { ins: ProductInsight }) {
  const p = ins.product;
  const navigate = useNavigate();
  const run = useRun();
  const canWrite = useCan('stock.write');
  const { category } = useCatalog();
  const cat = category(p.categoryId);
  const step = unitDef(p.unit).continuous ? defaultStep(p.unit) : 1;
  const consume = (e: React.MouseEvent) => {
    e.stopPropagation();
    void run('stock.consume', { productId: p.id, quantity: step }, { success: `−${formatQty(step, p.unit)} · ${p.name}`, undoable: true });
  };
  return (
    <div className="product-row" role="link" tabIndex={0} onClick={() => navigate(`/inventaire/${p.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/inventaire/${p.id}`)} data-testid="product-row">
      <ProductThumb photoId={p.photoId} icon={cat?.icon} color={cat?.color} />
      <div className="meta">
        <div className="title">{p.name}</div>
        <div className="chips"><StatusChips ins={ins} /></div>
      </div>
      <div className="qty">
        <span className={`num strong ${ins.total === 0 ? 'subtle' : ''}`} data-testid="product-qty">
          {ins.quality.approx ? '≈ ' : ''}{formatQty(ins.total, p.unit)}
        </span>
        {ins.daysLeft != null && ins.consumption.reliable && ins.total > 0 && (
          <span className="xsmall subtle">≈ {Math.round(ins.daysLeft)} j</span>
        )}
      </div>
      {canWrite && ins.total > 0 && (
        <button className="btn icon sm ghost minus" aria-label={`Consommer ${formatQty(step, p.unit)} de ${p.name}`} onClick={consume}><Minus size={18} /></button>
      )}
    </div>
  );
}

export function InventoryPage() {
  const forecast = useForecast();
  const view = useView();
  const navigate = useNavigate();
  const canWrite = useCan('catalog.write');
  const { categories, locations, location, category } = useCatalog();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [group, setGroup] = useState<'location' | 'category'>('location');

  const codesByProduct = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of view.productCode.values()) m.set(c.productId, [...(m.get(c.productId) ?? []), c.code]);
    return m;
  }, [view.productCode]);

  const counts = useMemo(() => {
    const c = { all: 0, low: 0, out: 0, expiring: 0, opened: 0 };
    for (const i of forecast.insights) {
      c.all++;
      if (i.status === 'low') c.low++;
      if (i.status === 'out') c.out++;
      if (i.nextExpiry && ['expired', 'today', 'urgent', 'soon'].includes(i.nextExpiry.status)) c.expiring++;
      if (i.openedLots.length) c.opened++;
    }
    return c;
  }, [forecast]);

  const sections = useMemo(() => {
    const nq = normalizeName(q);
    const digits = q.replace(/\D/g, '');
    const match = (i: ProductInsight) => {
      if (!nq) return true;
      const p = i.product;
      if (normalizeName(p.name).includes(nq) || normalizeName(p.brand ?? '').includes(nq)) return true;
      if (p.aliases.some((a) => normalizeName(a.text).includes(nq))) return true;
      return digits.length >= 4 && (codesByProduct.get(p.id) ?? []).some((c) => c.includes(digits));
    };
    const pass = (i: ProductInsight) =>
      filter === 'all' ||
      (filter === 'low' && i.status === 'low') ||
      (filter === 'out' && i.status === 'out') ||
      (filter === 'expiring' && !!i.nextExpiry && ['expired', 'today', 'urgent', 'soon'].includes(i.nextExpiry.status)) ||
      (filter === 'opened' && i.openedLots.length > 0);
    const rows = forecast.insights.filter((i) => match(i) && pass(i)).sort((a, b) => a.product.name.localeCompare(b.product.name, 'fr'));
    const order = group === 'location' ? locations.map((l) => l.id) : categories.map((c) => c.id);
    const map = new Map<string, ProductInsight[]>();
    for (const r of rows) {
      const k = (group === 'location' ? r.product.locationId : r.product.categoryId) ?? '';
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()]
      .sort((a, b) => (order.indexOf(a[0]) === -1 ? 999 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 999 : order.indexOf(b[0])))
      .map(([k, list]) => ({ key: k, title: (group === 'location' ? location(k)?.name : category(k)?.name) ?? 'Sans ' + (group === 'location' ? 'emplacement' : 'catégorie'), list }));
  }, [forecast, q, filter, group, codesByProduct, locations, categories, location, category]);

  const total = forecast.insights.length;
  return (
    <>
      <PageHead
        title="Inventaire"
        eyebrow={`${total} produit${total > 1 ? 's' : ''} suivi${total > 1 ? 's' : ''}`}
        actions={canWrite && <button className="btn primary" onClick={() => navigate('/inventaire/nouveau')}><Plus size={18} /> Ajouter</button>}
      />
      {total === 0 ? (
        <EmptyState
          icon={<Package size={28} />}
          title="Votre inventaire est vide"
          action={canWrite && (
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => navigate('/inventaire/nouveau')}><Plus size={18} /> Ajouter un produit</button>
              <button className="btn" onClick={() => navigate('/scanner')}><ScanLine size={18} /> Scanner</button>
            </div>
          )}
        >
          Ajoutez vos produits un à un, ou scannez-les à la chaîne. HOMEOS suivra ensuite les quantités, les dates et vos habitudes.
        </EmptyState>
      ) : (
        <>
          <div className="search">
            <Search size={18} />
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (nom, marque, code-barres…)" aria-label="Rechercher un produit" />
            {q && <button className="btn ghost icon sm" onClick={() => setQ('')} aria-label="Effacer"><X size={16} /></button>}
          </div>
          <div className="filter-bar">
            {([
              ['all', 'Tous', counts.all],
              ['out', 'Épuisés', counts.out],
              ['low', 'Faibles', counts.low],
              ['expiring', 'À consommer vite', counts.expiring],
              ['opened', 'Ouverts', counts.opened],
            ] as [Filter, string, number][]).map(([k, label, n]) => (
              <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {label} <span className="num">{n}</span>
              </button>
            ))}
          </div>
          <div className="row spread" style={{ margin: '4px 0 8px' }}>
            <span className="small subtle">{sections.reduce((s, x) => s + x.list.length, 0)} résultat(s)</span>
            <Segmented label="Regrouper par" value={group} onChange={setGroup} options={[{ value: 'location', label: 'Emplacement' }, { value: 'category', label: 'Catégorie' }]} />
          </div>
          {sections.length === 0 && <div className="card flat muted center">Aucun produit ne correspond.</div>}
          {sections.map((s) => (
            <section key={s.key}>
              <div className="section-title">{s.title} · {s.list.length}</div>
              <div className="card pad-0">
                {s.list.map((i) => <ProductRow key={i.product.id} ins={i} />)}
              </div>
            </section>
          ))}
          <div className="center" style={{ marginTop: 20 }}>
            <Link className="small" to="/parametres#catalogue">Gérer les catégories, emplacements et magasins</Link>
          </div>
        </>
      )}
    </>
  );
}
