// Browser-notifikationer: når det er ens tur i multiplayer, eller der sker noget vigtigt,
// mens fanen ikke er i fokus. Valget gemmes i browseren.
const KEY = 'cm-notify';

export function notifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notifyEnabled(): boolean {
  try { return notifySupported() && Notification.permission === 'granted' && localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** Slå til (spørger browseren om lov) eller fra */
export async function setNotify(on: boolean): Promise<boolean> {
  try {
    if (!on) { localStorage.setItem(KEY, '0'); return false; }
    if (!notifySupported()) return false;
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    localStorage.setItem(KEY, perm === 'granted' ? '1' : '0');
    return perm === 'granted';
  } catch { return false; }
}

/** Vis en notifikation, hvis brugeren har slået det til, og fanen ikke er i fokus */
export function notifyUser(title: string, body: string, tag: string) {
  if (!notifyEnabled() || (document.visibilityState === 'visible' && document.hasFocus())) return;
  try {
    const n = new Notification(title, { body, tag, icon: `${import.meta.env.BASE_URL}icon-192.png` });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* fx iOS uden PWA */ }
}

// ---------- installér som app (PWA) ----------

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installEvent: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e as InstallEvent; listeners.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { installEvent = null; listeners.forEach((f) => f()); });
}

export function canInstall(): boolean {
  return !!installEvent;
}

export function onInstallChange(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

export async function installApp(): Promise<boolean> {
  if (!installEvent) return false;
  await installEvent.prompt();
  const r = await installEvent.userChoice;
  installEvent = null;
  listeners.forEach((f) => f());
  return r.outcome === 'accepted';
}

/** Kan man bede om lov til notifikationer (understøttet og ikke allerede afvist)? */
export function notifyAskable(): boolean {
  return notifySupported() && Notification.permission !== 'denied';
}
