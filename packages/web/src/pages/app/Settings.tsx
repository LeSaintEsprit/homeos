import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bell, Download, KeyRound, LogOut, Moon, Palette, Plus, Server, ShieldCheck, Sun, Trash2, User, Home, Monitor, Link2 } from 'lucide-react';
import {
  CURRENCIES, DEFAULT_NOTIFICATION_PREFS, HOUSEHOLD_AVATARS, NOTIFICATION_KIND_LABELS, ROLE_LABELS, can, type Household, type Member, type NotificationKind,
} from '@homeos/shared';
import { errorMessage, get, patch, post } from '../../lib/api';
import { activeHousehold, logout, refreshMe, session, setActiveHousehold } from '../../lib/session';
import { useObservable } from '../../lib/store';
import { useEngine, useRun, useSync, useView } from '../../lib/sync/react';
import { setTheme, themePref, type ThemePref } from '../../lib/theme';
import { toast } from '../../lib/toast';
import { Field, TextField } from '../../ui/Field';
import { Segmented, Spinner, Switch } from '../../ui/Controls';
import { Sheet } from '../../ui/Sheet';
import { HouseholdAvatar } from '../../ui/Avatar';
import { useConfirm } from '../../ui/Confirm';
import { PageHead } from './Shell';
import { DataSection, ServerBackups } from './settings/DataSection';
import { CatalogSection } from './inventory/CatalogSection';

function Section({ icon, title, children, id }: { icon: ReactNode; title: string; children: ReactNode; id?: string }) {
  return (
    <section className="card" id={id} style={{ marginBottom: 16 }}>
      <div className="card-title">
        <h3 className="row" style={{ ['--gap' as string]: '10px' }}>{icon} {title}</h3>
      </div>
      <div className="stack" style={{ ['--gap' as string]: '14px' }}>{children}</div>
    </section>
  );
}

function ProfileSection() {
  const s = useObservable(session);
  const [name, setName] = useState(s.me!.user.name);
  const [email, setEmail] = useState(s.me!.user.email);
  const [pwOpen, setPwOpen] = useState(false);
  const [emailPw, setEmailPw] = useState('');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const saveName = async () => {
    try {
      await patch('/api/auth/profile', { name });
      await refreshMe();
      toast('Nom mis à jour dans tous vos foyers');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const saveEmail = async () => {
    try {
      await post('/api/auth/email', { email, password: emailPw });
      setEmailPw('');
      await refreshMe();
      toast('Adresse e-mail modifiée');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const savePw = async () => {
    try {
      await post('/api/auth/password', { current: cur, next });
      setPwOpen(false);
      setCur('');
      setNext('');
      toast('Mot de passe modifié. Vos autres appareils ont été déconnectés.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Section icon={<User size={20} />} title="Mon profil">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="grow"><TextField label="Nom affiché" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></div>
        <button className="btn" disabled={!name.trim() || name === s.me!.user.name} onClick={() => void saveName()}>Enregistrer</button>
      </div>
      <TextField label="Adresse e-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {email.trim().toLowerCase() !== s.me!.user.email && (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="grow"><TextField label="Mot de passe actuel (confirmation)" type="password" value={emailPw} onChange={(e) => setEmailPw(e.target.value)} autoComplete="current-password" /></div>
          <button className="btn" disabled={!emailPw} onClick={() => void saveEmail()}>Changer l'e-mail</button>
        </div>
      )}
      <button className="btn" onClick={() => setPwOpen(true)}><KeyRound size={17} /> Changer de mot de passe</button>
      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title="Changer de mot de passe" footer={<button className="btn primary" disabled={next.length < 8} onClick={() => void savePw()}>Enregistrer</button>}>
        <TextField label="Mot de passe actuel" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        <TextField label="Nouveau mot de passe" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" hint="Au moins 8 caractères. Vos autres appareils seront déconnectés." />
      </Sheet>
    </Section>
  );
}

function HouseholdSection() {
  const view = useView();
  const sync = useSync();
  const engine = useEngine();
  const run = useRun();
  const s = useObservable(session);
  const hh = activeHousehold(s)!;
  const h = view.household.get(hh.id) as Household | undefined;
  const isAdmin = can(sync.role, 'household.settings');
  const [form, setForm] = useState<{ name: string; avatar: string; currency: string; interval: string; safety: string; budget: string; soon: string } | null>(null);
  useEffect(() => {
    if (h && !form)
      setForm({
        name: h.name,
        avatar: h.avatar ?? '🏡',
        currency: h.currency,
        interval: String(h.settings.shoppingIntervalDays),
        safety: String(h.settings.safetyDays),
        budget: h.settings.monthlyBudgetCents != null ? String(h.settings.monthlyBudgetCents / 100) : '',
        soon: String(h.settings.expirySoonDays),
      });
  }, [h, form]);
  if (!h || !form) return null;
  const save = async () => {
    const budget = form.budget.trim() ? Math.round(Number(form.budget.replace(',', '.')) * 100) : null;
    const out = await run(
      'household.update',
      {
        patch: {
          name: form.name,
          avatar: form.avatar,
          currency: form.currency as 'EUR',
          settings: { shoppingIntervalDays: Number(form.interval), safetyDays: Number(form.safety), monthlyBudgetCents: budget, expirySoonDays: Number(form.soon) },
        },
        baseVersion: engine.confirmedVersion('household', h.id),
      },
      { success: 'Réglages du foyer enregistrés' },
    );
    if (out.ok) void refreshMe();
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Section icon={<Home size={20} />} title={`Foyer « ${h.name} »`}>
      {!isAdmin && <div className="alert info">Seuls les administrateurs du foyer peuvent modifier ces réglages.</div>}
      <fieldset disabled={!isAdmin} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <TextField label="Nom du foyer" value={form.name} onChange={set('name')} maxLength={80} />
        <Field label="Avatar">
          <div className="choice-grid">
            {HOUSEHOLD_AVATARS.map((a) => (
              <button type="button" key={a} className="choice" aria-pressed={a === form.avatar} onClick={() => setForm({ ...form, avatar: a })}>{a}</button>
            ))}
          </div>
        </Field>
        <div className="grid-2">
          <Field label="Fréquence des courses (jours)" hint="Horizon des prévisions d'achat.">
            <input className="input" type="number" min={1} max={60} value={form.interval} onChange={set('interval')} />
          </Field>
          <Field label="Marge de sécurité (jours)">
            <input className="input" type="number" min={0} max={30} value={form.safety} onChange={set('safety')} />
          </Field>
          <Field label="Budget mensuel">
            <input className="input" inputMode="decimal" value={form.budget} onChange={set('budget')} placeholder="Aucun" />
          </Field>
          <Field label="Alerte « bientôt périmé » (jours)">
            <input className="input" type="number" min={1} max={60} value={form.soon} onChange={set('soon')} />
          </Field>
          <Field label="Devise">
            <select className="select" value={form.currency} onChange={set('currency')}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </Field>
        </div>
        {isAdmin && <button className="btn primary" onClick={() => void save()}>Enregistrer les réglages</button>}
      </fieldset>
    </Section>
  );
}

const KINDS = Object.keys(NOTIFICATION_KIND_LABELS) as NotificationKind[];

function NotificationSection() {
  const view = useView();
  const run = useRun();
  const s = useObservable(session);
  const me = [...view.member.values()].find((m) => m.userId === s.me?.user.id) as Member | undefined;
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(me?.prefs.notifications ?? {}) };
  const [push, setPush] = useState<'unknown' | 'on' | 'off' | 'unsupported' | 'denied'>('unknown');
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setPush('unsupported');
    if (Notification.permission === 'denied') return setPush('denied');
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((sub) => setPush(sub ? 'on' : 'off')).catch(() => setPush('off'));
  }, []);
  const save = (next: Partial<typeof prefs>) => void run('member.updateSelf', { prefs: { notifications: { ...prefs, ...next } } }, { success: 'Préférences enregistrées' });
  const enablePush = async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setPush('denied');
      const { publicKey } = await get<{ publicKey: string }>('/api/push/key');
      const reg = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((publicKey.length + 3) % 4)), (c) => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const j = sub.toJSON();
      await post('/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys });
      setPush('on');
      toast('Notifications activées sur cet appareil');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const disablePush = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
    setPush('off');
  };
  return (
    <Section icon={<Bell size={20} />} title="Mes notifications" id="notifications">
      <div className="row spread">
        <div>
          <div className="strong">Notifications sur cet appareil</div>
          <div className="small muted">
            {push === 'unsupported' ? 'Non prises en charge par ce navigateur (sur iPhone : installez d’abord HOMEOS sur l’écran d’accueil).' : push === 'denied' ? 'Refusées dans les réglages du navigateur.' : 'Récapitulatif et alertes importantes.'}
          </div>
        </div>
        {push === 'on' || push === 'off' ? <Switch label="Notifications push" checked={push === 'on'} onChange={(v) => void (v ? enablePush() : disablePush())} /> : null}
      </div>
      {push === 'on' && (
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => void post<{ sent: number }>('/api/push/test').then((r) => toast(r.sent ? 'Notification de test envoyée : elle doit apparaître dans quelques secondes.' : 'Aucun appareil abonné n’a pu être joint.', r.sent ? 'success' : 'warning')).catch((e) => toast(errorMessage(e), 'error'))} data-testid="push-test">
          <Bell size={15} /> Envoyer une notification de test
        </button>
      )}
      <Field label="Récapitulatif">
        <Segmented label="Récapitulatif" value={prefs.digest} onChange={(v) => save({ digest: v })} options={[{ value: 'daily', label: 'Quotidien' }, { value: 'weekly', label: 'Hebdo (lundi)' }, { value: 'off', label: 'Aucun' }]} />
      </Field>
      {prefs.digest !== 'off' && (
        <Field label="Heure d'envoi">
          <select className="select" value={prefs.digestHour} onChange={(e) => save({ digestHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')} h 00</option>)}
          </select>
        </Field>
      )}
      <div className="row spread">
        <span>Alerte immédiate pour les modifications importantes des autres membres</span>
        <Switch label="Alertes immédiates" checked={prefs.pushImportant} onChange={(v) => save({ pushImportant: v })} />
      </div>
      <div className="section-title" style={{ margin: '8px 0 0' }}>Types d'alertes</div>
      {KINDS.map((k) => (
        <div key={k} className="row spread">
          <span>{NOTIFICATION_KIND_LABELS[k]}</span>
          <Switch label={NOTIFICATION_KIND_LABELS[k]} checked={!prefs.muted.includes(k)} onChange={(v) => save({ muted: v ? prefs.muted.filter((x) => x !== k) : [...prefs.muted, k] })} />
        </div>
      ))}
    </Section>
  );
}

function HouseholdsSection() {
  const s = useObservable(session);
  const navigate = useNavigate();
  return (
    <Section icon={<Home size={20} />} title="Mes foyers">
      <div className="card pad-0 flat">
        <div className="list">
          {s.me!.households.map((h) => (
            <button key={h.id} className="list-row" onClick={() => { setActiveHousehold(h.id); navigate('/'); }}>
              <HouseholdAvatar avatar={h.avatar} size={36} />
              <span className="meta"><span className="title" style={{ display: 'block' }}>{h.name}</span><span className="sub">{ROLE_LABELS[h.role]}</span></span>
              {h.id === s.activeId && <span className="badge primary">Actif</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <button className="btn" onClick={() => navigate('/foyers/nouveau')}><Plus size={17} /> Créer un foyer</button>
        <button className="btn" onClick={() => navigate('/foyers/rejoindre')}><KeyRound size={17} /> Rejoindre un foyer</button>
      </div>
    </Section>
  );
}

function AccountSection() {
  const [plan, setPlan] = useState<{ soleHouseholds: { name: string }[]; blocking: { name: string }[] } | null>(null);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async () => setPlan(await get('/api/auth/account/deletion-plan'));
  const remove = async () => {
    setBusy(true);
    try {
      await post('/api/auth/account/delete', { password: pw, confirm, deleteSoleHouseholds: true });
      await logout();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={<ShieldCheck size={20} />} title="Mes données personnelles">
      <p className="small muted" data-testid="hosting-notice" style={{ margin: '0 0 10px' }}>
        Vos données sont enregistrées sur vos appareils et sur le serveur de la personne qui héberge HOMEOS ; chaque foyer y est strictement séparé des autres.
        Comme pour tout service sans chiffrement de bout en bout, <strong>l'hébergeur peut techniquement accéder à la base de données</strong>.
        Rien n'est transmis à des tiers, sauf les codes-barres inconnus (recherche de la fiche produit sur Open Food Facts) et les notifications, chiffrées, via le service de votre navigateur.
      </p>
      <a className="btn" href="/api/auth/personal-data" download><Download size={17} /> Télécharger mes données personnelles</a>
      <button className="btn danger-soft" onClick={() => void open()}><Trash2 size={17} /> Supprimer mon compte</button>
      <Sheet open={!!plan} onClose={() => setPlan(null)} title="Supprimer mon compte">
        {plan && plan.blocking.length > 0 ? (
          <div className="alert warning">Nommez d'abord un autre administrateur dans : {plan.blocking.map((h) => `« ${h.name} »`).join(', ')}.</div>
        ) : plan ? (
          <>
            <p className="muted">Votre compte sera supprimé. Dans les foyers partagés, votre historique est conservé au nom d'« Ancien membre ».</p>
            {plan.soleHouseholds.length > 0 && <div className="alert error">Ces foyers, dont vous êtes le seul membre, seront supprimés (une sauvegarde est faite avant) : {plan.soleHouseholds.map((h) => `« ${h.name} »`).join(', ')}.</div>}
            <TextField label="Mot de passe" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <TextField label="Tapez SUPPRIMER pour confirmer" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button className="btn danger" disabled={confirm !== 'SUPPRIMER' || !pw || busy} onClick={() => void remove()}>{busy ? <Spinner /> : 'Supprimer définitivement'}</button>
          </>
        ) : null}
      </Sheet>
    </Section>
  );
}

export function ServerAdminSection() {
  const [users, setUsers] = useState<{ id: string; email: string; name: string; households: number; isServerAdmin: boolean }[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const load = () => get<{ users: typeof users }>('/api/admin/users').then((r) => setUsers(r.users)).catch(() => setUsers([]));
  useEffect(() => void load(), []);
  const reset = async (email: string) => {
    try {
      setLink((await post<{ link: string }>('/api/admin/reset-link', { email })).link);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Section icon={<Server size={20} />} title="Administration du serveur">
      <p className="small muted">Vous hébergez cette instance HOMEOS. Les foyers restent isolés les uns des autres ; vous seul gérez les sauvegardes et les comptes.</p>
      <div className="card pad-0 flat">
        <div className="list">
          {(users ?? []).map((u) => (
            <div key={u.id} className="list-row">
              <span className="meta"><span className="title" style={{ display: 'block' }}>{u.name}</span><span className="sub">{u.email} · {u.households} foyer(s){u.isServerAdmin ? ' · administrateur' : ''}</span></span>
              <button className="btn sm" onClick={() => void reset(u.email)}><Link2 size={15} /> Lien mot de passe</button>
            </div>
          ))}
        </div>
      </div>
      <ServerBackups />
      <Sheet open={!!link} onClose={() => setLink(null)} title="Lien de réinitialisation">
        <p className="muted small">Transmettez ce lien à la personne concernée : il est valable 24 heures et ne fonctionne qu'une fois.</p>
        <textarea className="textarea" readOnly value={link ?? ''} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn primary" onClick={() => void navigator.clipboard.writeText(link!).then(() => toast('Lien copié'))}>Copier</button>
      </Sheet>
    </Section>
  );
}

export function SettingsPage() {
  const s = useObservable(session);
  const theme = useObservable(themePref);
  const { ask, node } = useConfirm();
  const sync = useSync();
  const { hash } = useLocation();
  // Lien direct vers une section (ex. depuis le centre de notifications).
  useEffect(() => {
    if (!hash) return;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    return () => clearTimeout(t);
  }, [hash]);
  const doLogout = async () => {
    if (sync.pending && !(await ask('Modifications non envoyées', `${sync.pending} modification(s) n'ont pas encore été envoyées au serveur. Si vous vous déconnectez maintenant, elles seront perdues.`, 'Se déconnecter quand même', true))) return;
    if (!sync.pending && !(await ask('Se déconnecter ?', 'Les données de vos foyers seront retirées de cet appareil (elles restent sur le serveur).', 'Se déconnecter'))) return;
    await logout();
  };
  return (
    <>
      <PageHead title="Paramètres" eyebrow={s.me?.user.email} />
      <ProfileSection />
      <HouseholdSection />
      <CatalogSection />
      <DataSection />
      <NotificationSection />
      <Section icon={<Palette size={20} />} title="Apparence">
        <Segmented<ThemePref>
          label="Thème"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'auto', label: <span className="row" style={{ ['--gap' as string]: '6px' }}><Monitor size={15} /> Auto</span> },
            { value: 'light', label: <span className="row" style={{ ['--gap' as string]: '6px' }}><Sun size={15} /> Clair</span> },
            { value: 'dark', label: <span className="row" style={{ ['--gap' as string]: '6px' }}><Moon size={15} /> Sombre</span> },
          ]}
        />
      </Section>
      <HouseholdsSection />
      <AccountSection />
      {s.me?.user.isServerAdmin && <ServerAdminSection />}
      <button className="btn block" onClick={() => void doLogout()}><LogOut size={18} /> Se déconnecter</button>
      {node}
    </>
  );
}
