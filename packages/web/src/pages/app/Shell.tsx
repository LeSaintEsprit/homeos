import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Check, ChevronDown, CloudOff, House, KeyRound, LineChart, Package, Plus, RefreshCw, ScanLine, Settings, ShoppingCart, Users, CloudCheck, CloudUpload,
} from 'lucide-react';
import { ROLE_LABELS } from '@homeos/shared';
import { activeHousehold, session, setActiveHousehold, type SessionState } from '../../lib/session';
import { useObservable } from '../../lib/store';
import { useEngine, useSync } from '../../lib/sync/react';
import { relativeTime } from '../../lib/format';
import { HouseholdAvatar } from '../../ui/Avatar';
import { Logo } from '../../ui/Logo';
import { Sheet } from '../../ui/Sheet';

const NAV = [
  { to: '/', label: 'Accueil', icon: House, end: true },
  { to: '/inventaire', label: 'Inventaire', icon: Package },
  { to: '/courses', label: 'Courses', icon: ShoppingCart },
  { to: '/previsions', label: 'Prévisions', icon: LineChart },
  { to: '/famille', label: 'Famille', icon: Users },
];

export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const st = useSync();
  const engine = useEngine();
  const [open, setOpen] = useState(false);
  const cls = st.status === 'synced' ? 'ok' : st.status === 'offline' ? 'offline' : st.status === 'error' || st.issues.length ? 'error' : st.status === 'loading' ? '' : 'pending';
  const label =
    st.status === 'offline'
      ? `Hors ligne${st.pending ? ` · ${st.pending}` : ''}`
      : st.status === 'syncing' || st.status === 'loading'
        ? 'Synchronisation'
        : st.pending
          ? `${st.pending} en attente`
          : st.issues.length
            ? `${st.issues.length} à vérifier`
            : 'Synchronisé';
  const Icon = st.status === 'offline' ? CloudOff : st.status === 'syncing' || st.status === 'loading' ? RefreshCw : st.pending ? CloudUpload : st.issues.length ? AlertTriangle : CloudCheck;
  return (
    <>
      <button className={`sync-pill ${cls}`} onClick={() => setOpen(true)} aria-label={`État de la synchronisation : ${label}`} data-testid="sync-pill" data-status={st.status}>
        <Icon size={15} className={st.status === 'syncing' ? 'busy' : undefined} />
        {!compact && <span>{label}</span>}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Synchronisation"
        footer={<button className="btn primary" onClick={() => void engine.sync()}><RefreshCw size={16} /> Synchroniser maintenant</button>}
      >
        <div className="card flat" style={{ padding: 16 }}>
          <div className="row spread"><span className="muted">État</span><strong>{label}</strong></div>
          <div className="row spread"><span className="muted">Modifications en attente d'envoi</span><strong className="num">{st.pending}</strong></div>
          <div className="row spread"><span className="muted">Dernière synchronisation</span><strong>{st.lastSyncAt ? relativeTime(st.lastSyncAt) : 'jamais'}</strong></div>
        </div>
        <p className="small muted">
          Vos actions sont enregistrées sur cet appareil immédiatement, puis envoyées au serveur. Une modification n'est considérée comme synchronisée
          qu'après la confirmation du serveur — même hors connexion, rien n'est perdu.
        </p>
        {st.issues.length > 0 && (
          <div className="stack">
            <div className="section-title" style={{ margin: 0 }}>À vérifier</div>
            {st.issues.map((i) => (
              <div key={i.opId} className="alert warning" style={{ alignItems: 'center' }}>
                <AlertTriangle size={18} />
                <span className="grow">
                  {i.message}
                  {i.conflicts.map((c) => (
                    <span key={c.field} className="xsmall" style={{ display: 'block', fontWeight: 600 }}>
                      {c.label} : votre valeur « {String(c.mine)} », valeur actuelle « {String(c.theirs)} ».
                    </span>
                  ))}
                </span>
                <button className="btn sm" onClick={() => void engine.dismissIssue(i.opId)}>OK</button>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </>
  );
}

export function HouseholdSwitcher({ s }: { s: SessionState }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const engine = useEngine();
  const view = useSync().view;
  const ref = activeHousehold(s);
  if (!ref || !s.me) return null;
  // Nom et avatar issus des données synchronisées : à jour hors ligne et en temps réel.
  const synced = view.household.get(ref.id);
  const active = { ...ref, name: synced?.name ?? ref.name, avatar: synced?.avatar ?? ref.avatar };
  const pick = async (id: string) => {
    setOpen(false);
    if (id === active.id) return;
    await engine.drain();
    setActiveHousehold(id);
    navigate('/');
  };
  return (
    <>
      <button className="hh-switch" onClick={() => setOpen(true)} aria-label={`Foyer actif : ${active.name}. Changer de foyer`} data-testid="household-switcher">
        <HouseholdAvatar avatar={active.avatar} size={36} />
        <span style={{ minWidth: 0 }}>
          <span className="hh-label" style={{ display: 'block' }}>Foyer</span>
          <span className="hh-name" style={{ display: 'block' }} data-testid="active-household">{active.name}</span>
        </span>
        <ChevronDown size={18} className="subtle" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Mes foyers">
        <div className="card pad-0 flat">
          <div className="list">
            {s.me.households.map((h) => (
              <button key={h.id} className="list-row" onClick={() => void pick(h.id)}>
                <HouseholdAvatar avatar={h.avatar} size={40} />
                <span className="meta">
                  <span className="title" style={{ display: 'block' }}>{h.name}</span>
                  <span className="sub">{ROLE_LABELS[h.role]}</span>
                </span>
                {h.id === active.id && <Check size={20} color="var(--primary)" />}
              </button>
            ))}
          </div>
        </div>
        <div className="grid-2">
          <button className="btn" onClick={() => { setOpen(false); navigate('/foyers/nouveau'); }}><Plus size={18} /> Créer un foyer</button>
          <button className="btn" onClick={() => { setOpen(false); navigate('/foyers/rejoindre'); }}><KeyRound size={18} /> Rejoindre un foyer</button>
        </div>
        <p className="xsmall subtle">Chaque foyer est totalement séparé : stocks, listes et notifications ne se mélangent jamais.</p>
      </Sheet>
    </>
  );
}

export function Shell() {
  const s = useObservable(session);
  const navigate = useNavigate();
  return (
    <div className="app">
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="brand"><Logo size={34} /> HOMEOS</div>
        <button className="btn primary block scan-btn" onClick={() => navigate('/scanner')}><ScanLine size={19} /> Scanner</button>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <n.icon size={20} /> {n.label}
          </NavLink>
        ))}
        <NavLink to="/parametres" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><Settings size={20} /> Paramètres</NavLink>
        <div className="side-foot">
          <SyncIndicator />
          <div className="xsmall subtle" style={{ padding: '0 6px' }}>{s.me?.user.name} · {s.me?.user.email}</div>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <HouseholdSwitcher s={s} />
          <div className="grow" />
          <div className="mobile-only"><SyncIndicator compact /></div>
          <NavLink to="/parametres" className="btn ghost icon mobile-only" aria-label="Paramètres"><Settings size={21} /></NavLink>
        </header>
        {s.offline && (
          <div className="alert warning" style={{ borderRadius: 0 }}>
            <CloudOff size={18} />
            <span>Serveur injoignable : vous travaillez sur les données de cet appareil. Tout sera synchronisé au retour de la connexion.</span>
          </div>
        )}
        <main className="main" id="contenu">
          <Outlet />
        </main>
      </div>
      <nav className="tabbar" aria-label="Navigation">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <span className="tab-icon"><n.icon size={21} /></span>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <button className="fab" onClick={() => navigate('/scanner')} aria-label="Scanner un produit"><ScanLine size={26} /></button>
    </div>
  );
}

export function PageHead({ title, eyebrow, actions }: { title: ReactNode; eyebrow?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
