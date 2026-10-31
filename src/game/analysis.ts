// Assistent-analyse (forbedring #4) og den gennemsigtige motor (forbedring #3).
import { A, roleScore, slotRole } from './attributes';
import { quickMatch, zoneProfile, type EngineTeam } from './engine/match';
import { Rng } from './rng';
import { attrRange, knowledgeOf } from './scouting';
import { gs, squad } from './state';
import { aiTactic, engineTeam, userTactic } from './sim';
import type { Fixture, MatchReport, Player, Tactic } from './types';

export const RADAR_AXES: { key: string; attrs: number[] }[] = [
  { key: 'attack', attrs: [A.finishing, A.offTheBall, A.longShots, A.heading] },
  { key: 'creativity', attrs: [A.passing, A.creativity, A.technique, A.flair, A.dribbling] },
  { key: 'defence', attrs: [A.tackling, A.marking, A.positioning, A.anticipation] },
  { key: 'physical', attrs: [A.pace, A.acceleration, A.stamina, A.strength, A.agility] },
  { key: 'mental', attrs: [A.decisions, A.determination, A.teamwork, A.workRate, A.bravery] },
  { key: 'goalkeeping', attrs: [A.handling, A.reflexes, A.oneOnOnes] },
];

/** Radarværdier (1-20). Ved maskering bruges midten af scoutens interval. */
export function radar(p: Player): number[] {
  const k = knowledgeOf(p);
  return RADAR_AXES.map((ax) => {
    const vals = ax.attrs.map((i) => {
      const [lo, hi] = attrRange(p, i, k);
      return (lo + hi) / 2;
    });
    return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
  });
}

export interface Insight {
  key: string;
  params?: Record<string, string | number>;
  tone: 'good' | 'bad' | 'neutral';
}

const LANES = ['left', 'centre', 'right'] as const;

/** Modstanderrapport før en kamp */
export function opponentReport(f: Fixture) {
  const g = gs();
  const userHome = f.home === g.userClub;
  const oppId = userHome ? f.away : f.home;
  const opp = g.clubs[oppId];
  const oppTactic = aiTactic(oppId, g.userClub, !userHome);
  const myTactic = userTactic(false);
  const mine = engineTeam(g.userClub, myTactic);
  const theirs = engineTeam(oppId, oppTactic);
  const mz = zoneProfile(mine);
  const tz = zoneProfile(theirs);
  const insights: Insight[] = [];
  // Midtbane: bånd 2 (midten) – sum af tilstedeværelse
  const mid = (z: { att: number[]; def: number[] }) => [6, 7, 8].reduce((s, i) => s + z.att[i] + z.def[i], 0);
  const midDiff = mid(mz) - mid(tz);
  insights.push({ key: midDiff > 0.4 ? 'an.midWin' : midDiff < -0.4 ? 'an.midLose' : 'an.midEven', params: { ours: mid(mz).toFixed(1), theirs: mid(tz).toFixed(1) }, tone: midDiff > 0.4 ? 'good' : midDiff < -0.4 ? 'bad' : 'neutral' });
  // Deres forsvar pr. bane i deres eget tredjedel (bånd 0 set fra dem = zoner 0-2 i deres egen orientering)
  const defLane = [0, 1, 2].map((l) => tz.def[l] * (tz.defQ[l] || 1));
  const weakest = defLane.indexOf(Math.min(...defLane));
  // kun en anbefaling, hvis siden er tydeligt svagere end de andre (ellers: ingen særlig side)
  const sortedLanes = defLane.slice().sort((a, b) => a - b);
  const clear = sortedLanes[1] > 0 && (sortedLanes[1] - sortedLanes[0]) / sortedLanes[1] >= 0.12;
  // deres venstre = vores højre
  const ourSide = LANES[2 - weakest];
  if (clear) insights.push({ key: 'an.attackLane', params: { lane: ourSide }, tone: 'good' });
  else insights.push({ key: 'an.attackLaneNone', tone: 'neutral' });
  // Deres angreb pr. bane i vores tredjedel
  const attLane = [12, 13, 14].map((z) => tz.att[z] * (tz.attQ[z] || 1));
  const strongest = attLane.indexOf(Math.max(...attLane));
  insights.push({ key: 'an.threatLane', params: { lane: LANES[2 - strongest] }, tone: 'bad' });
  // Nøglespillere
  const theirXI = oppTactic.lineup.map((id) => g.players[id]).filter(Boolean);
  const keyPlayers = theirXI
    .map((p, i) => ({ p, v: roleScore(p, slotRole(oppTactic.slots[i])) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .map((x) => x.p.id);
  const scorer = squad(oppId).sort((a, b) => b.stats.goals - a.stats.goals)[0];
  if (scorer && scorer.stats.goals >= 3) insights.push({ key: 'an.topScorer', params: { player: `${scorer.first} ${scorer.last}`, goals: scorer.stats.goals }, tone: 'bad' });
  const aerial = theirXI.filter((p) => p.attrs[A.heading] + p.attrs[A.jumping] > 30).length;
  if (aerial >= 4) insights.push({ key: 'an.aerial', params: { n: aerial }, tone: 'bad' });
  const slowDef = theirXI.filter((p, i) => ['CB', 'FB'].includes(slotRole(oppTactic.slots[i])) && p.attrs[A.pace] < 11).length;
  if (slowDef >= 2) insights.push({ key: 'an.slowDefence', tone: 'good' });
  // Sandsynligheder via Monte Carlo
  const probs = winProbability(userHome ? mine : theirs, userHome ? theirs : mine, f.stage === 'F', 150);
  const [w, d, l] = userHome ? probs : [probs[2], probs[1], probs[0]];
  const form = g.comps[f.comp]?.table.find((r) => r.club === oppId)?.form ?? '';
  return { opp, oppTactic, keyPlayers, insights, probs: [w, d, l] as [number, number, number], form, zones: { mine: mz, theirs: tz }, attackLane: clear ? 2 - weakest : undefined };
}

export function winProbability(home: EngineTeam, away: EngineTeam, neutral: boolean, n = 150): [number, number, number] {
  const r = new Rng(12345);
  let w = 0, d = 0, l = 0;
  for (let i = 0; i < n; i++) {
    const rep = quickMatch(home, away, { neutral }, r);
    const [h, a] = [rep.stats[0].goals, rep.stats[1].goals];
    if (h > a) w++; else if (h === a) d++; else l++;
  }
  return [w / n, d / n, l / n];
}

/** Efter kampen: hvorfor gik det som det gik? */
export function matchVerdict(rep: MatchReport, side: 0 | 1): Insight[] {
  const out: Insight[] = [];
  const me = rep.stats[side];
  const them = rep.stats[1 - side];
  const goalsDiff = me.goals - them.goals;
  const xgDiff = me.xg - them.xg;
  if (goalsDiff <= 0 && xgDiff > 0.6) out.push({ key: 'v.unlucky', params: { xg: me.xg.toFixed(2), xga: them.xg.toFixed(2) }, tone: 'neutral' });
  else if (goalsDiff > 0 && xgDiff < -0.6) out.push({ key: 'v.lucky', params: { xg: me.xg.toFixed(2), xga: them.xg.toFixed(2) }, tone: 'neutral' });
  else out.push({ key: xgDiff > 0.3 ? 'v.deserved' : xgDiff < -0.3 ? 'v.outplayed' : 'v.even', params: { xg: me.xg.toFixed(2), xga: them.xg.toFixed(2) }, tone: xgDiff > 0.3 ? 'good' : xgDiff < -0.3 ? 'bad' : 'neutral' });
  // Midtbanekontrol fra zonekontrol (bånd 1-3)
  const ctl = rep.zoneControl.slice(3, 12);
  const homeCtl = ctl.reduce((s, v) => s + v, 0) / ctl.length;
  const myCtl = side === 0 ? homeCtl : 1 - homeCtl;
  if (myCtl > 0.56) out.push({ key: 'v.midWon', params: { pct: Math.round(myCtl * 100) }, tone: 'good' });
  else if (myCtl < 0.44) out.push({ key: 'v.midLost', params: { pct: Math.round(myCtl * 100) }, tone: 'bad' });
  // Skudkvalitet
  if (me.shots >= 12 && me.xg / Math.max(1, me.shots) < 0.08) out.push({ key: 'v.poorShots', params: { shots: me.shots }, tone: 'bad' });
  if (them.shots >= 14) out.push({ key: 'v.underSiege', params: { shots: them.shots }, tone: 'bad' });
  // Hvilken bane angreb vi mest?
  const heat = rep.heat[side];
  const attackZones = side === 0 ? [9, 10, 11, 12, 13, 14] : [0, 1, 2, 3, 4, 5];
  const lanes = [0, 1, 2].map((l) => attackZones.filter((z) => z % 3 === l).reduce((s, z) => s + heat[z], 0));
  const total = lanes.reduce((s, v) => s + v, 0) || 1;
  const maxL = lanes.indexOf(Math.max(...lanes));
  const laneName = side === 0 ? LANES[maxL] : LANES[2 - maxL];
  if (lanes[maxL] / total > 0.42) out.push({ key: 'v.lane', params: { lane: laneName, pct: Math.round((lanes[maxL] / total) * 100) }, tone: 'neutral' });
  // Træthed
  const lines = rep.players.filter((p) => p.team === side && p.minutes >= 80);
  const avgCond = lines.reduce((s, p) => s + p.cond, 0) / Math.max(1, lines.length);
  if (avgCond < 58) out.push({ key: 'v.tired', params: { cond: Math.round(avgCond) }, tone: 'bad' });
  if (me.reds) out.push({ key: 'v.red', tone: 'bad' });
  return out;
}

/** Foreslået opstilling (assistentens bud) */
export function suggestedTactic(base: Tactic): Tactic {
  return userTactic(true) && { ...userTactic(true), team: base.team, individual: base.individual };
}

// ---------- tabt føring ----------

export interface LeadLoss {
  lead: number;
  /** minuttet, hvor den største føring blev etableret, og hvor den var væk igen */
  leadMin: number;
  lostMin: number;
  xgBefore: [number, number];
  xgAfter: [number, number];
  shotsAfter: [number, number];
  oppSubs: number;
  oppChanges: { m: number; kind: string; to?: string }[];
  ourSubs: number;
  ourChanges: number;
  tired: { id: number; cond: number }[];
  /** vores side, hvor de fleste af deres chancer kom (set fra os), hvis der er et klart mønster */
  weakLane?: 'left' | 'centre' | 'right';
}

/** Hvis holdet førte og ikke vandt: hvad ændrede sig efter føringen? (samtidighed er ikke bevis for årsag) */
export function leadLoss(rep: MatchReport, side: 0 | 1): LeadLoss | null {
  const goals = rep.events.filter((e) => e.k === 'goal').sort((a, b) => a.m - b.m);
  let diff = 0, best = 0, leadMin = 0, lostMin = 0;
  for (const e of goals) {
    diff += e.t === side ? 1 : -1;
    if (diff > best) { best = diff; leadMin = e.m; lostMin = 0; }
    if (best > 0 && diff <= 0 && !lostMin) lostMin = e.m;
  }
  const final = rep.stats[side].goals - rep.stats[1 - side].goals;
  const pensWon = !!rep.pens && rep.pens[side] > rep.pens[1 - side];
  if (best < 1 || final > 0 || pensWon || !lostMin) return null;
  const xg = (t: number, after: boolean) => Math.round(rep.shots.filter((s) => s.t === t && (after ? s.m > leadMin : s.m <= leadMin)).reduce((a, s) => a + s.xg, 0) * 100) / 100;
  const shots = (t: number) => rep.shots.filter((s) => s.t === t && s.m > leadMin).length;
  const opp = 1 - side;
  const oppShots = rep.shots.filter((s) => s.t === opp && s.m > leadMin);
  // banen er absolut (hold 0 angriber mod højre); vores venstre side er øverst for hold 0 og nederst for hold 1
  const lanes = [0, 0, 0];
  for (const s of oppShots) lanes[s.zone % 3]++;
  const top = lanes.indexOf(Math.max(...lanes));
  const names = ['left', 'centre', 'right'] as const;
  const weakLane = oppShots.length >= 3 && lanes[top] / oppShots.length >= 0.5 ? names[side === 0 ? top : 2 - top] : undefined;
  return {
    lead: best, leadMin, lostMin,
    xgBefore: [xg(side, false), xg(opp, false)], xgAfter: [xg(side, true), xg(opp, true)],
    shotsAfter: [shots(side), shots(opp)],
    oppSubs: rep.events.filter((e) => e.k === 'sub' && e.t === opp && e.m > leadMin).length,
    oppChanges: (rep.changes ?? []).filter((c) => c.t === opp && c.m > leadMin).map((c) => ({ m: c.m, kind: c.kind, to: c.to })),
    ourSubs: rep.events.filter((e) => e.k === 'sub' && e.t === side && e.m > leadMin).length,
    ourChanges: (rep.changes ?? []).filter((c) => c.t === side && c.m > leadMin).length,
    tired: rep.players.filter((l) => l.team === side && !l.red && l.minutes >= 60 && l.cond < 62).sort((a, b) => a.cond - b.cond).slice(0, 3).map((l) => ({ id: l.id, cond: l.cond })),
    weakLane,
  };
}
