// Draft-liga: fiktive klubber drafter 16 spillere (11 startere + 5 udskiftere) fra de 500 bedste i databasen.
// Ingen økonomi, transfers, kontrakter, bestyrelse eller staff (kun assistenten). Når sæsonens kampe er spillet,
// starter en ny sæson med en ny draft.
//
// Draften selv styres af serveren (tur, tidsfrist, hvem har valgt hvad). Denne fil indeholder reglerne
// (snake-rækkefølge, pladser, automatiske valg) og opbygningen af sæsonens lille spilverden.
import { naturalRole, slotFit } from './attributes';
import { emptyRow, finalOrder, newFixture } from './competitions';
import { compHooks } from './hooks';
import { addDays, ageOn } from './dates';
import { caFromValue, makePlayer, makeStaff, type SubPos } from './data/generate';
import { activate, emptySlot, withHuman } from './humans';
import { emptyFinance, type WorldData } from './newgame';
import { Rng, hash, rng } from './rng';
import { addNews, gs, rebuildIndexes, setGame, squad } from './state';
import { formationSlots, newTactic } from './tactics';
import { POSITIONS, SIDES } from './types';
import type { Club, Competition, DraftAllTime, DraftInfo, DraftSettings, GameState, Lang, Player, Tactic } from './types';

export const POOL_SIZE = 500;
export const SQUAD = 16;
export const STARTERS = 11;
export const BENCH = SQUAD - STARTERS;
export const PICK_SECONDS = 60;
export const KEEPER_SECONDS = 120;
/** Draft-klubbernes id'er (så de aldrig forveksles med rigtige klubber og deres logoer) */
export const CLUB_BASE = 900_000;
/** Pladsen "på bænken" (startere har 0-10) */
export const BENCH_PLACE = -1;
/** Hvor godt en spiller skal passe til en plads for at kunne draftes til den (svarer til de positioner, der vises ved spilleren) */
export const FIT_MIN = 0.75;
export const MAX_TEAMS = 16;

export const DEFAULT_SETTINGS: DraftSettings = { rounds: 2, playoff: 'none', keepers: 0, injuries: true };

export interface DraftTeam {
  slot: number;
  /** Menneskelig manager (pid) – tom for AI-hold */
  pid: string;
  ai: boolean;
  manager: string;
  name: string;
  short: string;
  colors: [string, string];
  crest: number;
  formation: string;
  /** Ønskeliste (spiller-id'er i prioriteret rækkefølge) */
  wish: number[];
  /** Spillere holdet beholder fra sidste sæson (med plads) */
  keep: DraftPick[];
  keepReady?: boolean;
  /** Auktion: resterende budget (mio.) */
  budget?: number;
  summaryReady?: boolean;
}

export interface DraftPick { slot: number; player: number; place: number; auto?: boolean; /** auktion: prisen (mio.) */ price?: number }

export const clubIdOf = (slot: number) => CLUB_BASE + slot;

// ---------- puljen ----------

const poolCache = new Map<string, Player[]>();

/**
 * De 500 bedste spillere i databasen (efter evne). Beregnes ens på alle klienter ud fra databasen og rummets seed,
 * så serveren kun behøver at kende spillernes id'er.
 */
export function draftPool(world: WorldData, seed: number, year: number, league = ''): Player[] {
  const key = `${seed}|${year}|${world.version}|${world.players.length}|${league}`;
  const hit = poolCache.get(key);
  if (hit) return hit;
  const date = `${year}-08-01`;
  const F = Object.fromEntries(world.playerFields.map((f, i) => [f, i]));
  // en bestemt liga (kun spillere fra ligaens klubber) eller nationalitet ("n:12" = alle fra nation 12)
  const nation = league.startsWith('n:') ? Number(league.slice(2)) : null;
  const clubs = league && nation === null ? new Set(world.clubs.filter((c) => c[4] === league).map((c) => c[0])) : null;
  const rough = world.players.filter((r) => (nation === null || r[F.nation] === nation) && (!clubs || clubs.has(r[F.club] as number))).map((r) => {
    const age = ageOn(r[F.dob] as string, date);
    return { r, age, ca: caFromValue(r[F.value] as number, age) };
  }).sort((a, b) => b.ca - a.ca).slice(0, POOL_SIZE + 250);
  const players = rough.map(({ r }) => makePlayer({
    id: r[F.id] as number, first: r[F.first] as string, last: r[F.last] as string, dob: r[F.dob] as string, nation: r[F.nation] as number,
    club: 0, sub: r[F.pos] as SubPos, foot: r[F.foot] as Player['foot'], height: r[F.height] as number,
    ca: caFromValue(r[F.value] as number, ageOn(r[F.dob] as string, date)), value: r[F.value] as number, caps: r[F.caps] as number, intGoals: r[F.intGoals] as number,
    stats: { apps: r[F.apps] as number, minutes: r[F.minutes] as number, goals: r[F.goals] as number, assists: r[F.assists] as number, yellows: r[F.yellows] as number, reds: r[F.reds] as number },
    date, seed, wealth: 1,
  })).sort((a, b) => b.ca - a.ca || a.id - b.id).slice(0, POOL_SIZE);
  for (const p of players) { p.contract = null; p.condition = 100; p.morale = 14; }
  poolCache.set(key, players);
  return players;
}

// ---------- rækkefølgen ----------

/** Hvor mange hold puljen kan dække (16 spillere pr. hold) */
export const maxTeamsFor = (poolSize: number) => Math.min(MAX_TEAMS, Math.floor(poolSize / SQUAD));

/** Antal valg pr. hold i denne draft (keepers er allerede på holdet) */
export const picksPerTeam = (keepers: number) => SQUAD - keepers;

/** Snake draft: runde 1 i rækkefølgen, runde 2 baglæns osv. */
export function slotForPick(order: number[], n: number): number {
  const t = order.length;
  const round = Math.floor(n / t), i = n % t;
  return round % 2 === 0 ? order[i] : order[t - 1 - i];
}

export const totalPicks = (order: number[], keepers: number) => order.length * picksPerTeam(keepers);

// ---------- pladser ----------

/** Alle holds keepers (de kan ikke draftes af andre) */
export const allKeepers = (teams: DraftTeam[]) => teams.flatMap((t) => t.keep.map((k) => k.player));

/** Holdets valg indtil nu (inkl. keepers) */
export function teamPicks(team: DraftTeam, picks: DraftPick[]): DraftPick[] {
  return [...team.keep, ...picks.filter((p) => p.slot === team.slot)];
}

/** Ledige pladser: startpladser (0-10) og antal ledige bænkpladser */
export function openPlaces(team: DraftTeam, picks: DraftPick[]): { starters: number[]; bench: number } {
  const mine = teamPicks(team, picks);
  const taken = new Set(mine.filter((p) => p.place >= 0).map((p) => p.place));
  return {
    starters: Array.from({ length: STARTERS }, (_, i) => i).filter((i) => !taken.has(i)),
    bench: BENCH - mine.filter((p) => p.place === BENCH_PLACE).length,
  };
}

const isGK = (p: Player) => naturalRole(p) === 'GK';

/** Kan spilleren placeres her? Startere skal passe til pladsen; på bænken skal der være mindst én målmand */
export function canPlace(team: DraftTeam, picks: DraftPick[], player: Player, place: number, players: Record<number, Player>, benchGK = true): boolean {
  const open = openPlaces(team, picks);
  if (place >= 0) {
    if (!open.starters.includes(place)) return false;
    const slot = formationSlots(team.formation)[place];
    return !!slot && fitsSlot(player, slot);
  }
  if (open.bench <= 0) return false;
  // uden skader behøver bænken ingen målmand
  if (!benchGK) return true;
  // sidste bænkplads skal være en målmand, hvis der ikke allerede er en
  const hasGK = teamPicks(team, picks).some((p) => p.place === BENCH_PLACE && players[p.player] && isGK(players[p.player]));
  return hasGK || open.bench > 1 || isGK(player);
}

/** Pladser spilleren kan draftes til (bedst passende startplads først, bænken til sidst) */
export function placesFor(team: DraftTeam, picks: DraftPick[], player: Player, players: Record<number, Player>, benchGK = true): number[] {
  const slots = formationSlots(team.formation);
  const starters = openPlaces(team, picks).starters
    .filter((i) => canPlace(team, picks, player, i, players, benchGK))
    .sort((a, b) => slotFit(player, slots[b]) - slotFit(player, slots[a]));
  return canPlace(team, picks, player, BENCH_PLACE, players, benchGK) ? [...starters, BENCH_PLACE] : starters;
}

/**
 * Kan spilleren draftes til pladsen? Præcis de positioner og sider, der vises ved spilleren
 * (rating 15+), så det, man ser, og det, man må, altid stemmer overens.
 */
export function fitsSlot(p: Player, slot: { pos: import('./types').PosKey; side: import('./types').Side }): boolean {
  const pi = POSITIONS.indexOf(slot.pos);
  const best = Math.max(...p.pos);
  const posOk = p.pos[pi] >= 15 || (best < 15 && p.pos[pi] === best);
  if (!posOk) return false;
  if (slot.pos === 'GK') return true;
  return p.side[SIDES.indexOf(slot.side)] >= 15;
}

/** Kan spilleren spille rollen (til positionsfilteret)? Fløjroller tæller begge sider */
export function canPlayRole(p: Player, role: import('./types').Role): boolean {
  const S = (pos: import('./types').PosKey, side: import('./types').Side) => fitsSlot(p, { pos, side });
  switch (role) {
    case 'GK': return S('GK', 'C');
    case 'CB': return S('D', 'C') || S('SW', 'C');
    case 'FB': return S('D', 'L') || S('D', 'R') || S('WB', 'L') || S('WB', 'R');
    case 'DM': return S('DM', 'C');
    case 'CM': return S('M', 'C');
    case 'WM': return S('M', 'L') || S('M', 'R');
    case 'AM': return S('AM', 'C');
    case 'W': return S('AM', 'L') || S('AM', 'R');
    case 'ST': return S('ST', 'C');
  }
}

/** Hvor godt passer spilleren til pladsen (0-1) – til visning */
export const placeFit = (player: Player, formation: string, place: number) => place < 0 ? 1 : slotFit(player, formationSlots(formation)[place]);

/**
 * Automatisk valg (AI-hold, eller når tiden løber ud): først ønskelisten, ellers den bedste ledige spiller
 * til den plads, hvor holdet mangler mest. Startpladserne fyldes før bænken.
 */
export function autoPick(team: DraftTeam, picks: DraftPick[], pool: Player[], keepers: number[] = [], benchGK = true): DraftPick | null {
  // taget: alle valg i denne draft og alle holds keepers
  const taken = new Set([...picks.map((p) => p.player), ...keepers]);
  const byId: Record<number, Player> = Object.fromEntries(pool.map((p) => [p.id, p]));
  const free = pool.filter((p) => !taken.has(p.id) && !team.keep.some((k) => k.player === p.id));
  for (const id of team.wish) {
    const p = byId[id];
    if (!p || taken.has(id)) continue;
    const places = placesFor(team, picks, p, byId, benchGK);
    if (places.length) return { slot: team.slot, player: id, place: places[0], auto: true };
  }
  const open = openPlaces(team, picks);
  const slots = formationSlots(team.formation);
  let best: { p: Player; place: number; score: number } | null = null;
  for (const place of open.starters) {
    for (const p of free) {
      if (!fitsSlot(p, slots[place])) continue;
      const fit = slotFit(p, slots[place]);
      const score = p.ca * (0.7 + 0.3 * fit);
      if (!best || score > best.score) best = { p, place, score };
      break; // puljen er sorteret efter evne: den første der passer er den bedste til pladsen
    }
  }
  if (!best && open.bench > 0) {
    const p = free.find((x) => canPlace(team, picks, x, BENCH_PLACE, byId, benchGK));
    if (p) best = { p, place: BENCH_PLACE, score: p.ca };
  }
  // en startplads ingen i puljen passer til (meget usandsynligt): tag den bedste til bænken
  if (!best) {
    const p = free[0];
    if (!p) return null;
    const place = open.bench > 0 ? BENCH_PLACE : open.starters[0];
    if (place === undefined) return null;
    return { slot: team.slot, player: p.id, place, auto: true };
  }
  return { slot: team.slot, player: best.p.id, place: best.place, auto: true };
}

/** Keepers: AI-hold (og hold der ikke nåede at vælge) beholder deres bedste spillere på deres pladser */
export function autoKeepers(clubId: number, n: number, g: GameState = gs()): DraftPick[] {
  if (!n) return [];
  const club = g.clubs[clubId];
  const tac = club?.manager === -1 ? g.humans?.find((h) => h.userClub === clubId)?.tactic ?? (g.userClub === clubId ? g.tactic : null) : club?.tactic;
  const slot = clubId - CLUB_BASE;
  const placeOf = (id: number) => { const i = tac?.lineup.indexOf(id) ?? -1; return i >= 0 ? i : BENCH_PLACE; };
  return squad(clubId).sort((a, b) => b.ca - a.ca).slice(0, n).map((p) => ({ slot, player: p.id, place: placeOf(p.id) }));
}

// ---------- logoer ----------

export const CREST_SHAPES = 6;

/** Simpelt klublogo som SVG (skjold, cirkel …) i klubbens farver med forkortelsen */
export function crestSvg(shape: number, a: string, b: string, text: string): string {
  const shapes = [
    'M32 4 L58 12 L56 36 C54 50 44 58 32 62 C20 58 10 50 8 36 L6 12 Z',
    'M32 3 A29 29 0 1 0 32.01 3 Z',
    'M8 6 H56 V40 C56 52 44 60 32 62 C20 60 8 52 8 40 Z',
    'M32 3 L60 32 L32 61 L4 32 Z',
    'M12 4 H52 L60 16 V48 L52 60 H12 L4 48 V16 Z',
    'M32 4 L58 18 V46 L32 60 L6 46 V18 Z',
  ];
  const d = shapes[((shape % CREST_SHAPES) + CREST_SHAPES) % CREST_SHAPES];
  const t = text.slice(0, 3).toUpperCase().replace(/[<>&"]/g, '');
  const ink = textOn(a);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="${d}" fill="${a}" stroke="${b}" stroke-width="4"/><path d="M14 40 H50" stroke="${b}" stroke-width="5" opacity="0.9"/><text x="32" y="33" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${t.length > 2 ? 15 : 19}" font-weight="900" fill="${ink}">${t}</text></svg>`;
}

function textOn(hex: string): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
}

// ---------- AI-hold ----------

const AI_NAMES = ['Northgate Rovers', 'Harbour City', 'Atlético Sol', 'Real Montaña', 'Sporting Nova', 'Dynamo Kraków', 'Olympique Rive', 'Inter Lago', 'FC Nordlys', 'Borussia Wald', 'Ajax Duin', 'Celtic Glen', 'Athletic Vale', 'Racing Costa', 'Union Berg', 'Galaxy Bay'];
const AI_COLORS: [string, string][] = [['#c8102e', '#ffffff'], ['#003399', '#ffd200'], ['#00843d', '#ffffff'], ['#111111', '#ffd200'], ['#5c2d91', '#ffffff'], ['#f68b1f', '#111111'], ['#6cabdd', '#ffffff'], ['#7a263a', '#6cabdd']];
const AI_FORMATIONS = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-1-4-1'];

export function aiTeam(slot: number, used: string[]): DraftTeam {
  const r = new Rng(hash(slot, 4242));
  const name = AI_NAMES.find((n) => !used.includes(n)) ?? `AI ${slot}`;
  const short = name.split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return {
    slot, pid: '', ai: true, manager: 'AI', name, short, colors: AI_COLORS[slot % AI_COLORS.length], crest: r.int(0, CREST_SHAPES - 1),
    formation: AI_FORMATIONS[slot % AI_FORMATIONS.length], wish: [], keep: [],
  };
}

// ---------- sæsonens spilverden ----------

export interface BuildOpts {
  world: WorldData;
  seed: number;
  /** Draft-sæson (1, 2, …) */
  season: number;
  lang: Lang;
  settings: DraftSettings;
  teams: DraftTeam[];
  picks: DraftPick[];
  /** Den aktive manager (værten der bygger) */
  hostPid: string;
  prev?: DraftInfo;
}


/** Byg sæsonens spilverden ud fra draften: klubber, trupper, taktikker og kampprogram */
export function buildDraftGame(o: BuildOpts): GameState {
  // alle kampe spilles "i dag": én runde pr. træk med dags dato som udgangspunkt
  const start = new Date().toISOString().slice(0, 10);
  const year = Number(start.slice(0, 4));
  const seed = hash(o.seed, o.season) >>> 0;
  rng.state = seed || 1;
  const g: GameState = {
    version: 1,
    id: `draft-${Date.now().toString(36)}`,
    seed,
    rng: rng.state,
    date: addDays(start, -1),
    season: year,
    lang: o.lang,
    userClub: 0,
    manager: { name: '', nation: 0, rep: 50, history: [], trophies: [], sacked: 0 },
    board: { confidence: 100, expectation: 'mid', expectedPos: 1, warnings: 0 },
    options: { masking: false, autosave: true, matchSpeed: 650, fullCommentary: true, rules: 'modern' },
    activeNations: [],
    nations: o.world.nations,
    leagueOrder: ['DL'],
    leagues: { DL: { name: 'Draft League', nation: 0, tier: 1 } },
    players: {},
    clubs: {},
    staff: {},
    comps: {},
    fixtures: {},
    news: [],
    knowledge: {},
    shortlist: [],
    offers: [],
    tactic: null,
    savedTactics: [],
    reports: {},
    seasonHistory: [],
    challenge: null,
    names: {},
    nextId: { player: 10_000_000, staff: 1, news: 1, fixture: 1, offer: 1, tie: 1 },
    pendingFixture: null,
    dayDone: true,
    vacancies: [],
    jobOffers: [],
    draft: {
      settings: o.settings,
      season: o.season,
      history: o.prev?.history ?? [],
      allTime: o.prev?.allTime ?? {},
    },
  };
  // ligaen hører ikke til noget land: et eget "land" til ligaen og klubberne
  const home = g.nations.length;
  g.nations = [...g.nations, { name: 'Draft League', code: 'DL' }];
  g.leagues.DL.nation = home;
  setGame(g);

  // puljen: alle 500 er med (de udraftede bruges som erstatning ved skader)
  for (const p of draftPool(o.world, o.seed, o.world.season, o.settings.pool ?? '')) {
    const c: Player = structuredClone(p);
    c.club = 0;
    g.players[c.id] = c;
  }

  const teams = o.teams.slice().sort((a, b) => a.slot - b.slot);
  for (const t of teams) {
    const id = clubIdOf(t.slot);
    const club: Club = {
      id, name: t.name, short: t.short, nation: home, league: 'DL', stadium: `${t.name} Park`, seats: 40_000,
      rep: 75, balance: 0, transferBudget: 0, wageBudget: 0, youth: 10, facilities: 15, colors: t.colors,
      manager: 0, tactic: null, finance: emptyFinance(), history: [], ticketPrice: 0, crest: t.crest,
    };
    g.clubs[id] = club;
    const mine = teamPicks(t, o.picks);
    const tac: Tactic = newTactic(t.formation);
    for (const pk of mine) {
      const p = g.players[pk.player];
      if (!p) continue;
      p.club = id;
      if (pk.place >= 0) tac.lineup[pk.place] = p.id; else tac.bench.push(p.id);
    }
    // assistenten (den eneste i staben) og – for AI-hold – en AI-manager med holdets formation
    const mk = (role: 'assistant' | 'manager', first: string, last: string) => {
      const s = makeStaff({ id: g.nextId.staff++, first, last, nation: 0, club: id, role, level: 70, date: g.date, seed });
      g.staff[s.id] = s;
      return s;
    };
    mk('assistant', 'Assistant', t.short);
    if (t.ai) {
      const m = mk('manager', 'AI', t.name);
      m.style = { formation: t.formation, mentality: 2 };
      club.manager = m.id;
      club.tactic = tac;
    } else {
      club.manager = -1;
      const slot = emptySlot(t.pid, t.manager, 0);
      slot.userClub = id;
      slot.tactic = tac;
      slot.knowledge = Object.fromEntries(Object.keys(g.players).map((k) => [Number(k), 100]));
      (g.humans ??= []).push(slot);
    }
  }
  for (const id of Object.keys(g.players).map(Number)) g.knowledge[id] = 100;

  // kampprogram: hver runde én gang om ugen (lørdag)
  const clubIds = teams.map((t) => clubIdOf(t.slot));
  const comp: Competition = {
    id: 'DL', name: 'Draft League', type: 'league', nation: home, tier: 1, clubs: clubIds.slice(),
    table: clubIds.map(emptyRow), ties: [], stage: 'regular', finished: false, pending: 0, meta: { draft: true },
  };
  g.comps.DL = comp;
  const rounds = draftRounds(clubIds, o.settings.rounds);
  rounds.forEach((r, i) => r.forEach(([h, a]) => newFixture('DL', addDays(start, i), h, a, i + 1)));

  // værten er den aktive manager i sin egen browser
  if (g.humans?.length) {
    const host = g.humans.find((h) => h.pid === o.hostPid) ?? g.humans[0];
    activate(host.pid, g);
  }
  for (const h of g.humans ?? []) {
    withHuman(h.pid, () => {
      g.manager.name = h.name;
      addNews({ cat: 'general', key: 'draft.news.season', params: { n: o.season, club: g.clubs[g.userClub]?.name ?? '', rounds: rounds.length } });
    });
  }
  rebuildIndexes();
  return g;
}

/** Hver mod alle (n gange), hjemme/ude skifter */
function draftRounds(clubs: number[], times: number): [number, number][][] {
  const teams = rng.shuffle(clubs.slice());
  if (teams.length % 2) teams.push(-1);
  const n = teams.length;
  const base: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i], b = teams[n - 1 - i];
      if (a === -1 || b === -1) continue;
      round.push(r % 2 === 0 ? (i === 0 ? [a, b] : [b, a]) : i === 0 ? [b, a] : [a, b]);
    }
    base.push(round);
    teams.splice(1, 0, teams.pop()!);
  }
  const out: [number, number][][] = [];
  for (let t = 0; t < Math.max(1, times); t++) for (const r of base) out.push(r.map(([h, a]) => (t % 2 === 0 ? [h, a] : [a, h]) as [number, number]));
  return out;
}


// ---------- i løbet af sæsonen ----------

/** Daglig rutine i en draft-liga: kun kondition, moral og skader (ingen økonomi, transfers, bestyrelse …) */
export function draftDay() {
  const g = gs();
  for (const p of Object.values(g.players)) {
    if (p.injury) {
      p.injury.days--;
      if (p.injury.days <= 0) { p.injury = null; p.condition = Math.min(p.condition, 80); }
    }
    // ingen træthed eller moral i draft-ligaen
    p.condition = 100;
    p.morale = 13;
  }
  // AI-hold henter selv en erstatning for langtidsskadede
  for (const c of Object.values(g.clubs)) {
    if (c.manager === -1) continue;
    for (const p of squad(c.id)) {
      if ((p.injury?.days ?? 0) < REPLACE_DAYS) continue;
      const inn = replacementsFor(p)[0];
      if (inn) replacePlayer(c.id, p.id, inn.id);
    }
  }
}

/** Skader i en draft-liga: kun korte (højst to uger) – eller slet ingen */
export function draftInjuryDays(days: number): number {
  const d = gs().draft;
  if (!d) return days;
  if (!d.settings.injuries) return 0;
  return Math.min(days, 14);
}

/** Fra så mange dage kan en skadet spiller skiftes ud med en udraftet */
export const REPLACE_DAYS = 7;

/** Udraftede spillere der kan erstatte en skadet: målmand for målmand, markspiller for markspiller */
export function replacementsFor(out: Player): Player[] {
  const g = gs();
  const gk = naturalRole(out) === 'GK';
  return Object.values(g.players).filter((p) => !p.club && !p.injury && (naturalRole(p) === 'GK') === gk).sort((a, b) => b.ca - a.ca);
}

export function replacePlayer(clubId: number, outId: number, innId: number): 'ok' | 'notInjured' | 'invalid' {
  const g = gs();
  const out = g.players[outId], inn = g.players[innId];
  if (!out || !inn || out.club !== clubId || inn.club) return 'invalid';
  if ((out.injury?.days ?? 0) < REPLACE_DAYS) return 'notInjured';
  if ((naturalRole(out) === 'GK') !== (naturalRole(inn) === 'GK')) return 'invalid';
  out.club = 0;
  inn.club = clubId;
  const swap = (t: Tactic | null | undefined) => {
    if (!t) return;
    t.lineup = t.lineup.map((id) => (id === outId ? innId : id));
    t.bench = t.bench.map((id) => (id === outId ? innId : id));
  };
  swap(g.clubs[clubId].tactic);
  if (g.userClub === clubId) swap(g.tactic);
  for (const h of g.humans ?? []) if (h.userClub === clubId) swap(h.tactic);
  rebuildIndexes();
  addNews({ cat: 'injury', key: 'draft.news.replaced', params: { out: `${out.first} ${out.last}`.trim(), inn: `${inn.first} ${inn.last}`.trim(), club: g.clubs[clubId].name } }, { all: true });
  return 'ok';
}

/** Ligaen er færdig: start evt. slutspil (top 2 finale eller top 4 semifinaler) */
export function draftLeagueDone(comp: Competition) {
  const g = gs();
  const d = g.draft!;
  const order = finalOrder(comp);
  const last = Object.values(g.fixtures).filter((f) => f.comp === 'DL').reduce((m, f) => (f.date > m ? f.date : m), g.date);
  const n = d.settings.playoff === 'semis' ? 4 : d.settings.playoff === 'final' ? 2 : 0;
  if (!n || order.length < n) return;
  const po: Competition = { id: 'DLPO', name: 'Draft League Playoff', type: 'playoff', nation: g.leagues.DL?.nation ?? 0, tier: 0, clubs: order.slice(0, n), table: [], ties: [], stage: '', finished: false, pending: 0, meta: { draft: true, finalDate: addDays(last, 2) } };
  g.comps.DLPO = po;
  const tie = (a: number, b: number, stage: string, date: string) => {
    const t = { id: g.nextId.tie++, a, b, legs: 1, stage, fx: [] as number[] };
    po.ties.push(t);
    newFixture('DLPO', date, a, b, 1, { stage, tieId: t.id, leg: 1 });
  };
  if (n === 4) {
    po.stage = 'SF';
    tie(order[0], order[3], 'SF', addDays(last, 1));
    tie(order[1], order[2], 'SF', addDays(last, 1));
  } else {
    po.stage = 'F';
    tie(order[0], order[1], 'F', addDays(last, 1));
  }
  addNews({ cat: 'general', key: n === 4 ? 'draft.news.semis' : 'draft.news.final', params: { a: g.clubs[order[0]].name, b: g.clubs[order[1]].name } }, { all: true });
}

compHooks.draftLeagueDone = draftLeagueDone;

/** Er sæsonen slut (liga og evt. slutspil)? Så skrives historikken, og den næste draft kan begynde */
export function draftSeasonCheck(): boolean {
  const g = gs();
  const d = g.draft;
  if (!d) return false;
  if (d.seasonOver) return true;
  const lg = g.comps.DL;
  if (!lg?.finished) return false;
  const po = g.comps.DLPO;
  if (d.settings.playoff !== 'none' && lg.clubs.length >= (d.settings.playoff === 'semis' ? 4 : 2) && !po?.finished) return false;
  const order = finalOrder(lg);
  const rows = new Map(lg.table.map((r) => [r.club, r]));
  // topscorer
  let top: { name: string; goals: number; club: number } | undefined;
  for (const p of Object.values(g.players)) {
    const goals = p.stats.lgGoals;
    if (goals > 0 && (!top || goals > top.goals)) top = { name: `${p.first} ${p.last}`.trim(), goals, club: p.club };
  }
  d.history.push({
    season: d.season, champion: order[0], runnerUp: order[1], playoffWinner: po?.winner, topScorer: top,
    table: order.map((c) => ({ club: c, pts: rows.get(c)?.pts ?? 0, gd: (rows.get(c)?.gf ?? 0) - (rows.get(c)?.ga ?? 0) })),
  });
  for (const r of lg.table) {
    const a: DraftAllTime = (d.allTime[r.club] ??= { club: r.club, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, titles: 0, playoffs: 0 });
    a.p += r.p; a.w += r.w; a.d += r.d; a.l += r.l; a.gf += r.gf; a.ga += r.ga; a.pts += r.pts;
  }
  d.allTime[order[0]].titles++;
  if (po?.winner && d.allTime[po.winner]) d.allTime[po.winner].playoffs++;
  d.seasonOver = true;
  addNews({ cat: 'general', key: 'draft.news.over', params: { n: d.season, club: g.clubs[order[0]].name, po: po?.winner ? g.clubs[po.winner].name : '' } }, { all: true });
  return true;
}

/** Næste drafts rækkefølge: den der sluttede sidst, vælger først */
export function nextDraftOrder(): number[] {
  const g = gs();
  return finalOrder(g.comps.DL).map((c) => c - CLUB_BASE).reverse();
}

/** Klubberne der deltager (til visning af historik på tværs af sæsoner) */
export function draftClubName(id: number): string {
  return gs().clubs[id]?.name ?? '?';
}

export type { Player };

// ---------- draftkarakterer ("eksperten") ----------

export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F';
export interface TeamGrade {
  slot: number;
  grade: Grade;
  /** holdets styrke (gennemsnitlig evne, startere vejer mest) */
  score: number;
  /** sæsonens kup: valgt langt senere, end evnen tilsagde */
  steal?: { player: number; pick: number; rank: number };
  /** overbetalt / for tidligt valgt */
  reach?: { player: number; pick: number; rank: number };
  /** kommentar-nøgle (i18n) */
  line: string;
}

/**
 * Karakter til hvert hold efter draften: holdets styrke i forhold til de andre (startere på deres pladser vejer mest),
 * plus kuppet og det mest tvivlsomme valg. Alt beregnes ud fra valgene og puljen – samme resultat for alle.
 */
export function draftGrades(teams: DraftTeam[], picks: DraftPick[], pool: Player[]): TeamGrade[] {
  const byId: Record<number, Player> = Object.fromEntries(pool.map((p) => [p.id, p]));
  const rank = new Map(pool.map((p, i) => [p.id, i + 1]));
  const out = teams.map((t) => {
    // samme styrke som sæsonprognosen, så karakter og forventet placering hænger sammen
    const score = Math.round(teamLines(t, picks, byId).strength * 10) / 10;
    // kup og tvivlsomme valg (keepers tæller ikke)
    let steal: TeamGrade['steal'], reach: TeamGrade['reach'];
    let stealD = -Infinity, reachD = Infinity;
    picks.forEach((p, n) => {
      if (p.slot !== t.slot || !rank.has(p.player)) return;
      const r = rank.get(p.player)!;
      // auktion: værdi i forhold til prisen; snake: valgt senere/tidligere end evnen tilsagde
      const diff = p.price !== undefined ? marketValue(byId[p.player]) - p.price : n + 1 - r;
      if (!steal || diff > stealD) { steal = { player: p.player, pick: n + 1, rank: r }; stealD = diff; }
      if (!reach || diff < reachD) { reach = { player: p.player, pick: n + 1, rank: r }; reachD = diff; }
    });
    return { slot: t.slot, score, steal, reach };
  });
  const mean = out.reduce((a, x) => a + x.score, 0) / Math.max(1, out.length);
  // spredningen har en bund, så næsten lige stærke hold ikke får ekstreme karakterer
  const sd = Math.max(0.6, Math.sqrt(out.reduce((a, x) => a + (x.score - mean) ** 2, 0) / Math.max(1, out.length)));
  return out.map((x) => {
    const z = (x.score - mean) / sd;
    const grade: Grade = z >= 1.2 ? 'A+' : z >= 0.6 ? 'A' : z >= 0.2 ? 'B+' : z >= -0.2 ? 'B' : z >= -0.6 ? 'C' : z >= -1.2 ? 'D' : 'F';
    const variant = (hash(x.slot, Math.round(x.score * 10)) % 3) + 1;
    return { ...x, grade, line: `dr.grade.${grade}.${variant}` };
  });
}

// ---------- auktionsdraft ----------

export const BUDGET = 200;
export const NOM_SECONDS = 30;

export const teamCount = (team: DraftTeam, picks: DraftPick[]) => teamPicks(team, picks).length;
/** Højeste bud holdet må give: der skal være mindst 1 mio. tilbage pr. ledig plads */
export const maxBidFor = (team: DraftTeam, picks: DraftPick[]) => (team.budget ?? BUDGET) - Math.max(0, SQUAD - teamCount(team, picks) - 1);

/** Næste hold, der skal nominere (samme regel som serveren: fulde hold springes over) */
export function nominatorSlot(order: number[], idx: number, teams: DraftTeam[], picks: DraftPick[]): number | null {
  for (let k = 0; k < order.length; k++) {
    const t = teams.find((x) => x.slot === order[(idx + k) % order.length]);
    if (t && teamCount(t, picks) < SQUAD) return t.slot;
  }
  return null;
}

/** Hvad en spiller "er værd" på auktionen (mio.) – bruges af AI-holdene og af eksperten */
export function marketValue(p: Player): number {
  const r = p.ca / 2;
  return Math.max(1, Math.round(Math.pow(Math.max(0, r - 60) / 37, 2.5) * 75));
}

/** AI-holdets maksimale bud: markedsværdi × behov × lidt personlighed – aldrig over budgetloftet */
export function aiBidLimit(team: DraftTeam, picks: DraftPick[], p: Player, players: Record<number, Player>, benchGK = true): number {
  const places = placesFor(team, picks, p, players, benchGK);
  if (!places.length) return 0;
  const need = places[0] >= 0 ? 1 : 0.4;
  const mood = 0.85 + (hash(p.id, team.slot) % 31) / 100;
  return Math.min(maxBidFor(team, picks), Math.max(1, Math.round(marketValue(p) * need * mood)));
}

// ---------- sæsonprognose ----------

export interface TeamPreview {
  slot: number;
  /** holdets samlede styrke (1-100) */
  strength: number;
  lines: { gk: number; def: number; mid: number; att: number };
  /** nøglespilleren (højeste evne blandt starterne) */
  star?: number;
  /** forventet placering (1 = mester) og pointtal */
  expPos: number;
  expPts: number;
  /** chancer i procent */
  title: number;
  topHalf: number;
  last: number;
}

/** Holdets styrke pr. linje ud fra starterne på deres pladser */
function teamLines(team: DraftTeam, picks: DraftPick[], byId: Record<number, Player>) {
  const slots = formationSlots(team.formation);
  const mine = teamPicks(team, picks).filter((p) => p.place >= 0 && byId[p.player]);
  const group = (pos: string) => (pos === 'GK' ? 'gk' : pos === 'D' || pos === 'SW' || pos === 'WB' ? 'def' : pos === 'DM' || pos === 'M' ? 'mid' : 'att');
  const acc: Record<string, number[]> = { gk: [], def: [], mid: [], att: [] };
  for (const p of mine) {
    const pl = byId[p.player];
    acc[group(slots[p.place].pos)].push((pl.ca / 2) * (0.8 + 0.2 * slotFit(pl, slots[p.place])));
  }
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 50);
  const lines = { gk: avg(acc.gk), def: avg(acc.def), mid: avg(acc.mid), att: avg(acc.att) };
  const bench = teamPicks(team, picks).filter((p) => p.place < 0 && byId[p.player]).map((p) => byId[p.player].ca / 2);
  // midtbane og forsvar vejer lidt mere end målmanden; bænken tæller lidt (udskiftninger)
  const strength = lines.gk * 0.12 + lines.def * 0.3 + lines.mid * 0.3 + lines.att * 0.28 + (avg(bench) - 80) * 0.05;
  const star = mine.slice().sort((a, b) => byId[b.player].ca - byId[a.player].ca)[0]?.player;
  return { lines, strength, star };
}

/**
 * Forventninger til sæsonen: hver kamp får sandsynligheder ud fra styrkeforskellen, og sæsonen simuleres mange gange.
 * Seedet kommer fra valgene, så alle klienter får præcis de samme tal.
 */
export function seasonPreview(teams: DraftTeam[], picks: DraftPick[], pool: Player[], rounds: number, sims = 2000): TeamPreview[] {
  const byId: Record<number, Player> = Object.fromEntries(pool.map((p) => [p.id, p]));
  const info = teams.map((t) => ({ slot: t.slot, ...teamLines(t, picks, byId) }));
  const n = info.length;
  if (n < 2) return [];
  const r = new Rng(hash(picks.length, ...picks.slice(0, 20).map((p) => p.player)));
  const titles = new Array(n).fill(0), tops = new Array(n).fill(0), lasts = new Array(n).fill(0), pts = new Array(n).fill(0), posSum = new Array(n).fill(0);
  const games = Math.max(1, rounds);
  for (let s = 0; s < sims; s++) {
    const p = new Array(n).fill(0);
    const gd = new Array(n).fill(0);
    for (let g = 0; g < games; g++) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const home = g % 2 === 0 ? i : j, away = home === i ? j : i;
        const d = info[home].strength - info[away].strength + 1.2;
        const draw = 0.27 * Math.exp(-Math.abs(d) / 14);
        const win = (1 - draw) / (1 + Math.exp(-d / 3.2));
        const x = r.next();
        if (x < win) { p[home] += 3; gd[home]++; gd[away]--; } else if (x < win + draw) { p[home]++; p[away]++; } else { p[away] += 3; gd[away]++; gd[home]--; }
      }
    }
    const order = p.map((_, i) => i).sort((a, b) => p[b] - p[a] || gd[b] - gd[a] || r.next() - 0.5);
    order.forEach((ti, k) => { posSum[ti] += k + 1; if (k < Math.ceil(n / 2)) tops[ti]++; });
    titles[order[0]]++;
    lasts[order[n - 1]]++;
    for (let i = 0; i < n; i++) pts[i] += p[i];
  }
  const avgPos = posSum.map((v) => v / sims);
  const rankBy = avgPos.map((_, i) => i).sort((a, b) => avgPos[a] - avgPos[b]);
  return info.map((x, i) => ({
    slot: x.slot,
    strength: Math.round(x.strength * 10) / 10,
    lines: { gk: Math.round(x.lines.gk), def: Math.round(x.lines.def), mid: Math.round(x.lines.mid), att: Math.round(x.lines.att) },
    star: x.star,
    expPos: rankBy.indexOf(i) + 1,
    expPts: Math.round(pts[i] / sims),
    title: Math.round((titles[i] / sims) * 100),
    topHalf: Math.round((tops[i] / sims) * 100),
    last: Math.round((lasts[i] / sims) * 100),
  })).sort((a, b) => a.expPos - b.expPos);
}
