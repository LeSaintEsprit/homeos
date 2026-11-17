import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Home, KeyRound, MailCheck, ShieldAlert, Users } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@homeos/shared';
import { errorMessage, get, post } from '../../lib/api';
import { applyMe, refreshMe, session, setActiveHousehold, type Me } from '../../lib/session';
import { useObservable } from '../../lib/store';
import { Logo } from '../../ui/Logo';
import { TextField } from '../../ui/Field';
import { HouseholdAvatar } from '../../ui/Avatar';
import { Spinner } from '../../ui/Controls';

export function AuthLayout({ children, tagline = 'La maison sous contrôle, en famille.' }: { children: ReactNode; tagline?: string }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo size={48} className="logo" />
          <div>
            <div className="word">HOMEOS</div>
            <div className="tag">{tagline}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 'var(--sp-6)' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function PasswordField({ value, onChange, label = 'Mot de passe', autoComplete = 'current-password', hint }: { value: string; onChange: (v: string) => void; label?: string; autoComplete?: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor="pw">{label}</label>
      <div className="input-group">
        <input id="pw" className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required minLength={autoComplete === 'new-password' ? 8 : undefined} />
        <button type="button" className="btn ghost icon sm suffix" onClick={() => setShow(!show)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      <ShieldAlert size={18} />
      <span>{error}</span>
    </div>
  );
}

function afterLogin(me: Me, navigate: (to: string) => void, redirect?: string | null, joined?: string | null) {
  applyMe(me);
  if (joined) setActiveHousehold(joined);
  if (redirect && redirect.startsWith('/')) navigate(redirect);
  else navigate(me.households.length ? '/' : '/bienvenue');
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      afterLogin(await post<Me>('/api/auth/login', { email, password }), navigate, params.get('redirect'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit}>
        <div>
          <h1 style={{ fontSize: 'var(--fs-xl)' }}>Connexion</h1>
          <p className="muted small">Retrouvez les stocks et la liste de courses de votre foyer.</p>
        </div>
        <ErrorBox error={error} />
        <TextField label="Adresse e-mail" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <PasswordField value={password} onChange={setPassword} />
        <button className="btn primary lg block" disabled={busy}>
          {busy ? <Spinner /> : <>Se connecter <ArrowRight size={18} /></>}
        </button>
        <div className="row spread small">
          <Link to="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
          <Link to={`/inscription${params.get('redirect')?.startsWith('/invitation/') ? `?code=${params.get('redirect')!.split('/').pop()}` : ''}`}>Créer un compte</Link>
        </div>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [cfg, setCfg] = useState<{ firstRun: boolean; registration: string } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ firstRun: boolean; registration: string }>('/api/auth/config').then(setCfg).catch(() => setCfg({ firstRun: false, registration: 'invite' }));
  }, []);
  const codeRequired = !!cfg && !cfg.firstRun && cfg.registration === 'invite';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<Me & { joinedHouseholdId: string | null }>('/api/auth/register', { name, email, password, inviteCode: code.trim() || undefined });
      afterLogin(r, navigate, null, r.joinedHouseholdId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout tagline={cfg?.firstRun ? 'Bienvenue ! Créez le premier compte de ce serveur.' : undefined}>
      <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit}>
        <div>
          <h1 style={{ fontSize: 'var(--fs-xl)' }}>Créer un compte</h1>
          <p className="muted small">Un compte personnel par membre de la famille : chaque action est ainsi attribuée à la bonne personne.</p>
        </div>
        {cfg?.firstRun && (
          <div className="alert info">
            <KeyRound size={18} />
            <span>Premier compte du serveur : vous en deviendrez l'administrateur (sauvegardes, invitations d'autres familles).</span>
          </div>
        )}
        <ErrorBox error={error} />
        <TextField label="Prénom ou nom" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        <TextField label="Adresse e-mail" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <PasswordField value={password} onChange={setPassword} label="Mot de passe" autoComplete="new-password" hint="Au moins 8 caractères." />
        {!cfg?.firstRun && (
          <TextField
            label={codeRequired ? "Code d'invitation" : "Code d'invitation (facultatif)"}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDE-FGHJK"
            autoComplete="off"
            required={codeRequired}
            hint="Reçu d'un membre de votre foyer, ou pour créer le vôtre."
          />
        )}
        <button className="btn primary lg block" disabled={busy || !cfg}>
          {busy ? <Spinner /> : <>Créer mon compte <ArrowRight size={18} /></>}
        </button>
        <div className="small center">
          Déjà inscrit ? <Link to="/connexion">Se connecter</Link>
        </div>
      </form>
    </AuthLayout>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'email' | 'admin' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMode((await post<{ mode: 'email' | 'admin' }>('/api/auth/forgot', { email })).mode);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      {mode ? (
        <div className="stack" style={{ ['--gap' as string]: '16px' }}>
          <div className="empty-icon" style={{ width: 56, height: 56, borderRadius: 18, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}>
            <MailCheck size={28} />
          </div>
          {mode === 'email' ? (
            <>
              <h1 style={{ fontSize: 'var(--fs-xl)' }}>Vérifiez vos e-mails</h1>
              <p className="muted">Si un compte existe pour <strong>{email}</strong>, un lien de réinitialisation vient d'être envoyé. Il est valable 24 heures et ne fonctionne qu'une fois.</p>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 'var(--fs-xl)' }}>Demandez un lien à l'administrateur</h1>
              <p className="muted">Ce serveur n'envoie pas d'e-mails. Demandez à la personne qui héberge HOMEOS de générer pour vous un <strong>lien de réinitialisation à usage unique</strong> (Paramètres → Administration du serveur).</p>
            </>
          )}
          <Link className="btn block" to="/connexion">Retour à la connexion</Link>
        </div>
      ) : (
        <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit}>
          <h1 style={{ fontSize: 'var(--fs-xl)' }}>Mot de passe oublié</h1>
          <ErrorBox error={error} />
          <TextField label="Adresse e-mail du compte" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="btn primary lg block" disabled={busy}>{busy ? <Spinner /> : 'Continuer'}</button>
          <Link className="small center" to="/connexion">Retour à la connexion</Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ email: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ email: string }>(`/api/auth/reset/${token}`).then(setInfo).catch(() => setInvalid(true));
  }, [token]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      afterLogin(await post<Me>('/api/auth/reset', { token, password }), navigate);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      {invalid ? (
        <div className="stack">
          <h1 style={{ fontSize: 'var(--fs-xl)' }}>Lien invalide</h1>
          <p className="muted">Ce lien de réinitialisation est expiré ou a déjà été utilisé. Demandez-en un nouveau.</p>
          <Link className="btn block" to="/mot-de-passe-oublie">Nouvelle demande</Link>
        </div>
      ) : !info ? (
        <div className="center"><Spinner /></div>
      ) : (
        <form className="stack" style={{ ['--gap' as string]: '16px' }} onSubmit={submit}>
          <h1 style={{ fontSize: 'var(--fs-xl)' }}>Nouveau mot de passe</h1>
          <p className="muted small">Compte : <strong>{info.email}</strong>. Vos autres appareils seront déconnectés.</p>
          <ErrorBox error={error} />
          <PasswordField value={password} onChange={setPassword} label="Nouveau mot de passe" autoComplete="new-password" hint="Au moins 8 caractères." />
          <button className="btn primary lg block" disabled={busy}>{busy ? <Spinner /> : 'Enregistrer et me connecter'}</button>
        </form>
      )}
    </AuthLayout>
  );
}

interface Preview {
  kind: 'household' | 'platform';
  householdName?: string;
  householdAvatar?: string | null;
  inviterName: string | null;
  role?: Role;
  restrictedEmail?: boolean;
  expiresAt: string;
}

export function InvitationPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const s = useObservable(session);
  const [p, setP] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<Preview>(`/api/invitations/${encodeURIComponent(code)}`).then(setP).catch((e) => setError(errorMessage(e)));
  }, [code]);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ householdId: string }>(`/api/invitations/${encodeURIComponent(code)}/accept`);
      await refreshMe();
      setActiveHousehold(r.householdId);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const loggedIn = s.status === 'ready';
  const already = p?.kind === 'household' && s.me?.households.some((h) => h.name === p.householdName);
  return (
    <AuthLayout tagline="Invitation">
      {error && !p ? (
        <div className="stack">
          <ErrorBox error={error} />
          <Link className="btn block" to="/">Retour</Link>
        </div>
      ) : !p ? (
        <div className="center"><Spinner /></div>
      ) : (
        <div className="stack" style={{ ['--gap' as string]: '18px' }}>
          {p.kind === 'household' ? (
            <div className="row">
              <HouseholdAvatar avatar={p.householdAvatar} size={56} />
              <div>
                <div className="small muted">{p.inviterName ?? 'Un membre'} vous invite à rejoindre</div>
                <h1 style={{ fontSize: 'var(--fs-xl)' }}>{p.householdName}</h1>
                <span className="badge primary">{ROLE_LABELS[p.role!]}</span>
              </div>
            </div>
          ) : (
            <div className="row">
              <div className="option-card" style={{ border: 0, padding: 0 }}>
                <div className="oc-icon"><Home size={22} /></div>
                <div>
                  <h1 style={{ fontSize: 'var(--fs-xl)' }}>Créez votre foyer</h1>
                  <div className="muted small">{p.inviterName ?? 'Quelqu’un'} vous invite à utiliser HOMEOS pour votre propre maison.</div>
                </div>
              </div>
            </div>
          )}
          <ErrorBox error={error} />
          {p.restrictedEmail && <div className="alert info"><Users size={18} /><span>Cette invitation est réservée à l'adresse e-mail à laquelle elle a été envoyée.</span></div>}
          {loggedIn && p.kind === 'household' ? (
            <button className="btn primary lg block" onClick={accept} disabled={busy || !!already}>
              {busy ? <Spinner /> : already ? 'Vous êtes déjà membre' : `Rejoindre « ${p.householdName} »`}
            </button>
          ) : loggedIn ? (
            <Link className="btn primary lg block" to="/foyers/nouveau">Créer mon foyer</Link>
          ) : (
            <>
              <Link className="btn primary lg block" to={`/inscription?code=${encodeURIComponent(code)}`}>Créer mon compte</Link>
              {p.kind === 'household' && (
                <Link className="btn block" to={`/connexion?redirect=${encodeURIComponent(`/invitation/${code}`)}`}>J'ai déjà un compte</Link>
              )}
            </>
          )}
          <div className="xsmall subtle center">Invitation valable jusqu'au {new Date(p.expiresAt).toLocaleDateString('fr-FR')}.</div>
        </div>
      )}
    </AuthLayout>
  );
}
