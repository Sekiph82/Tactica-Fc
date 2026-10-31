// Opret et nyt spil ud fra world.json
import { startScoreSeason } from './rating';
import { naturalRole } from './attributes';
import { europeanQualifiers, setupChampionsLeague, setupCup, setupLeague, setupUefaCup } from './competitions';
import { ageOn } from './dates';
import {
  caFromValue, makePlayer, makeStaff, randomDob, randomName, valueFromCA, wageFor, type SubPos,
} from './data/generate';
import { rulesFor, LEAGUE_RULES } from './leagues';
import { Rng, hash, rng } from './rng';
import { addNews, addPlayer, gs, rebuildIndexes, setGame, squad } from './state';
import { initReleaseClauses } from './clauses';
import { refreshShortlists, windowLastDay, windowOpen } from './transfers';
import { autoSelect, newTactic, FORMATIONS } from './tactics';
import type { Club, GameState, Lang, Player, Role, Staff, StaffRole } from './types';
import type { CMWorld } from './data/cm0102';
import { setBoardExpectation } from './board';
import { fairTicketPrice, transferBudgetFor } from './finance';
import { initKnowledge } from './scouting';
import { CHALLENGES } from './challenges';
import { monthlyDevelopment, recordDevelopment } from './training';

export interface WorldData {
  version: number;
  source: string;
  season: number;
  nations: { name: string; code: string }[];
  leagues: { id: string; name: string; nation: number; tier: number }[];
  clubs: [number, string, string, number, string, string, number, string][];
  playerFields: string[];
  players: (string | number)[][];
  names: Record<string, [string[], string[]]>;
}

export interface NewGameOptions {
  managerName: string;
  managerNation: number;
  clubId: number;
  activeNations: number[];
  lang: Lang;
  masking: boolean;
  seed: number;
  challenge?: string;
  /** Online: frist pr. træk i timer (0 = ingen) */
  deadlineHours?: number;
}

const PALETTE = ['#c8102e', '#003399', '#ffffff', '#111111', '#ffd200', '#00843d', '#6cabdd', '#7a263a', '#f68b1f', '#5c2d91', '#0057b8', '#e30613'];

export const START_DATE = (season: number) => `${season}-07-01`;

export function createGame(world: WorldData, o: NewGameOptions): GameState {
  const season = world.season;
  const date = START_DATE(season);
  const seed = o.seed >>> 0;
  rng.state = seed || 1;
  const names: Record<number, [string[], string[]]> = {};
  for (const [k, v] of Object.entries(world.names)) names[Number(k)] = v;

  const g: GameState = {
    version: 1,
    id: `save-${Date.now().toString(36)}`,
    seed,
    rng: rng.state,
    date,
    season,
    lang: o.lang,
    userClub: o.clubId,
    manager: { name: o.managerName, nation: o.managerNation, rep: 40, history: [], trophies: [], sacked: 0 },
    board: { confidence: 60, expectation: 'mid', expectedPos: 10, warnings: 0 },
    options: { masking: o.masking, autosave: true, matchSpeed: 650, fullCommentary: true, rules: world.source.startsWith('Championship Manager 01/02') ? 'classic' : 'modern' },
    activeNations: o.activeNations.slice(),
    nations: world.nations,
    leagueOrder: world.leagues.map((l) => l.id),
    leagues: Object.fromEntries(world.leagues.map((l) => [l.id, { name: l.name, nation: l.nation, tier: l.tier }])),
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
    names,
    nextId: { player: 10_000_000, staff: 1, news: 1, fixture: 1, offer: 1, tie: 1 },
    pendingFixture: null,
    dayDone: false,
    vacancies: [],
    jobOffers: [],
  };
  const cm = (world as Partial<CMWorld>).kind === 'cm0102' ? (world as CMWorld) : null;
  if (cm) { g.dbKind = 'cm0102'; g.customRules = cm.rules as GameState['customRules']; }
  setGame(g);

  const leagueById = new Map(world.leagues.map((l) => [l.id, l]));

  // Klubber
  for (const [id, name, short, nation, league, stadium, seats] of world.clubs) {
    const h = hash(id);
    g.clubs[id] = {
      id, name, short, nation, league, stadium: stadium || `${short} Stadium`, seats: seats || 5000,
      rep: 30, balance: 0, transferBudget: 0, wageBudget: 0, youth: 10, facilities: 10,
      colors: [PALETTE[h % PALETTE.length], PALETTE[(h >>> 8) % PALETTE.length]],
      manager: 0, tactic: null,
      finance: emptyFinance(),
      history: [],
      ticketPrice: 25,
    };
    if (g.clubs[id].colors[0] === g.clubs[id].colors[1]) g.clubs[id].colors[1] = g.clubs[id].colors[0] === '#ffffff' ? '#111111' : '#ffffff';
  }

  // Spillere
  const F = Object.fromEntries(world.playerFields.map((f, i) => [f, i]));
  for (const r of world.players) {
    const club = r[F.club] as number;
    if (club && !g.clubs[club]) continue;
    const dob = r[F.dob] as string;
    const age = ageOn(dob, date);
    const value = r[F.value] as number;
    const league = club ? g.clubs[club].league : '';
    const wealth = league ? rulesFor(league, 20).wealth : 0.5;
    const p = makePlayer({
      id: r[F.id] as number, first: r[F.first] as string, last: r[F.last] as string, dob, nation: r[F.nation] as number,
      club, sub: r[F.pos] as SubPos, foot: r[F.foot] as Player['foot'], height: r[F.height] as number,
      ca: cm?.ratings[r[F.id] as number]?.ca ?? caFromValue(value, age), value, caps: r[F.caps] as number, intGoals: r[F.intGoals] as number,
      stats: { apps: r[F.apps] as number, minutes: r[F.minutes] as number, goals: r[F.goals] as number, assists: r[F.assists] as number, yellows: r[F.yellows] as number, reds: r[F.reds] as number },
      contractEnd: (r[F.contract] as string) || undefined, date, seed, wealth,
    });
    // CM 01/02: originalens evner, potentiale og positioner
    const rt = cm?.ratings[p.id];
    if (rt) {
      // evner originalen ikke har sat (0) beholder rolleprofilen fra position og CA
      p.ca = rt.ca; p.pa = Math.max(rt.ca, rt.pa); p.attrs = rt.attrs.map((v, i) => (v > 0 ? v : p.attrs[i])); p.pos = rt.pos.slice(); p.side = rt.side.slice();
    }
    if (!value) p.value = valueFromCA(p.ca, p.pa, age);
    addPlayer(p);
  }

  // Fyld trupper op
  const leagueLevel = new Map<string, number>();
  for (const l of world.leagues) {
    const cas: number[] = [];
    for (const c of Object.values(g.clubs)) {
      if (c.league !== l.id) continue;
      const sq = squad(c.id);
      if (sq.length >= 12) cas.push(median(sq.map((p) => p.ca)));
    }
    leagueLevel.set(l.id, cas.length ? median(cas) : l.tier === 2 ? 85 : 95);
  }
  for (const c of Object.values(g.clubs)) {
    const sq = squad(c.id);
    const lvl = sq.length >= 12 ? median(sq.map((p) => p.ca)) : (leagueLevel.get(c.league) ?? 90) - 4;
    fillSquad(c, sq, lvl, date, seed);
  }

  // Reputation og økonomi
  for (const c of Object.values(g.clubs)) {
    const sq = squad(c.id);
    const values = sq.map((p) => p.value).sort((a, b) => b - a).slice(0, 20);
    const sv = values.reduce((s, v) => s + v, 0);
    c.rep = cm?.clubRep[c.id] ?? Math.round(Math.max(5, Math.min(98, (Math.log10(Math.max(sv, 1e6)) - 6) * 30)));
    const lg = leagueById.get(c.league);
    if (lg?.tier === 2) c.rep = Math.min(c.rep, 62);
    if (cm?.clubColors[c.id]) c.colors = cm.clubColors[c.id];
    const wealth = rulesFor(c.league, 20).wealth;
    for (const p of sq) if (p.contract) p.contract.wage = wageFor(p.value, wealth);
    const wages = sq.reduce((s, p) => s + (p.contract?.wage ?? 0), 0);
    c.wageBudget = Math.round((wages * 1.08) / 1000) * 1000;
    c.balance = Math.round((sv * 0.12 + wages * 30) / 100_000) * 100_000;
    c.transferBudget = transferBudgetFor(sv, wealth, c.balance);
    c.youth = clampInt(4 + c.rep / 7 + (hash(c.id, 3) % 5) - 2, 1, 20);
    c.facilities = clampInt(3 + c.rep / 6 + (hash(c.id, 4) % 5) - 2, 1, 20);
    c.ticketPrice = fairTicketPrice(c.rep, c.league);
    if (!c.seats || c.seats < 1000) c.seats = Math.round(2000 + c.rep * c.rep * 6);
  }

  // Staff
  for (const c of Object.values(g.clubs)) createClubStaff(c, world, seed, date);
  for (let i = 0; i < 160; i++) {
    const r = new Rng(hash(seed, 5000 + i));
    const nation = rng.pick(o.activeNations.length ? o.activeNations : [0]);
    const [first, last] = randomName(names, nation, r);
    const role: StaffRole = (['coach', 'coach', 'scout', 'physio', 'assistant', 'manager'] as StaffRole[])[i % 6];
    const s = makeStaff({ id: g.nextId.staff++, first, last, nation, club: 0, role, level: r.int(15, 70), date, seed });
    g.staff[s.id] = s;
  }

  // Turneringer for aktive nationer
  setupSeasonComps(season, {});

  // Brugerens klub
  const club = g.clubs[o.clubId];
  takeOverClub(club);
  initKnowledge();
  monthlyDevelopment();
  if (o.challenge) {
    const ch = CHALLENGES.find((c) => c.id === o.challenge);
    if (ch) {
      g.challenge = { id: ch.id, deadlineSeason: season + ch.seasons - 1 };
      ch.setup?.(g);
    }
  }
  initReleaseClauses();
  refreshShortlists();
  startScoreSeason();
  addNews({ cat: 'general', key: 'news.welcome', params: { manager: o.managerName, club: club.name } });
  g.manager.onboard = {};
  if (windowOpen()) addNews({ cat: 'transfer', key: 'window.opened', params: { date: windowLastDay() ?? g.date } });
  addNews({ cat: 'finance', key: 'sponsor.offers', params: {} });
  rebuildIndexes();
  return g;
}

export function setupSeasonComps(season: number, prevTables: Record<string, number[]>, cupWinners: Record<number, number> = {}) {
  const g = gs();
  const active = new Set(g.activeNations);
  const byLeague = new Map<string, number[]>();
  for (const c of Object.values(g.clubs)) {
    if (!byLeague.has(c.league)) byLeague.set(c.league, []);
    byLeague.get(c.league)!.push(c.id);
  }
  const leaguesMeta = new Map(Object.entries(g.leagues).filter(([id]) => byLeague.has(id)));
  for (const [id, m] of leaguesMeta) {
    if (!active.has(m.nation)) continue;
    setupLeague(id, m.name, m.nation, m.tier, byLeague.get(id)!, season);
  }
  for (const nation of active) {
    const leagues = [...leaguesMeta.entries()].filter(([, m]) => m.nation === nation).map(([id]) => id);
    const cupName = leagues.map((l) => LEAGUE_RULES[l]?.cup).find(Boolean);
    const clubs = leagues.flatMap((l) => byLeague.get(l) ?? []);
    if (clubs.length >= 8) setupCup(nation, cupName ?? `${g.nations[nation].name} Cup`, clubs, season);
  }
  const { cl, uefa, conf } = europeanQualifiers(prevTables, cupWinners);
  setupChampionsLeague(cl, season);
  setupUefaCup(uefa, season);
  setupUefaCup(conf, season, 'UECL', 'Conference League');
}

export function takeOverClub(club: Club) {
  const g = gs();
  const old = g.staff[club.manager];
  if (old) {
    old.club = 0;
  }
  club.manager = -1;
  g.userClub = club.id;
  const sq = squad(club.id);
  // vælg formationen der passer bedst til truppen
  let best = newTactic('4-4-2');
  let bestScore = -1;
  for (const f of FORMATIONS) {
    const t = autoSelect(newTactic(f), sq, false);
    const score = t.lineup.reduce((s, id) => s + (g.players[id]?.ca ?? 0), 0);
    if (score > bestScore + 5) { bestScore = score; best = t; }
  }
  g.tactic = best;
  for (const p of sq) recordDevelopment(p);
  g.board = { confidence: 65, expectation: 'mid', expectedPos: 10, warnings: 0 };
  setBoardExpectation();
}

function createClubStaff(c: Club, world: WorldData, seed: number, date: string) {
  const g = gs();
  const r = new Rng(hash(seed, c.id, 99));
  const coach = world.clubs.find((x) => x[0] === c.id)?.[7] ?? '';
  const mk = (role: StaffRole, level: number) => {
    let first: string, last: string;
    if (role === 'manager' && coach) {
      const parts = coach.split(' ');
      first = parts.length > 1 ? parts[0] : '';
      last = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
    } else {
      [first, last] = randomName(g.names, c.nation, r);
    }
    const s = makeStaff({ id: g.nextId.staff++, first, last, nation: c.nation, club: c.id, role, level, date, seed });
    g.staff[s.id] = s;
    return s;
  };
  const lvl = c.rep;
  const m = mk('manager', lvl + r.int(-5, 5));
  c.manager = m.id;
  mk('assistant', lvl - 5);
  const coaches = 2 + Math.floor(c.rep / 25);
  for (let i = 0; i < coaches; i++) mk('coach', lvl - 8 + r.int(-6, 6));
  mk('physio', lvl - 5);
  if (c.rep > 55) mk('physio', lvl - 10);
  const scouts = 1 + Math.floor(c.rep / 30);
  for (let i = 0; i < scouts; i++) mk('scout', lvl - 8 + r.int(-6, 6));
}

const NEED: [SubPos, number][] = [['GK', 3], ['CB', 4], ['LB', 2], ['RB', 2], ['DM', 2], ['CM', 3], ['LW', 1], ['RW', 1], ['LM', 1], ['RM', 1], ['AM', 1], ['CF', 3]];
const ROLE_OF: Record<SubPos, Role> = { GK: 'GK', CB: 'CB', LB: 'FB', RB: 'FB', DM: 'DM', CM: 'CM', AM: 'AM', LM: 'WM', RM: 'WM', LW: 'W', RW: 'W', CF: 'ST', SS: 'ST' };

/** Generér spillere så truppen dækker alle positioner (bruges til 2. divisioner og tynde trupper) */
export function fillSquad(c: Club, sq: Player[], level: number, date: string, seed: number, min = 22) {
  const g = gs();
  const have = new Map<Role, number>();
  for (const p of sq) {
    const role = naturalRole(p);
    have.set(role, (have.get(role) ?? 0) + 1);
  }
  const r = new Rng(hash(seed, c.id, 1234));
  const needed: SubPos[] = [];
  const roleNeed = new Map<Role, number>();
  for (const [sub, n] of NEED) roleNeed.set(ROLE_OF[sub], (roleNeed.get(ROLE_OF[sub]) ?? 0) + n);
  for (const [sub, n] of NEED) {
    const role = ROLE_OF[sub];
    const count = have.get(role) ?? 0;
    const want = roleNeed.get(role)!;
    if (count < want) {
      const add = Math.min(n, want - count);
      for (let i = 0; i < add; i++) needed.push(sub);
      have.set(role, count + add);
    }
  }
  let total = sq.length + needed.length;
  while (total < min) { needed.push(r.pick(['CB', 'CM', 'CF', 'DM', 'LB', 'RW'] as SubPos[])); total++; }
  const wealth = rulesFor(c.league, 20).wealth;
  for (const sub of needed) {
    const nation = r.chance(0.82) ? c.nation : r.pick(Object.keys(g.names).map(Number));
    const [first, last] = randomName(g.names, nation, r);
    const age = r.int(18, 33);
    const id = g.nextId.player++;
    const p = makePlayer({
      id, first, last, dob: randomDob(age, date, r), nation, club: c.id, sub, foot: r.chance(0.25) ? 'L' : 'R', height: 0,
      ca: level + r.normal(-3, 9), date, seed, wealth,
    });
    addPlayer(p);
  }
}

function emptyFinance() {
  return { gate: 0, tv: 0, prize: 0, sponsor: 0, merch: 0, transfersIn: 0, transfersOut: 0, wages: 0, other: 0 };
}

export { emptyFinance };

function median(a: number[]) {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function clampInt(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

export type { Staff };
