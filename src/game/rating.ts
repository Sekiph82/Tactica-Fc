// Manager Score: point pr. sæson ud fra opgaven manageren stod over for og hvad han opnåede.
// Svære opgaver (svag klub, stærk liga, høje forventninger indfriet) giver flere point end at vinde
// med favoritten. Point bruges til de globale ranglister (singleplayer).
import { strengthRank } from './board';
import { finalOrder, nationRanking, leagueRows } from './competitions';
import { ageOn } from './dates';
import { LEAGUE_RULES } from './leagues';
import { gs, squad } from './state';
import type { Competition } from './types';

export interface ScoreLine {
  key: string;
  pts: number;
  params?: Record<string, string | number>;
}

export interface SeasonScore {
  season: number;
  club: number;
  clubName: string;
  league: string;
  leagueName: string;
  points: number;
  lines: ScoreLine[];
  /** Sendt til ranglisten */
  submitted?: boolean;
}

/** Linjenøgler og deres grænser (serveren validerer med de samme) */
export const SCORE_LIMITS: Record<string, [number, number]> = {
  position: [0, 100], expectation: [-90, 90], title: [0, 190], promotion: [0, 55], relegation: [-55, 0],
  cup: [0, 40], cupFinal: [0, 16], cl: [0, 100], uefa: [0, 60], board: [-30, 10], sacked: [-80, 0], finance: [-8, 8], youth: [0, 15],
};

/** Ligaens vægt: stærke ligaer tæller mere */
export function leagueWeight(leagueId: string): number {
  const g = gs();
  const lg = g.leagues[leagueId];
  if (!lg) return 0.5;
  const rank = nationRanking().indexOf(lg.nation);
  const nationF = rank < 0 ? 0.85 : rank < 5 ? 1.5 : rank < 10 ? 1.25 : rank < 20 ? 1.05 : 0.9;
  return lg.tier === 1 ? nationF : nationF * 0.45;
}

const STAGE_PTS_CL: Record<string, number> = { G: 8, R16: 18, QF: 30, SF: 45, F: 65, W: 100 };
const STAGE_PTS_UEFA: Record<string, number> = { R32: 5, R16: 10, QF: 18, SF: 28, F: 40, W: 60 };
const ORDER = ['G', 'R32', 'R16', 'QF', 'SF', 'F', 'W'];

/** Hvor langt nåede klubben i en europæisk turnering? */
function stageReached(comp: Competition | undefined, clubId: number): string | null {
  if (!comp || !comp.clubs.includes(clubId)) return null;
  if (comp.winner === clubId) return 'W';
  let best = comp.id === 'CL' ? 'G' : 'R32';
  for (const t of comp.ties) {
    if (t.a !== clubId && t.b !== clubId) continue;
    const s = t.stage.startsWith('G') ? 'G' : t.stage;
    if (ORDER.indexOf(s) > ORDER.indexOf(best)) best = s;
  }
  return best;
}

const clamp = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * Beregn sæsonens score for den aktive manager. provisional = løbende prognose midt i sæsonen.
 * Kaldes ved sæsonslut før tabellerne nulstilles.
 */
export function computeSeasonScore(provisional = false): SeasonScore | null {
  const g = gs();
  const club = g.clubs[g.userClub];
  const start = g.manager.seasonStart;
  const sackedThisSeason = start && start.season === g.season ? g.manager.sacked - start.sacked : 0;
  const lines: ScoreLine[] = [];
  const add = (key: string, pts: number, params?: ScoreLine['params']) => {
    const v = clamp(pts, SCORE_LIMITS[key]);
    if (v !== 0) lines.push({ key, pts: v, params });
  };
  if (sackedThisSeason > 0) add('sacked', -40 * sackedThisSeason);
  if (!club) {
    if (!lines.length) return null;
    return { season: g.season, club: 0, clubName: '-', league: '-', leagueName: '-', points: lines.reduce((s, l) => s + l.pts, 0), lines };
  }
  const lw = leagueWeight(club.league);
  const comp = g.comps[club.league];
  if (comp?.type === 'league' && comp.table.length > 1) {
    const order = provisional ? leagueRows(comp).map((r) => r.club) : finalOrder(comp);
    const n = order.length;
    const pos = order.indexOf(club.id) + 1;
    const played = comp.table.find((r) => r.club === club.id)?.p ?? 0;
    if (pos > 0 && played > 0) {
      const { rank } = strengthRank(club);
      add('position', (60 * (n - pos)) / (n - 1) * lw, { pos, n });
      add('expectation', (g.board.expectedPos - pos) * 6 * lw, { expected: g.board.expectedPos, pos });
      const finished = !provisional && comp.finished;
      if (finished && pos === 1) add('title', 50 * lw * Math.min(2.5, 1 + Math.max(0, rank - 1) * 0.15), { rank });
      const rules = LEAGUE_RULES[club.league];
      if (finished && rules) {
        const po = g.comps[`PO-${club.league}`];
        const promoted = (rules.promoted && pos <= rules.promoted) || (po?.winner === club.id && po.playoffFor !== club.league);
        if (promoted) add('promotion', 35 * Math.max(1, lw * 1.6));
        // nedrykning koster mindst, når bestyrelsen allerede regnede med en bundkamp
        const expectedDown = g.board.expectedPos > n - (rules.relegated ?? 0) - 2;
        if (rules.relegated && pos > n - rules.relegated) add('relegation', -35 * Math.max(1, lw) * (expectedDown ? 0.4 : 1));
      }
    }
  }
  // pokalturneringer
  for (const c of Object.values(g.comps)) {
    if (c.type !== 'cup' || !c.clubs.includes(club.id)) continue;
    if (c.winner === club.id) add('cup', 25 * lw, { comp: c.name });
    else if (c.finished && (c.meta as { runnerUp?: number } | undefined)?.runnerUp === club.id) add('cupFinal', 10 * lw, { comp: c.name });
  }
  const cl = stageReached(g.comps.CL, club.id);
  if (cl) add('cl', STAGE_PTS_CL[cl] ?? 0, { stage: cl });
  const uefa = stageReached(g.comps.UEFA, club.id);
  if (uefa) add('uefa', STAGE_PTS_UEFA[uefa] ?? 0, { stage: uefa });
  // bestyrelsen
  const boardPts = (g.board.confidence >= 75 ? 10 : 0) - g.board.warnings * 10;
  add('board', boardPts, { conf: Math.round(g.board.confidence) });
  // økonomi: resultat i forhold til lønbudgettet (kun hvis samme klub hele sæsonen)
  if (start && start.season === g.season && start.club === club.id) {
    const yearly = Math.max(1, club.wageBudget * 52);
    add('finance', ((club.balance - start.balance) / yearly) * 12);
  }
  // egne unge spillere med spilletid
  const youthMinutes = squad(club.id).filter((p) => ageOn(p.dob, g.date) <= 21 && !p.loan).reduce((s, p) => s + p.stats.minutes, 0);
  add('youth', youthMinutes / 1500, { minutes: youthMinutes });
  return { season: g.season, club: club.id, clubName: club.name, league: club.league, leagueName: comp?.name ?? g.leagues[club.league]?.name ?? club.league, points: lines.reduce((s, l) => s + l.pts, 0), lines };
}

/** Sæsonslut: gem scoren (kaldes for hver menneskelig manager før tabellerne nulstilles) */
export function recordSeasonScore(s: SeasonScore | null, sackedAtSeasonEnd: boolean) {
  const g = gs();
  if (!s) return;
  if (sackedAtSeasonEnd) {
    s.lines.push({ key: 'sacked', pts: -40 });
    s.points -= 40;
  }
  (g.manager.scores ??= []).push(s);
  if (g.manager.scores.length > 60) g.manager.scores.shift();
}

/** Ny sæson (eller nyt spil): husk udgangspunktet for økonomi og fyringer */
export function startScoreSeason() {
  const g = gs();
  const club = g.clubs[g.userClub];
  g.manager.seasonStart = { season: g.season, club: g.userClub, balance: club?.balance ?? 0, sacked: g.manager.sacked };
}

export function careerPoints(): number {
  return (gs().manager.scores ?? []).reduce((s, x) => s + x.points, 0);
}
