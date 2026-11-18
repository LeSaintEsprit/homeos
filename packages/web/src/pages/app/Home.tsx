import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CalendarClock, Download, Package, PackageX, Plus, ShoppingBasket, ShoppingCart, SlidersHorizontal, Smartphone, Sparkles, TrendingDown, UserPlus, Wallet,
} from 'lucide-react';
import {
  DASHBOARD_WIDGETS, budgetStatus, estimateListCost, expiryOverview, formatMoney, formatQty, isActiveItem, moveWidget, newId, remainingToBuy, resolveDashboard, toggleWidget,
  type Activity, type Product, type Purchase, type ShoppingItem, type WidgetId,
} from '@homeos/shared';
import { useCatalog, useForecast, useHousehold, useMe, useMembers, useToday } from '../../lib/hooks';
import { useCan, useRun, useView } from '../../lib/sync/react';
import { greeting, relativeTime } from '../../lib/format';
import { Avatar } from '../../ui/Avatar';
import { Sheet } from '../../ui/Sheet';
import { Switch } from '../../ui/Controls';
import { ConfidenceBadge, ExpiryBadge } from '../../ui/Reliability';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

export function useInstallPrompt() {
  const [evt, setEvt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return { evt, standalone, ios, clear: () => setEvt(null) };
}

function Widget({ id, title, icon, link, linkLabel, children }: { id: WidgetId; title: string; icon: ReactNode; link?: string; linkLabel?: string; children: ReactNode }) {
  return (
    <section className={`card widget widget-${id} rise`} data-testid={`widget-${id}`}>
      <div className="card-title">
        <h3 className="row" style={{ ['--gap' as string]: '8px' }}>{icon} {title}</h3>
        {link && <Link to={link} className="small strong row" style={{ ['--gap' as string]: '4px' }}>{linkLabel ?? 'Voir'} <ArrowRight size={14} /></Link>}
      </div>
      {children}
    </section>
  );
}

/** Section centrale : ce qu'il faut acheter et ce qu'il faut consommer en priorité. */
function PlanWidget() {
  const forecast = useForecast();
  const run = useRun();
  const canShop = useCan('shopping.write');
  const recos = forecast.recommendations.filter((r) => r.urgency !== 'planned').slice(0, 5);
  const more = forecast.recommendations.length - recos.length;
  const o = useMemo(() => expiryOverview(forecast), [forecast]);
  const toEat = [...o.today, ...o.urgent].length;
  const add = (productId: string) => {
    const r = forecast.recommendations.find((x) => x.productId === productId)!;
    const p = forecast.byId.get(productId)!.product;
    return run('shopping.add', { itemId: newId(), productId, name: p.name, quantity: r.displayQty, unit: r.displayUnit, source: 'recommendation', priority: r.urgency === 'now' ? 'high' : 'normal' }, { success: `« ${p.name} » ajouté à la liste` });
  };
  return (
    <Widget id="prevoir" title="Ce que votre maison doit prévoir" icon={<Sparkles size={19} color="var(--accent)" />} link="/previsions" linkLabel="Prévisions">
      {recos.length === 0 && toEat === 0 ? (
        <p className="small muted" data-testid="plan-empty">Rien d'urgent : les stocks connus couvrent vos besoins jusqu'aux prochaines courses.</p>
      ) : (
        <div className="stack" style={{ ['--gap' as string]: '2px' }}>
          {recos.map((r) => {
            const p = forecast.byId.get(r.productId)!.product;
            return (
              <div key={r.productId} className="plan-line" data-testid="plan-reco">
                <span className={`dot-urgency ${r.urgency}`} aria-hidden />
                <span className="grow small">
                  {r.explanation}
                  <span className="row wrap" style={{ ['--gap' as string]: '6px', marginTop: 4 }}><ConfidenceBadge c={r.confidence} /></span>
                </span>
                {canShop && <button className="btn sm" onClick={() => void add(p.id)} aria-label={`Ajouter ${p.name} à la liste`}><Plus size={15} /></button>}
              </div>
            );
          })}
          {more > 0 && <Link to="/previsions" className="small strong" style={{ padding: '8px 0' }}>+ {more} autre{more > 1 ? 's' : ''} à prévoir</Link>}
          {toEat > 0 && (
            <Link to="/previsions?vue=peremption" className="alert warning" style={{ marginTop: 8, textDecoration: 'none' }}>
              <CalendarClock size={18} /> <span>{toEat} lot{toEat > 1 ? 's' : ''} à consommer aujourd'hui ou dans les prochains jours.</span>
            </Link>
          )}
        </div>
      )}
    </Widget>
  );
}

function Kpi({ to, label, value, tone, testid }: { to: string; label: string; value: number; tone?: string; testid: string }) {
  return (
    <Link to={to} className={`kpi ${tone && value > 0 ? tone : ''}`} data-testid={testid}>
      <strong className="num">{value}</strong>
      <span>{label}</span>
    </Link>
  );
}

function KpiWidget() {
  const forecast = useForecast();
  const view = useView();
  const tracked = forecast.insights.filter((i) => i.status !== 'untracked').length;
  const low = forecast.insights.filter((i) => i.status === 'low').length;
  const out = forecast.insights.filter((i) => i.status === 'out').length;
  const toBuy = ([...view.shoppingItem.values()] as ShoppingItem[]).filter((i) => isActiveItem(i) && remainingToBuy(i) > 0).length;
  const o = expiryOverview(forecast);
  const soon = o.today.length + o.urgent.length + o.soon.length;
  return (
    <Widget id="indicateurs" title="Indicateurs" icon={<Package size={19} />}>
      <div className="kpi-grid">
        <Kpi to="/inventaire" label="produits suivis" value={tracked} testid="kpi-tracked" />
        <Kpi to="/inventaire?filtre=faibles" label="stocks faibles" value={low} tone="warning" testid="kpi-low" />
        <Kpi to="/inventaire?filtre=epuises" label="épuisés" value={out} tone="danger" testid="kpi-out" />
        <Kpi to="/courses" label="à acheter" value={toBuy} tone="info" testid="kpi-tobuy" />
        <Kpi to="/previsions?vue=peremption" label="bientôt périmés" value={soon} tone="warning" testid="kpi-expiring" />
      </div>
    </Widget>
  );
}

function ListWidget() {
  const view = useView();
  const navigate = useNavigate();
  const { currency } = useHousehold();
  const items = useMemo(() => ([...view.shoppingItem.values()] as ShoppingItem[]).filter((i) => isActiveItem(i) && remainingToBuy(i) > 0), [view.shoppingItem]);
  const products = useMemo(() => new Map([...view.product.values()].map((p) => [p.id, p as Product])), [view.product]);
  const cost = useMemo(() => estimateListCost(items, products, [...view.purchase.values()] as Purchase[]), [items, products, view.purchase]);
  const sorted = [...items].sort((a, b) => ({ urgent: 0, high: 1, normal: 2 })[a.priority] - ({ urgent: 0, high: 1, normal: 2 })[b.priority] || a.name.localeCompare(b.name, 'fr'));
  return (
    <Widget id="liste" title="Liste de courses" icon={<ShoppingCart size={19} />} link="/courses" linkLabel="Ouvrir">
      {items.length === 0 ? (
        <p className="small muted">La liste est vide.</p>
      ) : (
        <>
          <div className="small muted" style={{ marginBottom: 8 }}>
            <strong className="num" style={{ color: 'var(--text)' }}>{items.length}</strong> article{items.length > 1 ? 's' : ''} à acheter
            {cost.estimatedCents + cost.knownCents > 0 && <> · ≈ <span className="num">{formatMoney(cost.estimatedCents + cost.knownCents, currency)}</span></>}
            {cost.unknownCount > 0 && <> · {cost.unknownCount} prix inconnu{cost.unknownCount > 1 ? 's' : ''}</>}
          </div>
          <div className="chips-wrap">
            {sorted.slice(0, 8).map((i) => (
              <span key={i.id} className={`chip static ${i.priority !== 'normal' ? 'prio' : ''}`}>{i.name} <span className="num">{formatQty(remainingToBuy(i), i.unit)}</span></span>
            ))}
            {items.length > 8 && <span className="chip static">+ {items.length - 8}</span>}
          </div>
          <button className="btn primary block" style={{ marginTop: 12 }} onClick={() => navigate('/courses/magasin')}><ShoppingBasket size={18} /> Mode courses</button>
        </>
      )}
    </Widget>
  );
}

function ExpiryWidget() {
  const forecast = useForecast();
  const o = useMemo(() => expiryOverview(forecast), [forecast]);
  const list = [...o.expired, ...o.today, ...o.urgent, ...o.soon].slice(0, 5);
  return (
    <Widget id="peremption" title="À consommer en priorité" icon={<CalendarClock size={19} />} link="/previsions?vue=peremption">
      {list.length === 0 ? (
        <p className="small muted">Aucune date proche.</p>
      ) : (
        <div className="stack" style={{ ['--gap' as string]: '8px' }}>
          {list.map((e) => (
            <Link key={e.lot.lot.id} to={`/inventaire/${e.insight.product.id}`} className="row spread" style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className="small"><strong>{e.insight.product.name}</strong> <span className="num subtle">· {formatQty(e.lot.lot.quantity, e.insight.product.unit)}</span></span>
              <ExpiryBadge li={e.lot} />
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}

function SpendWidget() {
  const view = useView();
  const today = useToday();
  const { currency, settings } = useHousehold();
  const b = useMemo(() => budgetStatus([...view.purchase.values()] as Purchase[], today, settings.monthlyBudgetCents), [view.purchase, today, settings.monthlyBudgetCents]);
  const pct = b.ratio != null ? Math.min(100, Math.round(b.ratio * 100)) : null;
  const over = b.budgetCents != null && b.projectedCents != null && b.projectedCents > b.budgetCents;
  return (
    <Widget id="depenses" title="Dépenses du mois" icon={<Wallet size={19} />} link="/depenses" linkLabel="Détail">
      <div className="row spread" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="num" style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800 }} data-testid="spent">{formatMoney(b.spentCents, currency)}</div>
          <div className="xsmall subtle">prix connus uniquement{b.unpricedCount ? ` · ${b.unpricedCount} achat${b.unpricedCount > 1 ? 's' : ''} sans prix` : ''}</div>
        </div>
        {b.budgetCents != null && <div className="small muted right">sur {formatMoney(b.budgetCents, currency, { round: true })}</div>}
      </div>
      {pct != null && <div className={`bar big ${over ? 'over' : ''}`} style={{ marginTop: 10 }}><span style={{ width: `${pct}%` }} /></div>}
      <div className="small muted" style={{ marginTop: 8 }}>
        {b.spentCents === 0 && b.unpricedCount === 0 ? (
          'Aucun achat enregistré ce mois-ci : la réception des courses alimente ce suivi.'
        ) : b.projectedCents != null ? (
          <span className={over ? 'strong' : ''} style={over ? { color: 'var(--danger)' } : undefined}>
            {over && <AlertTriangle size={14} style={{ verticalAlign: '-2px' }} />} Projection fin de mois ≈ {formatMoney(b.projectedCents, currency, { round: true })} au rythme actuel
          </span>
        ) : (
          'Projection disponible à partir du 5 du mois.'
        )}
        {b.budgetCents == null && <> · <Link to="/parametres">définir un budget</Link></>}
      </div>
    </Widget>
  );
}

function MovesWidget() {
  const view = useView();
  const members = useMembers();
  const acts = useMemo(() => ([...view.activity.values()] as Activity[]).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 6), [view.activity]);
  return (
    <Widget id="mouvements" title="Derniers mouvements" icon={<TrendingDown size={19} />} link="/famille?vue=journal" linkLabel="Journal">
      {acts.length === 0 ? (
        <p className="small muted">Aucune activité pour l'instant.</p>
      ) : (
        <div className="stack" style={{ ['--gap' as string]: '10px' }}>
          {acts.map((a) => {
            const m = members.get(a.userId);
            return (
              <div key={a.id} className="row" style={{ alignItems: 'flex-start' }} data-testid="move-line">
                <Avatar name={m?.name ?? '?'} color={m?.color} size={28} />
                <span className="small grow"><strong>{m?.name ?? 'Ancien membre'}</strong> {a.summary}<span className="xsmall subtle" style={{ display: 'block' }}>{relativeTime(a.at)}</span></span>
              </div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}

const RENDER: Record<WidgetId, () => ReactNode> = {
  prevoir: () => <PlanWidget />,
  indicateurs: () => <KpiWidget />,
  liste: () => <ListWidget />,
  peremption: () => <ExpiryWidget />,
  depenses: () => <SpendWidget />,
  mouvements: () => <MovesWidget />,
};

function CustomizeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const run = useRun();
  const prefs = me?.prefs.dashboard;
  const { order, hidden } = resolveDashboard(prefs);
  const save = (next: typeof prefs) => void run('member.updateSelf', { prefs: { dashboard: next } });
  return (
    <Sheet open={open} onClose={onClose} title="Personnaliser l'accueil" footer={<button className="btn primary" onClick={onClose}>Terminé</button>}>
      <p className="small muted">Choisissez et ordonnez les blocs de votre accueil. Ce réglage vous est propre et suit votre compte sur tous vos appareils, pour ce foyer.</p>
      <div className="card pad-0 flat" data-testid="widget-settings">
        {order.map((id, i) => {
          const w = DASHBOARD_WIDGETS.find((x) => x.id === id)!;
          return (
            <div key={id} className="list-row" style={{ paddingBlock: 10 }}>
              <span className="meta">
                <span className="title" style={{ display: 'block' }}>{w.label}</span>
                <span className="sub">{w.description}</span>
              </span>
              <button className="btn ghost icon sm" onClick={() => save(moveWidget(prefs, id, -1))} disabled={i === 0} aria-label={`Monter ${w.label}`}><ArrowUp size={16} /></button>
              <button className="btn ghost icon sm" onClick={() => save(moveWidget(prefs, id, 1))} disabled={i === order.length - 1} aria-label={`Descendre ${w.label}`}><ArrowDown size={16} /></button>
              <Switch label={`Afficher ${w.label}`} checked={!hidden.includes(id)} onChange={(v) => save(toggleWidget(prefs, id, v))} />
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function Onboarding() {
  const view = useView();
  const install = useInstallPrompt();
  const { categories } = useCatalog();
  const members = [...view.member.values()].filter((m) => m.active);
  const empty = view.product.size === 0;
  if (members.length >= 2 && install.standalone && !empty) return null;
  return (
    <div className="grid-2" style={{ marginTop: 16 }}>
      {empty && (
        <div className="card rise">
          <div className="strong" style={{ marginBottom: 6 }}>Commencez par vos produits</div>
          <p className="small muted" style={{ marginBottom: 14 }}>Scannez les produits de vos placards ou ajoutez-les à la main ({categories.length} catégories prêtes) : les prévisions s'affineront avec l'usage.</p>
          <Link className="btn soft" to="/inventaire/nouveau"><Plus size={18} /> Ajouter un produit</Link>
        </div>
      )}
      {members.length < 2 && (
        <div className="card rise">
          <div className="strong" style={{ marginBottom: 6 }}>Invitez votre famille</div>
          <p className="small muted" style={{ marginBottom: 14 }}>Chacun son compte : tout le monde voit les mêmes stocks et la même liste, et chaque action est attribuée.</p>
          <Link className="btn soft" to="/famille"><UserPlus size={18} /> Inviter un membre</Link>
        </div>
      )}
      {!install.standalone && (
        <div className="card rise">
          <div className="strong" style={{ marginBottom: 6 }}>Installer HOMEOS</div>
          {install.evt ? (
            <>
              <p className="small muted" style={{ marginBottom: 14 }}>Ouvrez HOMEOS comme une application, même sans connexion.</p>
              <button className="btn soft" onClick={() => void install.evt!.prompt().then(install.clear)}><Download size={18} /> Installer</button>
            </>
          ) : install.ios ? (
            <p className="small muted"><Smartphone size={14} style={{ verticalAlign: '-2px' }} /> Sur iPhone : touchez « Partager » puis « Sur l'écran d'accueil ». Indispensable pour recevoir les notifications.</p>
          ) : (
            <p className="small muted">Depuis le menu de votre navigateur, choisissez « Installer l'application ».</p>
          )}
        </div>
      )}
    </div>
  );
}

export function HomePage() {
  const me = useMe();
  const forecast = useForecast();
  const [custom, setCustom] = useState(false);
  const { visible } = resolveDashboard(me?.prefs.dashboard);
  const outCount = forecast.insights.filter((i) => i.status === 'out').length;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>{greeting()}{me ? `, ${me.name.split(' ')[0]}` : ''}</h1>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => setCustom(true)} data-testid="customize" aria-label="Personnaliser l’accueil"><SlidersHorizontal size={18} /><span className="hide-sm">Personnaliser</span></button>
        </div>
      </div>
      {outCount > 0 && !visible.includes('indicateurs') && (
        <Link to="/inventaire?filtre=epuises" className="alert error" style={{ marginBottom: 12, textDecoration: 'none' }}><PackageX size={18} /> {outCount} produit{outCount > 1 ? 's' : ''} épuisé{outCount > 1 ? 's' : ''}</Link>
      )}
      <div className="dashboard">
        {visible.map((id) => <div key={id} className={`dash-cell dash-${id}`}>{RENDER[id]()}</div>)}
      </div>
      {visible.length === 0 && <p className="muted center">Tous les blocs sont masqués. <button className="btn ghost sm" onClick={() => setCustom(true)}>Personnaliser</button></p>}
      <Onboarding />
      <CustomizeSheet open={custom} onClose={() => setCustom(false)} />
    </>
  );
}
