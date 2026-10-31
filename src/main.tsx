import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './ui/App';
import { ConfirmHost } from './ui/confirm';
import './styles.css';
import { gs, notify } from './game/state';
import { runUntil } from './game/sim';
import { addDays } from './game/dates';
import { applyTheme } from './ui/theme';
import { configurePlatformServices } from './game/ports';
import { browserPlatform } from './platform/browser';
import './ui/notify'; // fanger browserens "kan installeres"-signal tidligt

// kun i udvikling: adgang til spiltilstanden fra konsollen/Playwright-tests (advance spoler dage frem)
if (import.meta.env.DEV) (window as unknown as { __cm: unknown }).__cm = { gs, notify, advance: (days: number) => runUntil({ untilDate: addDays(gs().date, days), autoPlay: true }).then(() => notify()) };

configurePlatformServices(browserPlatform);
applyTheme();
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ConfirmHost />
  </StrictMode>,
);
