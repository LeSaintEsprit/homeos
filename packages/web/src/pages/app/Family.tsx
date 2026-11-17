import { useEffect, useMemo, useState } from 'react';
import { Copy, Mail, QrCode, Share2, ShieldCheck, Trash2, UserPlus, Users, LogOut, History, Home } from 'lucide-react';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, can, type Member, type Role } from '@homeos/shared';
import { del, errorMessage, get, patch, post } from '../../lib/api';
import { activeHousehold, refreshMe, session } from '../../lib/session';
import { useObservable } from '../../lib/store';
import { useSync, useView } from '../../lib/sync/react';
import { toast } from '../../lib/toast';
import { relativeTime } from '../../lib/format';
import { Avatar } from '../../ui/Avatar';
import { Sheet } from '../../ui/Sheet';
import { Field, TextField } from '../../ui/Field';
import { EmptyState, Segmented, Spinner } from '../../ui/Controls';
import { useConfirm } from '../../ui/Confirm';
import { PageHead } from './Shell';

interface Invitation {
  id: string;
  code: string;
  role: Role;
  email: string | null;
  expiresAt: string;
  maxUses: number;
  uses: number;
}

interface CreatedInvite {
  invitation: Invitation;
  link: string;
  emailSent?: boolean;
  mailto?: string | null;
  shareText: string;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copié dans le presse-papiers');
  } catch {
    toast('Copie impossible : sélectionnez le texte manuellement.', 'warning');
  }
}

function QrImage({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import('qrcode').then((q) => q.toDataURL(text, { margin: 1, width: 360, color: { dark: '#17201b', light: '#ffffff' } })).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [text]);
  return src ? <img src={src} alt="QR code de l'invitation" width={180} height={180} style={{ borderRadius: 12, alignSelf: 'center' }} /> : <div className="skeleton" style={{ width: 180, height: 180, alignSelf: 'center' }} />;
}

export function ShareInvite({ created, onDone, title }: { created: CreatedInvite; onDone: () => void; title: string }) {
  const [qr, setQr] = useState(false);
  const canShare = typeof navigator.share === 'function';
  return (
    <div className="stack" style={{ ['--gap' as string]: '14px' }}>
      <p className="muted small">{title}</p>
      <div className="code-box" data-testid="invite-code">{created.invitation.code}</div>
      {created.emailSent && <div className="alert success"><Mail size={18} /><span>Invitation envoyée par e-mail.</span></div>}
      {qr && <QrImage text={created.link} />}
      <div className="grid-2">
        <button className="btn" onClick={() => void copy(created.link)}><Copy size={17} /> Copier le lien</button>
        {canShare ? (
          <button className="btn" onClick={() => void navigator.share({ title: 'Invitation HOMEOS', text: created.shareText, url: created.link }).catch(() => {})}><Share2 size={17} /> Partager</button>
        ) : (
          <button className="btn" onClick={() => void copy(created.shareText)}><Copy size={17} /> Copier le message</button>
        )}
        <button className="btn" onClick={() => setQr(!qr)}><QrCode size={17} /> {qr ? 'Masquer le QR code' : 'QR code'}</button>
        {created.mailto && !created.emailSent && (
          <a className="btn" href={created.mailto}><Mail size={17} /> Envoyer par e-mail</a>
        )}
      </div>
      <div className="xsmall subtle">Valable jusqu'au {new Date(created.invitation.expiresAt).toLocaleDateString('fr-FR')} · {created.invitation.maxUses} utilisation{created.invitation.maxUses > 1 ? 's' : ''}.</div>
      <button className="btn primary block" onClick={onDone}>Terminé</button>
    </div>
  );
}

function InviteSheet({ open, onClose, hid, onCreated }: { open: boolean; onClose: () => void; hid: string; onCreated: () => void }) {
  const [role, setRole] = useState<Role>('member');
  const [days, setDays] = useState(7);
  const [uses, setUses] = useState(1);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setCreated(null);
    setEmail('');
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<CreatedInvite>(`/api/households/${hid}/invitations`, { role, days, maxUses: uses, email: email.trim() || undefined });
      setCreated(r);
      onCreated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={close} title={created ? 'Invitation prête' : 'Inviter un membre'}>
      {created ? (
        <ShareInvite created={created} onDone={close} title="Transmettez ce code ou ce lien. La personne crée son compte (ou se connecte) et rejoint votre foyer immédiatement." />
      ) : (
        <>
          {error && <div className="alert error">{error}</div>}
          <Field label="Rôle">
            <div className="stack" style={{ ['--gap' as string]: '8px' }}>
              {(['admin', 'member', 'viewer'] as Role[]).map((r) => (
                <button type="button" key={r} className="option-card" aria-pressed={role === r} onClick={() => setRole(r)} style={{ padding: 12 }}>
                  <span>
                    <span className="strong">{ROLE_LABELS[r]}</span>
                    <br />
                    <span className="xsmall muted">{ROLE_DESCRIPTIONS[r]}</span>
                  </span>
                </button>
              ))}
            </div>
          </Field>
          <TextField label="Adresse e-mail (facultatif)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="Si renseignée, seule cette adresse pourra utiliser l'invitation." />
          <div className="grid-2">
            <Field label="Validité">
              <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} jour{d > 1 ? 's' : ''}</option>)}
              </select>
            </Field>
            <Field label="Utilisations">
              <select className="select" value={uses} onChange={(e) => setUses(Number(e.target.value))} disabled={!!email.trim()}>
                {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
          </div>
          <button className="btn primary lg block" onClick={() => void submit()} disabled={busy}>{busy ? <Spinner /> : 'Créer l’invitation'}</button>
        </>
      )}
    </Sheet>
  );
}

function PlatformInviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      setCreated(await post<CreatedInvite>('/api/platform-invitations', { days: 14, maxUses: 1 }));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setCreated(null);
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title="Inviter une autre famille">
      {created ? (
        <ShareInvite created={created} onDone={close} title="Cette personne pourra créer son compte et SON propre foyer, totalement séparé du vôtre." />
      ) : (
        <>
          <p className="muted">
            Proposez HOMEOS à un proche (votre sœur, des amis…) : il créera son propre foyer, avec ses propres stocks et sa propre liste. Vous n'aurez
            <strong> aucun accès</strong> à ses données, et lui aucun aux vôtres.
          </p>
          <div className="alert info"><ShieldCheck size={18} /><span>La personne qui héberge le serveur HOMEOS peut techniquement accéder à la base de données. Informez-en les familles que vous invitez.</span></div>
          <button className="btn primary lg block" onClick={() => void create()} disabled={busy}>{busy ? <Spinner /> : 'Créer une invitation (14 jours, 1 utilisation)'}</button>
        </>
      )}
    </Sheet>
  );
}

export function FamilyPage() {
  const s = useObservable(session);
  const view = useView();
  const sync = useSync();
  const hh = activeHousehold(s)!;
  const isAdmin = can(sync.role, 'members.manage');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [tab, setTab] = useState<'membres' | 'journal'>('membres');
  const { ask, node } = useConfirm();

  const members = useMemo(() => [...view.member.values()].filter((m) => m.active).sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : 1)), [view.member]);
  const names = useMemo(() => new Map([...view.member.values()].map((m) => [m.userId, m])), [view.member]);
  const activities = useMemo(() => [...view.activity.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 80), [view.activity]);

  const loadInvites = () => {
    if (!isAdmin) return;
    get<{ invitations: Invitation[] }>(`/api/households/${hh.id}/invitations`).then((r) => setInvitations(r.invitations)).catch(() => setInvitations([]));
  };
  useEffect(loadInvites, [hh.id, isAdmin]);

  const changeRole = async (m: Member, role: Role) => {
    try {
      await patch(`/api/households/${hh.id}/members/${m.userId}`, { role });
      toast(`${m.name} est maintenant ${ROLE_LABELS[role].toLowerCase()}`);
      setEditing(null);
      await refreshMe();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const remove = async (m: Member) => {
    const self = m.userId === s.me?.user.id;
    if (!(await ask(self ? 'Quitter le foyer ?' : `Retirer ${m.name} ?`, self ? `Vous n'aurez plus accès à « ${hh.name} ». Ses données seront supprimées de cet appareil.` : `${m.name} perdra immédiatement l'accès à « ${hh.name} ». Son historique est conservé.`, self ? 'Quitter' : 'Retirer', true))) return;
    try {
      await del(`/api/households/${hh.id}/members/${m.userId}`);
      setEditing(null);
      toast(self ? 'Vous avez quitté le foyer' : `${m.name} a été retiré du foyer`);
      await refreshMe();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const revoke = async (i: Invitation) => {
    await del(`/api/households/${hh.id}/invitations/${i.id}`).catch((e) => toast(errorMessage(e), 'error'));
    loadInvites();
  };

  return (
    <>
      <PageHead
        eyebrow={hh.name}
        title="Famille"
        actions={isAdmin && <button className="btn primary" onClick={() => setInviteOpen(true)}><UserPlus size={18} /> Inviter</button>}
      />
      <Segmented label="Vue" value={tab} onChange={setTab} options={[{ value: 'membres', label: 'Membres' }, { value: 'journal', label: 'Journal' }]} />
      {tab === 'membres' ? (
        <>
          <div className="section-title">{members.length} membre{members.length > 1 ? 's' : ''}</div>
          <div className="card pad-0">
            <div className="list">
              {members.map((m) => (
                <button key={m.id} className="list-row" onClick={() => setEditing(m)} data-testid="member-row">
                  <Avatar name={m.name} color={m.color} size={42} />
                  <span className="meta">
                    <span className="title" style={{ display: 'block' }}>{m.name}{m.userId === s.me?.user.id ? ' (vous)' : ''}</span>
                    <span className="sub">{m.email}</span>
                  </span>
                  <span className={`badge ${m.role === 'admin' ? 'primary' : m.role === 'viewer' ? '' : 'info'}`}>{ROLE_LABELS[m.role]}</span>
                </button>
              ))}
            </div>
          </div>
          {isAdmin && (
            <>
              <div className="section-title">Invitations en cours</div>
              {invitations === null ? (
                <div className="skeleton" style={{ height: 60 }} />
              ) : invitations.length === 0 ? (
                <div className="card flat small muted">Aucune invitation en attente.</div>
              ) : (
                <div className="card pad-0">
                  <div className="list">
                    {invitations.map((i) => (
                      <div key={i.id} className="list-row">
                        <span className="meta">
                          <span className="title num" style={{ display: 'block', letterSpacing: '0.06em' }}>{i.code}</span>
                          <span className="sub">{ROLE_LABELS[i.role]}{i.email ? ` · ${i.email}` : ''} · expire {relativeTime(i.expiresAt)}</span>
                        </span>
                        <button className="btn ghost icon sm" aria-label="Copier le lien" onClick={() => void copy(`${location.origin}/invitation/${i.code}`)}><Copy size={17} /></button>
                        <button className="btn ghost icon sm" aria-label="Révoquer" onClick={() => void revoke(i)}><Trash2 size={17} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="section-title">Autres familles</div>
              <div className="card row" style={{ alignItems: 'flex-start' }}>
                <div className="oc-icon" style={{ width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent)', flex: 'none' }}><Home size={22} /></div>
                <div className="grow">
                  <div className="strong">Partager HOMEOS avec une autre famille</div>
                  <div className="small muted">Elle aura son propre foyer, totalement séparé du vôtre.</div>
                </div>
                <button className="btn sm" onClick={() => setPlatformOpen(true)}>Inviter</button>
              </div>
            </>
          )}
          {!isAdmin && (
            <button className="btn danger-soft" style={{ marginTop: 24 }} onClick={() => void remove(members.find((m) => m.userId === s.me?.user.id)!)}><LogOut size={17} /> Quitter ce foyer</button>
          )}
        </>
      ) : activities.length === 0 ? (
        <EmptyState icon={<History size={28} />} title="Aucune activité">Les actions de chaque membre apparaîtront ici : qui a fait quoi, et quand.</EmptyState>
      ) : (
        <div className="card pad-0" style={{ marginTop: 16 }}>
          <div className="list" data-testid="activity-journal">
            {activities.map((a) => {
              const m = names.get(a.userId);
              return (
                <div key={a.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <Avatar name={m?.name ?? '?'} color={m?.color} size={32} />
                  <span className="meta">
                    <span><strong>{m?.name ?? 'Ancien membre'}</strong> {a.summary}</span>
                    <span className="sub" style={{ display: 'block' }}>{relativeTime(a.at)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} hid={hh.id} onCreated={loadInvites} />
      <PlatformInviteSheet open={platformOpen} onClose={() => setPlatformOpen(false)} />
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.name}>
        {editing && (
          <>
            <div className="row">
              <Avatar name={editing.name} color={editing.color} size={52} />
              <div>
                <div className="strong">{editing.email}</div>
                <div className="small muted">Membre depuis {relativeTime(editing.joinedAt)}</div>
              </div>
            </div>
            {isAdmin ? (
              <Field label="Rôle">
                <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                  {(['admin', 'member', 'viewer'] as Role[]).map((r) => (
                    <button key={r} className="option-card" aria-pressed={editing.role === r} onClick={() => editing.role !== r && void changeRole(editing, r)} style={{ padding: 12 }}>
                      <span>
                        <span className="strong">{ROLE_LABELS[r]}</span>
                        <br />
                        <span className="xsmall muted">{ROLE_DESCRIPTIONS[r]}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </Field>
            ) : (
              <div className="badge">{ROLE_LABELS[editing.role]}</div>
            )}
            {(isAdmin || editing.userId === s.me?.user.id) && (
              <button className="btn danger-soft" onClick={() => void remove(editing)}>
                {editing.userId === s.me?.user.id ? <><LogOut size={17} /> Quitter le foyer</> : <><Trash2 size={17} /> Retirer du foyer</>}
              </button>
            )}
          </>
        )}
      </Sheet>
      {node}
      <div className="xsmall subtle center" style={{ marginTop: 24 }}><Users size={13} style={{ verticalAlign: '-2px' }} /> Chaque membre a son propre compte ; chaque action lui est attribuée.</div>
    </>
  );
}
