import { Suspense, lazy, useEffect, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { activeHousehold, loadSession, session } from './lib/session';
import { useObservable } from './lib/store';
import { EngineProvider } from './lib/sync/react';
import { Toasts } from './ui/Toasts';
import { Logo } from './ui/Logo';
import { Shell } from './pages/app/Shell';
import { HomePage } from './pages/app/Home';
import { InventoryPage } from './pages/app/inventory/InventoryPage';
import { ShoppingPage } from './pages/app/shopping/ShoppingPage';


/** Écran chargé à la demande (préchargé par le service worker : disponible hors connexion). */
function lazyPage<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}
const ForgotPage = lazyPage(() => import('./pages/auth/AuthPages'), 'ForgotPage');
const InvitationPage = lazyPage(() => import('./pages/auth/AuthPages'), 'InvitationPage');
const LoginPage = lazyPage(() => import('./pages/auth/AuthPages'), 'LoginPage');
const RegisterPage = lazyPage(() => import('./pages/auth/AuthPages'), 'RegisterPage');
const ResetPage = lazyPage(() => import('./pages/auth/AuthPages'), 'ResetPage');
const CreateHouseholdPage = lazyPage(() => import('./pages/onboarding/Onboarding'), 'CreateHouseholdPage');
const JoinHouseholdPage = lazyPage(() => import('./pages/onboarding/Onboarding'), 'JoinHouseholdPage');
const WelcomePage = lazyPage(() => import('./pages/onboarding/Onboarding'), 'WelcomePage');
const FamilyPage = lazyPage(() => import('./pages/app/Family'), 'FamilyPage');
const SettingsPage = lazyPage(() => import('./pages/app/Settings'), 'SettingsPage');
const AdminPage = lazyPage(() => import('./pages/app/AdminPage'), 'AdminPage');
const NewProductPage = lazyPage(() => import('./pages/app/inventory/ProductDetail'), 'NewProductPage');
const ProductDetailPage = lazyPage(() => import('./pages/app/inventory/ProductDetail'), 'ProductDetailPage');
const SessionPage = lazyPage(() => import('./pages/app/inventory/Sessions'), 'SessionPage');
const SessionsPage = lazyPage(() => import('./pages/app/inventory/Sessions'), 'SessionsPage');
const AuditPage = lazyPage(() => import('./pages/app/inventory/Audit'), 'AuditPage');
const ScannerPage = lazyPage(() => import('./pages/app/scanner/ScannerPage'), 'ScannerPage');
const ForecastPage = lazyPage(() => import('./pages/app/forecast/ForecastPage'), 'ForecastPage');
const NotificationsPage = lazyPage(() => import('./pages/app/Notifications'), 'NotificationsPage');
const ExpensesPage = lazyPage(() => import('./pages/app/expenses/ExpensesPage'), 'ExpensesPage');
const ShoppingModePage = lazyPage(() => import('./pages/app/shopping/ShoppingMode'), 'ShoppingModePage');
const ReceiptPage = lazyPage(() => import('./pages/app/shopping/ReceiptPage'), 'ReceiptPage');
const StoreDetailPage = lazyPage(() => import('./pages/app/shopping/Stores'), 'StoreDetailPage');
const StoresPage = lazyPage(() => import('./pages/app/shopping/Stores'), 'StoresPage');
const RecipesPage = lazyPage(() => import('./pages/app/recipes/RecipesPage'), 'RecipesPage');
const RecipeDetailPage = lazyPage(() => import('./pages/app/recipes/RecipesPage'), 'RecipeDetailPage');
const RecipeEditPage = lazyPage(() => import('./pages/app/recipes/RecipesPage'), 'RecipeEditPage');

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
      <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/connexion" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/inscription" element={<PublicOnly><RegisterPage /></PublicOnly>} />
        <Route path="/mot-de-passe-oublie" element={<PublicOnly><ForgotPage /></PublicOnly>} />
        <Route path="/reinitialiser/:token" element={<ResetPage />} />
        <Route path="/invitation/:code" element={<InvitationPage />} />
        <Route path="/bienvenue" element={<RequireAuth><WelcomePage /></RequireAuth>} />
        <Route path="/foyers/nouveau" element={<RequireAuth><CreateHouseholdPage /></RequireAuth>} />
        <Route path="/foyers/rejoindre" element={<RequireAuth><JoinHouseholdPage /></RequireAuth>} />
        <Route path="/administration" element={<RequireAuth><AdminPage /></RequireAuth>} />
        <Route element={<RequireAuth><HouseholdSpace /></RequireAuth>}>
          <Route index element={<HomePage />} />
          <Route path="inventaire" element={<InventoryPage />} />
          <Route path="inventaire/nouveau" element={<NewProductPage />} />
          <Route path="inventaire/inventaires" element={<SessionsPage />} />
          <Route path="inventaire/inventaires/:id" element={<SessionPage />} />
          <Route path="inventaire/controle" element={<AuditPage />} />
          <Route path="inventaire/:id" element={<ProductDetailPage />} />
          <Route path="courses" element={<ShoppingPage />} />
          <Route path="courses/magasin" element={<ShoppingModePage />} />
          <Route path="courses/magasins" element={<StoresPage />} />
          <Route path="courses/ticket" element={<ReceiptPage />} />
          <Route path="courses/magasins/:id" element={<StoreDetailPage />} />
          <Route path="recettes" element={<RecipesPage />} />
          <Route path="recettes/nouvelle" element={<RecipeEditPage />} />
          <Route path="recettes/:id" element={<RecipeDetailPage />} />
          <Route path="recettes/:id/modifier" element={<RecipeEditPage />} />
          <Route path="previsions" element={<ForecastPage />} />
          <Route path="scanner" element={<ScannerPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="depenses" element={<ExpensesPage />} />
          <Route path="famille" element={<FamilyPage />} />
          <Route path="parametres" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </Suspense>
      <Toasts />
    </BrowserRouter>
  );
}
