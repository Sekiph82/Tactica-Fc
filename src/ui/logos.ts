import { gs, hasGame } from '../game/state';
// Klublogoer hentes ved kørsel fra luukhopman/football-logos via jsDelivr (ikke bundlet i projektet)
let base = '';
let map: Record<string, string> = {};
let loaded: Promise<void> | null = null;

export function loadLogos(): Promise<void> {
  if (!loaded) {
    loaded = fetch(`${import.meta.env.BASE_URL}data/logos.json`)
      .then((r) => (r.ok ? r.json() : { base: '', logos: {} }))
      .then((d: { base: string; logos: Record<string, string> }) => { base = d.base; map = d.logos; })
      .catch(() => { /* uden logoer */ });
  }
  return loaded;
}

export function logoUrl(clubId: number): string | null {
  // logoerne hører til den moderne database (Transfermarkt-ID'er) – ikke til CM 01/02-klubber
  if (hasGame() && gs().dbKind === 'cm0102') return null;
  const p = map[clubId];
  return p ? base + p.split('/').map(encodeURIComponent).join('/') : null;
}
