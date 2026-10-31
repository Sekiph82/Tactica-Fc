// Klient til de globale ranglister (api/rank.ts). Profilen (navn + hemmeligt token) gemmes i browseren.
// Kun singleplayer-sæsoner indsendes, og kun når ranglisterne findes (Vercel-udgaven).
import { getAvatar } from '../ui/avatar';
import { gs, hasGame, notify } from '../game/state';
import { isMultiplayer } from '../game/humans';

export interface RankProfile { pid: string; token: string; name: string }
export interface RankRow { id: string; pid?: string; supporter?: string; points: number; name: string; club: string; league: string; season?: number; seasons?: number }
export type Board = 'career' | 'season' | 'month' | 'league';

const KEY = 'cm0102.rankProfile';

export function rankingAvailable(): boolean {
  return import.meta.env.BASE_URL === '/' || import.meta.env.VITE_AI === '1';
}

export function getProfile(): RankProfile | null {
  try { const v = localStorage.getItem(KEY); return v ? (JSON.parse(v) as RankProfile) : null; } catch { return null; }
}

export async function createProfile(name: string): Promise<RankProfile | string> {
  try {
    const r = await fetch('/api/rank', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'profile', name }) });
    const j = await r.json();
    if (!r.ok) return String(j.error ?? 'error');
    const prof = { pid: j.pid, token: j.token, name: j.name } as RankProfile;
    try { localStorage.setItem(KEY, JSON.stringify(prof)); } catch { /* ignorer */ }
    return prof;
  } catch {
    return 'network';
  }
}

let submitting = false;

/** Send sæsoner der ikke er indsendt endnu (kaldes efter sæsonskift og når ranglisten åbnes) */
export async function submitPending(): Promise<number> {
  if (submitting || !hasGame() || !rankingAvailable()) return 0;
  const g = gs();
  const prof = getProfile();
  if (!prof || isMultiplayer(g)) return 0;
  const pending = (g.manager.scores ?? []).filter((s) => !s.submitted);
  if (!pending.length) return 0;
  submitting = true;
  let sent = 0;
  try {
    for (const s of pending) {
      const r = await fetch('/api/rank', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'submit', pid: prof.pid, token: prof.token, career: g.id, season: s.season, points: s.points, lines: s.lines.map((l) => ({ key: l.key, pts: l.pts })), club: s.clubName, league: s.league, leagueName: s.leagueName }),
      }).catch(() => null);
      if (!r) break;
      if (r.ok || r.status === 400 || r.status === 403) { s.submitted = true; sent++; }
    }
  } finally {
    submitting = false;
  }
  if (sent) notify();
  void syncProfile();
  return sent;
}

/** Præstationer og karriereoversigt til den offentlige managerprofil */
export async function syncProfile(): Promise<boolean> {
  if (!hasGame() || !rankingAvailable()) return false;
  const g = gs();
  const prof = getProfile();
  if (!prof || isMultiplayer(g)) return false;
  const club = g.clubs[g.userClub];
  const titles = g.manager.trophies.filter((x) => !/month|Year/.test(x.comp)).length;
  const summary = {
    club: club?.name ?? '', league: club ? g.leagues[club.league]?.name ?? '' : '', nation: g.nations[g.manager.nation]?.name ?? '',
    seasons: new Set(g.manager.history.map((h) => h.season)).size, wins: g.manager.achStats?.wins ?? 0,
    trophies: g.manager.trophies.length, titles, rep: Math.round(g.manager.rep),
    trophyList: g.manager.trophies.filter((x) => !/month/.test(x.comp)).slice(-30).map((x) => `${x.season}/${String(x.season + 1).slice(2)} ${x.comp}`),
  };
  try {
    const r = await fetch('/api/rank', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'sync', pid: prof.pid, token: prof.token, ach: Object.keys(g.manager.ach ?? {}), summary, avatar: getAvatar(), motto: g.manager.motto ?? '' }) });
    return r.ok;
  } catch { return false; }
}

export interface PublicProfile {
  name: string; created: string; ach: string[]; avatar: string | null; motto: string; supporter?: string | null; regen?: string | null;
  summary: { club: string; league: string; nation: string; seasons: number; wins: number; trophies: number; titles: number; rep: number; trophyList: string[] } | null;
  careers: { id: string; club: string; league: string; total: number; seasons: number; rank: number | null }[];
}

export async function fetchProfile(pid: string): Promise<PublicProfile | null> {
  try {
    const r = await fetch(`/api/rank?profile=${encodeURIComponent(pid)}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Nyt navn på ranglisterne (stadig unikt) */
export async function renameProfile(name: string): Promise<'ok' | string> {
  const prof = getProfile();
  if (!prof || !rankingAvailable()) return 'none';
  try {
    const r = await fetch('/api/rank', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'rename', pid: prof.pid, token: prof.token, name }) });
    const j = await r.json();
    if (!r.ok) return String(j.error ?? 'error');
    try { localStorage.setItem(KEY, JSON.stringify({ ...prof, name: j.name })); } catch { /* ignorer */ }
    return 'ok';
  } catch { return 'network'; }
}

/** Link til en managers offentlige profil */
export function profileUrl(pid: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}?manager=${pid}`;
}

export async function fetchBoard(board: Board, league?: string): Promise<{ rows: RankRow[]; me: { rank: number; points: number } | null; total: number } | null> {
  if (!rankingAvailable()) return null;
  const career = hasGame() ? gs().id : '';
  try {
    const r = await fetch(`/api/rank?board=${board}&league=${encodeURIComponent(league ?? '')}&career=${encodeURIComponent(career)}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
