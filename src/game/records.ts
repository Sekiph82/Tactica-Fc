// Klubrekorder og legender for menneskestyrede klubber (siden spillets start), og spillere der bliver
// trænere, assistenter eller scouts efter karrieren.
import { A } from './attributes';
import { ageOn } from './dates';
import { asOwner, isHumanClub } from './humans';
import { hash01 } from './rng';
import { addNews, gs } from './state';
import { unlock } from './achievements';
import type { Club, ClubRecords, Fixture, MatchReport, Player, Staff, StaffRole } from './types';

/** Kampe eller mål for klubben, der gør en spiller til klublegende */
export const LEGEND_APPS = 150, LEGEND_GOALS = 60;

const pname = (p: Player) => `${p.first} ${p.last}`.trim();

function recs(c: Club): ClubRecords {
  return (c.records ??= { since: gs().date, players: {} });
}

/** Efter hver kamp: kampe og mål for klubben, største sejr/nederlag og publikumsrekord */
export function recordsAfterMatch(f: Fixture, rep: MatchReport, att: number) {
  const g = gs();
  for (const side of [0, 1] as const) {
    const cid = side === 0 ? f.home : f.away;
    const c = g.clubs[cid];
    if (!c || !isHumanClub(cid)) continue;
    const r = recs(c);
    const opp = side === 0 ? f.away : f.home;
    const gf = rep.stats[side].goals, ga = rep.stats[1 - side].goals;
    const news = (key: string, params: Record<string, string | number>, link?: { kind: 'player' | 'fixture'; id: number }) =>
      asOwner(cid, () => addNews({ cat: 'general', key, params, ...(link ? { link } : {}) }));
    // spillerne
    const leaderApps = topBy(r, 'apps'), leaderGoals = topBy(r, 'goals');
    for (const line of rep.players) {
      if (line.team !== side || line.minutes <= 0) continue;
      const p = g.players[line.id];
      if (!p) continue;
      const e = (r.players[p.id] ??= { name: pname(p), apps: 0, goals: 0, from: g.date });
      e.name = pname(p);
      e.apps++;
      e.goals += line.goals;
      if (!e.legend && (e.apps >= LEGEND_APPS || e.goals >= LEGEND_GOALS)) {
        e.legend = true;
        asOwner(cid, () => unlock('legend'));
        news('recb.news.legend', { player: e.name, apps: e.apps, goals: e.goals }, { kind: 'player', id: p.id });
      }
    }
    // ny førsteplads på listerne (kun når der er noget at slå)
    const nowApps = topBy(r, 'apps'), nowGoals = topBy(r, 'goals');
    if (nowApps && leaderApps && nowApps.id !== leaderApps.id && leaderApps.e.apps >= 50) news('recb.news.apps', { player: nowApps.e.name, n: nowApps.e.apps }, { kind: 'player', id: nowApps.id });
    if (nowGoals && leaderGoals && nowGoals.id !== leaderGoals.id && leaderGoals.e.goals >= 20) news('recb.news.goals', { player: nowGoals.e.name, n: nowGoals.e.goals }, { kind: 'player', id: nowGoals.id });
    // kampene
    const m = { fixture: f.id, gf, ga, opp, date: g.date, comp: f.comp };
    const margin = gf - ga;
    if (margin > 0 && (!r.bigWin || margin > r.bigWin.gf - r.bigWin.ga || (margin === r.bigWin.gf - r.bigWin.ga && gf > r.bigWin.gf))) {
      const old = r.bigWin;
      r.bigWin = m;
      if (old && margin >= 4) news('recb.news.bigWin', { score: `${gf}-${ga}`, opp: g.clubs[opp]?.name ?? '' }, { kind: 'fixture', id: f.id });
    }
    if (margin < 0 && (!r.bigLoss || -margin > r.bigLoss.ga - r.bigLoss.gf || (-margin === r.bigLoss.ga - r.bigLoss.gf && ga > r.bigLoss.ga))) r.bigLoss = m;
    if (side === 0 && att > 0 && (!r.topAtt || att > r.topAtt.att)) {
      const old = r.topAtt;
      r.topAtt = { att, opp, date: g.date };
      if (old) news('recb.news.att', { att: att.toLocaleString(), opp: g.clubs[opp]?.name ?? '' });
    }
  }
}

function topBy(r: ClubRecords, k: 'apps' | 'goals') {
  let best: { id: number; e: ClubRecords['players'][number] } | null = null;
  for (const [id, e] of Object.entries(r.players)) if (!best || e[k] > best.e[k]) best = { id: Number(id), e };
  return best;
}

/** Ved en handel: rekordkøb og -salg (kaldes før spilleren skifter klub) */
export function recordsAfterMove(p: Player, to: number, fee: number, loan: boolean) {
  const g = gs();
  const from = g.clubs[p.club];
  if (from && isHumanClub(from.id)) {
    const r = recs(from);
    const e = r.players[p.id];
    if (e) e.to = g.date;
    if (!loan && fee > 0 && (!r.sale || fee > r.sale.fee)) {
      const old = r.sale;
      r.sale = { pid: p.id, name: pname(p), fee, club: to, date: g.date };
      if (fee >= 20_000_000) asOwner(from.id, () => unlock('bigSale'));
      if (old) asOwner(from.id, () => addNews({ cat: 'transfer', key: 'recb.news.sale', params: { player: pname(p), fee }, link: { kind: 'player', id: p.id } }));
    }
  }
  const dest = g.clubs[to];
  if (dest && isHumanClub(to) && !loan && fee > 0) {
    const r = recs(dest);
    if (!r.buy || fee > r.buy.fee) {
      const old = r.buy;
      r.buy = { pid: p.id, name: pname(p), fee, club: p.club, date: g.date };
      if (old) asOwner(to, () => addNews({ cat: 'transfer', key: 'recb.news.buy', params: { player: pname(p), fee }, link: { kind: 'player', id: p.id } }));
    }
  }
}

/** Ved sæsonslut (før statistikken nulstilles): flest mål i en sæson og bedste placering */
export function recordsSeasonEnd(leaguePos: (c: Club) => number) {
  const g = gs();
  for (const c of Object.values(g.clubs)) {
    if (!isHumanClub(c.id)) continue;
    const r = recs(c);
    const top = Object.values(g.players).filter((p) => p.club === c.id).sort((a, b) => b.stats.goals - a.stats.goals)[0];
    if (top && top.stats.goals > 0 && (!r.seasonGoals || top.stats.goals > r.seasonGoals.goals)) {
      r.seasonGoals = { pid: top.id, name: pname(top), goals: top.stats.goals, season: g.season };
    }
    const pos = leaguePos(c);
    const tier = g.leagues[c.league]?.tier ?? 1;
    if (pos > 0 && (!r.bestFinish || tier < r.bestFinish.tier || (tier === r.bestFinish.tier && pos < r.bestFinish.pos))) {
      r.bestFinish = { season: g.season, pos, league: g.leagues[c.league]?.name ?? c.league, tier };
    }
  }
}

// ---------- efter karrieren ----------

/**
 * En spiller, der stopper, kan blive træner, assistent eller scout. Egenskaberne bygger på hans
 * personlighed og fodboldforstand. Klublegender i en menneskestyret klub tilbyder sig altid til klubben.
 */
export function retireIntoStaff(p: Player): Staff | null {
  const g = gs();
  const age = ageOn(p.dob, g.date);
  const legendOf = Object.values(g.clubs).find((c) => c.records?.players[p.id]?.legend);
  const notable = p.rep >= 55 || p.ca >= 120;
  if (!legendOf && (!notable || age < 31 || hash01(g.seed, p.id, 91) > 0.35)) return null;
  const a = p.attrs;
  const clamp = (v: number) => Math.max(1, Math.min(20, Math.round(v)));
  const brains = (a[A.decisions] + a[A.anticipation] + a[A.positioning]) / 3;
  const attrs = {
    coaching: clamp((a[A.determination] + a[A.professionalism] + a[A.teamwork] + brains) / 4 - 1),
    judgingAbility: clamp(brains - 1 + (hash01(p.id, 1) - 0.5) * 4),
    judgingPotential: clamp(brains - 2 + (hash01(p.id, 2) - 0.5) * 6),
    physio: clamp(4 + hash01(p.id, 3) * 4),
    motivating: clamp((a[A.influence] + a[A.determination]) / 2),
    discipline: clamp((a[A.professionalism] + a[A.temperament]) / 2),
    tactics: clamp(brains),
  };
  const role: StaffRole = attrs.motivating >= 15 && attrs.tactics >= 13 ? 'assistant' : attrs.judgingAbility + attrs.judgingPotential > attrs.coaching * 2 + 2 ? 'scout' : 'coach';
  const id = g.nextId.staff++;
  const s: Staff = {
    id, first: p.first, last: p.last, nation: p.nation, dob: p.dob, club: 0, role, attrs,
    rep: Math.max(20, Math.min(90, Math.round(p.rep * 0.8))),
    wage: Math.round((250 + p.rep * 8) / 50) * 50,
    expires: `${g.season + 2}-06-30`,
    exPlayer: { pid: p.id, ...(legendOf ? { legendOf: legendOf.id } : {}) },
  };
  g.staff[id] = s;
  if (legendOf) asOwner(legendOf.id, () => addNews({ cat: 'general', key: 'recb.news.legendStaff', params: { player: pname(p), role: role } }));
  return s;
}
