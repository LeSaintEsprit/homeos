import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Smartphone, UserPlus, Users } from 'lucide-react';
import { activeHousehold, session } from '../../lib/session';
import { useObservable } from '../../lib/store';
import { useView } from '../../lib/sync/react';
import { greeting } from '../../lib/format';
import { HouseholdAvatar } from '../../ui/Avatar';

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

export function HomePage() {
  const s = useObservable(session);
  const view = useView();
  const ref = activeHousehold(s)!;
  const synced = view.household.get(ref.id);
  const hh = { ...ref, name: synced?.name ?? ref.name, avatar: synced?.avatar ?? ref.avatar };
  const members = [...view.member.values()].filter((m) => m.active);
  const install = useInstallPrompt();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>{greeting()}, {s.me?.user.name.split(' ')[0]}</h1>
        </div>
      </div>
      <div className="card hero rise" style={{ marginBottom: 16 }}>
        <div className="row">
          <HouseholdAvatar avatar={hh.avatar} size={56} />
          <div className="grow">
            <div className="small muted">Foyer actif</div>
            <h2 style={{ fontSize: 'var(--fs-xl)' }}>{hh.name}</h2>
            <div className="small muted"><Users size={14} style={{ verticalAlign: '-2px' }} /> {members.length} membre{members.length > 1 ? 's' : ''} · {view.product.size} produit{view.product.size > 1 ? 's' : ''} suivi{view.product.size > 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>
      <div className="grid-2">
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
    </>
  );
}
