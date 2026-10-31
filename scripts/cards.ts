// Måler kort pr. hold med forskellige tacklinger: røde pr. kamp og pr. sæson, andel andet gule kort.
// Kør: npx tsx scripts/cards.ts   (mål: ~2 røde kort pr. hold pr. sæson ved normal spillestil, ~40% andet gule)
import { readFileSync } from 'node:fs';
import { createGame, type WorldData } from '../src/game/newgame';
import { gs } from '../src/game/state';
import { aiTactic, engineTeam } from '../src/game/sim';
import { MatchSim } from '../src/game/engine/match';
import { Rng } from '../src/game/rng';
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);
createGame(world, { managerName: 'T', managerNation: ni('Denmark'), clubId: world.clubs.find((c) => c[2] === 'FC København')![0], activeNations: ['Denmark'].map(ni), lang: 'da', masking: true, seed: 9 });
const g = gs();
const lg = Object.values(g.comps).find((c) => c.type === 'league' && c.name.includes('Superliga'))!;
const clubs = lg.clubs;
const N = 1500;
for (const [label, tackling, closing] of [['normal', 1, 1], ['hårde tacklinger', 2, 1], ['hårde + højt pres', 2, 2]] as const) {
  let red = 0, second = 0, yel = 0, fouls = 0;
  for (let i = 0; i < N; i++) {
    const a = clubs[i % clubs.length], b = clubs[(i * 5 + 1) % clubs.length];
    if (a === b) continue;
    const ta = aiTactic(a, b, true); ta.team = { ...ta.team, tackling, closingDown: closing };
    const sim = new MatchSim(engineTeam(a, ta), engineTeam(b, aiTactic(b, a, false)), { commentary: false, aiSubs: [true, true] }, new Rng(77 + i));
    const rep = sim.runToEnd();
    red += rep.stats[0].reds; yel += rep.stats[0].yellows; fouls += rep.stats[0].fouls;
    second += rep.events.filter((e) => e.k === 'red' && e.t === 0).filter((e) => rep.events.some((y) => y.k === 'yellow' && y.p === e.p)).length;
  }
  console.log(`${label.padEnd(20)} røde pr. kamp (eget hold) ${(red / N).toFixed(3)} (≈ ${(red / N * 32).toFixed(1)} pr. sæson, heraf 2. gule ${Math.round(second / Math.max(1, red) * 100)}%) · gule ${(yel / N).toFixed(2)} · frispark ${(fouls / N).toFixed(1)}`);
}
