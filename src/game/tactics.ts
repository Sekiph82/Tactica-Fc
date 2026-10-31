import { fitFactor, roleScore, slotFit, slotRole } from './attributes';
import { benchSize } from './rules';
import type { Player, PlayerInstructions, PosKey, Side, Slot, Tactic, TeamInstructions } from './types';

type S = [PosKey, Side, number, number];

// x: 0 = eget mål, 100 = modstanderens. y: 0 = venstre kant.
const F: Record<string, S[]> = {
  '4-4-2': [['GK', 'C', 4, 50], ['D', 'L', 24, 12], ['D', 'C', 20, 38], ['D', 'C', 20, 62], ['D', 'R', 24, 88], ['M', 'L', 50, 12], ['M', 'C', 47, 38], ['M', 'C', 47, 62], ['M', 'R', 50, 88], ['ST', 'C', 76, 40], ['ST', 'C', 76, 60]],
  '4-4-2 Diamond': [['GK', 'C', 4, 50], ['D', 'L', 24, 12], ['D', 'C', 20, 38], ['D', 'C', 20, 62], ['D', 'R', 24, 88], ['DM', 'C', 37, 50], ['M', 'C', 50, 30], ['M', 'C', 50, 70], ['AM', 'C', 63, 50], ['ST', 'C', 78, 40], ['ST', 'C', 78, 60]],
  '4-3-3': [['GK', 'C', 4, 50], ['D', 'L', 24, 12], ['D', 'C', 20, 38], ['D', 'C', 20, 62], ['D', 'R', 24, 88], ['DM', 'C', 38, 50], ['M', 'C', 50, 32], ['M', 'C', 50, 68], ['AM', 'L', 70, 14], ['ST', 'C', 78, 50], ['AM', 'R', 70, 86]],
  '4-2-3-1': [['GK', 'C', 4, 50], ['D', 'L', 24, 12], ['D', 'C', 20, 38], ['D', 'C', 20, 62], ['D', 'R', 24, 88], ['DM', 'C', 38, 38], ['DM', 'C', 38, 62], ['AM', 'L', 64, 14], ['AM', 'C', 62, 50], ['AM', 'R', 64, 86], ['ST', 'C', 80, 50]],
  '4-5-1': [['GK', 'C', 4, 50], ['D', 'L', 24, 12], ['D', 'C', 20, 38], ['D', 'C', 20, 62], ['D', 'R', 24, 88], ['M', 'L', 50, 12], ['M', 'C', 46, 32], ['M', 'C', 44, 50], ['M', 'C', 46, 68], ['M', 'R', 50, 88], ['ST', 'C', 78, 50]],
  '4-1-4-1': [['GK', 'C', 4, 50], ['D', 'L', 24, 12], ['D', 'C', 20, 38], ['D', 'C', 20, 62], ['D', 'R', 24, 88], ['DM', 'C', 36, 50], ['M', 'L', 54, 12], ['M', 'C', 52, 38], ['M', 'C', 52, 62], ['M', 'R', 54, 88], ['ST', 'C', 78, 50]],
  '3-5-2': [['GK', 'C', 4, 50], ['D', 'C', 20, 28], ['D', 'C', 18, 50], ['D', 'C', 20, 72], ['WB', 'L', 44, 8], ['M', 'C', 46, 32], ['DM', 'C', 38, 50], ['M', 'C', 46, 68], ['WB', 'R', 44, 92], ['ST', 'C', 76, 40], ['ST', 'C', 76, 60]],
  '3-4-3': [['GK', 'C', 4, 50], ['D', 'C', 20, 28], ['D', 'C', 18, 50], ['D', 'C', 20, 72], ['M', 'L', 48, 10], ['M', 'C', 46, 38], ['M', 'C', 46, 62], ['M', 'R', 48, 90], ['AM', 'L', 72, 18], ['ST', 'C', 80, 50], ['AM', 'R', 72, 82]],
  '5-3-2': [['GK', 'C', 4, 50], ['WB', 'L', 32, 8], ['D', 'C', 18, 30], ['SW', 'C', 14, 50], ['D', 'C', 18, 70], ['WB', 'R', 32, 92], ['M', 'C', 46, 30], ['M', 'C', 44, 50], ['M', 'C', 46, 70], ['ST', 'C', 74, 40], ['ST', 'C', 74, 60]],
  '5-4-1': [['GK', 'C', 4, 50], ['WB', 'L', 28, 8], ['D', 'C', 18, 30], ['D', 'C', 16, 50], ['D', 'C', 18, 70], ['WB', 'R', 28, 92], ['M', 'L', 48, 16], ['M', 'C', 44, 40], ['M', 'C', 44, 60], ['M', 'R', 48, 84], ['ST', 'C', 74, 50]],
  '4-2-4': [['GK', 'C', 4, 50], ['D', 'L', 24, 12], ['D', 'C', 20, 38], ['D', 'C', 20, 62], ['D', 'R', 24, 88], ['M', 'C', 46, 38], ['M', 'C', 46, 62], ['AM', 'L', 72, 12], ['ST', 'C', 78, 40], ['ST', 'C', 78, 60], ['AM', 'R', 72, 88]],
  '4-3-1-2': [['GK', 'C', 4, 50], ['D', 'L', 24, 12], ['D', 'C', 20, 38], ['D', 'C', 20, 62], ['D', 'R', 24, 88], ['M', 'C', 46, 28], ['DM', 'C', 40, 50], ['M', 'C', 46, 72], ['AM', 'C', 62, 50], ['ST', 'C', 78, 40], ['ST', 'C', 78, 60]],
};

export const FORMATIONS = Object.keys(F);

export function formationSlots(name: string): Slot[] {
  return (F[name] ?? F['4-4-2']).map(([pos, side, x, y]) => ({ pos, side, x, y }));
}

export function defaultTeamInstructions(mentality = 2): TeamInstructions {
  return { mentality, passing: 1, tempo: 1, width: 1, closingDown: 1, tackling: 1, marking: 'zonal', offside: false, counter: false };
}

export function defaultPlayerInstructions(slot: Slot): PlayerInstructions {
  const role = slotRole(slot);
  return {
    runs: role === 'ST' || role === 'W' || role === 'AM' ? 2 : role === 'CB' || role === 'GK' || role === 'DM' ? 0 : 1,
    runWithBall: role === 'W' || role === 'WM',
    longShots: role === 'AM' || role === 'CM' ? 1 : role === 'ST' ? 1 : 0,
    throughBalls: role === 'AM' || role === 'CM',
    crossing: role === 'W' || role === 'WM' || role === 'FB' ? 2 : 1,
    tightMarking: false,
    freeRole: false,
  };
}

export function newTactic(formation: string, mentality = 2): Tactic {
  const slots = formationSlots(formation);
  return {
    formation,
    slots,
    lineup: slots.map(() => 0),
    bench: [],
    team: defaultTeamInstructions(mentality),
    individual: slots.map(defaultPlayerInstructions),
    captain: 0,
    penalties: 0,
    freeKicks: 0,
    corners: 0,
  };
}

export function changeFormation(t: Tactic, formation: string): Tactic {
  const slots = formationSlots(formation);
  return { ...t, formation, slots, individual: slots.map(defaultPlayerInstructions) };
}

/** Kan spilleren spille i dag? */
export function available(p: Player): boolean {
  return !p.injury && p.banned <= 0;
}

/** Spillerens værdi på en plads, inkl. kondition. Bruges af AI og assistenten. */
export function slotValue(p: Player, slot: Slot, considerCondition = true): number {
  const fit = slotFit(p, slot);
  let v = roleScore(p, slotRole(slot)) * fitFactor(fit);
  if (considerCondition) v *= 0.55 + 0.45 * Math.min(1, p.condition / 100);
  return v;
}

/** Grådig opstilling: bedste spiller-plads-par først. */
export function pickLineup(players: Player[], slots: Slot[], considerCondition = true): { lineup: number[]; bench: number[] } {
  const avail = players.filter(available);
  const pairs: [number, number, number][] = [];
  for (let s = 0; s < slots.length; s++) {
    for (let i = 0; i < avail.length; i++) {
      pairs.push([slotValue(avail[i], slots[s], considerCondition), i, s]);
    }
  }
  pairs.sort((a, b) => b[0] - a[0]);
  const lineup = slots.map(() => 0);
  const used = new Set<number>();
  let filled = 0;
  for (const [, i, s] of pairs) {
    if (filled === slots.length) break;
    if (lineup[s] || used.has(i)) continue;
    lineup[s] = avail[i].id;
    used.add(i);
    filled++;
  }
  // Bænk: reservemålmand + bedste rest efter alsidighed
  const rest = avail.filter((_, i) => !used.has(i));
  const bench: number[] = [];
  const gk = rest.filter((p) => p.pos[0] >= 15).sort((a, b) => b.ca - a.ca)[0];
  if (gk) bench.push(gk.id);
  const others = rest
    .filter((p) => p !== gk)
    .sort((a, b) => b.ca * (0.6 + 0.4 * b.condition / 100) - a.ca * (0.6 + 0.4 * a.condition / 100));
  // sørg for spredning: forsvar, midtbane, angreb
  const want = ['D', 'M', 'ST', 'AM', 'DM'];
  for (const w of want) {
    if (bench.length >= benchSize()) break;
    const idx = others.findIndex((p) => p.pos[['GK', 'SW', 'D', 'DM', 'M', 'AM', 'ST', 'WB'].indexOf(w)] >= 15);
    if (idx >= 0) bench.push(others.splice(idx, 1)[0].id);
  }
  while (bench.length < benchSize() && others.length) bench.push(others.shift()!.id);
  return { lineup, bench };
}

/** Udfyld en taktik med opstilling, kaptajn og dødboldsskytter */
export function autoSelect(t: Tactic, players: Player[], considerCondition = true): Tactic {
  const { lineup, bench } = pickLineup(players, t.slots, considerCondition);
  const byId = new Map(players.map((p) => [p.id, p]));
  const xi = lineup.map((id) => byId.get(id)).filter(Boolean) as Player[];
  const best = (f: (p: Player) => number) => xi.slice().sort((a, b) => f(b) - f(a))[0]?.id ?? 0;
  return {
    ...t,
    lineup,
    bench,
    captain: best((p) => p.attrs[21] * 2 + p.ca / 20),
    penalties: best((p) => p.attrs[8] + p.attrs[2] * 0.3),
    freeKicks: best((p) => p.attrs[10]),
    corners: best((p) => p.attrs[11]),
  };
}

/** Rens taktik for spillere der ikke længere er tilgængelige */
export function validateTactic(t: Tactic, players: Player[]): Tactic {
  const ids = new Set(players.filter(available).map((p) => p.id));
  const lineup = t.lineup.map((id) => (ids.has(id) ? id : 0));
  const bench = t.bench.filter((id) => ids.has(id) && !lineup.includes(id));
  return { ...t, lineup, bench };
}

export function lineupComplete(t: Tactic): boolean {
  return t.lineup.every((id) => id > 0) && new Set(t.lineup).size === t.lineup.length;
}
