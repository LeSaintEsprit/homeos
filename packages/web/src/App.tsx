import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { activeHousehold, loadSession, session } from './lib/session';
import { useObservable } from './lib/store';
import { EngineProvider } from './lib/sync/react';
import { Toasts } from './ui/Toasts';
import { Logo } from './ui/Logo';
import { ForgotPage, InvitationPage, LoginPage, RegisterPage, ResetPage } from './pages/auth/AuthPages';
import { CreateHouseholdPage, JoinHouseholdPage, WelcomePage } from './pages/onboarding/Onboarding';
import { Shell } from './pages/app/Shell';
import { HomePage } from './pages/app/Home';
import { FamilyPage } from './pages/app/Family';
import { SettingsPage } from './pages/app/Settings';
import { Placeholder } from './pages/app/Placeholder';
import { InventoryPage } from './pages/app/inventory/InventoryPage';
import { NewProductPage, ProductDetailPage } from './pages/app/inventory/ProductDetail';
import { ScannerPage } from './pages/app/scanner/ScannerPage';
import { ShoppingPage } from './pages/app/shopping/ShoppingPage';
import { ShoppingModePage } from './pages/app/shopping/ShoppingMode';
import { StoreDetailPage, StoresPage } from './pages/app/shopping/Stores';

function Splash() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <div style={{ animation: 'pulse-soft 1.4s ease-in-out infinite' }}><Logo size={64} /></div>
    </div>
  );
}

/** Accès réservé aux personnes connectées. */
function RequireAuth({ children }: { children: ReactNode }) {
  const s = useObservable(session);
  const loc = useLocation();
  if (s.status === 'loading') return <Splash />;
  if (s.status === 'anon') return <Navigate to={`/connexion?redirect=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** Espace du foyer actif : un moteur de synchronisation par foyer. */
function HouseholdSpace() {
  const s = useObservable(session);
  const hh = activeHousehold(s);
  if (!hh) return <Navigate to="/bienvenue" replace />;
  return (
    <EngineProvider key={`${s.me!.user.id}:${hh.id}`} userId={s.me!.user.id} householdId={hh.id} role={hh.role}>
      <Shell />
    </EngineProvider>
  );
}

function PublicOnly({ children }: { children: ReactNode }) {
  const s = useObservable(session);
  if (s.status === 'loading') return <Splash />;
  if (s.status === 'ready') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  useEffect(() => {
    void loadSession();
  }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/connexion" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/inscription" element={<PublicOnly><RegisterPage /></PublicOnly>} />
        <Route path="/mot-de-passe-oublie" element={<PublicOnly><ForgotPage /></PublicOnly>} />
        <Route path="/reinitialiser/:token" element={<ResetPage />} />
        <Route path="/invitation/:code" element={<InvitationPage />} />
        <Route path="/bienvenue" element={<RequireAuth><WelcomePage /></RequireAuth>} />
        <Route path="/foyers/nouveau" element={<RequireAuth><CreateHouseholdPage /></RequireAuth>} />
        <Route path="/foyers/rejoindre" element={<RequireAuth><JoinHouseholdPage /></RequireAuth>} />
        <Route element={<RequireAuth><HouseholdSpace /></RequireAuth>}>
          <Route index element={<HomePage />} />
          <Route path="inventaire" element={<InventoryPage />} />
          <Route path="inventaire/nouveau" element={<NewProductPage />} />
          <Route path="inventaire/:id" element={<ProductDetailPage />} />
          <Route path="courses" element={<ShoppingPage />} />
          <Route path="courses/magasin" element={<ShoppingModePage />} />
          <Route path="courses/magasins" element={<StoresPage />} />
          <Route path="courses/magasins/:id" element={<StoreDetailPage />} />
          <Route path="previsions/*" element={<Placeholder title="Prévisions" phase={6} />} />
          <Route path="scanner" element={<ScannerPage />} />
          <Route path="famille" element={<FamilyPage />} />
          <Route path="parametres" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toasts />
    </BrowserRouter>
  );
}
