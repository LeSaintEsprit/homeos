import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './lib/theme';
import { App } from './App';
import { registerSW } from 'virtual:pwa-register';
import { toast } from './lib/toast';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const update = registerSW({
    onNeedRefresh() {
      toast('Une nouvelle version de HOMEOS est disponible.', 'info', { ms: 60_000, action: { label: 'Mettre à jour', run: () => void update(true) } });
    },
  });
}
