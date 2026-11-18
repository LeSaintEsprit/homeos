import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Pencil, Plus, Receipt, Trash2, Wallet } from 'lucide-react';
import {
  RANGE_LABELS, breakdownBy, budgetStatus, comparePricesByStore, compatibleUnits, detectUnusualSpending, estimateListCost, formatMoney, formatQty, inRange,
  isActiveItem, newId, parseEuros, periodLabel, priceHistory, productsWithPriceHistory, spendingByPeriod, spendingRange, topProducts, unitLabel,
  type Category, type Product, type Purchase, type RangePreset, type ShoppingItem, type Store, type UnitCode,
} from '@homeos/shared';
import { useCatalog, useForecast, useHousehold, useMembers, useToday, parseQty } from '../../../lib/hooks';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { formatShortDate } from '../../../lib/format';
import { EmptyState, Segmented } from '../../../ui/Controls';
import { Field, TextField } from '../../../ui/Field';
import { Sheet } from '../../../ui/Sheet';
import { useConfirm } from '../../../ui/Confirm';
import { ChartCard, ColumnChart, LineChart, RankedBars } from '../../../ui/Charts';
import { UnitSelect } from '../inventory/ProductForm';
import { PageHead } from '../Shell';

function useMoney() {
  const { currency } = useHousehold();
  return {
    money: (c: number) => formatMoney(c, currency),
    round: (c: number) => formatMoney(c, currency, { round: true }),
    currency,
  };
}

/** Saisie ou modification d'un achat (prix facultatif : sans prix, il reste « inconnu »). */
export function PurchaseSheet({ purchase, open, onClose }: { purchase: Purchase | null; open: boolean; onClose: () => void }) {
  const run = useRun();
  const view = useView();
  const today = useToday();
  const { stores, categories } = useCatalog();
  const { ask, node } = useConfirm();
  const [name, setName] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<UnitCode>('piece');
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [storeId, setStoreId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(today);
  const [loaded, setLoaded] = useState<string | null>(null);
  const key = open ? (purchase?.id ?? 'new') : null;
  if (key !== loaded) {
    setLoaded(key);
    setName(purchase?.name ?? '');
    setProductId(purchase?.productId ?? '');
    setQty(String(purchase?.quantity ?? 1).replace('.', ','));
    setUnit(purchase?.unit ?? 'piece');
    setPrice(purchase?.totalCents != null ? (purchase.totalCents / 100).toFixed(2).replace('.', ',') : '');
    setDiscount(purchase?.discountCents ? (purchase.discountCents / 100).toFixed(2).replace('.', ',') : '');
    setStoreId(purchase?.storeId ?? '');
    setCategoryId(purchase?.categoryId ?? '');
    setDate(purchase?.date ?? today);
  }
  const products = useMemo(() => ([...view.product.values()] as Product[]).filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name, 'fr')), [view.product]);
  const product = productId ? (view.product.get(productId) as Product | undefined) : undefined;
  const save = async () => {
    const q = parseQty(qty);
    const n = name.trim() || product?.name || '';
    if (!n || !q || q <= 0) return;
    const totalCents = price.trim() ? parseEuros(price) : null;
    const discountCents = discount.trim() ? parseEuros(discount) : null;
    const fields = { name: n, quantity: q, unit, totalCents, discountCents, storeId: storeId || null, date, categoryId: categoryId || null, productId: productId || null };
    const out = purchase
      ? await run('purchase.update', { id: purchase.id, patch: fields }, { success: 'Achat modifié' })
      : await run('purchase.create', { id: newId(), ...fields, note: null }, { success: 'Achat enregistré' });
    if (out.ok) onClose();
  };
  const remove = async () => {
    if (!purchase) return;
    const linked = purchase.lotId ? ' Le stock déjà rangé n’est pas modifié (utilisez « Annuler » dans l’historique du produit si besoin).' : '';
    if (!(await ask('Supprimer cet achat ?', `« ${purchase.name} » du ${formatShortDate(purchase.date)} ne sera plus compté dans les dépenses.${linked}`, 'Supprimer', true))) return;
    const out = await run('purchase.delete', { id: purchase.id }, { success: 'Achat supprimé' });
    if (out.ok) onClose();
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={purchase ? 'Modifier l’achat' : 'Nouvel achat'}
      footer={<>
        {purchase && <button className="btn danger-soft" onClick={() => void remove()}><Trash2 size={16} /> Supprimer</button>}
        <button className="btn primary" onClick={() => void save()} data-testid="purchase-save">Enregistrer</button>
      </>}
    >
      {!purchase && <p className="small muted">Pour une dépense sans passage par la liste de courses. Elle ne modifie pas le stock : pour ranger un produit, utilisez « Ajouter » dans l’inventaire.</p>}
      <Field label="Produit (facultatif)">
        <select className="select" value={productId} onChange={(e) => { setProductId(e.target.value); const p = view.product.get(e.target.value) as Product | undefined; if (p) { setUnit(p.unit); if (!name.trim()) setName(p.name); if (p.categoryId) setCategoryId(p.categoryId); } }}>
          <option value="">— Dépense libre —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <TextField label="Libellé" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex. Fleurs, piles…" />
      <div className="grid-2 always">
        <Field label="Quantité"><input className="input num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Unité">
          {product ? (
            <select className="select" value={unit} onChange={(e) => setUnit(e.target.value as UnitCode)}>
              {compatibleUnits(product).map((u) => <option key={u} value={u}>{unitLabel(u, 2)}</option>)}
            </select>
          ) : <UnitSelect value={unit} onChange={(u) => u && setUnit(u)} />}
        </Field>
        <Field label="Prix payé (total)" hint={price.trim() ? undefined : 'Vide = prix inconnu'}>
          <input className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="—" data-testid="purchase-price" />
        </Field>
        <Field label="Dont remise"><input className="input num" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="—" /></Field>
        <Field label="Magasin">
          <select className="select" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">—</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Date"><input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Catégorie">
        <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">—</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      {node}
    </Sheet>
  );
}

function BudgetBlock({ purchases }: { purchases: Purchase[] }) {
  const today = useToday();
  const { settings } = useHousehold();
  const { money, round } = useMoney();
  const b = useMemo(() => budgetStatus(purchases, today, settings.monthlyBudgetCents), [purchases, today, settings.monthlyBudgetCents]);
  const pct = b.ratio != null ? Math.min(100, Math.round(b.ratio * 100)) : null;
  const over = b.budgetCents != null && b.projectedCents != null && b.projectedCents > b.budgetCents;
  return (
    <section className="card" data-testid="budget">
      <div className="row spread" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="small muted">Dépensé ce mois-ci</div>
          <div className="hero-figure" data-testid="month-spent">{money(b.spentCents)}</div>
        </div>
        {b.budgetCents != null && <div className="small muted right">budget<br /><strong className="num" style={{ color: 'var(--text)' }}>{round(b.budgetCents)}</strong></div>}
      </div>
      {pct != null && <div className={`bar big ${over ? 'over' : ''}`} style={{ marginTop: 10 }} role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Part du budget dépensée"><span style={{ width: `${pct}%` }} /></div>}
      <div className="stat-grid" style={{ marginTop: 12 }}>
        <div className="stat"><span className="stat-label">Projection</span><strong className="num">{b.projectedCents != null ? `≈ ${round(b.projectedCents)}` : '—'}</strong></div>
        <div className="stat"><span className="stat-label">{b.remainingCents != null && b.remainingCents < 0 ? 'Dépassement' : 'Reste'}</span><strong className="num" style={b.remainingCents != null && b.remainingCents < 0 ? { color: 'var(--danger)' } : undefined}>{b.remainingCents != null ? round(Math.abs(b.remainingCents)) : '—'}</strong></div>
        <div className="stat"><span className="stat-label">Panier moyen</span><strong className="num">{b.avgTripCents != null ? round(b.avgTripCents) : '—'}</strong></div>
      </div>
      <div className="xsmall subtle" style={{ marginTop: 8 }}>
        Montants calculés avec les seuls prix enregistrés{b.unpricedCount ? ` · ${b.unpricedCount} achat${b.unpricedCount > 1 ? 's' : ''} sans prix ce mois-ci, non comptés` : ''}.
        {b.avgMonthCents != null && ` Moyenne des 3 derniers mois : ${round(b.avgMonthCents)}.`}
        {b.projectedCents == null && ' Projection disponible à partir du 5 du mois.'}
        {b.budgetCents == null && <> <Link to="/parametres">Définir un budget mensuel</Link>.</>}
      </div>
      {over && <div className="alert warning" style={{ marginTop: 10 }}><AlertTriangle size={18} /> Au rythme actuel, le budget du mois serait dépassé.</div>}
    </section>
  );
}

function PriceTracker({ purchases }: { purchases: Purchase[] }) {
  const view = useView();
  const { currency } = useHousehold();
  const { store } = useCatalog();
  const candidates = useMemo(() => productsWithPriceHistory(purchases).filter((c) => view.product.get(c.productId)), [purchases, view.product]);
  const [pid, setPid] = useState('');
  const productId = pid || candidates[0]?.productId || '';
  const product = productId ? (view.product.get(productId) as Product | undefined) : undefined;
  const history = useMemo(() => (product ? priceHistory(product, purchases) : []), [product, purchases]);
  const byStore = useMemo(() => comparePricesByStore(history), [history]);
  if (!candidates.length || !product) {
    return (
      <section className="card">
        <div className="card-title"><h3>Évolution des prix</h3></div>
        <p className="small muted">Le suivi apparaît dès qu'un produit a au moins deux prix enregistrés (réception des courses avec prix, tickets, achats saisis).</p>
      </section>
    );
  }
  const unitTxt = unitLabel(product.unit, 1);
  const cents = (c: number) => formatMoney(Math.round(c), currency);
  const per = (c: number) => `${cents(c)} / ${unitTxt}`;
  return (
    <ChartCard
      title="Évolution des prix"
      subtitle={`Prix payé par ${unitTxt}, d'après ${history.length} achat${history.length > 1 ? 's' : ''} enregistré${history.length > 1 ? 's' : ''}`}
      testid="price-chart"
      table={
        <table className="viz-table">
          <thead><tr><th>Date</th><th>Magasin</th><th className="n">Quantité</th><th className="n">Prix / {unitTxt}</th></tr></thead>
          <tbody>{history.map((h, i) => <tr key={i}><td>{formatShortDate(h.date)}</td><td>{store(h.storeId)?.name ?? '—'}</td><td className="n">{formatQty(h.quantity, product.unit)}</td><td className="n">{per(h.centsPerStockUnit)}</td></tr>)}</tbody>
        </table>
      }
    >
      <select className="select" style={{ marginBottom: 10 }} value={productId} onChange={(e) => setPid(e.target.value)} aria-label="Produit suivi" data-testid="price-product">
        {candidates.map((c) => <option key={c.productId} value={c.productId}>{(view.product.get(c.productId) as Product).name}</option>)}
      </select>
      <LineChart
        points={history.map((h) => ({ date: h.date, value: h.centsPerStockUnit, note: store(h.storeId)?.name }))}
        format={per}
        formatAxis={(v) => formatMoney(v, currency, { round: v % 100 === 0 })}
        formatDate={formatShortDate}
      />
      {byStore.length > 1 && (
        <table className="viz-table" style={{ marginTop: 12 }} data-testid="store-prices">
          <thead><tr><th>Prix par {unitTxt}</th><th className="n">Moyen</th><th className="n">Plus bas</th><th className="n">Dernier</th></tr></thead>
          <tbody>
            {byStore.map((r) => (
              <tr key={r.storeId ?? 'none'}>
                <td>{store(r.storeId)?.name ?? 'Magasin non précisé'}{r === byStore[0] && <span className="badge success" style={{ marginLeft: 6 }}>le moins cher</span>}</td>
                <td className="n">{cents(r.avg)}</td><td className="n">{cents(r.min)}</td><td className="n">{cents(r.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ChartCard>
  );
}

export function ExpensesPage() {
  const view = useView();
  const today = useToday();
  const forecast = useForecast();
  const members = useMembers();
  const canWrite = useCan('purchase.write');
  const { settings } = useHousehold();
  const { money, round, currency } = useMoney();
  const { store } = useCatalog();
  const [preset, setPreset] = useState<RangePreset>('month');
  const [edit, setEdit] = useState<Purchase | null>(null);
  const [creating, setCreating] = useState(false);
  const all = useMemo(() => [...view.purchase.values()] as Purchase[], [view.purchase]);
  const range = useMemo(() => spendingRange(preset, today, all), [preset, today, all]);
  const inPeriod = useMemo(() => all.filter((p) => inRange(p, range.from, range.to)), [all, range]);
  // Série bornée à la période : la première barre ne compte que les jours inclus dans le filtre.
  const series = useMemo(() => spendingByPeriod(inPeriod, today, range.period, range.n), [inPeriod, today, range]);
  const products = useMemo(() => new Map([...view.product.values()].map((p) => [p.id, p as Product])), [view.product]);
  const unusual = useMemo(() => detectUnusualSpending(all, products, today, settings.monthlyBudgetCents, currency), [all, products, today, settings.monthlyBudgetCents, currency]);
  const byCat = useMemo(() => breakdownBy(inPeriod, 'categoryId', view.category as Map<string, Category>, 'Sans catégorie'), [inPeriod, view.category]);
  const byStore = useMemo(() => breakdownBy(inPeriod, 'storeId', view.store as Map<string, Store>, 'Magasin non précisé'), [inPeriod, view.store]);
  const top = useMemo(() => topProducts(inPeriod, 8), [inPeriod]);
  const total = inPeriod.reduce((s, p) => s + (p.totalCents ?? 0), 0);
  const unpriced = inPeriod.filter((p) => p.totalCents == null).length;
  const items = useMemo(() => ([...view.shoppingItem.values()] as ShoppingItem[]).filter(isActiveItem), [view.shoppingItem]);
  const listCost = useMemo(() => estimateListCost(items, products, all), [items, products, all]);
  const recoCost = forecast.recommendations.reduce((s, r) => s + (r.estCostCents ?? 0), 0);
  const recoUnknown = forecast.recommendations.filter((r) => r.estCostCents == null).length;
  const list = [...inPeriod].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1));
  const [shown, setShown] = useState(60);
  const visible = list.slice(0, shown);
  const days = [...new Set(visible.map((p) => p.date))];
  const cur = series[series.length - 1]?.key;
  return (
    <>
      <PageHead
        title="Dépenses"
        eyebrow={<Link to="/courses" className="row" style={{ ['--gap' as string]: '4px' }}><ArrowLeft size={14} /> Courses</Link>}
        actions={canWrite && <>
          <Link className="btn" to="/courses/ticket"><Receipt size={18} /> Ticket</Link>
          <button className="btn" onClick={() => setCreating(true)} data-testid="add-purchase"><Plus size={18} /> Achat</button>
        </>}
      />
      <BudgetBlock purchases={all} />
      {unusual.length > 0 && (
        <div className="stack" style={{ marginTop: 12, ['--gap' as string]: '8px' }} data-testid="unusual">
          {unusual.map((u) => <div key={u.key} className="alert warning"><AlertTriangle size={18} /> <span>{u.message}</span></div>)}
        </div>
      )}
      <div className="card flat" style={{ marginTop: 12, padding: 12 }}>
        <div className="small muted">Prochains achats prévus</div>
        <div className="small" style={{ marginTop: 4 }} data-testid="planned-cost">
          Liste de courses : {listCost.knownCents + listCost.estimatedCents > 0 ? <strong className="num">≈ {round(listCost.knownCents + listCost.estimatedCents)}</strong> : '—'}
          {listCost.unknownCount > 0 && <span className="subtle"> · {listCost.unknownCount} prix inconnu{listCost.unknownCount > 1 ? 's' : ''}</span>}
          {' · '}Recommandations : {recoCost > 0 ? <strong className="num">≈ {round(recoCost)}</strong> : '—'}
          {recoUnknown > 0 && <span className="subtle"> · {recoUnknown} sans prix connu</span>}
        </div>
      </div>

      <div className="filter-row">
        <Segmented label="Période" value={preset} onChange={setPreset} options={(Object.keys(RANGE_LABELS) as RangePreset[]).map((k) => ({ value: k, label: RANGE_LABELS[k] }))} />
        <span className="small muted" data-testid="period-total">{money(total)}{unpriced ? ` · ${unpriced} sans prix` : ''}</span>
      </div>

      {all.length === 0 ? (
        <EmptyState icon={<Wallet size={28} />} title="Aucun achat enregistré" action={canWrite && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={18} /> Enregistrer un achat</button>}>
          Les achats s'enregistrent à la réception des courses, avec un ticket de caisse ou à la main. Seuls les prix réellement payés sont comptés : aucun montant n'est inventé.
        </EmptyState>
      ) : (
        <div className="dashboard">
          <div className="dash-cell" style={{ gridColumn: '1 / -1' }}>
            <ChartCard
              title={`Dépenses par ${range.period === 'week' ? 'semaine' : range.period === 'month' ? 'mois' : 'année'}`}
              subtitle="Prix enregistrés uniquement"
              testid="spend-chart"
              table={
                <table className="viz-table">
                  <thead><tr><th>Période</th><th className="n">Dépensé</th><th className="n">Achats</th><th className="n">Sans prix</th></tr></thead>
                  <tbody>{series.map((s) => <tr key={s.key}><td>{range.period === 'week' ? `Semaine du ${s.key < range.from ? periodLabel(range.from, 'week') : s.label}` : s.label}{s.key === cur ? ' (en cours)' : ''}</td><td className="n">{money(s.totalCents)}</td><td className="n">{s.pricedCount}</td><td className="n">{s.unpricedCount}</td></tr>)}</tbody>
                </table>
              }
            >
              <ColumnChart
                data={series.map((s) => ({ key: s.key, label: range.period === 'year' ? s.label : periodLabel(s.key < range.from ? range.from : s.key, range.period), value: s.totalCents, current: s.key === cur, note: s.unpricedCount ? `${s.unpricedCount} achat${s.unpricedCount > 1 ? 's' : ''} sans prix` : undefined }))}
                format={money}
                formatAxis={(v) => formatMoney(v, currency, { round: v % 100 === 0 })}
                reference={range.period === 'month' && settings.monthlyBudgetCents ? { value: settings.monthlyBudgetCents, label: `Budget ${round(settings.monthlyBudgetCents)}` } : null}
              />
            </ChartCard>
          </div>
          <div className="dash-cell">
            <ChartCard title="Par catégorie" testid="by-category" table={<BreakdownTable rows={byCat} money={money} />}>
              {byCat.length ? <RankedBars data={byCat.map((b) => ({ key: b.id ?? 'none', label: b.label, value: b.totalCents, sub: `${b.count} achat${b.count > 1 ? 's' : ''}` }))} format={money} /> : <p className="small muted">Aucun achat avec prix sur la période.</p>}
            </ChartCard>
          </div>
          <div className="dash-cell">
            <ChartCard title="Par magasin" testid="by-store" table={<BreakdownTable rows={byStore} money={money} />}>
              {byStore.length ? <RankedBars data={byStore.map((b) => ({ key: b.id ?? 'none', label: b.label, value: b.totalCents, sub: `${b.count} achat${b.count > 1 ? 's' : ''}` }))} format={money} /> : <p className="small muted">Aucun achat avec prix sur la période.</p>}
            </ChartCard>
          </div>
          <div className="dash-cell">
            <ChartCard title="Produits les plus coûteux" subtitle="Total payé sur la période" testid="top-products" table={<BreakdownTable rows={top.map((t) => ({ id: t.productId, label: t.name, totalCents: t.totalCents, count: t.count, color: null }))} money={money} />}>
              {top.length ? <RankedBars data={top.map((t) => ({ key: t.productId ?? t.name, label: t.name, value: t.totalCents, sub: `${t.count} achat${t.count > 1 ? 's' : ''}` }))} format={money} /> : <p className="small muted">Aucun achat avec prix sur la période.</p>}
            </ChartCard>
          </div>
          <div className="dash-cell">
            <PriceTracker purchases={all} />
          </div>
        </div>
      )}

      {list.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 20 }}>Achats · {RANGE_LABELS[preset].toLowerCase()} · {list.length}</div>
          <div className="card pad-0" data-testid="purchase-list">
            {days.map((d) => (
              <div key={d}>
                <div className="day-head">{formatShortDate(d)}</div>
                {visible.filter((p) => p.date === d).map((p) => (
                  <button key={p.id} className="list-row" onClick={() => canWrite && setEdit(p)} disabled={!canWrite} data-testid="purchase-row">
                    <span className="meta">
                      <span className="title" style={{ display: 'block' }}>{p.name} <span className="num subtle small">· {formatQty(p.quantity, p.unit)}</span></span>
                      <span className="sub">
                        {store(p.storeId)?.name ?? 'Magasin non précisé'} · {members.get(p.userId)?.name ?? 'Ancien membre'}
                        {p.receiptId ? ' · ticket' : p.shoppingItemId ? ' · courses' : ''}
                        {p.discountCents ? ` · remise ${money(p.discountCents)}` : ''}
                      </span>
                    </span>
                    <span className="num small">{p.totalCents != null ? money(p.totalCents) : <span className="subtle">prix inconnu</span>}</span>
                    {canWrite && <Pencil size={15} className="subtle" />}
                  </button>
                ))}
              </div>
            ))}
            {list.length > shown && <button className="list-row" onClick={() => setShown((n) => n + 100)} data-testid="more-purchases"><span className="meta small strong">Afficher plus ({list.length - shown} autres)</span></button>}
          </div>
        </>
      )}
      <p className="xsmall subtle" style={{ marginTop: 14 }}><Receipt size={12} style={{ verticalAlign: '-2px' }} /> Un achat sans prix reste « prix inconnu » : il n'est jamais estimé dans les dépenses passées.</p>
      <PurchaseSheet purchase={edit} open={!!edit || creating} onClose={() => { setEdit(null); setCreating(false); }} />
    </>
  );
}

function BreakdownTable({ rows, money }: { rows: { id: string | null; label: string; totalCents: number; count: number }[]; money: (c: number) => string }) {
  const sum = rows.reduce((s, r) => s + r.totalCents, 0);
  return (
    <table className="viz-table">
      <thead><tr><th>Nom</th><th className="n">Montant</th><th className="n">Part</th><th className="n">Achats</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id ?? r.label}><td>{r.label}</td><td className="n">{money(r.totalCents)}</td><td className="n">{sum ? Math.round((r.totalCents / sum) * 100) : 0} %</td><td className="n">{r.count}</td></tr>)}</tbody>
    </table>
  );
}
