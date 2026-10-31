// Holdsnak før kampen, i pausen og efter kampen – med reaktioner fra hver enkelt spiller.
// Virkningen afhænger af situationen (favorit/underdog, stillingen), tonen og spillerens personlighed.
import { opponentReport } from './analysis';
import { A } from './attributes';
import { hash01 } from './rng';
import { gs } from './state';
import { traits } from './personality';
import type { Player, TalkReaction, TalkStage, TalkTone } from './types';

export const TONES: Record<TalkStage, TalkTone[]> = {
  pre: ['noPressure', 'motivate', 'focus', 'demand', 'passionate'],
  half: ['praise', 'focus', 'calm', 'motivate', 'demand', 'criticise'],
  post: ['praise', 'focus', 'calm', 'disappointed', 'criticise'],
};
export const INDIVIDUAL_TONES: TalkTone[] = ['praise', 'motivate', 'demand', 'criticise'];
export const MAX_INDIVIDUAL = 3;

const HARSH = new Set<TalkTone>(['demand', 'criticise', 'disappointed']);
const SOFT = new Set<TalkTone>(['praise', 'noPressure', 'calm']);

export interface TalkContext {
  stage: TalkStage;
  fixture: number;
  /** Forventning: sejrschance minus nederlagschance (-1..1) */
  e: number;
  /** Målforskel set fra brugerens side (0 før kampen) */
  diff: number;
  big: boolean;
  /** Kampkarakterer indtil nu (pause/efter kampen) */
  ratings: Record<number, number>;
}

export interface TalkResult {
  pid: number;
  reaction: TalkReaction;
  individual?: TalkTone;
}

/** Forventningen til kampen (fra assistentens analyse) */
export function matchExpectation(fixtureId: number): { e: number; big: boolean } {
  const g = gs();
  const f = g.fixtures[fixtureId];
  if (!f) return { e: 0, big: false };
  const rep = opponentReport(f);
  const comp = g.comps[f.comp];
  const big = f.stage === 'F' || comp?.type === 'continental' || comp?.type === 'playoff' || Math.abs(g.clubs[f.home].rep - g.clubs[f.away].rep) <= 4 && rep.opp.rep >= 70;
  return { e: rep.probs[0] - rep.probs[2], big };
}

/** Hvor godt passer tonen til situationen (for holdet som helhed) */
function base(tone: TalkTone, c: TalkContext): number {
  const { e, diff: d } = c;
  if (c.stage === 'pre') {
    switch (tone) {
      case 'noPressure': return 0.6 - 1.6 * e;
      case 'motivate': return 0.9 - 0.4 * Math.max(0, e);
      case 'demand': return 0.2 + 2 * e;
      case 'focus': return 0.5 + 0.8 * Math.max(0, e);
      case 'passionate': return c.big ? 1.2 : 0.3;
      default: return 0;
    }
  }
  const lead = d > 0, level = d === 0;
  if (c.stage === 'half') {
    switch (tone) {
      case 'praise': return lead ? 1.2 - (d >= 2 ? 0.4 : 0) : level ? (e < 0 ? 0.8 : -0.2) : e < -0.3 && d === -1 ? 0.2 : -1;
      case 'focus': return lead ? 1.2 + (d >= 2 ? 0.3 : 0) : level ? 0.5 : 0.2;
      case 'calm': return lead ? 0.4 : level ? 0.5 : 0.9 - (e > 0.3 ? 0.4 : 0);
      case 'motivate': return lead ? 0.5 : 0.8 - e * 0.5;
      case 'demand': return lead ? (e > 0 ? 0.3 : -0.3) : level ? 0.3 + 1.2 * e : 0.6 + e;
      case 'criticise': return lead ? -1.5 : level ? (e > 0.3 ? 0.2 : -0.8) : e > 0.2 ? 0.6 : -0.3;
      default: return 0;
    }
  }
  switch (tone) {
    case 'praise': return lead ? 1.5 : level ? (e < 0 ? 1 : -0.3) : e < -0.3 ? 0.4 : -1.2;
    case 'focus': return lead ? 0.8 : level ? 0.5 : 0;
    case 'calm': return lead ? 0.3 : level ? 0.5 : 0.9;
    case 'disappointed': return lead ? -1.2 : level ? (e > 0.2 ? 0.7 : -0.6) : e > -0.2 ? 0.8 : -0.4;
    case 'criticise': return lead ? -2 : level ? (e > 0.3 ? 0.3 : -1) : e > 0 ? 0.6 : -0.8;
    default: return 0;
  }
}

/** Individuel snak: afhænger af spillerens egen præstation */
function baseIndividual(tone: TalkTone, p: Player, c: TalkContext): number {
  const r = c.ratings[p.id];
  if (r === undefined) {
    // før kampen
    switch (tone) {
      case 'praise': return p.morale < 12 ? 0.8 : 0.4;
      case 'motivate': return p.morale < 10 ? 1.1 : 0.7;
      case 'demand': return 0.2 + c.e;
      case 'criticise': return -0.6;
      default: return 0;
    }
  }
  switch (tone) {
    case 'praise': return r >= 7 ? 1.4 : r >= 6.5 ? 0.7 : -0.6;
    case 'motivate': return 0.7 + (p.morale < 10 ? 0.4 : 0);
    case 'demand': return r < 6.3 ? 0.7 : r >= 7 ? -0.5 : 0.3;
    case 'criticise': return r < 6 ? 0.6 : r >= 6.8 ? -1.4 : -0.4;
    default: return 0;
  }
}

/** Spillerens personlige modtagelse af tonen */
function personal(p: Player, tone: TalkTone, c: TalkContext): number {
  const det = p.attrs[A.determination], temp = p.attrs[A.temperament], pres = p.attrs[A.pressure], prof = p.attrs[A.professionalism];
  const tr = traits(p);
  const r = c.ratings[p.id];
  let s = 0;
  if (HARSH.has(tone)) {
    s += (det - 12) * 0.08;
    if (temp <= 8) s -= 0.5;
    if (pres <= 8 && c.stage !== 'post') s -= 0.4;
    if (p.morale < 8) s -= 0.3;
  }
  if (tone === 'criticise' && r !== undefined) s += r >= 7.2 ? -1 : r <= 6 ? 0.3 : 0;
  if (tone === 'praise' && r !== undefined) s += r <= 6 ? -0.6 : r >= 7.2 ? 0.4 : 0;
  if (SOFT.has(tone)) {
    if (p.morale < 8) s += 0.3;
    if (prof <= 9 && (c.diff > 0 || c.e > 0.3)) s -= 0.3; // risiko for selvtilfredshed
  }
  if (tone === 'passionate') {
    if (tr.includes('bigGame')) s += 0.4;
    if (temp <= 9) s += 0.3;
    if (prof >= 15) s -= 0.2;
  }
  if (tone === 'demand' && tr.includes('professional')) s += 0.3;
  if (tr.includes('leader')) s += 0.15;
  return s;
}

function classify(s: number, tone: TalkTone, p: Player, c: TalkContext): TalkReaction {
  if (s >= 1.3) return 'fired';
  if (s >= 0.55) return 'focused';
  if (s >= -0.3) return 'neutral';
  if (SOFT.has(tone)) return 'complacent';
  if (HARSH.has(tone)) return p.attrs[A.temperament] <= 9 ? 'angry' : p.attrs[A.pressure] <= 9 ? 'nervous' : 'deflated';
  return c.e > 0 || c.diff > 0 ? 'complacent' : 'nervous';
}

const STAGE_IDX: Record<TalkStage, number> = { pre: 1, half: 2, post: 3 };

function score(p: Player, tone: TalkTone, c: TalkContext, individual: boolean, noise: boolean): number {
  const g = gs();
  const b = individual ? baseIndividual(tone, p, c) * 1.2 : base(tone, c);
  const spread = tone === 'passionate' ? 1.9 : 1.2;
  const n = noise ? (hash01(g.seed, p.id, c.fixture, STAGE_IDX[c.stage], individual ? 7 : 3) - 0.5) * spread : 0;
  return b + personal(p, tone, c) + n;
}

/** Reaktioner fra alle spillere */
export function evaluateTalk(c: TalkContext, tone: TalkTone, pids: number[], individual: Record<number, TalkTone> = {}): TalkResult[] {
  const g = gs();
  return pids.map((pid) => g.players[pid]).filter(Boolean).map((p) => {
    const ind = individual[p.id];
    const tn = ind ?? tone;
    return { pid: p.id, reaction: classify(score(p, tn, c, !!ind, true), tn, p, c), ...(ind ? { individual: ind } : {}) };
  });
}

/** Assistentens forslag: den tone der i gennemsnit virker bedst (uden tilfældighed) */
export function assistantTone(c: TalkContext, pids: number[]): TalkTone {
  const g = gs();
  const ps = pids.map((id) => g.players[id]).filter(Boolean);
  let best = TONES[c.stage][0], bestV = -Infinity;
  for (const tone of TONES[c.stage]) {
    const v = ps.reduce((s, p) => s + score(p, tone, c, false, false), 0) / Math.max(1, ps.length);
    if (v > bestV) { bestV = v; best = tone; }
  }
  return best;
}

const BOOST: Record<TalkReaction, number> = { fired: 1.04, focused: 1.02, neutral: 1, complacent: 0.97, nervous: 0.97, angry: 0.975, deflated: 0.97 };
const MORALE: Record<TalkReaction, number> = { fired: 0.8, focused: 0.4, neutral: 0, complacent: 0, nervous: -0.3, angry: -0.8, deflated: -0.6 };

/** Giv holdsnakken: moral ændres med det samme, og før/under kampen gemmes virkningen til kampmotoren */
export function giveTalk(c: TalkContext, tone: TalkTone, pids: number[], individual: Record<number, TalkTone> = {}): { results: TalkResult[]; boosts: Record<number, number> } | string {
  const g = gs();
  if (!TONES[c.stage].includes(tone)) return 'error';
  const ind: Record<number, TalkTone> = {};
  for (const [k, v] of Object.entries(individual).slice(0, MAX_INDIVIDUAL)) if (INDIVIDUAL_TONES.includes(v)) ind[Number(k)] = v;
  if (!g.matchTalk || g.matchTalk.fixture !== c.fixture) g.matchTalk = { fixture: c.fixture, boosts: {}, done: [] };
  if (g.matchTalk.done.includes(c.stage)) return 'talk.alreadyDone';
  const results = evaluateTalk(c, tone, pids, ind);
  const boosts: Record<number, number> = {};
  const mult = c.stage === 'post' ? 2 : 1;
  for (const r of results) {
    const p = g.players[r.pid];
    p.morale = Math.max(1, Math.min(20, p.morale + MORALE[r.reaction] * mult));
    if (BOOST[r.reaction] !== 1) boosts[r.pid] = BOOST[r.reaction];
  }
  g.matchTalk.done.push(c.stage);
  if (c.stage !== 'post') g.matchTalk.boosts = boosts;
  return { results, boosts };
}

/** Er snakken allerede holdt i denne fase? */
export function talkDone(fixture: number, stage: TalkStage): boolean {
  const mt = gs().matchTalk;
  return !!mt && mt.fixture === fixture && mt.done.includes(stage);
}
