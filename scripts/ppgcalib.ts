// Point pr. kamp (og bestyrelsens forventning, board.ts) som funktion af styrkeforskel (squadStrength), til bestyrelsens forventning. Kør: npx tsx scripts/ppgcalib.ts
import { readFileSync } from 'node:fs';
import { createGame, type WorldData } from '../src/game/newgame';
import { aiTactic, engineTeam } from '../src/game/sim';
import { quickMatch } from '../src/game/engine/match';
import { gs } from '../src/game/state';
import { squadStrength } from '../src/game/board';
import { Rng } from '../src/game/rng';
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);
createGame(world, { managerName: 'T', managerNation: ni('Denmark'), clubId: 443, activeNations: ['Denmark', 'England'].map(ni), lang: 'da', masking: true, seed: 1 });
const g = gs();
const r = new Rng(3);
const bins = new Map<number, [number, number, number]>();
for (const L of ['DK1', 'DK2', 'GB1', 'GB2']) {
  const cl = Object.values(g.clubs).filter((c) => c.league === L).map((c) => c.id);
  for (let i = 0; i < 1500; i++) {
    const h = r.pick(cl), a = r.pick(cl.filter((c) => c !== h));
    const d = (squadStrength(h) - squadStrength(a)) / 12;
    const rep = quickMatch(engineTeam(h, aiTactic(h, a, true)), engineTeam(a, aiTactic(a, h, false)), {}, r);
    const [x, y] = [rep.stats[0].goals, rep.stats[1].goals];
    for (const [dd, p] of [[d, x > y ? 3 : x === y ? 1 : 0], [-d, y > x ? 3 : x === y ? 1 : 0]] as const) {
      const b = Math.max(-3, Math.min(3, Math.round(dd * 2) / 2));
      const e = bins.get(b) ?? [0, 0, 0]; e[0]++; e[1] += p; e[2] += 1.37 + 1.05 * Math.tanh(dd * 0.45); bins.set(b, e);
    }
  }
}
for (const [b, [n, p, e]] of [...bins].sort((a, b) => a[0] - b[0])) console.log(`diff ${b.toFixed(1).padStart(5)}  n ${String(n).padStart(5)}  ppg ${(p / n).toFixed(2)}  forventning ${(e / n).toFixed(2)}  tillid/ligakamp ${((p - e) / n * 1.6).toFixed(2)}`);
