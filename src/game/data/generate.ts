// Deterministisk generering af CM-attributter ud fra Transfermarkt-data,
// samt fyld-spillere, regens og staff.
import { A, ATTRS, ATTR_COUNT, ROLE_WEIGHTS, GROUPS } from '../attributes';
import { Rng, hash } from '../rng';
import type { Foot, Player, Role, Staff, StaffRole } from '../types';
import { ageOn } from '../dates';

export type SubPos = 'GK' | 'CB' | 'LB' | 'RB' | 'DM' | 'CM' | 'AM' | 'LM' | 'RM' | 'LW' | 'RW' | 'CF' | 'SS';

export const SUB_ROLE: Record<SubPos, Role> = {
  GK: 'GK', CB: 'CB', LB: 'FB', RB: 'FB', DM: 'DM', CM: 'CM', AM: 'AM', LM: 'WM', RM: 'WM', LW: 'W', RW: 'W', CF: 'ST', SS: 'ST',
};

export interface BaseStats {
  apps: number;
  minutes: number;
  goals: number;
  assists: number;
  yellows: number;
  reds: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Markedsværdi (€) → Current Ability (1-200), korrigeret for alder. */
export function caFromValue(value: number, age: number): number {
  const v = Math.max(value, 10_000);
  let ca = 40 + 35 * (Math.log10(v) - 4);
  // Unge spilleres værdi indeholder potentiale, ældres er presset af alder
  const ageAdj: Record<number, number> = { 15: -30, 16: -27, 17: -24, 18: -20, 19: -15, 20: -10, 21: -7, 22: -4, 23: -2 };
  if (age <= 23) ca += ageAdj[Math.max(15, age)] ?? 0;
  if (age >= 30) ca += Math.min(22, (age - 29) * 4.5);
  return clamp(ca, 25, 195);
}

/** Omvendt: hvad er en spiller "værd" (bruges løbende i spillet) */
export function valueFromCA(ca: number, pa: number, age: number): number {
  let v = Math.pow(10, (ca - 40) / 35 + 4);
  if (age <= 23) {
    const pot = Math.max(0, pa - ca);
    v *= 1 + Math.min(3, pot / 25) * (age <= 20 ? 1 : 0.6);
  }
  if (age >= 30) v *= Math.max(0.15, 1 - (age - 29) * 0.17);
  return roundValue(v);
}

export function roundValue(v: number): number {
  if (v < 10_000) return Math.round(v / 1000) * 1000;
  if (v < 1_000_000) return Math.round(v / 25_000) * 25_000;
  if (v < 10_000_000) return Math.round(v / 100_000) * 100_000;
  return Math.round(v / 500_000) * 500_000;
}

/** Ugeløn ud fra værdi og ligaens økonomi (0.4-1.6) */
export function wageFor(value: number, wealth = 1): number {
  const w = Math.max(400, value * 0.0021 * Math.sqrt(wealth) + 3000 * wealth);
  if (w < 5000) return Math.round(w / 50) * 50;
  return Math.round(w / 500) * 500;
}

export function potentialFor(ca: number, age: number, r: Rng): number {
  let gap = 0;
  if (age <= 17) gap = r.range(25, 70);
  else if (age <= 19) gap = r.range(18, 50);
  else if (age <= 21) gap = r.range(10, 35);
  else if (age <= 23) gap = r.range(4, 20);
  else if (age <= 26) gap = r.range(0, 9);
  else gap = r.range(0, 3);
  // Sjældne "wonderkids" – CM 01/02-ånden
  if (age <= 19 && r.chance(0.02)) gap += r.range(12, 30);
  return clamp(Math.round(ca + gap), Math.round(ca), 200);
}

/** Positions- og sideratings ud fra Transfermarkt sub-position. */
export function positionRatings(sub: SubPos, foot: Foot, r: Rng): { pos: number[]; side: number[] } {
  // POSITIONS: GK SW D DM M AM ST WB  –  SIDES: L C R
  const pos = [1, 1, 1, 1, 1, 1, 1, 1];
  const side = [1, 1, 1];
  const v = (lo: number, hi: number) => r.int(lo, hi);
  const L = 0, C = 1, R = 2;
  const wideSide = (main: number) => {
    side[main] = 20;
    side[C] = v(5, 12);
    side[main === L ? R : L] = foot === 'B' ? v(12, 18) : v(3, 12);
  };
  switch (sub) {
    case 'GK': pos[0] = 20; side[C] = 20; break;
    case 'CB':
      pos[2] = 20; pos[1] = v(8, 16); pos[3] = v(4, 15); side[C] = 20;
      if (r.chance(0.25)) { side[foot === 'L' ? L : R] = v(12, 17); }
      break;
    case 'LB': case 'RB': {
      pos[2] = 20; pos[7] = v(13, 19); pos[4] = v(4, 13);
      wideSide(sub === 'LB' ? L : R);
      break;
    }
    case 'DM': pos[3] = 20; pos[4] = v(13, 18); pos[2] = v(5, 14); side[C] = 20; break;
    case 'CM': pos[4] = 20; pos[3] = v(9, 16); pos[5] = v(9, 16); side[C] = 20; if (r.chance(0.3)) side[r.chance(0.5) ? L : R] = v(12, 17); break;
    case 'AM': pos[5] = 20; pos[4] = v(11, 17); pos[6] = v(6, 14); side[C] = 20; if (r.chance(0.35)) side[r.chance(0.5) ? L : R] = v(12, 17); break;
    case 'LM': case 'RM': pos[4] = 20; pos[5] = v(11, 17); pos[7] = v(5, 13); wideSide(sub === 'LM' ? L : R); break;
    case 'LW': case 'RW': pos[5] = 20; pos[4] = v(11, 17); pos[6] = v(7, 15); wideSide(sub === 'LW' ? L : R); break;
    case 'CF': pos[6] = 20; pos[5] = v(3, 12); side[C] = 20; break;
    case 'SS': pos[6] = 20; pos[5] = v(14, 18); side[C] = 20; break;
  }
  return { pos, side };
}

/** Kerne: byg 48 attributter for en spiller. */
export function buildAttributes(opts: {
  sub: SubPos;
  ca: number;
  age: number;
  height: number;
  foot: Foot;
  stats?: BaseStats;
  caps?: number;
  r: Rng;
}): number[] {
  const { sub, ca, age, height, stats, caps = 0, r } = opts;
  const role = SUB_ROLE[sub];
  const w = ROLE_WEIGHTS[role];
  const level = (ca / 200) * 17 + 1;
  const attrs = new Array<number>(ATTR_COUNT).fill(10);
  for (let i = 0; i < 36; i++) {
    const p = 0.62 + 0.5 * w[i];
    attrs[i] = level * p + r.normal(0, 1.4);
  }
  // Fysik afhænger af alder
  const physAge = age < 24 ? 0.6 : age > 29 ? -(age - 29) * 0.7 : 0;
  for (const k of ['pace', 'acceleration', 'agility', 'stamina'] as const) attrs[A[k]] += physAge;
  attrs[A.naturalFitness] = 10 + r.normal(0, 3) + (age > 30 ? 1 : 0);
  attrs[A.determination] = 11 + r.normal(0, 3.5) + (ca > 150 ? 1.5 : 0);
  // Højde
  if (height > 0) {
    const h = (height - 181) / 7; // ~±1 pr. 7 cm
    attrs[A.heading] += h * 1.4;
    attrs[A.jumping] += h * 1.2;
    attrs[A.strength] += h * 1.1;
    attrs[A.agility] -= h * 0.8;
    attrs[A.balance] -= h * 0.6;
    attrs[A.acceleration] -= h * 0.5;
  }
  // Statistik fra de seneste sæsoner
  if (stats && stats.minutes >= 600) {
    const per90 = (n: number) => (n * 90) / stats.minutes;
    const g = per90(stats.goals);
    const a = per90(stats.assists);
    const expG = role === 'ST' ? 0.38 : role === 'W' || role === 'AM' ? 0.22 : role === 'CM' || role === 'WM' ? 0.09 : 0.04;
    const expA = role === 'W' || role === 'AM' ? 0.2 : role === 'ST' || role === 'WM' ? 0.13 : role === 'FB' || role === 'CM' ? 0.08 : 0.03;
    const gd = clamp((g - expG) / Math.max(0.05, expG), -1, 1.5);
    const ad = clamp((a - expA) / Math.max(0.04, expA), -1, 1.5);
    attrs[A.finishing] += gd * 1.8;
    attrs[A.offTheBall] += gd * 1.2;
    attrs[A.anticipation] += gd * 0.6;
    attrs[A.passing] += ad * 1.0;
    attrs[A.creativity] += ad * 1.4;
    attrs[A.crossing] += ad * (role === 'W' || role === 'WM' || role === 'FB' ? 1.2 : 0.4);
    const cards = per90(stats.yellows + stats.reds * 3);
    attrs[A.aggression] += clamp((cards - 0.18) * 12, -3, 5);
    attrs[A.dirtiness] = 7 + clamp((cards - 0.15) * 25, -5, 10) + r.normal(0, 2);
    const minShare = stats.minutes / Math.max(1, stats.apps * 90);
    attrs[A.consistency] = 9 + ca / 40 + minShare * 2 + r.normal(0, 2.5);
  } else {
    attrs[A.dirtiness] = 8 + r.normal(0, 3);
    attrs[A.consistency] = 8 + ca / 40 + r.normal(0, 3);
  }
  // Standardsituationer følger teknik
  const tech = attrs[A.technique];
  attrs[A.freeKicks] = tech * 0.6 + r.normal(4, 3);
  attrs[A.corners] = (attrs[A.crossing] + tech) * 0.3 + r.normal(4, 3);
  attrs[A.penalties] = attrs[A.finishing] * 0.5 + r.normal(6, 3);
  attrs[A.throwIns] = r.normal(9, 3) + (role === 'FB' ? 2 : 0);
  if (role === 'GK') {
    attrs[A.freeKicks] = r.normal(4, 2);
    attrs[A.corners] = r.normal(3, 2);
    attrs[A.penalties] = r.normal(5, 2);
  }
  // Skjulte
  attrs[A.importantMatches] = 10 + Math.min(5, caps / 15) + r.normal(0, 3);
  attrs[A.injuryProneness] = 2 + Math.abs(r.normal(0, 5)) + (age > 31 ? 2 : 0);
  attrs[A.versatility] = 10 + r.normal(0, 4);
  for (const k of ['adaptability', 'ambition', 'loyalty', 'pressure', 'professionalism', 'sportsmanship', 'temperament'] as const) {
    attrs[A[k]] = 11 + r.normal(0, 3.5);
  }
  attrs[A.ambition] += ca > 150 ? 2 : 0;
  attrs[A.pressure] += ca > 160 ? 2 : 0;
  for (let i = 0; i < ATTR_COUNT; i++) attrs[i] = clamp(attrs[i], 1, 20);
  return attrs;
}

export function emptyStats() {
  return { apps: 0, subs: 0, minutes: 0, goals: 0, assists: 0, mom: 0, yellows: 0, reds: 0, ratingSum: 0, ratingCount: 0, lgGoals: 0, lgApps: 0 };
}

export function makePlayer(o: {
  id: number;
  first: string;
  last: string;
  dob: string;
  nation: number;
  club: number;
  sub: SubPos;
  foot: Foot;
  height: number;
  ca: number;
  pa?: number;
  value?: number;
  caps?: number;
  intGoals?: number;
  stats?: BaseStats;
  contractEnd?: string;
  date: string;
  seed: number;
  wealth?: number;
  regen?: boolean;
}): Player {
  const r = new Rng(hash(o.seed, o.id));
  const age = ageOn(o.dob, o.date);
  const ca = Math.round(clamp(o.ca + r.normal(0, 3), 20, 198));
  const pa = o.pa ?? potentialFor(ca, age, r);
  const attrs = buildAttributes({ sub: o.sub, ca, age, height: o.height, foot: o.foot, stats: o.stats, caps: o.caps, r });
  const { pos, side } = positionRatings(o.sub, o.foot, r);
  const value = o.value && o.value > 0 ? o.value : valueFromCA(ca, pa, age);
  const rep = clamp(Math.round((ca - 40) * 0.55 + Math.min(15, (o.caps ?? 0) / 4)), 1, 100);
  const y = Number(o.date.slice(0, 4));
  const expires = o.contractEnd && o.contractEnd >= o.date ? o.contractEnd : `${y + r.int(1, 4)}-06-30`;
  return {
    id: o.id,
    first: o.first,
    last: o.last,
    dob: o.dob,
    nation: o.nation,
    club: o.club,
    foot: o.foot,
    height: o.height || Math.round(r.normal(o.sub === 'GK' ? 189 : o.sub === 'CB' ? 186 : 179, 5)),
    attrs,
    pos,
    side,
    ca,
    pa: Math.max(pa, ca),
    rep,
    value,
    contract: o.club ? { wage: wageFor(value, o.wealth ?? 1), expires } : null,
    condition: 95 + r.int(0, 5),
    morale: 13 + r.int(-2, 2),
    form: [],
    injury: null,
    banned: 0,
    yellowCount: 0,
    training: defaultTraining(SUB_ROLE[o.sub]),
    listed: false,
    loan: null,
    stats: emptyStats(),
    history: [],
    caps: o.caps ?? 0,
    intGoals: o.intGoals ?? 0,
    regen: o.regen,
  };
}

export function defaultTraining(role: Role): string {
  switch (role) {
    case 'GK': return 'goalkeeping';
    case 'CB': case 'FB': case 'DM': return 'defending';
    case 'CM': case 'AM': return 'ballcontrol';
    case 'WM': case 'W': return 'attacking';
    case 'ST': return 'shooting';
  }
}

const SUB_DIST: [SubPos, number][] = [
  ['GK', 3], ['CB', 4], ['LB', 2], ['RB', 2], ['DM', 2], ['CM', 3], ['AM', 1], ['LM', 1], ['RM', 1], ['LW', 1], ['RW', 1], ['CF', 3],
];

export function randomSub(r: Rng): SubPos {
  return r.weighted(SUB_DIST, (x) => x[1])![0];
}

export function randomName(names: Record<number, [string[], string[]]>, nation: number, r: Rng): [string, string] {
  const pool = names[nation] ?? names[Number(Object.keys(names)[0])];
  // Skæv mod de mest almindelige navne
  const pickSkew = (arr: string[]) => arr[Math.floor(Math.pow(r.next(), 1.6) * arr.length)] ?? 'Alex';
  return [pickSkew(pool[0]), pickSkew(pool[1])];
}

export function randomDob(age: number, date: string, r: Rng): string {
  const y = Number(date.slice(0, 4)) - age - 1;
  const doy = r.int(0, 364);
  const d = new Date(Date.UTC(y, 6, 1 + doy));
  return d.toISOString().slice(0, 10);
}

const STAFF_ROLE_ATTR: Record<StaffRole, (keyof Staff['attrs'])[]> = {
  manager: ['tactics', 'motivating', 'judgingAbility'],
  assistant: ['coaching', 'tactics', 'judgingAbility'],
  coach: ['coaching', 'discipline'],
  physio: ['physio'],
  scout: ['judgingAbility', 'judgingPotential'],
};

export function makeStaff(o: { id: number; first: string; last: string; nation: number; club: number; role: StaffRole; level: number; date: string; seed: number }): Staff {
  const r = new Rng(hash(o.seed, o.id, 77));
  const base = (o.level / 100) * 12 + 4;
  const attr = () => clamp(Math.round(base + r.normal(0, 2.5)), 1, 20);
  const attrs = { coaching: attr(), judgingAbility: attr(), judgingPotential: attr(), physio: clamp(Math.round(r.normal(5, 3)), 1, 20), motivating: attr(), discipline: attr(), tactics: attr() };
  for (const k of STAFF_ROLE_ATTR[o.role]) attrs[k] = clamp(attrs[k] + r.int(1, 4), 1, 20);
  if (o.role === 'physio') attrs.physio = clamp(Math.round(base + 2 + r.normal(0, 2.5)), 1, 20);
  const age = o.role === 'manager' ? r.int(38, 64) : r.int(30, 62);
  const y = Number(o.date.slice(0, 4));
  return {
    id: o.id,
    first: o.first,
    last: o.last,
    nation: o.nation,
    dob: randomDob(age, o.date, r),
    club: o.club,
    role: o.role,
    attrs,
    rep: clamp(Math.round(o.level + r.normal(0, 8)), 1, 100),
    wage: Math.round(((o.role === 'manager' ? 800 : o.role === 'assistant' ? 330 : 250) * Math.pow(1.05, Math.max(0, o.level))) / 50) * 50 + 300,
    expires: `${y + r.int(1, 3)}-06-30`,
    style: o.role === 'manager' ? { formation: r.weighted(AI_FORMATIONS, (f) => f[1])![0], mentality: r.int(1, 3) } : undefined,
  };
}

export const AI_FORMATIONS: [string, number][] = [
  ['4-4-2', 5], ['4-2-3-1', 6], ['4-3-3', 6], ['4-1-4-1', 2], ['3-5-2', 2], ['4-4-2 Diamond', 1], ['5-3-2', 1], ['3-4-3', 1], ['4-5-1', 2],
];

export { ATTRS, GROUPS };
