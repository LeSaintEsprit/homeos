import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, BellOff, CheckCheck, EyeOff, Info, Settings2 } from 'lucide-react';
import { NOTIFICATION_KIND_LABELS, type Activity, type Alert } from '@homeos/shared';
import { useAlerts, useHousehold, useMe, useMembers, useToday } from '../../lib/hooks';
import { useRun, useView } from '../../lib/sync/react';
import { relativeTime } from '../../lib/format';
import { Avatar } from '../../ui/Avatar';
import { EmptyState, Segmented } from '../../ui/Controls';
import { PageHead } from './Shell';

const SEV_ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info } as const;

function AlertRow({ a, unread, onDismiss }: { a: Alert; unread: boolean; onDismiss: () => void }) {
  const Icon = SEV_ICON[a.severity];
  const inner = (
    <>
      <span className="title strong" style={{ display: 'block' }}>{a.title}</span>
      {a.body && <span className="small muted" style={{ display: 'block' }}>{a.body}</span>}
      <span className="xsmall subtle">{NOTIFICATION_KIND_LABELS[a.kind]}{a.kind === 'important_change' ? ` · ${relativeTime(a.at)}` : ''}</span>
    </>
  );
  return (
    <div className={`alert-row ${unread ? 'unread' : ''}`} data-testid="alert-row" data-kind={a.kind}>
      <span className={`sev ${a.severity}`}><Icon size={18} /></span>
      <span className="body">{a.link ? <Link to={a.link} style={{ textDecoration: 'none' }}>{inner}</Link> : inner}</span>
      <button className="btn ghost icon sm" onClick={onDismiss} aria-label={`Masquer : ${a.title}`} title="Masquer cette alerte"><EyeOff size={17} /></button>
    </div>
  );
}

function AlertsTab() {
  const { visible, all } = useAlerts();
  const me = useMe();
  const run = useRun();
  const today = useToday();
  // Date de lecture précédente, figée à l'ouverture : les nouveautés restent marquées pendant la consultation.
  const readAt = useRef(me?.prefs.notifReadAt);
  useEffect(() => {
    if (!me) return;
    const t = setTimeout(() => void run('member.updateSelf', { prefs: { notifReadAt: new Date().toISOString() } }), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);
  const dismissedCount = Object.keys(me?.prefs.dismissed ?? {}).length;
  const muted = me?.prefs.notifications?.muted ?? [];
  const hiddenByPrefs = all.filter((a) => muted.includes(a.kind)).length;
  const dismiss = (a: Alert) => run('member.updateSelf', { prefs: { dismissed: { [a.key]: today } } }, { success: 'Alerte masquée' });
  const dismissAll = async () => {
    await run('member.updateSelf', { prefs: { dismissed: Object.fromEntries(visible.map((a) => [a.key, today])) } }, { success: `${visible.length} alerte(s) masquée(s)` });
  };
  const groups = [
    { sev: 'critical', title: 'Urgent' },
    { sev: 'warning', title: 'À surveiller' },
    { sev: 'info', title: 'Pour information' },
  ] as const;
  return (
    <>
      {visible.length === 0 ? (
        <EmptyState icon={<CheckCheck size={28} />} title="Tout est en ordre">Aucune alerte pour le moment. Les stocks critiques, les dates proches et les courses à ranger apparaîtront ici.</EmptyState>
      ) : (
        <>
          <div className="row spread" style={{ marginBottom: 4 }}>
            <span className="small muted" data-testid="alert-count">{visible.length} alerte{visible.length > 1 ? 's' : ''}</span>
            <button className="btn ghost sm" onClick={() => void dismissAll()}><EyeOff size={15} /> Tout masquer</button>
          </div>
          {groups.map((g) => {
            const list = visible.filter((a) => a.severity === g.sev);
            if (!list.length) return null;
            return (
              <section key={g.sev}>
                <div className="section-title">{g.title} · {list.length}</div>
                <div className="card pad-0">
                  {list.map((a) => <AlertRow key={a.key} a={a} unread={a.kind === 'important_change' && (!readAt.current || a.at > readAt.current)} onDismiss={() => void dismiss(a)} />)}
                </div>
              </section>
            );
          })}
        </>
      )}
      <div className="stack small muted" style={{ marginTop: 16, ['--gap' as string]: '6px' }}>
        <span>Une alerte masquée réapparaît si la situation change (nouvelle date, nouveau jour pour un stock critique).</span>
        {dismissedCount > 0 && (
          <span>
            {dismissedCount} alerte{dismissedCount > 1 ? 's' : ''} masquée{dismissedCount > 1 ? 's' : ''} ·{' '}
            <button className="btn ghost sm" onClick={() => void run('member.updateSelf', { prefs: { clearDismissed: true } }, { success: 'Alertes masquées réaffichées' })} data-testid="restore-dismissed">Tout réafficher</button>
          </span>
        )}
        {hiddenByPrefs > 0 && <span><BellOff size={13} style={{ verticalAlign: '-2px' }} /> {hiddenByPrefs} alerte{hiddenByPrefs > 1 ? 's' : ''} d'un type désactivé dans vos préférences.</span>}
        <Link to="/parametres#notifications" className="row" style={{ ['--gap' as string]: '6px' }}><Settings2 size={15} /> Choisir les types d'alertes et le récapitulatif</Link>
      </div>
    </>
  );
}

function ActivityTab() {
  const view = useView();
  const members = useMembers();
  const acts = useMemo(() => ([...view.activity.values()] as Activity[]).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 100), [view.activity]);
  if (!acts.length) return <EmptyState icon={<Info size={28} />} title="Aucune activité">Chaque action des membres du foyer apparaîtra ici.</EmptyState>;
  return (
    <div className="card pad-0" data-testid="activity-feed">
      {acts.map((a) => {
        const m = members.get(a.userId);
        return (
          <div key={a.id} className="list-row" style={{ alignItems: 'flex-start' }}>
            <Avatar name={m?.name ?? '?'} color={m?.color} size={32} />
            <span className="meta">
              <span className="small"><strong>{m?.name ?? 'Ancien membre'}</strong> {a.summary}</span>
              <span className="sub" style={{ display: 'block' }}>{relativeTime(a.at)}{a.important ? ' · important' : ''}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const { name } = useHousehold();
  const tab = params.get('vue') === 'activite' ? 'activite' : 'alertes';
  return (
    <>
      <PageHead title="Notifications" eyebrow={name} />
      <Segmented label="Vue" value={tab} onChange={(t) => setParams(t === 'alertes' ? {} : { vue: t })} options={[{ value: 'alertes', label: 'Alertes' }, { value: 'activite', label: 'Activité du foyer' }]} />
      <div style={{ marginTop: 12 }}>{tab === 'alertes' ? <AlertsTab /> : <ActivityTab />}</div>
    </>
  );
}
