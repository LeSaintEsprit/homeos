import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarRange, Check, ChevronDown, Info, Leaf, ListPlus, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  WASTE_REASON_LABELS, addDays, dataGaps, expiryOverview, formatMoney, formatQty, newId, runOutTimeline, wasteStats, weekLabel,
  type HouseholdForecast, type Lot, type LotEntry, type Movement, type Recommendation, type Urgency,
} from '@homeos/shared';
import { useCatalog, useForecast, useHousehold, useToday } from '../../../lib/hooks';
import { useCan, useRun, useView } from '../../../lib/sync/react';
import { formatShortDate } from '../../../lib/format';
import { EmptyState, Segmented } from '../../../ui/Controls';
import { ConfidenceBadge, ExpiryBadge, PriceHint } from '../../../ui/Reliability';
import { StockActionSheet, type StockAction } from '../inventory/ActionSheets';
import { PageHead } from '../Shell';

const GROUPS: { urgency: Urgency; title: string; hint: string }[] = [
  { urgency: 'now', title: 'À acheter maintenant', hint: 'Épuisé, sous le seuil ou rupture imminente.' },
  { urgency: 'soon', title: 'Avant les prochaines courses', hint: 'Rupture prévue avant la fin de votre cycle de courses.' },
  { urgency: 'planned', title: 'Achats habituels à prévoir', hint: 'D’après la régularité de vos achats.' },
];

function RecoCard({ r }: { r: Recommendation }) {
  const view = useView();
  const run = useRun();
  const forecast = useForecast();
  const { currency } = useHousehold();
  const canShop = useCan('shopping.write');
  const [open, setOpen] = useState(false);
  const ins = forecast.byId.get(r.productId)!;
  const p = ins.product;
  const add = () =>
    run('shopping.add', { itemId: newId(), productId: p.id, name: p.name, quantity: r.displayQty, unit: r.displayUnit, source: 'recommendation', priority: r.urgency === 'now' ? 'high' : 'normal' }, { success: `« ${p.name} » ajouté à la liste` });
  return (
    <div className="reco" data-testid="reco">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <Link to={`/inventaire/${p.id}`} className="strong" style={{ color: 'inherit' }}>{p.name}</Link>
          <div className="small" style={{ marginTop: 2 }}>{r.explanation}</div>
          <div className="row wrap" style={{ ['--gap' as string]: '6px', marginTop: 8 }}>
            <ConfidenceBadge c={r.confidence} />
            {r.dueDate && r.urgency !== 'now' && <span className="badge"><CalendarRange size={12} /> d'ici le {formatShortDate(r.dueDate)}</span>}
            <PriceHint price={r.price} cents={r.estCostCents} currency={currency} />
          </div>
        </div>
        {canShop && <button className="btn sm" onClick={() => void add()} aria-label={`Ajouter ${p.name} à la liste`}><Plus size={16} /></button>}
      </div>
      <button className="why" onClick={() => setOpen(!open)} aria-expanded={open}>
        Pourquoi ? <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && (
        <div className="xsmall muted stack" style={{ ['--gap' as string]: '4px' }}>
          <span>{r.detail}</span>
          <span>Stock utilisable : {ins.quality.approx ? '≈ ' : ''}{formatQty(ins.usable, p.unit)} — {ins.quality.label.toLowerCase()}.</span>
          {r.price && <span>Prix : estimation {r.price.basis}.</span>}
          {view.product.get(p.id) && <Link to={`/inventaire/${p.id}`}>Voir la fiche du produit</Link>}
        </div>
      )}
    </div>
  );
}

function ToPlanTab({ forecast }: { forecast: HouseholdForecast }) {
  const run = useRun();
  const { settings, currency } = useHousehold();
  const canShop = useCan('shopping.write');
  const [showAllGaps, setShowAllGaps] = useState(false);
  const recos = forecast.recommendations;
  const covered = forecast.insights.filter((i) => i.coveredByList).length;
  const gaps = useMemo(() => dataGaps(forecast, settings), [forecast, settings]);
  const est = recos.reduce((s, r) => s + (r.estCostCents ?? 0), 0);
  const unknown = recos.filter((r) => r.estCostCents == null).length;
  const addAll = async (list: Recommendation[]) => {
    for (const r of list) {
      const p = forecast.byId.get(r.productId)!.product;
      await run('shopping.add', { itemId: newId(), productId: p.id, name: p.name, quantity: r.displayQty, unit: r.displayUnit, source: 'recommendation', priority: r.urgency === 'now' ? 'high' : 'normal' });
    }
  };
  return (
    <>
      <div className="card summary-card">
        {recos.length ? (
          <>
            <div className="row spread wrap">
              <div>
                <div className="strong" style={{ fontSize: 'var(--fs-lg)' }} data-testid="reco-count">{recos.length} produit{recos.length > 1 ? 's' : ''} à prévoir</div>
                <div className="small muted">
                  {est > 0 ? <>Coût estimé ≈ <span className="num">{formatMoney(est, currency)}</span></> : 'Coût inconnu'}
                  {unknown > 0 && est > 0 && <> · {unknown} sans prix connu</>}
                  {covered > 0 && <> · {covered} déjà couvert{covered > 1 ? 's' : ''} par la liste</>}
                </div>
              </div>
              {canShop && <button className="btn primary" onClick={() => void addAll(recos)} data-testid="reco-add-all"><ListPlus size={18} /> Tout ajouter à la liste</button>}
            </div>
          </>
        ) : (
          <div className="row">
            <Check size={22} color="var(--success)" />
            <div>
              <div className="strong">Rien à prévoir pour le moment</div>
              <div className="small muted">{covered > 0 ? `${covered} produit(s) déjà couvert(s) par la liste de courses.` : 'Vos stocks couvrent les besoins connus.'}</div>
            </div>
          </div>
        )}
      </div>
      {GROUPS.map((g) => {
        const list = recos.filter((r) => r.urgency === g.urgency);
        if (!list.length) return null;
        return (
          <section key={g.urgency}>
            <div className="row spread" style={{ alignItems: 'flex-end' }}>
              <div className="section-title">{g.title} · {list.length}</div>
              {canShop && list.length > 1 && <button className="btn ghost sm" onClick={() => void addAll(list)}>Tout ajouter</button>}
            </div>
            <div className="card pad-0">{list.map((r) => <RecoCard key={r.productId} r={r} />)}</div>
          </section>
        );
      })}
      <div className="section-title" style={{ marginTop: 24 }}>Pour des prévisions plus justes</div>
      {gaps.length === 0 ? (
        <div className="card small muted">Toutes les données nécessaires sont présentes : les prévisions reposent sur vos seuils et votre consommation observée.</div>
      ) : (
        <div className="card pad-0" data-testid="data-gaps">
          {(showAllGaps ? gaps : gaps.slice(0, 6)).map((g) => (
            <Link key={g.insight.product.id} to={`/inventaire/${g.insight.product.id}`} className="list-row" style={{ textDecoration: 'none' }}>
              <span className="meta">
                <span className="title" style={{ display: 'block' }}>{g.insight.product.name}</span>
                <span className="sub">{g.message}</span>
              </span>
              <Info size={18} className="subtle" />
            </Link>
          ))}
          {gaps.length > 6 && !showAllGaps && <button className="list-row" onClick={() => setShowAllGaps(true)}><span className="meta small strong">Voir les {gaps.length} produits</span></button>}
        </div>
      )}
      <p className="xsmall subtle" style={{ marginTop: 12 }}>
        Les prévisions sont calculées sur cet appareil à partir de vos stocks, de vos consommations enregistrées (les plus récentes comptent davantage, les périodes de rupture sont exclues) et de vos seuils. Sans données suffisantes, aucune consommation n'est supposée.
      </p>
    </>
  );
}

function CalendarTab({ forecast }: { forecast: HouseholdForecast }) {
  const today = useToday();
  const weeks = useMemo(() => runOutTimeline(forecast, today, 42), [forecast, today]);
  if (!weeks.length) {
    return (
      <EmptyState icon={<CalendarRange size={28} />} title="Aucune rupture prévue sur 6 semaines">
        Le calendrier se remplit à mesure que les consommations sont enregistrées : il faut quelques semaines d'historique pour prévoir une rupture avec confiance. Les produits sans historique ne sont jamais extrapolés.
      </EmptyState>
    );
  }
  return (
    <>
      {weeks.map((w) => (
        <section key={w.week}>
          <div className="section-title">{weekLabel(w.week, today)}</div>
          <div className="card pad-0">
            {w.events.map((e) => (
              <Link key={e.productId} to={`/inventaire/${e.productId}`} className="list-row" style={{ textDecoration: 'none' }} data-testid="timeline-event">
                <span className="date-chip">
                  <span>{new Date(`${e.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short' })}</span>
                  <strong className="num">{Number(e.date.slice(8))}</strong>
                </span>
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>{e.name}</span>
                  <span className="sub">
                    {e.kind === 'runout' ? (e.inDays === 0 ? 'Rupture prévue aujourd’hui' : `Rupture prévue dans ${e.inDays} j`) : 'Achat habituel attendu'}
                    {e.onList && ' · déjà dans la liste'}
                  </span>
                </span>
                <ConfidenceBadge c={e.confidence} />
              </Link>
            ))}
          </div>
        </section>
      ))}
      <p className="xsmall subtle" style={{ marginTop: 12 }}>Dates estimées au rythme de consommation actuel ; elles se mettent à jour à chaque mouvement.</p>
    </>
  );
}

function LotLine({ e, onAction }: { e: LotEntry; onAction: (a: StockAction, e: LotEntry) => void }) {
  const canWrite = useCan('stock.write');
  const { location } = useCatalog();
  const p = e.insight.product;
  const loc = location(e.lot.lot.locationId ?? p.locationId);
  return (
    <div className="list-row lot-line" data-testid="expiry-lot">
      <span className="meta">
        <Link to={`/inventaire/${p.id}`} className="title" style={{ display: 'block', color: 'inherit' }}>{p.name}</Link>
        <span className="sub">
          <span className="num">{e.lot.lot.qtyApprox ? '≈ ' : ''}{formatQty(e.lot.lot.quantity, p.unit)}</span>
          {loc && ` · ${loc.name}`}
          {e.lot.atRiskQty > 0 && <span style={{ color: 'var(--danger)', fontWeight: 700 }}> · ≈ {formatQty(e.lot.atRiskQty, p.unit)} risquent d'être jetés</span>}
        </span>
        <span className="row wrap" style={{ ['--gap' as string]: '6px', marginTop: 6 }}>
          <ExpiryBadge li={e.lot} />
          {e.lot.status === 'expired' && e.lot.lot.expiryKind === 'ddm' && <span className="xsmall muted">souvent encore consommable : vérifiez l'aspect et l'odeur</span>}
        </span>
      </span>
      {canWrite && (
        <span className="stack" style={{ ['--gap' as string]: '6px' }}>
          <button className="btn sm" onClick={() => onAction('consume', e)}>Consommer</button>
          <button className="btn ghost sm" onClick={() => onAction('waste', e)} aria-label={`Jeter ${p.name}`}><Trash2 size={15} /> Jeter</button>
        </span>
      )}
    </div>
  );
}

function ExpiryTab({ forecast }: { forecast: HouseholdForecast }) {
  const view = useView();
  const { settings } = useHousehold();
  const o = useMemo(() => expiryOverview(forecast), [forecast]);
  const [act, setAct] = useState<{ a: StockAction; e: LotEntry } | null>(null);
  const onAction = (a: StockAction, e: LotEntry) => setAct({ a, e });
  // Un lot ouvert déjà listé par date n'est pas répété dans « ouverts ».
  const shown = new Set([...o.expired, ...o.today, ...o.urgent, ...o.soon].map((e) => e.lot.lot.id));
  const sections: { key: string; title: ReactNode; list: LotEntry[]; hint?: string }[] = [
    { key: 'expired', title: 'Date dépassée', list: o.expired, hint: 'À vérifier : une DLC dépassée ne se consomme plus ; une DDM dépassée est souvent encore bonne.' },
    { key: 'today', title: "Aujourd'hui", list: o.today },
    { key: 'urgent', title: `Dans les ${settings.expiryUrgentDays} prochains jours`, list: o.urgent },
    { key: 'soon', title: `D'ici ${settings.expirySoonDays} jours`, list: o.soon },
    { key: 'atRisk', title: 'Risque de gaspillage', list: o.atRisk, hint: 'Au rythme où ces produits sont consommés, une partie risque d’être jetée : à cuisiner ou partager en priorité.' },
    { key: 'opened', title: 'Autres produits ouverts', list: o.opened.filter((e) => !shown.has(e.lot.lot.id)), hint: 'À finir avant la date calculée avec la durée de conservation après ouverture.' },
  ];
  const total = o.expired.length + o.today.length + o.urgent.length + o.soon.length;
  const urgentCount = o.expired.length + o.today.length + o.urgent.length;
  const lotsOf = (pid: string) => ([...view.lot.values()] as Lot[]).filter((l) => l.productId === pid && l.quantity > 0);
  return (
    <>
      <div className="card summary-card">
        <div className="row">
          <Leaf size={22} color="var(--success)" />
          <div>
            <div className="strong" style={{ fontSize: 'var(--fs-lg)' }} data-testid="expiry-count">
              {total ? `${total} lot${total > 1 ? 's' : ''} à consommer bientôt` : 'Aucune date proche'}
              {urgentCount > 0 && urgentCount < total && <span className="small" style={{ color: 'var(--danger)' }}> · dont {urgentCount} en urgence</span>}
            </div>
            <div className="small muted">Consommez d'abord les dates les plus proches : HOMEOS les propose en premier à chaque consommation.</div>
          </div>
        </div>
      </div>
      {sections.map((s) =>
        s.list.length ? (
          <section key={s.key} data-testid={`expiry-${s.key}`}>
            <div className="section-title">{s.title} · {s.list.length}</div>
            {s.hint && <div className="xsmall muted" style={{ margin: '-4px 4px 8px' }}>{s.hint}</div>}
            <div className="card pad-0">{s.list.map((e) => <LotLine key={`${s.key}-${e.lot.lot.id}`} e={e} onAction={onAction} />)}</div>
          </section>
        ) : null,
      )}
      {o.forgotten.length > 0 && (
        <section data-testid="expiry-forgotten">
          <div className="section-title">Peut-être oubliés · {o.forgotten.length}</div>
          <div className="xsmall muted" style={{ margin: '-4px 4px 8px' }}>En stock mais sans aucun mouvement depuis longtemps : sont-ils toujours là ?</div>
          <div className="card pad-0">
            {o.forgotten.map((i) => (
              <Link key={i.product.id} to={`/inventaire/${i.product.id}`} className="list-row" style={{ textDecoration: 'none' }}>
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>{i.product.name}</span>
                  <span className="sub">{formatQty(i.usable, i.product.unit)} · dernier mouvement le {formatShortDate(i.lastMovementAt!)}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {o.undated.length > 0 && (
        <section>
          <div className="section-title">Sans date · {o.undated.length}</div>
          <div className="xsmall muted" style={{ margin: '-4px 4px 8px' }}>Produits habituellement datés dont un lot n'a pas de date : ajoutez-la depuis la fiche pour être prévenu.</div>
          <div className="card pad-0">{o.undated.map((e) => <LotLine key={`u-${e.lot.lot.id}`} e={e} onAction={onAction} />)}</div>
        </section>
      )}
      {!total && !o.atRisk.length && !o.opened.length && !o.forgotten.length && (
        <EmptyState icon={<Leaf size={28} />} title="Rien ne presse">Les produits proches de leur date apparaîtront ici, du plus urgent au moins urgent.</EmptyState>
      )}
      {act && (
        <StockActionSheet action={act.a} product={act.e.insight.product} lots={lotsOf(act.e.insight.product.id)} lot={act.e.lot.lot} onClose={() => setAct(null)} />
      )}
    </>
  );
}

const PERIODS = { '30': 30, '90': 90, '365': 365 } as const;

function WasteTab({ forecast }: { forecast: HouseholdForecast }) {
  const view = useView();
  const today = useToday();
  const { currency, settings } = useHousehold();
  const [period, setPeriod] = useState<keyof typeof PERIODS>('30');
  const from = addDays(today, -PERIODS[period]);
  const stats = useMemo(
    () => wasteStats([...view.movement.values()] as Movement[], view.lot as Map<string, Lot>, from),
    [view.movement, view.lot, from],
  );
  const o = useMemo(() => expiryOverview(forecast), [forecast]);
  // Valeur des lots à consommer dans le délai « bientôt » (prix connus uniquement).
  const soonLots = [...o.today, ...o.urgent, ...o.soon];
  const soonValue = soonLots.reduce((s, e) => s + (e.lot.lot.unitPriceCents != null ? Math.round(e.lot.lot.unitPriceCents * e.lot.lot.quantity) : 0), 0);
  const soonUnpriced = soonLots.filter((e) => e.lot.lot.unitPriceCents == null).length;
  const reasons = Object.entries(stats.byReason).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <Segmented label="Période" value={period} onChange={setPeriod} options={[{ value: '30', label: '30 jours' }, { value: '90', label: '3 mois' }, { value: '365', label: '12 mois' }]} />
      <div className="stat-grid" style={{ marginTop: 12 }}>
        <div className="stat"><span className="stat-label">Pertes</span><strong className="num" data-testid="waste-count">{stats.count}</strong></div>
        <div className="stat"><span className="stat-label">Valeur jetée</span><strong className="num">{stats.count ? formatMoney(stats.valueCents, currency) : '—'}</strong></div>
        <div className="stat"><span className="stat-label">À sauver ({settings.expirySoonDays} j)</span><strong className="num">{soonLots.length ? formatMoney(soonValue, currency) : '—'}</strong></div>
      </div>
      <div className="xsmall subtle" style={{ marginTop: 6 }}>
        Valeurs calculées avec les prix réellement payés{stats.unvaluedCount ? ` ; ${stats.unvaluedCount} perte(s) sans prix connu non valorisée(s)` : ''}{soonUnpriced ? ` ; ${soonUnpriced} lot(s) à sauver sans prix connu` : ''}.
      </div>
      {stats.count === 0 ? (
        <EmptyState icon={<Leaf size={28} />} title="Aucune perte enregistrée">Utilisez « Jeter » sur un produit pour suivre ce qui est gaspillé et pourquoi.</EmptyState>
      ) : (
        <div className="grid-2" style={{ marginTop: 8 }}>
          <section>
            <div className="section-title">Produits les plus jetés</div>
            <div className="card pad-0" data-testid="waste-products">
              {stats.byProduct.slice(0, 10).map((r) => {
                const p = forecast.byId.get(r.productId)?.product ?? view.product.get(r.productId);
                return (
                  <div key={r.productId} className="list-row">
                    <span className="meta">
                      <span className="title" style={{ display: 'block' }}>{p?.name ?? 'Produit supprimé'}</span>
                      <span className="sub">{r.count} fois · {p ? formatQty(r.qty, p.unit) : r.qty}</span>
                    </span>
                    <span className="num small">{r.valueCents ? formatMoney(r.valueCents, currency) : <span className="subtle">prix inconnu</span>}</span>
                  </div>
                );
              })}
            </div>
          </section>
          <section>
            <div className="section-title">Motifs</div>
            <div className="card stack" style={{ ['--gap' as string]: '10px' }}>
              {reasons.map(([k, n]) => (
                <div key={k}>
                  <div className="row spread small"><span>{WASTE_REASON_LABELS[k as keyof typeof WASTE_REASON_LABELS] ?? k}</span><strong className="num">{n}</strong></div>
                  <div className="bar"><span style={{ width: `${Math.round((n / stats.count) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

type Tab = 'a-prevoir' | 'calendrier' | 'peremption' | 'gaspillage';

export function ForecastPage() {
  const [params, setParams] = useSearchParams();
  const forecast = useForecast();
  const tab = (params.get('vue') as Tab) || 'a-prevoir';
  const o = useMemo(() => expiryOverview(forecast), [forecast]);
  const urgentExpiry = o.expired.length + o.today.length + o.urgent.length;
  const now = forecast.recommendations.filter((r) => r.urgency === 'now').length;
  return (
    <>
      <PageHead title="Prévisions" eyebrow={<><Sparkles size={13} style={{ verticalAlign: '-2px' }} /> Ce que votre maison doit prévoir</>} />
      <div className="tabs-scroll">
        <Segmented
          label="Vue"
          value={tab}
          onChange={(t) => setParams(t === 'a-prevoir' ? {} : { vue: t })}
          options={[
            { value: 'a-prevoir', label: <>À prévoir{now ? <span className="count-dot">{now}</span> : null}</> },
            { value: 'calendrier', label: 'Calendrier' },
            { value: 'peremption', label: <>Péremption{urgentExpiry ? <span className="count-dot">{urgentExpiry}</span> : null}</> },
            { value: 'gaspillage', label: 'Pertes' },
          ]}
        />
      </div>
      <div style={{ marginTop: 12 }}>
        {tab === 'a-prevoir' && <ToPlanTab forecast={forecast} />}
        {tab === 'calendrier' && <CalendarTab forecast={forecast} />}
        {tab === 'peremption' && <ExpiryTab forecast={forecast} />}
        {tab === 'gaspillage' && <WasteTab forecast={forecast} />}
      </div>
    </>
  );
}
