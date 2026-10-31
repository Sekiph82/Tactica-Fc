// Fortæller serveren (api/notify.ts), at en ny singleplayer-karriere er startet, så udvikleren
// får en mail. Fire-and-forget: fejl og manglende server (GitHub Pages) ignoreres.
import { rankingAvailable } from './rank';

export function notifyNewCareer(info: { manager: string; club: string; league?: string; nation?: string; challenge?: string; bots: number; db: string; lang: string }): void {
  if (!rankingAvailable()) return;
  fetch('/api/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(info), keepalive: true }).catch(() => {});
}
