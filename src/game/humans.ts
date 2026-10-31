// Flere menneskelige managere i samme verden (online multiplayer).
//
// Spillets kode er skrevet ud fra "brugerens" perspektiv (g.userClub, g.tactic, g.news …).
// Hver menneskelig manager har en "slot" med sine personlige felter. Når der skal gøres noget
// på vegne af en bestemt manager, byttes hans felter ind i GameState (activate), og bagefter
// tilbage. I singleplayer findes ingen slots, og alt virker som før.
import { gs } from './state';
import type { GameState, HumanSlot } from './types';

export const PERSONAL_KEYS = [
  'userClub', 'manager', 'board', 'tactic', 'savedTactics', 'knowledge', 'scoutFinds', 'shortlist', 'news', 'jobOffers', 'challenge', 'pendingFixture', 'press', 'matchTalk', 'chatRead', 'transferDigest',
] as const;

type PersonalKey = (typeof PERSONAL_KEYS)[number];

export function isMultiplayer(g: GameState = gs()): boolean {
  return !!g.humans && g.humans.length > 0;
}

/** Gem de aktive personlige felter tilbage i den aktive slot */
export function stash(g: GameState = gs()) {
  if (!g.humans || !g.active) return;
  const slot = g.humans.find((h) => h.pid === g.active);
  if (!slot) return;
  for (const k of PERSONAL_KEYS) (slot as unknown as Record<PersonalKey, unknown>)[k] = (g as unknown as Record<PersonalKey, unknown>)[k];
}

/** Gør en managers felter aktive */
export function activate(pid: string, g: GameState = gs()) {
  if (!g.humans) return;
  if (g.active === pid) return;
  stash(g);
  const slot = g.humans.find((h) => h.pid === pid);
  if (!slot) return;
  for (const k of PERSONAL_KEYS) (g as unknown as Record<PersonalKey, unknown>)[k] = (slot as unknown as Record<PersonalKey, unknown>)[k];
  g.active = pid;
}

export function withHuman<T>(pid: string, fn: () => T): T {
  const g = gs();
  if (!g.humans) return fn();
  const prev = g.active;
  activate(pid, g);
  try {
    return fn();
  } finally {
    if (prev) activate(prev, g);
  }
}

/** Kør fn for hver menneskelig manager (eller én gang i singleplayer) */
export function forEachHuman(fn: () => void) {
  const g = gs();
  if (!g.humans) { fn(); return; }
  for (const h of g.humans.map((x) => x.pid)) withHuman(h, fn);
}

export function isHumanClub(clubId: number): boolean {
  const g = gs();
  return !!clubId && g.clubs[clubId]?.manager === -1;
}

/** Hvilken menneskelig manager styrer klubben? */
export function ownerOf(clubId: number): string | null {
  const g = gs();
  if (!g.humans || !clubId) return null;
  if (g.userClub === clubId && g.active) return g.active;
  return g.humans.find((h) => h.pid !== g.active && h.userClub === clubId)?.pid ?? null;
}

/** Kør fn som ejeren af klubben (hvis klubben er menneskestyret) */
export function asOwner(clubId: number, fn: () => void) {
  const g = gs();
  if (!g.humans) { if (clubId === g.userClub) fn(); return; }
  const o = ownerOf(clubId);
  if (o) withHuman(o, fn);
}

export function emptySlot(pid: string, name: string, nation: number): HumanSlot {
  return {
    pid, name, userClub: 0,
    manager: { name, nation, rep: 40, history: [], trophies: [], sacked: 0 },
    board: { confidence: 60, expectation: 'mid', expectedPos: 10, warnings: 0 },
    tactic: null, savedTactics: [], knowledge: {}, scoutFinds: {}, shortlist: [], news: [], jobOffers: [], challenge: null, pendingFixture: null,
  };
}

/** Gør spillet klar til multiplayer: værten bliver første slot */
export function enableMultiplayer(hostPid: string, hostName: string) {
  const g = gs();
  if (g.humans) return;
  const slot = emptySlot(hostPid, hostName, g.manager.nation);
  g.humans = [slot];
  g.active = hostPid;
  stash(g);
}

/** Navnet på den menneskelige manager (eller AI-manager) der styrer klubben */
export function humanManager(clubId: number): { name: string; bot: boolean } | null {
  const g = gs();
  if (!clubId || g.clubs[clubId]?.manager !== -1) return null;
  const active = g.humans?.find((h) => h.pid === g.active);
  if (g.userClub === clubId) return { name: g.manager.name, bot: !!active?.bot };
  // den aktive managers egen slot kan have en forældet klub – spring den over
  const h = g.humans?.find((x) => x.pid !== g.active && x.userClub === clubId);
  return h ? { name: h.name, bot: !!h.bot } : null;
}

/** Fjern en manager fra spillet: klubben får en AI-manager (eller bliver en ledig stilling) */
export function removeHuman(pid: string): string {
  const g = gs();
  const slot = g.humans?.find((h) => h.pid === pid);
  if (!slot || !g.humans) return 'unknown';
  if (g.active === pid) return 'unknown';
  const clubId = slot.userClub;
  g.humans = g.humans.filter((h) => h.pid !== pid);
  g.offers = g.offers.map((o) => (o.buyer === clubId && ['pending', 'negotiating', 'countered'].includes(o.status) ? { ...o, status: 'withdrawn' as const } : o));
  const club = g.clubs[clubId];
  if (club) {
    club.manager = 0;
    club.tactic = null;
    removeHooks.onRemoved?.(clubId);
  }
  for (const h of g.humans) if (!h.bot) withHuman(h.pid, () => removeHooks.news?.(slot.name, club?.name ?? ''));
  return 'ok';
}

/** Undgå cirkulære imports: board/state registrerer hvordan klubben får ny manager og nyheden skrives */
export const removeHooks: { onRemoved?: (clubId: number) => void; news?: (name: string, club: string) => void } = {};
