// Træning og spillerudvikling (ugentlig)
import { A, ATTRS, type AttrKey } from './attributes';
import { ageOn } from './dates';
import { rng } from './rng';
import { gs } from './state';
import type { Player, Role } from './types';
import { valueFromCA } from './data/generate';
import { ROLE_WEIGHTS, naturalRole } from './attributes';
import { isHumanClub } from './humans';
import { squad } from './state';

export interface Schedule {
  key: string;
  focus: Partial<Record<AttrKey, number>>;
  load: number; // belastning → kondition og skadesrisiko
}

export const SCHEDULES: Schedule[] = [
  { key: 'general', focus: { passing: 1, technique: 1, stamina: 1, decisions: 1, tackling: 0.6, finishing: 0.6, teamwork: 1 }, load: 1 },
  { key: 'goalkeeping', focus: { handling: 2, reflexes: 2, oneOnOnes: 2, positioning: 1, agility: 1, jumping: 0.6 }, load: 0.8 },
  { key: 'defending', focus: { tackling: 2, marking: 2, positioning: 1.6, heading: 1.2, anticipation: 1, strength: 0.8 }, load: 1.1 },
  { key: 'ballcontrol', focus: { technique: 2, passing: 1.8, dribbling: 1.4, creativity: 1.2, decisions: 1, flair: 0.6 }, load: 0.9 },
  { key: 'attacking', focus: { dribbling: 1.6, crossing: 1.6, offTheBall: 1.4, pace: 0.8, acceleration: 0.8, creativity: 1 }, load: 1.1 },
  { key: 'shooting', focus: { finishing: 2.2, longShots: 1.4, offTheBall: 1.2, heading: 1, anticipation: 1 }, load: 1 },
  { key: 'fitness', focus: { stamina: 2, strength: 1.6, pace: 1.2, acceleration: 1.2, agility: 1, jumping: 1, naturalFitness: 0.5 }, load: 1.4 },
  { key: 'setpieces', focus: { freeKicks: 2.4, corners: 2.4, penalties: 2, throwIns: 1, crossing: 1 }, load: 0.7 },
  { key: 'rest', focus: {}, load: 0.3 },
];

const SCHEDULE_MAP = new Map(SCHEDULES.map((s) => [s.key, s]));

export interface CoachingInfo {
  /** samlet træningskvalitet 0-1 */
  quality: number;
  /** udviklingsfaktor i forhold til en gennemsnitlig klub (1 = normal) */
  factor: number;
  /** trænernes disciplin dæmper dovne/problemspillere (0-1) */
  discipline: number;
  /** trænernes motivation løfter moralen (0-1) */
  motivating: number;
  coaches: number;
}

/** Trænerholdets kvalitet: de bedste trænere vejer tungest, antallet og faciliteterne tæller med */
export function coachingInfo(clubId: number): CoachingInfo {
  const g = gs();
  const staff = Object.values(g.staff).filter((s) => s.club === clubId && (s.role === 'coach' || s.role === 'assistant'));
  const sorted = staff.map((s) => s.attrs.coaching).sort((a, b) => b - a);
  // de tre bedste trænere tæller dobbelt
  const weights = sorted.map((_, i) => (i < 3 ? 2 : 1));
  const wsum = weights.reduce((s, w) => s + w, 0) || 1;
  const avg = sorted.length ? sorted.reduce((s, v, i) => s + v * weights[i], 0) / wsum : 6;
  const depth = Math.min(1, staff.length / 5);
  const club = g.clubs[clubId];
  const quality = (avg / 20) * (0.7 + 0.3 * depth) * (0.75 + 0.25 * ((club?.facilities ?? 10) / 20));
  const avgOf = (k: 'discipline' | 'motivating') => (staff.length ? staff.reduce((s, x) => s + x.attrs[k], 0) / staff.length / 20 : 0.4);
  // 0.3 + 1.2*q: svage trænere (q≈0.3) ≈ 0.66, gode (q≈0.75) ≈ 1.2 – næsten dobbelt så hurtig udvikling
  return { quality, factor: (0.3 + 1.2 * quality) / (0.3 + 1.2 * 0.5), discipline: avgOf('discipline'), motivating: avgOf('motivating'), coaches: staff.length };
}

function coachQuality(clubId: number): CoachingInfo {
  return coachingInfo(clubId);
}

/** Kører hver mandag for alle spillere */
export function weeklyDevelopment() {
  const g = gs();
  const cq = new Map<number, CoachingInfo>();
  const none: CoachingInfo = { quality: 0.25, factor: 0.6, discipline: 0.3, motivating: 0.3, coaches: 0 };
  for (const p of Object.values(g.players)) {
    if (!cq.has(p.club)) cq.set(p.club, p.club ? coachQuality(p.club) : none);
    const ci = cq.get(p.club)!;
    develop(p, ci);
    // motiverende trænere løfter moralen en smule hver uge
    if (p.club && ci.motivating > 0.55) p.morale = Math.min(20, p.morale + (ci.motivating - 0.55) * 0.6);
  }
}

const YOUTH_RATE = 0.0115;
const PRIME_RATE = 0.003;

function develop(p: Player, ci: CoachingInfo) {
  const coachF = 0.3 + 1.2 * ci.quality;
  const g = gs();
  const age = ageOn(p.dob, g.date);
  const sched = SCHEDULE_MAP.get(p.training) ?? SCHEDULES[0];
  // disciplinerede trænere får mere ud af umotiverede spillere
  const rawProf = (p.attrs[A.professionalism] + p.attrs[A.determination]) / 40; // 0.05-1
  const prof = rawProf + (1 - rawProf) * ci.discipline * 0.35;
  const minutesBoost = Math.min(1, p.stats.minutes / Math.max(1, 90 * 20)) * 0.4 + 0.8;
  let delta = 0;
  if (age <= 23) {
    const ageF = age <= 18 ? 1 : age <= 20 ? 0.9 : age <= 22 ? 0.65 : 0.45;
    // kalibreret (scripts/player-pool.ts): talenter når tæt på deres potentiale omkring 22-23 år
    delta = (p.pa - p.ca) * YOUTH_RATE * ageF * coachF * (0.55 + prof * 0.7) * minutesBoost * sched.load;
  } else if (age <= 28) {
    // de fleste topper midt i 20'erne – kun en langsom vækst herfra (ellers vokser antallet af stjerner hvert år)
    delta = (p.pa - p.ca) * PRIME_RATE * coachF * (0.6 + prof * 0.6) * minutesBoost;
  } else if (age >= 30) {
    // gode trænere og fysioterapi bremser tilbagegangen en smule
    delta = -(0.03 + (age - 29) * 0.03) * (1.2 - p.attrs[A.naturalFitness] / 40) * (1.1 - prof * 0.3) * (1.2 - coachF * 0.25);
  }
  delta += rng.normal(0, 0.05);
  if (Math.abs(delta) < 0.01) return;
  const before = p.ca;
  p.ca = Math.max(1, Math.min(p.pa + (delta < 0 ? 0 : 0), p.ca + delta, 200));
  const change = p.ca - before;
  if (change === 0) return;
  // Fordel ændringen på attributter: træningsfokus ved vækst, fysik først ved tilbagegang
  const pts = change * 0.16;
  if (change > 0) {
    const isGK = p.pos[0] >= 15;
    // bred vækst + ekstra i træningsfokus
    for (let i = 0; i < 33; i++) bump(p, i, change * 0.045);
    if (isGK) for (let i = 33; i < 36; i++) bump(p, i, change * 0.06);
    for (const [k, w] of Object.entries(sched.focus) as [AttrKey, number][]) {
      if (!isGK && A[k] >= 33) continue;
      bump(p, A[k], change * 0.08 * w);
    }
  } else {
    const phys: AttrKey[] = ['pace', 'acceleration', 'stamina', 'agility', 'jumping', 'strength'];
    for (const k of phys) bump(p, A[k], pts * 1.3);
    for (const k of ['anticipation', 'decisions', 'positioning'] as AttrKey[]) bump(p, A[k], -pts * 0.3); // erfaring
  }
}

function bump(p: Player, i: number, d: number) {
  p.attrs[i] = Math.max(1, Math.min(20, p.attrs[i] + d));
}

/** Månedlig værdiopdatering */
export function monthlyValues() {
  const g = gs();
  for (const p of Object.values(g.players)) {
    const age = ageOn(p.dob, g.date);
    const target = valueFromCA(p.ca, p.pa, age);
    // glid mod modelværdien og påvirkes af form
    const form = p.form.length ? p.form.reduce((s, x) => s + x, 0) / p.form.length : 6.5;
    const formF = 1 + (form - 6.7) * 0.06;
    let v = p.value * 0.85 + target * 0.15 * formF;
    if (p.contract) {
      const yearsLeft = (Number(p.contract.expires.slice(0, 4)) - Number(g.date.slice(0, 4)));
      if (yearsLeft <= 0) v *= 0.75;
    }
    p.value = roundV(Math.max(1000, v));
    p.rep = Math.max(1, Math.min(100, p.rep * 0.97 + ((p.ca - 40) * 0.55) * 0.03));
  }
}

function roundV(v: number) {
  if (v < 1_000_000) return Math.round(v / 5000) * 5000;
  return Math.round(v / 50_000) * 50_000;
}

export { ATTRS };

// ---------- udviklingshistorik ----------

/** Gem et øjebliksbillede af spillerens attributter (bruges til udviklingsgrafer) */
export function recordDevelopment(p: Player, date = gs().date) {
  const snap = { d: date, a: p.attrs.slice(0, 36).map((v) => Math.round(v * 10) / 10) };
  const dev = p.dev ?? (p.dev = []);
  const last = dev[dev.length - 1];
  if (last && last.d.slice(0, 7) === date.slice(0, 7)) dev[dev.length - 1] = snap;
  else dev.push(snap);
  if (dev.length > 36) dev.shift();
}

/** Månedligt: øjebliksbilleder for alle menneskestyrede klubbers spillere */
export function monthlyDevelopment() {
  const g = gs();
  for (const c of Object.values(g.clubs)) {
    if (!isHumanClub(c.id)) continue;
    for (const p of squad(c.id)) recordDevelopment(p);
  }
  // udlejede spillere følges også
  for (const p of Object.values(g.players)) if (p.loan && isHumanClub(p.loan.from)) recordDevelopment(p);
}

// ---------- assistentens træningsforslag ----------

export interface TrainingAdvice {
  key: string;
  reason: string;
  attrs: string[];
}

const GK_KEYS = new Set(['handling', 'oneOnOnes', 'reflexes']);

/** Hvad bør spilleren træne? Ser på rollens vigtigste attributter, alder, skader og dødbolde. */
export function trainingAdvice(p: Player): TrainingAdvice {
  const g = gs();
  const age = ageOn(p.dob, g.date);
  if (p.injury && p.injury.days > 7) return { key: 'rest', reason: 'adv.injured', attrs: [] };
  const role = naturalRole(p);
  const w = ROLE_WEIGHTS[role];
  // reference: gennemsnit af rollens fem vigtigste attributter
  const keyIdx = w.map((x, i) => [x, i] as const).filter(([, i]) => i < 36).sort((a, b) => b[0] - a[0]).slice(0, 5).map(([, i]) => i);
  const ref = keyIdx.reduce((s, i) => s + p.attrs[i], 0) / keyIdx.length;
  if (age >= 31) {
    const phys = (p.attrs[A.pace] + p.attrs[A.stamina] + p.attrs[A.strength]) / 3;
    if (phys < ref - 1) return { key: 'fitness', reason: 'adv.age', attrs: ['stamina', 'pace'] };
  }
  let best: TrainingAdvice = { key: CORE[role][0], reason: 'adv.core', attrs: [] };
  let bestScore = 0.35;
  for (const key of ALLOWED[role]) {
    const s = SCHEDULE_MAP.get(key);
    if (!s) continue;
    let score = 0;
    const weak: [string, number][] = [];
    for (const [k, fw] of Object.entries(s.focus) as [AttrKey, number][]) {
      // kun programmets hovedattributter (ellers styrer fx hovedstød i afslutningstræning en forsvarers forslag)
      if (fw < 1.2) continue;
      const i = A[k];
      if (i >= 36) continue;
      if (role !== 'GK' && GK_KEYS.has(k)) continue;
      const rw = w[i] ?? 0;
      if (rw < 0.45) continue; // kun attributter der betyder noget for rollen
      const gap = Math.max(0, ref - p.attrs[i]);
      const contrib = gap * fw * rw * rw;
      score += contrib;
      if (contrib > 0) weak.push([k, contrib]);
    }
    // dødboldsskytter får fordel af dødboldstræning
    if (s.key === 'setpieces') {
      const t = g.tactic;
      const taker = !!t && p.club === g.userClub && [t.freeKicks, t.corners, t.penalties].includes(p.id);
      score = taker ? score * 3 + 0.5 : score * 0.3;
    }
    // fysisk træning kun ved en tydelig fysisk svaghed – undtagen hvor fart er kernen (backer og kanter)
    if (s.key === 'fitness' && role !== 'FB' && role !== 'W' && role !== 'WM') score *= 0.55;
    // positionens kerneprogram foretrækkes, når der ikke er en tydelig svaghed andetsteds
    if (CORE[role].includes(s.key)) score = score * 1.4 + 0.9;
    if (age <= 21 && s.key !== 'fitness') score *= 1.15; // unge: fokuser på færdigheder
    if (score > bestScore) {
      bestScore = score;
      const reason = weak.length ? (age <= 21 ? 'adv.youth' : 'adv.weakness') : 'adv.core';
      best = { key: s.key, reason, attrs: weak.sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k) };
    }
  }
  return best;
}

/** Træningsprogrammer der giver mening for hver position (det første er positionens kerne) */
const ALLOWED: Record<Role, string[]> = {
  GK: ['goalkeeping', 'fitness'],
  CB: ['defending', 'fitness', 'ballcontrol', 'setpieces'],
  FB: ['defending', 'attacking', 'fitness', 'ballcontrol'],
  DM: ['defending', 'ballcontrol', 'fitness'],
  CM: ['ballcontrol', 'fitness', 'shooting', 'defending', 'setpieces'],
  WM: ['attacking', 'ballcontrol', 'fitness', 'setpieces'],
  AM: ['ballcontrol', 'shooting', 'attacking', 'setpieces'],
  W: ['attacking', 'shooting', 'ballcontrol', 'fitness', 'setpieces'],
  ST: ['shooting', 'attacking', 'ballcontrol', 'fitness'],
};
const CORE: Record<Role, string[]> = {
  GK: ['goalkeeping'], CB: ['defending'], FB: ['defending', 'attacking'], DM: ['defending'], CM: ['ballcontrol'],
  WM: ['attacking'], AM: ['ballcontrol', 'shooting'], W: ['attacking'], ST: ['shooting'],
};

/** Månedlig besked fra assistenten om spillere der træner forkert */
export function monthlyTrainingReport(): { mismatches: number } {
  const g = gs();
  if (!g.userClub) return { mismatches: 0 };
  let mismatches = 0;
  for (const p of squad(g.userClub)) if (trainingAdvice(p).key !== p.training) mismatches++;
  return { mismatches };
}
