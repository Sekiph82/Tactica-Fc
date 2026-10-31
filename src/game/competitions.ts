// Turneringer: kalender, kampprogram, tabeller, pokaler, CL/UEFA og playoffs.
import { compHooks } from './hooks';
import { addDays, nthWeekday, weekday } from './dates';
import { CL_SPOTS, CONF_SPOTS, LEAGUE_RULES, UEFA_NATIONS, UEFA_SPOTS, inBreak, rulesFor } from './leagues';
import { rng } from './rng';
import { addNews, gs, indexFixture, newsRelevant } from './state';
import { forEachHuman } from './humans';
import { celebrateTrophy } from './fans';
import type { Competition, Fixture, MatchResultShort, TableRow, Tie } from './types';

// ---------- kalender ----------

export interface SeasonCalendar {
  saturdays: string[];
  tuesdays: string[];
  cupRounds: string[];
  cupFinal: string;
  cl: { group: string[]; r16: string[]; qf: string[]; sf: string[]; final: string };
  uefa: { r32: string[]; r16: string[]; qf: string[]; sf: string[]; final: string };
  playoff: { sf: string[]; final: string; rel: string[] };
}

export function calendar(y: number): SeasonCalendar {
  const breaks = new Set([nthWeekday(y, 9, 6, 2), nthWeekday(y, 10, 6, 2), nthWeekday(y, 11, 6, 3), nthWeekday(y + 1, 3, 6, 4)]);
  const cupFinal = nthWeekday(y + 1, 5, 6, 2);
  const start = nthWeekday(y, 8, 6, 2);
  const end = nthWeekday(y + 1, 5, 6, 4);
  const saturdays: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) if (!breaks.has(d) && d !== cupFinal) saturdays.push(d);
  // Ekstra juleprogram (2. juledag + nytår) bruges når der er brug for det
  const g1 = nthWeekday(y, 9, 2, 3);
  const cl = {
    group: [0, 14, 35, 49, 70, 84].map((o) => addDays(g1, o)),
    r16: [nthWeekday(y + 1, 2, 2, 3), addDays(nthWeekday(y + 1, 2, 2, 3), 21)],
    qf: [nthWeekday(y + 1, 4, 2, 1), addDays(nthWeekday(y + 1, 4, 2, 1), 7)],
    sf: [nthWeekday(y + 1, 4, 2, 4), addDays(nthWeekday(y + 1, 4, 2, 4), 7)],
    final: addDays(end, 7),
  };
  const uefa = {
    r32: [addDays(g1, 2), addDays(g1, 16)],
    r16: [addDays(g1, 44), addDays(g1, 58)],
    qf: [nthWeekday(y + 1, 2, 4, 3), addDays(nthWeekday(y + 1, 2, 4, 3), 21)],
    sf: [nthWeekday(y + 1, 4, 4, 1), addDays(nthWeekday(y + 1, 4, 4, 1), 14)],
    final: nthWeekday(y + 1, 5, 3, 3),
  };
  const cupRounds = [nthWeekday(y, 8, 3, -1), nthWeekday(y, 9, 3, 4), nthWeekday(y, 10, 3, -1), nthWeekday(y, 12, 3, 1), nthWeekday(y + 1, 1, 3, 3), nthWeekday(y + 1, 2, 3, -1), nthWeekday(y + 1, 4, 3, 3)];
  const busy = new Set([...cl.group, ...cl.r16, ...cl.qf, ...cl.sf, ...cupRounds]);
  const busyWeeks = new Set([...busy].map((d) => addDays(d, -weekday(d))));
  const tuesdays: string[] = [];
  for (let d = nthWeekday(y, 9, 2, 1); d <= nthWeekday(y + 1, 4, 2, -1); d = addDays(d, 7)) {
    if (!busyWeeks.has(addDays(d, -weekday(d)))) tuesdays.push(d);
  }
  const playoff = { sf: [addDays(end, 4), addDays(end, 7)], final: addDays(end, 14), rel: [addDays(end, 5), addDays(end, 9)] };
  return { saturdays, tuesdays, cupRounds, cupFinal, cl, uefa, playoff };
}

/** Ligaens egne kampdage: tidligere sæsonstart (fx Danmark i juli) og ingen kampe i vinterpausen */
export function leagueCalendar(cal: SeasonCalendar, rules: { start?: string; winterBreak?: [string, string] }, season: number): SeasonCalendar {
  let saturdays = cal.saturdays.slice();
  if (rules.start && saturdays.length) {
    const extra: string[] = [];
    let d = `${season}-${rules.start}`;
    while (weekday(d) !== 6) d = addDays(d, 1);
    for (; d < saturdays[0]; d = addDays(d, 7)) extra.push(d);
    saturdays = [...extra, ...saturdays];
  }
  return {
    ...cal,
    saturdays: saturdays.filter((d) => !inBreak(d, rules.winterBreak)),
    tuesdays: cal.tuesdays.filter((d) => !inBreak(d, rules.winterBreak)),
  };
}

/** Vinterpausen i en nations bedste række (bruges også til pokalturneringen) */
function nationBreak(nation: number): [string, string] | undefined {
  const g = gs();
  const top = Object.entries(g.leagues).find(([, l]) => l.nation === nation && l.tier === 1);
  return top ? LEAGUE_RULES[top[0]]?.winterBreak : undefined;
}

/** Vælg n datoer jævnt fordelt fra en sorteret liste */
function spread(dates: string[], n: number): string[] {
  if (n >= dates.length) return dates.slice(0, n);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(dates[Math.round((i * (dates.length - 1)) / Math.max(1, n - 1))]);
  return out;
}

export function leagueDates(cal: SeasonCalendar, rounds: number): string[] {
  if (rounds <= cal.saturdays.length) return spread(cal.saturdays, rounds);
  const extra = spread(cal.tuesdays, rounds - cal.saturdays.length);
  return [...cal.saturdays, ...extra].sort();
}

// ---------- kampprogram ----------

/** Cirkelmetoden – returnerer runder af [hjemme, ude] */
export function roundRobin(clubs: number[]): [number, number][][] {
  const teams = clubs.slice();
  if (teams.length % 2) teams.push(-1);
  const n = teams.length;
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = teams[i], b = teams[n - 1 - i];
      if (a === -1 || b === -1) continue;
      round.push(r % 2 === 0 ? (i === 0 ? [a, b] : [b, a]) : i === 0 ? [b, a] : [a, b]);
    }
    rounds.push(round);
    teams.splice(1, 0, teams.pop()!);
  }
  return rounds;
}

export function multiRoundRobin(clubs: number[], times: number): [number, number][][] {
  const shuffled = rng.shuffle(clubs.slice());
  const base = roundRobin(shuffled);
  const out: [number, number][][] = [];
  for (let t = 0; t < times; t++) {
    for (const r of base) out.push(r.map(([h, a]) => (t % 2 === 0 ? [h, a] : [a, h]) as [number, number]));
  }
  return out;
}

export function newFixture(comp: string, date: string, home: number, away: number, round: number, extra: Partial<Fixture> = {}): Fixture {
  const g = gs();
  const f: Fixture = { id: g.nextId.fixture++, comp, date, home, away, round, ...extra };
  g.fixtures[f.id] = f;
  indexFixture(f.id, date);
  const c = g.comps[comp];
  if (c) c.pending++;
  if (f.tieId && c) c.ties.find((t) => t.id === f.tieId)?.fx.push(f.id);
  return f;
}

export function emptyRow(club: number): TableRow {
  return { club, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: '' };
}

export function sortTable(rows: TableRow[]): TableRow[] {
  const g = gs();
  return rows.sort((a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || (g.clubs[a.club]?.short ?? '').localeCompare(g.clubs[b.club]?.short ?? ''));
}

// ---------- sæsonopsætning ----------

export function setupLeague(id: string, name: string, nation: number, tier: number, clubs: number[], season: number) {
  const g = gs();
  const rules = rulesFor(id, clubs.length);
  const cal = calendar(season);
  const comp: Competition = {
    id, name, type: 'league', nation, tier, clubs: clubs.slice(),
    table: clubs.map(emptyRow), ties: [], stage: 'regular', finished: false, pending: 0,
  };
  g.comps[id] = comp;
  const rounds = multiRoundRobin(clubs, rules.rounds);
  let total = rounds.length;
  if (rules.split) {
    const per = clubs.length / rules.split.groups;
    total = rules.split.after + (per - 1) * rules.split.rounds;
    rounds.length = Math.min(rounds.length, rules.split.after);
  }
  const dates = leagueDates(leagueCalendar(cal, rules, season), total);
  comp.meta = { dates };
  rounds.forEach((r, i) => r.forEach(([h, a]) => newFixture(id, dates[i], h, a, i + 1)));
}

/** Fase 2 i split-ligaer (DK, Skotland, Østrig) */
function generateSplit(comp: Competition) {
  const rules = LEAGUE_RULES[comp.id];
  if (!rules?.split) return;
  const sorted = sortTable(comp.table.slice());
  const per = sorted.length / rules.split.groups;
  const dates = (comp.meta?.dates as string[]) ?? [];
  comp.groups = {};
  for (let gi = 0; gi < rules.split.groups; gi++) {
    const rows = sorted.slice(gi * per, (gi + 1) * per).map((r) => ({ ...r, pts: rules.split!.halvePoints ? Math.ceil(r.pts / 2) : r.pts }));
    const key = gi === 0 ? 'champ' : 'releg';
    comp.groups[key] = rows;
    const clubs = rows.map((r) => r.club);
    const rr = multiRoundRobin(clubs, rules.split.rounds);
    rr.forEach((round, i) => round.forEach(([h, a]) => newFixture(comp.id, dates[rules.split!.after + i] ?? dates[dates.length - 1], h, a, rules.split!.after + i + 1, { stage: key })));
  }
  comp.stage = 'split';
  comp.splitDone = true;
}

export function setupCup(nation: number, name: string, clubs: number[], season: number) {
  const g = gs();
  const id = `CUP-${nation}`;
  const cal = calendar(season);
  const comp: Competition = { id, name, type: 'cup', nation, tier: 0, clubs: clubs.slice(), table: [], ties: [], stage: '', finished: false, pending: 0 };
  g.comps[id] = comp;
  const sorted = clubs.slice().sort((a, b) => g.clubs[b].rep - g.clubs[a].rep);
  let size = 1;
  while (size < sorted.length) size *= 2;
  const byes = size - sorted.length;
  const seeded = sorted.slice(0, byes);
  const rest = rng.shuffle(sorted.slice(byes));
  const roundsTotal = Math.log2(size);
  comp.meta = { roundsTotal, byes: seeded, round: 1 };
  const firstPairs: [number, number][] = [];
  for (let i = 0; i + 1 < rest.length; i += 2) firstPairs.push([rest[i], rest[i + 1]]);
  if (firstPairs.length === 0) {
    // ingen første runde – direkte videre
    drawCupRound(comp, seeded, 2, cal);
    return;
  }
  createCupRound(comp, firstPairs, 1, cal);
}

function cupStageName(round: number, total: number): string {
  const left = total - round;
  return left === 0 ? 'F' : left === 1 ? 'SF' : left === 2 ? 'QF' : `R${round}`;
}

function createCupRound(comp: Competition, pairs: [number, number][], round: number, cal: SeasonCalendar) {
  const g = gs();
  const total = comp.meta!.roundsTotal as number;
  const stage = cupStageName(round, total);
  const idx = Math.max(0, cal.cupRounds.length - (total - 1) + (round - 1));
  let date = stage === 'F' ? cal.cupFinal : cal.cupRounds[Math.min(cal.cupRounds.length - 1, idx)];
  // pokalrunder i vinterpausen flyttes til første onsdag efter pausen
  const brk = comp.nation >= 0 ? nationBreak(comp.nation) : undefined;
  if (stage !== 'F' && inBreak(date, brk)) {
    while (inBreak(date, brk) || weekday(date) !== 3) date = addDays(date, 1);
    if (date >= cal.cupFinal) date = addDays(cal.cupFinal, -7);
  }
  comp.stage = stage;
  comp.meta!.round = round;
  for (const [a, b] of pairs) {
    // lavere rangeret hold får hjemmebane
    const [h, aw] = g.clubs[a].rep < g.clubs[b].rep ? [a, b] : [b, a];
    const tie: Tie = { id: g.nextId.tie++, a: h, b: aw, legs: 1, stage, fx: [] };
    comp.ties.push(tie);
    newFixture(comp.id, date, h, aw, round, { stage, tieId: tie.id, leg: 1 });
  }
}

function drawCupRound(comp: Competition, clubs: number[], round: number, cal: SeasonCalendar) {
  const list = rng.shuffle(clubs.slice());
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  createCupRound(comp, pairs, round, cal);
}

// ---------- europæiske turneringer ----------

export function nationRanking(): number[] {
  const g = gs();
  const byNation = new Map<number, number[]>();
  for (const c of Object.values(g.clubs)) {
    if (g.leagues[c.league]?.tier !== 1) continue;
    if (!UEFA_NATIONS.has(g.nations[c.nation]?.name)) continue;
    if (!byNation.has(c.nation)) byNation.set(c.nation, []);
    byNation.get(c.nation)!.push(c.rep);
  }
  const score = (reps: number[]) => reps.sort((a, b) => b - a).slice(0, 5).reduce((s, v) => s + v, 0);
  return [...byNation.entries()].sort((a, b) => score(b[1]) - score(a[1])).map(([n]) => n);
}

function tier1League(nation: number): string | undefined {
  const g = gs();
  return Object.entries(g.leagues).find(([, l]) => l.nation === nation && l.tier === 1)?.[0];
}

/** Find europæiske deltagere – bruger sluttabeller hvis ligaen blev spillet, ellers reputation */
export function europeanQualifiers(prevTables: Record<string, number[]>, cupWinners: Record<number, number> = {}): { cl: number[]; uefa: number[]; conf: number[] } {
  const g = gs();
  const ranking = nationRanking();
  const cl: number[] = [];
  const uefa: number[] = [];
  const conf: number[] = [];
  ranking.forEach((nation, r) => {
    const lg = tier1League(nation);
    if (!lg) return;
    const order = prevTables[lg] ?? Object.values(g.clubs).filter((c) => c.league === lg).sort((a, b) => b.rep - a.rep).map((c) => c.id);
    const nCL = CL_SPOTS[r] ?? 0;
    const nU = UEFA_SPOTS[r] ?? 0;
    const nC = CONF_SPOTS[r] ?? 0;
    const taken = new Set<number>();
    const take = (arr: number[], n: number) => { for (const c of order) { if (n <= 0) break; if (!taken.has(c)) { arr.push(c); taken.add(c); n--; } } };
    take(cl, nCL);
    // pokalvinderen får en plads i UEFA Cup (er han allerede med, går pladsen videre i tabellen)
    const cup = cupWinners[nation];
    if (cup !== undefined && !taken.has(cup) && g.clubs[cup]) { uefa.push(cup); taken.add(cup); take(uefa, nU); }
    else take(uefa, nU + (cup !== undefined ? 1 : 0)); // pokalvinderen var allerede med: pladsen går videre i tabellen
    take(conf, nC);
  });
  const fill = (arr: number[], n: number, exclude: Set<number>) => {
    if (arr.length > n) arr.length = n;
    if (arr.length < n) {
      const extra = Object.values(g.clubs)
        .filter((c) => !exclude.has(c.id) && !arr.includes(c.id) && UEFA_NATIONS.has(g.nations[c.nation]?.name) && g.leagues[c.league]?.tier === 1)
        .sort((a, b) => b.rep - a.rep);
      for (const c of extra) {
        if (arr.length >= n) break;
        arr.push(c.id);
      }
    }
  };
  fill(cl, 32, new Set());
  fill(uefa, 32, new Set(cl));
  fill(conf, 32, new Set([...cl, ...uefa]));
  return { cl, uefa, conf };
}

export function setupChampionsLeague(clubs: number[], season: number) {
  const g = gs();
  const cal = calendar(season);
  const comp: Competition = { id: 'CL', name: 'Champions League', type: 'continental', nation: -1, tier: 0, clubs: clubs.slice(), table: [], ties: [], stage: 'groups', finished: false, groups: {}, pending: 0 };
  g.comps.CL = comp;
  // 4 potter efter reputation, ingen to fra samme nation i en gruppe (best effort)
  const sorted = clubs.slice().sort((a, b) => g.clubs[b].rep - g.clubs[a].rep);
  const pots = [0, 1, 2, 3].map((i) => rng.shuffle(sorted.slice(i * 8, i * 8 + 8)));
  const groups: number[][] = Array.from({ length: 8 }, () => []);
  for (const pot of pots) {
    for (const club of pot) {
      const nation = g.clubs[club].nation;
      const options = groups.map((_, i) => i).filter((i) => groups[i].length < pots.indexOf(pot) + 1);
      const ok = options.filter((i) => !groups[i].some((c) => g.clubs[c].nation === nation));
      const gi = (ok.length ? ok : options)[0];
      groups[gi].push(club);
    }
  }
  groups.forEach((clubsInGroup, gi) => {
    const key = String.fromCharCode(65 + gi);
    comp.groups![key] = clubsInGroup.map(emptyRow);
    const rr = multiRoundRobin(clubsInGroup, 2);
    rr.forEach((round, ri) => round.forEach(([h, a]) => newFixture('CL', cal.cl.group[ri], h, a, ri + 1, { stage: `G${key}` })));
  });
}

export function setupUefaCup(clubs: number[], season: number, id = 'UEFA', name = 'UEFA Cup') {
  const g = gs();
  const cal = calendar(season);
  const comp: Competition = { id, name, type: 'continental', nation: -1, tier: 0, clubs: clubs.slice(), table: [], ties: [], stage: 'R32', finished: false, pending: 0 };
  g.comps[id] = comp;
  const sorted = clubs.slice().sort((a, b) => g.clubs[b].rep - g.clubs[a].rep);
  const seeds = rng.shuffle(sorted.slice(0, 16));
  const unseeded = rng.shuffle(sorted.slice(16));
  const pairs: [number, number][] = seeds.map((s, i) => [unseeded[i], s]);
  createTwoLegRound(comp, pairs, 'R32', cal.uefa.r32);
}

function createTwoLegRound(comp: Competition, pairs: [number, number][], stage: string, dates: string[]) {
  const g = gs();
  comp.stage = stage;
  for (const [a, b] of pairs) {
    if (a === undefined || b === undefined) continue;
    const tie: Tie = { id: g.nextId.tie++, a, b, legs: 2, stage, fx: [] };
    comp.ties.push(tie);
    newFixture(comp.id, dates[0], a, b, 1, { stage, tieId: tie.id, leg: 1 });
    newFixture(comp.id, dates[1], b, a, 2, { stage, tieId: tie.id, leg: 2 });
  }
}

function createFinal(comp: Competition, a: number, b: number, date: string) {
  const g = gs();
  const tie: Tie = { id: g.nextId.tie++, a, b, legs: 1, stage: 'F', fx: [] };
  comp.ties.push(tie);
  comp.stage = 'F';
  newFixture(comp.id, date, a, b, 1, { stage: 'F', tieId: tie.id, leg: 1 });
}

// ---------- playoffs ----------

export function setupPlayoff(id: string, spec: { seeds: [string, number][]; format: 'semis' | 'final2'; winnerTo: string; loserTo?: string }, season: number) {
  const g = gs();
  const cal = calendar(season);
  const clubs: number[] = [];
  for (const [lg, pos] of spec.seeds) {
    const comp = g.comps[lg];
    if (!comp) return;
    const table = comp.tier > 1 ? promotionOrder(comp) : finalOrder(comp);
    const club = table[pos - 1];
    if (club) clubs.push(club);
  }
  if (clubs.length < 2) return;
  const comp: Competition = { id, name: `Playoff ${g.comps[spec.seeds[0][0]].name}`, type: 'playoff', nation: g.comps[spec.seeds[0][0]].nation, tier: 0, clubs, table: [], ties: [], stage: '', finished: false, playoffFor: spec.winnerTo, meta: { spec }, pending: 0 };
  g.comps[id] = comp;
  if (spec.format === 'final2') {
    createTwoLegRound(comp, [[clubs[1], clubs[0]]], 'F2', cal.playoff.rel);
  } else {
    createTwoLegRound(comp, [[clubs[1], clubs[0]], [clubs[3], clubs[2]]], 'SF', cal.playoff.sf);
  }
}

/** Reservehold (fx "Real Sociedad B") må ikke rykke op i samme liga som førsteholdet */
export function isReserveTeam(clubId: number): boolean {
  return /\s(B|II)$/.test(gs().clubs[clubId]?.name ?? '');
}

/** Rækkefølgen for oprykning: som finalOrder, men uden reservehold */
export function promotionOrder(comp: Competition): number[] {
  return finalOrder(comp).filter((c) => !isReserveTeam(c));
}

/**
 * Ligatabellen i rigtig rækkefølge: i en split-liga står hele mesterskabsspillet over nedrykningsspillet,
 * uanset point (rækkerne har sæsonens samlede tal). Bruges til placeringer og visning.
 */
export function leagueRows(comp: Competition): TableRow[] {
  if (comp.type === 'league' && comp.groups && comp.splitDone) {
    const byClub = new Map(comp.table.map((r) => [r.club, r]));
    return finalOrder(comp).map((c) => byClub.get(c)).filter((r): r is TableRow => !!r);
  }
  return sortTable(comp.table.slice());
}

/** Ligaens endelige rækkefølge (respekterer split-grupper) */
export function finalOrder(comp: Competition): number[] {
  if (comp.groups && comp.type === 'league') {
    const champ = sortTable(comp.groups.champ ?? []).map((r) => r.club);
    const releg = sortTable(comp.groups.releg ?? []).map((r) => r.club);
    return [...champ, ...releg];
  }
  return sortTable(comp.table.slice()).map((r) => r.club);
}

// ---------- resultater ----------

function applyRow(row: TableRow, gf: number, ga: number) {
  row.p++;
  row.gf += gf;
  row.ga += ga;
  const res = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
  if (res === 'W') { row.w++; row.pts += 3; } else if (res === 'D') { row.d++; row.pts++; } else row.l++;
  row.form = (row.form + res).slice(-5);
}

/** Registrér resultat i turneringen og håndtér videre runder */
export function recordResult(f: Fixture, res: MatchResultShort) {
  const g = gs();
  f.result = res;
  const comp = g.comps[f.comp];
  if (!comp) return;
  comp.pending--;
  if (comp.type === 'league') {
    const tableList = f.stage && comp.groups?.[f.stage] ? comp.groups[f.stage] : comp.table;
    const h = tableList.find((r) => r.club === f.home);
    const a = tableList.find((r) => r.club === f.away);
    if (h) applyRow(h, res.hg, res.ag);
    if (a) applyRow(a, res.ag, res.hg);
    // også i samlet tabel ved split, så sæsonens totaler kan vises
    if (f.stage && comp.groups?.[f.stage]) {
      const th = comp.table.find((r) => r.club === f.home);
      const ta = comp.table.find((r) => r.club === f.away);
      if (th) applyRow(th, res.hg, res.ag);
      if (ta) applyRow(ta, res.ag, res.hg);
    }
    checkLeagueProgress(comp);
    return;
  }
  if (comp.type === 'continental' && f.stage?.startsWith('G')) {
    const key = f.stage.slice(1);
    const rows = comp.groups![key];
    const h = rows.find((r) => r.club === f.home);
    const a = rows.find((r) => r.club === f.away);
    if (h) applyRow(h, res.hg, res.ag);
    if (a) applyRow(a, res.ag, res.hg);
    checkGroupsDone(comp);
    return;
  }
  if (f.tieId) resolveTie(comp, f);
}

function checkLeagueProgress(comp: Competition) {
  const g = gs();
  if (comp.pending > 0) return;
  // draft-liga: mester og evt. slutspil
  if (comp.meta?.draft) {
    comp.finished = true;
    comp.winner = finalOrder(comp)[0];
    compHooks.draftLeagueDone?.(comp);
    return;
  }
  const rules = LEAGUE_RULES[comp.id];
  if (rules?.split && !comp.splitDone) {
    generateSplit(comp);
    // kun til managere, hvis klub spiller i ligaen
    forEachHuman(() => { if (g.clubs[g.userClub]?.league === comp.id) addNews({ cat: 'general', key: 'news.split', params: { comp: comp.name } }); });
    return;
  }
  comp.finished = true;
  const order = finalOrder(comp);
  comp.winner = order[0];
  forEachHuman(() => { if (newsRelevant(...comp.clubs)) addNews({ cat: 'general', key: 'news.champions', params: { club: g.clubs[order[0]].name, comp: comp.name }, link: { kind: 'comp', id: comp.id } }); });
  celebrateTrophy(order[0], comp.name, 'league');
  if (rules?.playoff) {
    // Playoffs startes når alle involverede ligaer er færdige
    const leagues = [...new Set(rules.playoff.seeds.map((s) => s[0]))];
    if (leagues.every((l) => g.comps[l]?.finished)) setupPlayoff(`PO-${comp.id}`, rules.playoff, g.season);
  }
  // Ligaer der er "seed" i en anden ligas playoff (fx L2 3. plads i L1-playoff)
  for (const [lid, r] of Object.entries(LEAGUE_RULES)) {
    if (lid === comp.id || !r.playoff) continue;
    if (!r.playoff.seeds.some((s) => s[0] === comp.id)) continue;
    const leagues = [...new Set(r.playoff.seeds.map((s) => s[0]))];
    if (leagues.every((l) => g.comps[l]?.finished) && !g.comps[`PO-${lid}`]) setupPlayoff(`PO-${lid}`, r.playoff, g.season);
  }
}

function checkGroupsDone(comp: Competition) {
  const g = gs();
  if (comp.pending > 0) return;
  const winners: number[] = [];
  const runners: number[] = [];
  const groupOf = new Map<number, string>();
  for (const [key, rows] of Object.entries(comp.groups!)) {
    const s = sortTable(rows.slice());
    winners.push(s[0].club);
    runners.push(s[1].club);
    groupOf.set(s[0].club, key);
    groupOf.set(s[1].club, key);
  }
  const cal = calendar(g.season);
  // Vinder møder toer fra anden gruppe
  const r = rng.shuffle(runners.slice());
  const pairs: [number, number][] = [];
  for (const w of rng.shuffle(winners.slice())) {
    let idx = r.findIndex((x) => groupOf.get(x) !== groupOf.get(w));
    if (idx < 0) idx = 0;
    pairs.push([r.splice(idx, 1)[0], w]);
  }
  createTwoLegRound(comp, pairs, 'R16', cal.cl.r16);
}

/** Afgør om en kamp (på resultatet hg-ag) skal have en vinder fundet i forlænget/straffe */
export function needsWinnerFn(f: Fixture): ((hg: number, ag: number) => boolean) | undefined {
  const g = gs();
  if (!f.tieId) return undefined;
  const comp = g.comps[f.comp];
  const tie = comp?.ties.find((t) => t.id === f.tieId);
  if (!tie) return undefined;
  if (tie.legs === 1) return (hg, ag) => hg === ag;
  if (f.leg !== 2) return undefined;
  const first = tie.fx.map((id) => g.fixtures[id]).find((x) => x?.leg === 1);
  if (!first?.result) return undefined;
  // første kamp: hjemme = tie.a. Anden: hjemme = tie.b
  const a1 = first.result.hg, b1 = first.result.ag;
  return (hg, ag) => {
    const aggA = a1 + ag, aggB = b1 + hg;
    if (aggA !== aggB) return false;
    // udebanemål
    return ag === b1;
  };
}

function resolveTie(comp: Competition, f: Fixture) {
  const g = gs();
  const tie = comp.ties.find((t) => t.id === f.tieId);
  if (!tie) return;
  const res = f.result!;
  if (tie.legs === 1) {
    if (res.hg !== res.ag) tie.winner = res.hg > res.ag ? f.home : f.away;
    else if (res.pens) tie.winner = res.pens[0] > res.pens[1] ? f.home : f.away;
    else tie.winner = rng.chance(0.5) ? f.home : f.away;
  } else {
    if (f.leg !== 2) return;
    const first = tie.fx.map((id) => g.fixtures[id]).find((x) => x?.leg === 1);
    if (!first?.result) return;
    const aggA = first.result.hg + res.ag;
    const aggB = first.result.ag + res.hg;
    if (aggA !== aggB) tie.winner = aggA > aggB ? tie.a : tie.b;
    else if (res.ag !== first.result.ag) tie.winner = res.ag > first.result.ag ? tie.a : tie.b;
    else if (res.pens) tie.winner = res.pens[0] > res.pens[1] ? f.home : f.away;
    else tie.winner = rng.chance(0.5) ? tie.a : tie.b;
  }
  advance(comp, tie.stage);
}

function advance(comp: Competition, stage: string) {
  const g = gs();
  const stageTies = comp.ties.filter((t) => t.stage === stage);
  if (stageTies.some((t) => !t.winner)) return;
  const winners = stageTies.map((t) => t.winner!);
  const cal = calendar(g.season);
  if (stage === 'F' || stage === 'F2' || winners.length === 1 && comp.type !== 'cup') {
    comp.finished = true;
    comp.winner = winners[0];
    const runnerUp = stageTies[0].a === winners[0] ? stageTies[0].b : stageTies[0].a;
    comp.meta = { ...(comp.meta ?? {}), runnerUp };
    forEachHuman(() => { if (comp.type === 'continental' || newsRelevant(...comp.clubs)) addNews({ cat: 'general', key: comp.type === 'playoff' ? 'news.playoffWin' : 'news.cupWin', params: { club: g.clubs[winners[0]].name, comp: comp.name }, link: { kind: 'comp', id: comp.id } }); });
    if (comp.type !== 'playoff') celebrateTrophy(winners[0], comp.name, comp.type === 'continental' ? 'europe' : 'cup');
    return;
  }
  if (comp.type === 'cup') {
    const round = (comp.meta!.round as number) + 1;
    const byes = (comp.meta!.byes as number[]) ?? [];
    const pool = round === 2 ? [...winners, ...byes] : winners;
    comp.meta!.byes = [];
    if (pool.length === 2) {
      createFinal(comp, pool[0], pool[1], cal.cupFinal);
      comp.meta!.round = round;
      return;
    }
    drawCupRound(comp, pool, round, cal);
    return;
  }
  if (comp.type === 'playoff') {
    if (winners.length === 2) createFinal(comp, winners[0], winners[1], (comp.meta?.finalDate as string | undefined) ?? cal.playoff.final);
    return;
  }
  // kontinental
  const list = rng.shuffle(winners.slice());
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  const isCL = comp.id === 'CL';
  if (list.length === 2) {
    createFinal(comp, list[0], list[1], isCL ? cal.cl.final : cal.uefa.final);
    return;
  }
  const next = list.length === 16 ? 'R16' : list.length === 8 ? 'QF' : 'SF';
  const dates = isCL ? (next === 'QF' ? cal.cl.qf : cal.cl.sf) : next === 'R16' ? cal.uefa.r16 : next === 'QF' ? cal.uefa.qf : cal.uefa.sf;
  createTwoLegRound(comp, pairs, next, dates);
}

export function compPrize(compId: string, stage: string): number {
  if (compId === 'CL') return ({ G: 2_500_000, R16: 11_000_000, QF: 12_500_000, SF: 15_000_000, F: 18_000_000 } as Record<string, number>)[stage] ?? 0;
  if (compId === 'UEFA') return ({ R32: 1_000_000, R16: 1_500_000, QF: 2_500_000, SF: 4_000_000, F: 6_000_000 } as Record<string, number>)[stage] ?? 0;
  if (compId === 'UECL') return ({ R32: 500_000, R16: 800_000, QF: 1_200_000, SF: 2_000_000, F: 3_000_000 } as Record<string, number>)[stage] ?? 0;
  return 0;
}

/**
 * Ældre gem fra før Conference League: tilføj turneringen til den igangværende sæson, hvis den
 * første runde ikke er spillet endnu. Sidste sæsons slutstillinger findes i klubbernes historik.
 */
export function addMissingConference(): boolean {
  const g = gs();
  if (g.comps.UECL || !g.comps.UEFA || g.humans?.some((h) => !h.bot && h.pid !== g.active)) return false;
  const cal = calendar(g.season);
  if (g.date >= cal.uefa.r32[0]) return false;
  const prevTables: Record<string, number[]> = {};
  for (const c of Object.values(g.clubs)) {
    const h = c.history.find((x) => x.season === g.season - 1);
    if (!h || g.leagues[h.league]?.tier !== 1) continue;
    (prevTables[h.league] ??= [])[h.pos - 1] = c.id;
  }
  for (const k of Object.keys(prevTables)) prevTables[k] = prevTables[k].filter((x) => x !== undefined);
  const cupWinners: Record<number, number> = {};
  for (const c of g.seasonHistory.at(-1)?.comps ?? []) if (c.id.startsWith('CUP-') && c.winner) cupWinners[Number(c.id.slice(4))] = c.winner;
  // allerede kvalificerede (CL/UEFA) bevares; Conference League fyldes efter de nye regler
  const inEurope = new Set([...g.comps.CL?.clubs ?? [], ...g.comps.UEFA.clubs]);
  const conf = europeanQualifiers(prevTables, cupWinners).conf.filter((id) => !inEurope.has(id));
  if (conf.length < 32) {
    const extra = Object.values(g.clubs).filter((c) => !inEurope.has(c.id) && !conf.includes(c.id) && UEFA_NATIONS.has(g.nations[c.nation]?.name) && g.leagues[c.league]?.tier === 1).sort((a, b) => b.rep - a.rep);
    for (const c of extra) { if (conf.length >= 32) break; conf.push(c.id); }
  }
  setupUefaCup(conf.slice(0, 32), g.season, 'UECL', 'Conference League');
  return true;
}
