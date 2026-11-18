import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { session } from '../../lib/session';
import { useObservable } from '../../lib/store';
import { Logo } from '../../ui/Logo';
import { ServerAdminSection } from './Settings';

/**
 * Administration de l'instance, accessible à l'hébergeur même sans foyer
 * (il peut héberger HOMEOS pour d'autres familles sans en faire partie).
 */
export function AdminPage() {
  const s = useObservable(session);
  if (!s.me?.user.isServerAdmin) {
    return (
      <div className="main" style={{ maxWidth: 720, margin: '0 auto' }}>
        <div className="alert warning">Cette page est réservée à la personne qui héberge cette instance HOMEOS.</div>
        <Link to="/">Retour</Link>
      </div>
    );
  }
  return (
    <div className="main" style={{ maxWidth: 820, margin: '0 auto', paddingBottom: 40 }}>
      <div className="row spread" style={{ margin: '12px 0 16px' }}>
        <div className="row"><Logo size={30} /> <strong>HOMEOS</strong></div>
        <Link to={s.me.households.length ? '/' : '/bienvenue'} className="row" style={{ ['--gap' as string]: '4px' }}><ArrowLeft size={15} /> Retour</Link>
      </div>
      <h1 style={{ marginBottom: 16 }}>Administration du serveur</h1>
      <ServerAdminSection />
    </div>
  );
}
