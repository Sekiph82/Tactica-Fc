import type { Player, PosKey, Role, Side, Slot } from './types';
import { POSITIONS, SIDES } from './types';

// Attributlisten følger CM 01/02 (player.dat/staff.dat) – se docs/RESEARCH.md
export const ATTRS = [
  // Teknisk (0-13)
  'crossing', 'dribbling', 'finishing', 'heading', 'longShots', 'marking', 'offTheBall', 'passing',
  'penalties', 'tackling', 'freeKicks', 'corners', 'technique', 'throwIns',
  // Mental (14-24)
  'aggression', 'anticipation', 'bravery', 'creativity', 'decisions', 'determination', 'flair',
  'influence', 'positioning', 'teamwork', 'workRate',
  // Fysisk (25-32)
  'acceleration', 'agility', 'balance', 'jumping', 'naturalFitness', 'pace', 'stamina', 'strength',
  // Målmand (33-35)
  'handling', 'oneOnOnes', 'reflexes',
  // Skjulte (36-47)
  'consistency', 'importantMatches', 'injuryProneness', 'dirtiness', 'versatility', 'adaptability',
  'ambition', 'loyalty', 'pressure', 'professionalism', 'sportsmanship', 'temperament',
] as const;

export type AttrKey = (typeof ATTRS)[number];
export const A = Object.fromEntries(ATTRS.map((k, i) => [k, i])) as Record<AttrKey, number>;
export const ATTR_COUNT = ATTRS.length;

export const GROUPS: Record<'technical' | 'mental' | 'physical' | 'goalkeeping' | 'hidden', AttrKey[]> = {
  technical: ['corners', 'crossing', 'dribbling', 'finishing', 'freeKicks', 'heading', 'longShots', 'marking', 'offTheBall', 'passing', 'penalties', 'tackling', 'technique', 'throwIns'],
  mental: ['aggression', 'anticipation', 'bravery', 'creativity', 'decisions', 'determination', 'flair', 'influence', 'positioning', 'teamwork', 'workRate'],
  physical: ['acceleration', 'agility', 'balance', 'jumping', 'naturalFitness', 'pace', 'stamina', 'strength'],
  goalkeeping: ['handling', 'oneOnOnes', 'reflexes'],
  hidden: ['consistency', 'importantMatches', 'injuryProneness', 'dirtiness', 'versatility', 'adaptability', 'ambition', 'loyalty', 'pressure', 'professionalism', 'sportsmanship', 'temperament'],
};

const TECH = new Set(GROUPS.technical);
const MENT = new Set(GROUPS.mental);
const PHYS = new Set(GROUPS.physical);
const GKS = new Set(GROUPS.goalkeeping);
const HIDDEN = new Set(GROUPS.hidden);

/** Hvor vigtig hver attribut er for en rolle (0-1). Bruges både til generering og vurdering. */
const ROLE_KEYS: Record<Role, Partial<Record<AttrKey, number>>> = {
  GK: { handling: 1, reflexes: 1, oneOnOnes: 0.85, positioning: 0.85, anticipation: 0.6, decisions: 0.6, agility: 0.75, jumping: 0.6, bravery: 0.5, influence: 0.3, passing: 0.25 },
  CB: { marking: 1, tackling: 1, heading: 0.9, positioning: 1, jumping: 0.8, strength: 0.8, anticipation: 0.8, bravery: 0.7, decisions: 0.6, pace: 0.5, passing: 0.35, teamwork: 0.5, aggression: 0.5 },
  FB: { tackling: 0.8, marking: 0.75, positioning: 0.75, pace: 0.9, acceleration: 0.8, stamina: 0.8, crossing: 0.7, workRate: 0.65, anticipation: 0.6, dribbling: 0.45, passing: 0.5, teamwork: 0.55 },
  DM: { tackling: 0.9, marking: 0.65, positioning: 0.85, passing: 0.7, decisions: 0.7, anticipation: 0.8, workRate: 0.8, stamina: 0.7, teamwork: 0.75, strength: 0.6, aggression: 0.5 },
  CM: { passing: 1, decisions: 0.8, creativity: 0.6, technique: 0.7, workRate: 0.7, stamina: 0.8, teamwork: 0.7, anticipation: 0.6, tackling: 0.5, longShots: 0.5, offTheBall: 0.5, dribbling: 0.45 },
  WM: { crossing: 0.9, pace: 0.8, acceleration: 0.7, stamina: 0.8, workRate: 0.7, dribbling: 0.7, passing: 0.6, technique: 0.6, teamwork: 0.55, offTheBall: 0.6 },
  AM: { creativity: 1, passing: 0.9, technique: 0.9, dribbling: 0.8, flair: 0.8, offTheBall: 0.7, decisions: 0.7, longShots: 0.6, finishing: 0.5, agility: 0.55, anticipation: 0.5 },
  W: { dribbling: 1, pace: 1, acceleration: 0.9, crossing: 0.8, flair: 0.8, technique: 0.8, agility: 0.7, offTheBall: 0.6, finishing: 0.5, creativity: 0.5 },
  ST: { finishing: 1, offTheBall: 0.9, anticipation: 0.8, heading: 0.6, pace: 0.65, acceleration: 0.65, dribbling: 0.5, technique: 0.5, strength: 0.55, decisions: 0.5, bravery: 0.4, jumping: 0.5 },
};

/** Vægte pr. rolle som fuldt array (inkl. standardvægte for uspecificerede attributter) */
export const ROLE_WEIGHTS: Record<Role, number[]> = Object.fromEntries(
  (Object.keys(ROLE_KEYS) as Role[]).map((role) => {
    const keys = ROLE_KEYS[role];
    const w = ATTRS.map((k) => {
      if (keys[k] !== undefined) return keys[k] as number;
      if (HIDDEN.has(k)) return 0;
      if (role === 'GK') return GKS.has(k) ? 1 : TECH.has(k) ? 0.05 : MENT.has(k) ? 0.3 : 0.3;
      if (GKS.has(k)) return 0;
      if (k === 'penalties' || k === 'freeKicks' || k === 'corners' || k === 'throwIns') return 0.1;
      if (TECH.has(k)) return 0.15;
      if (MENT.has(k)) return 0.35;
      if (PHYS.has(k)) return 0.4;
      return 0.2;
    });
    return [role, w];
  }),
) as Record<Role, number[]>;

/** Rolle for en formationsplads */
export function slotRole(slot: Slot): Role {
  switch (slot.pos) {
    case 'GK': return 'GK';
    case 'SW': return 'CB';
    case 'D': return slot.side === 'C' ? 'CB' : 'FB';
    case 'WB': return 'FB';
    case 'DM': return 'DM';
    case 'M': return slot.side === 'C' ? 'CM' : 'WM';
    case 'AM': return slot.side === 'C' ? 'AM' : 'W';
    case 'ST': return 'ST';
  }
}

/** Vægtet attribut-gennemsnit for rollen (1-20) */
export function roleScore(p: Player, role: Role): number {
  const w = ROLE_WEIGHTS[role];
  let s = 0;
  let t = 0;
  for (let i = 0; i < 36; i++) {
    const wi = w[i];
    if (wi > 0) {
      // kvadratisk vægtning → nøgleattributter betyder mest
      const ww = wi * wi;
      s += p.attrs[i] * ww;
      t += ww;
    }
  }
  return t > 0 ? s / t : 1;
}

const POS_IDX = Object.fromEntries(POSITIONS.map((p, i) => [p, i])) as Record<PosKey, number>;
const SIDE_IDX = Object.fromEntries(SIDES.map((s, i) => [s, i])) as Record<Side, number>;

/** Hvor godt passer spilleren til pladsen (0-1). Kombinerer position og side som i CM. */
export function slotFit(p: Player, slot: Slot): number {
  const pr = p.pos[POS_IDX[slot.pos]] ?? 1;
  if (slot.pos === 'GK') return pr / 20;
  const sr = p.side[SIDE_IDX[slot.side]] ?? 1;
  return (Math.min(pr, sr) * 0.7 + pr * 0.3) / 20;
}

/** Effektivitets-multiplikator ud fra pladsfit (bruges i matchmotoren) */
export function fitFactor(fit: number): number {
  return 0.55 + 0.45 * Math.pow(Math.max(0, Math.min(1, fit)), 1.4);
}

/** Bedste naturlige rolle (til visning og AI-behovsanalyse) */
export function naturalRole(p: Player): Role {
  const posI = p.pos.indexOf(Math.max(...p.pos));
  const pos = POSITIONS[posI];
  const sideI = p.side.indexOf(Math.max(...p.side));
  const side = SIDES[sideI];
  return slotRole({ pos, side, x: 0, y: 0 });
}

/** CM-agtig positionsstreng, fx "D/DM RC" eller "AM/F L" */
export function positionString(p: Player): string {
  const names: Record<PosKey, string> = { GK: 'GK', SW: 'SW', D: 'D', DM: 'DM', M: 'M', AM: 'AM', ST: 'F', WB: 'WB' };
  const ps = POSITIONS.filter((_, i) => p.pos[i] >= 15).map((k) => names[k]);
  if (ps.length === 0) ps.push(names[POSITIONS[p.pos.indexOf(Math.max(...p.pos))]]);
  if (ps.length === 1 && ps[0] === 'GK') return 'GK';
  const sides = SIDES.filter((_, i) => p.side[i] >= 15);
  // CM-rækkefølge R, L, C
  const order = ['R', 'L', 'C'].filter((s) => sides.includes(s as Side)).join('');
  return `${ps.join('/')} ${order}`.trim();
}

export function roleGroup(role: Role): string {
  return role;
}

export function attr(p: Player, k: AttrKey): number {
  return p.attrs[A[k]];
}

export const POSITIONS_LABEL: [string, number][] = [['GK', 0], ['SW', 1], ['D', 2], ['DM', 3], ['M', 4], ['AM', 5], ['F', 6], ['WB', 7]];

/**
 * Hvorfor passer en spiller (ikke) til en rolle: hans stærkeste og svageste af rollens vigtige egenskaber,
 * og om han er vant til pladsen. Bruges til korte beskrivelser som "god boldvinder · svag spilfordeler".
 */
export function roleProfile(p: Player, role: Role, slot?: Slot): { strengths: AttrKey[]; weaknesses: AttrKey[]; compromise: boolean } {
  const keys = Object.entries(ROLE_KEYS[role]).filter(([, w]) => (w ?? 0) >= 0.6).map(([k]) => k as AttrKey);
  const val = (k: AttrKey) => p.attrs[A[k]];
  const sorted = keys.slice().sort((a, b) => val(b) - val(a));
  const strengths = sorted.filter((k) => val(k) >= 14).slice(0, 2);
  const weaknesses = sorted.slice().reverse().filter((k) => val(k) <= 10).slice(0, strengths.length ? 1 : 2);
  return { strengths, weaknesses, compromise: !!slot && slotFit(p, slot) < 0.75 };
}
