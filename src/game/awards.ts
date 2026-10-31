// Priser og kåringer (forslag #10): månedens spiller/manager, årets hold, Ballon d'Or, gallaaften.
import { naturalRole } from './attributes';
import { finalOrder, leagueRows } from './competitions';
import { forEachHuman, humanManager } from './humans';
import { addNews, gs, squad } from './state';
import type { Competition, MonthAward, Player, Role, SeasonSummary } from './types';

const pname = (p: Player) => `${p.first} ${p.last}`.trim();
const avg = (p: Player) => (p.stats.ratingCount ? p.stats.ratingSum / p.stats.ratingCount : 0);

function activeLeagues(): Competition[] {
  const g = gs();
  return Object.values(g.comps).filter((c) => c.type === 'league' && (g.leagues[c.id]?.tier ?? 9) <= 2);
}

function managerName(clubId: number): string {
  const g = gs();
  const c = g.clubs[clubId];
  if (!c) return '?';
  if (c.manager === -1) return humanManager(clubId)?.name ?? '?';
  const s = g.staff[c.manager];
  return s ? `${s.first} ${s.last}`.trim() : '?';
}

/** Gem tilstand ved månedens start, så månedens præstationer kan måles */
export function snapshotMonth() {
  const g = gs();
  const players: Record<number, [number, number, number]> = {};
  const tables: Record<string, Record<number, number>> = {};
  for (const comp of activeLeagues()) {
    tables[comp.id] = Object.fromEntries(comp.table.map((r) => [r.club, r.pts]));
    for (const cid of comp.clubs) for (const p of squad(cid)) players[p.id] = [p.stats.ratingSum, p.stats.ratingCount, p.stats.lgGoals];
  }
  g.monthSnap = { players, tables };
}

/** Kåringer for den forgangne måned – kaldes den 1. i hver måned før ny snapshot */
export function monthlyAwards() {
  const g = gs();
  const snap = g.monthSnap;
  if (!snap) { snapshotMonth(); return; }
  const prev = new Date(g.date + 'T00:00:00Z');
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const month = prev.toISOString().slice(0, 7);
  for (const comp of activeLeagues()) {
    const before = snap.tables[comp.id];
    if (!before) continue;
    // månedens manager: flest point (måldifference som tiebreak via tabellens sortering)
    let bestClub = 0, bestPts = -1;
    for (const r of leagueRows(comp)) {
      const gained = r.pts - (before[r.club] ?? 0);
      if (gained > bestPts) { bestPts = gained; bestClub = r.club; }
    }
    if (bestPts <= 0) continue; // ingen kampe i måneden
    // månedens spiller: bedste snit med mindst 3 kampe, mål tæller med
    let best: Player | null = null, bestScore = -1;
    for (const cid of comp.clubs) {
      for (const p of squad(cid)) {
        const s = snap.players[p.id];
        if (!s) continue;
        const n = p.stats.ratingCount - s[1];
        if (n < 3) continue;
        const rating = (p.stats.ratingSum - s[0]) / n;
        const goals = p.stats.lgGoals - s[2];
        const score = rating + goals * 0.12;
        if (score > bestScore) { bestScore = score; best = p; }
      }
    }
    if (!best) continue;
    const award: MonthAward = { month, comp: comp.id, player: best.id, manager: bestClub, managerName: managerName(bestClub) };
    (g.monthAwards ??= []).push(award);
    const winner = best;
    forEachHuman(() => {
      const myLeague = g.clubs[g.userClub]?.league;
      if (myLeague !== comp.id) return;
      addNews({ cat: 'award', key: 'award.monthPlayer', params: { player: pname(winner), club: g.clubs[winner.club]?.short ?? '', comp: comp.name }, link: { kind: 'player', id: winner.id } });
      if (bestClub === g.userClub) {
        g.manager.trophies.push({ season: g.season, comp: `${comp.name} – manager of the month ${month}`, club: g.userClub });
        addNews({ cat: 'award', key: 'award.monthManagerMe', params: { comp: comp.name, pts: bestPts } });
      } else addNews({ cat: 'award', key: 'award.monthManager', params: { manager: award.managerName, club: g.clubs[bestClub]?.short ?? '', comp: comp.name } });
    });
  }
  snapshotMonth();
}

const XI: Role[] = ['GK', 'FB', 'CB', 'CB', 'FB', 'WM', 'CM', 'CM', 'WM', 'ST', 'ST'];
const FALLBACK: Record<Role, Role[]> = { GK: [], FB: ['CB'], CB: ['FB', 'DM'], DM: ['CM'], CM: ['DM', 'AM'], WM: ['W', 'AM'], AM: ['CM', 'W'], W: ['WM', 'AM'], ST: ['AM', 'W'] };

/** Årets hold (4-4-2) for en liga */
export function teamOfYear(comp: Competition): number[] {
  const games = Math.max(...comp.table.map((r) => r.p), 1);
  const pool = comp.clubs.flatMap((c) => squad(c)).filter((p) => p.stats.lgApps >= games * 0.4);
  const used = new Set<number>();
  const pickRole = (roles: Role[]) => {
    const cand = pool.filter((p) => !used.has(p.id) && roles.includes(naturalRole(p))).sort((a, b) => avg(b) + b.stats.lgGoals * 0.03 - (avg(a) + a.stats.lgGoals * 0.03))[0];
    if (cand) used.add(cand.id);
    return cand?.id ?? 0;
  };
  return XI.map((r) => pickRole([r]) || pickRole(FALLBACK[r]));
}

/** Sæsonens største overraskelse: klubben der sluttede længst over sin forventning */
export function surpriseOfSeason(comp: Competition): { club: number; expected: number; actual: number } | undefined {
  const g = gs();
  const order = finalOrder(comp);
  const byRep = order.slice().sort((a, b) => g.clubs[b].rep - g.clubs[a].rep);
  let best: { club: number; expected: number; actual: number } | undefined;
  order.forEach((cid, i) => {
    const exp = byRep.indexOf(cid) + 1;
    if (exp - (i + 1) >= 3 && (!best || exp - (i + 1) > best.expected - best.actual)) best = { club: cid, expected: exp, actual: i + 1 };
  });
  return best;
}

/** Gallaaften: Ballon d'Or, årets manager og arkivering af månedens priser */
export function seasonGala(summary: SeasonSummary) {
  const g = gs();
  // Ballon d'Or: hele verden – præstation, mål, evne og trofæer
  const winners = new Set(Object.values(g.comps).filter((c) => c.winner).map((c) => c.winner!));
  const clWinner = g.comps.CL?.winner;
  // Kandidater: alle topspillere – også i ligaer der ikke simuleres (de vurderes på evne og omdømme)
  const cands = Object.values(g.players).filter((p) => p.club && (p.ca >= 150 || (p.stats.apps + p.stats.subs >= 15 && p.stats.ratingCount)));
  const score = (p: Player) => {
    const played = p.stats.apps + p.stats.subs;
    let s = p.ca / 2 + p.rep / 4;
    if (played >= 10 && p.stats.ratingCount) s += (avg(p) - 6.6) * 12 + p.stats.goals * 0.25 + p.stats.assists * 0.12;
    if (winners.has(p.club)) s += 3;
    if (p.club === clWinner) s += 6;
    return s;
  };
  const top = cands.sort((a, b) => score(b) - score(a)).slice(0, 10);
  summary.ballonDor = top.map((p) => p.id);
  summary.ballonDorNames = top.map((p) => [pname(p), p.club] as [string, number]);
  // Årets manager: største overpræstation i en førstedivision
  let best: { name: string; club: number; comp: string; diff: number } | undefined;
  for (const comp of activeLeagues().filter((c) => (g.leagues[c.id]?.tier ?? 9) === 1)) {
    const s = surpriseOfSeason(comp);
    const champ = comp.winner;
    const cand = s ? { club: s.club, diff: s.expected - s.actual } : champ ? { club: champ, diff: 2 } : undefined;
    if (cand && (!best || cand.diff > best.diff)) best = { name: managerName(cand.club), club: cand.club, comp: comp.name, diff: cand.diff };
  }
  if (best) summary.managerOfYear = { name: best.name, club: best.club, comp: best.comp };
  summary.monthAwards = g.monthAwards ?? [];
  g.monthAwards = [];
  const bd = g.players[summary.ballonDor[0]];
  if (bd) addNews({ cat: 'award', key: 'award.ballonDor', params: { player: pname(bd), club: g.clubs[bd.club]?.short ?? '' }, link: { kind: 'player', id: bd.id } }, { all: true });
  forEachHuman(() => {
    if (best && best.club === g.userClub) {
      g.manager.trophies.push({ season: g.season, comp: 'Manager of the Year', club: g.userClub });
      addNews({ cat: 'award', key: 'award.managerOfYearMe', params: {} });
    }
    addNews({ cat: 'award', key: 'award.gala', params: { season: `${g.season}/${String(g.season + 1).slice(2)}` }, link: { kind: 'awards', id: 0 } });
  });
}
