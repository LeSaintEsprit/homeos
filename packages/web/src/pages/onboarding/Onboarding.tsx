import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Bell, CalendarClock, Home, KeyRound, LogOut, Sparkles } from 'lucide-react';
import { CURRENCIES, HOUSEHOLD_AVATARS } from '@homeos/shared';
import { errorMessage, post } from '../../lib/api';
import { applyMe, logout, refreshMe, session, setActiveHousehold, type Me } from '../../lib/session';
import { useObservable } from '../../lib/store';
import { AuthLayout } from '../auth/AuthPages';
import { TextField, Field } from '../../ui/Field';
import { Segmented, Spinner } from '../../ui/Controls';

export function WelcomePage() {
  const s = useObservable(session);
  const navigate = useNavigate();
  return (
    <AuthLayout tagline={`Bienvenue, ${s.me?.user.name ?? ''}`}>
      <div className="stack" style={{ ['--gap' as string]: '14px' }}>
        <div>
          <h1 style={{ fontSize: 'var(--fs-xl)' }}>Votre foyer</h1>
          <p className="muted small">Un foyer regroupe les stocks, la liste de courses et les dépenses d'une maison. Chaque foyer est privé.</p>
        </div>
        <button className="option-card" onClick={() => navigate('/foyers/nouveau')}>
          <span className="oc-icon"><Home size={22} /></span>
          <span>
            <span className="strong">Créer un nouveau foyer</span>
            <br />
            <span className="small muted">Vous en serez l'administrateur et pourrez inviter votre famille.</span>
          </span>
        </button>
        <button className="option-card" onClick={() => navigate('/foyers/rejoindre')}>
          <span className="oc-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><KeyRound size={22} /></span>
          <span>
            <span className="strong">Rejoindre un foyer existant</span>
            <br />
            <span className="small muted">Avec le code ou le lien d'invitation reçu d'un membre.</span>
          </span>
        </button>
        <button className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={() => void logout()}>
          <LogOut size={16} /> Se déconnecter
        </button>
      </div>
    </AuthLayout>
  );
}

export function JoinHouseholdPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ householdId: string }>(`/api/invitations/${encodeURIComponent(code.trim())}/accept`);
      await refreshMe();
      setActiveHousehold(r.householdId);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout tagline="Rejoindre un foyer">
      <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit}>
        <h1 style={{ fontSize: 'var(--fs-xl)' }}>Code d'invitation</h1>
        {error && <div className="alert error">{error}</div>}
        <TextField label="Code reçu" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCDE-FGHJK" autoComplete="off" required style={{ letterSpacing: '0.1em', fontWeight: 700 }} />
        <button className="btn primary lg block" disabled={busy}>{busy ? <Spinner /> : 'Rejoindre'}</button>
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={() => navigate(-1)}>Retour</button>
      </form>
    </AuthLayout>
  );
}

const INTERVALS = [
  { value: '3', label: '2 × / sem.' },
  { value: '7', label: 'Chaque semaine' },
  { value: '14', label: 'Tous les 15 j' },
];

export function CreateHouseholdPage() {
  const navigate = useNavigate();
  const s = useObservable(session);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('🏡');
  const [currency, setCurrency] = useState('EUR');
  const [interval, setInterval] = useState('7');
  const [budget, setBudget] = useState('');
  const [digest, setDigest] = useState<'daily' | 'weekly' | 'off'>('daily');
  const [hour, setHour] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const budgetCents = budget.trim() ? Math.round(Number(budget.replace(',', '.')) * 100) : null;
      if (budgetCents != null && !(budgetCents >= 0)) throw new Error('Budget invalide.');
      const r = await post<Me & { id: string }>('/api/households', {
        name,
        avatar,
        currency,
        timezone: tz,
        settings: { shoppingIntervalDays: Number(interval), monthlyBudgetCents: budgetCents },
        notifications: { digest, digestHour: hour },
      });
      applyMe({ user: r.user, households: r.households });
      setActiveHousehold(r.id);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const steps = [
    <div className="stack" style={{ ['--gap' as string]: '16px' }} key="name">
      <TextField label="Nom du foyer" value={name} onChange={(e) => setName(e.target.value)} placeholder="Maison familiale" autoFocus required maxLength={80} />
      <Field label="Avatar">
        <div className="choice-grid">
          {HOUSEHOLD_AVATARS.map((a) => (
            <button type="button" key={a} className="choice" aria-pressed={a === avatar} onClick={() => setAvatar(a)} aria-label={`Avatar ${a}`}>
              {a}
            </button>
          ))}
        </div>
      </Field>
    </div>,
    <div className="stack" style={{ ['--gap' as string]: '18px' }} key="habits">
      <Field label={<span className="row" style={{ ['--gap' as string]: '6px' }}><CalendarClock size={16} /> Fréquence des courses</span>} hint="Sert à anticiper ce qu'il faudra acheter d'ici les prochaines courses.">
        <Segmented label="Fréquence des courses" value={interval} options={INTERVALS} onChange={setInterval} />
      </Field>
      <TextField label="Budget mensuel des courses (facultatif)" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Ex. 600" hint="Vous pourrez le modifier à tout moment." />
      <Field label="Devise">
        <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </Field>
    </div>,
    <div className="stack" style={{ ['--gap' as string]: '18px' }} key="notif">
      <Field label={<span className="row" style={{ ['--gap' as string]: '6px' }}><Bell size={16} /> Récapitulatif</span>} hint="Un seul message regroupant l'essentiel, plutôt qu'une multitude d'alertes.">
        <Segmented label="Récapitulatif" value={digest} onChange={setDigest} options={[{ value: 'daily', label: 'Quotidien' }, { value: 'weekly', label: 'Hebdomadaire' }, { value: 'off', label: 'Aucun' }]} />
      </Field>
      {digest !== 'off' && (
        <Field label="Heure d'envoi">
          <select className="select" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')} h 00</option>
            ))}
          </select>
        </Field>
      )}
      <div className="alert info">
        <Sparkles size={18} />
        <span>Fuseau horaire détecté : {tz}. Les catégories et emplacements de base (frigo, placards, cellier…) sont créés automatiquement.</span>
      </div>
    </div>,
  ];
  const titles = ['Votre foyer', 'Vos habitudes', 'Vos notifications'];
  const canNext = step > 0 || name.trim().length > 0;

  return (
    <AuthLayout tagline={`Étape ${step + 1} sur 3`}>
      <form
        className="stack"
        style={{ ['--gap' as string]: '20px' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 2) setStep(step + 1);
          else void create();
        }}
      >
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }} aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ height: 4, flex: 1, borderRadius: 4, background: i <= step ? 'var(--primary)' : 'var(--surface-3)', transition: 'background 240ms' }} />
            ))}
          </div>
          <h1 style={{ fontSize: 'var(--fs-xl)' }}>{titles[step]}</h1>
          {step === 0 && <p className="muted small">Vous en serez l'administrateur{s.me ? `, ${s.me.user.name}` : ''}.</p>}
        </div>
        {error && <div className="alert error">{error}</div>}
        {steps[step]}
        <div className="row">
          {step > 0 ? (
            <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={18} /> Retour</button>
          ) : (
            <button type="button" className="btn ghost" onClick={() => navigate(s.me?.households.length ? '/' : '/bienvenue')}>Annuler</button>
          )}
          <button className="btn primary grow" disabled={!canNext || busy}>
            {busy ? <Spinner /> : step < 2 ? <>Continuer <ArrowRight size={18} /></> : 'Créer mon foyer'}
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
