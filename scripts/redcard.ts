// Måler hvor meget et rødt kort betyder: samme kampe med og uden et rødt kort i 30. minut.
// Kør: npx tsx scripts/redcard.ts [kampe]   (mål: ~1/3 færre egne mål og ~50% flere imod, som i rigtige kampe)
import { readFileSync } from 'node:fs';
import { createGame, type WorldData } from '../src/game/newgame';
import { gs } from '../src/game/state';
import { aiTactic, engineTeam } from '../src/game/sim';
import { MatchSim } from '../src/game/engine/match';
import { Rng } from '../src/game/rng';
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);
createGame(world, { managerName: 'T', managerNation: ni('England'), clubId: world.clubs.find((c) => c[2] === 'Vejle Boldklub')![0], activeNations: ['England', 'Denmark'].map(ni), lang: 'da', masking: true, seed: 9 });
const g = gs();
const lg = Object.values(g.comps).find((c) => c.type === 'league' && c.name.includes('Premier'))!;
const clubs = lg.clubs.slice(4, 14);
const N = Number(process.argv[2] ?? 600), RED_AT = 30;
function run(red: boolean) {
  let gf = 0, ga = 0, w = 0, d = 0, l = 0, shotsF = 0, shotsA = 0, possF = 0;
  for (let i = 0; i < N; i++) {
    const a = clubs[i % clubs.length], b = clubs[(i * 7 + 3) % clubs.length];
    if (a === b) continue;
    const sim = new MatchSim(engineTeam(a, aiTactic(a, b, true)), engineTeam(b, aiTactic(b, a, false)), { commentary: false, neutral: true, aiSubs: [true, true] }, new Rng(1000 + i));
    while (sim.minute < RED_AT && sim.step());
    if (red) { const t = (sim as any).teams[0]; const sp = t.on.find((s: any) => !s.off && s.slot === 6) ?? t.on.find((s: any) => !s.off && s.slot > 0); (sim as any).sendOff(t, sp, false); }
    const g0 = sim.teams[0].stats.goals, g1 = sim.teams[1].stats.goals, s0 = sim.teams[0].stats.shots, s1 = sim.teams[1].stats.shots;
    while (sim.step());
    const rep = sim.report();
    gf += rep.stats[0].goals - g0; ga += rep.stats[1].goals - g1; shotsF += rep.stats[0].shots - s0; shotsA += rep.stats[1].shots - s1; possF += rep.stats[0].possession;
    const dd = rep.stats[0].goals - rep.stats[1].goals; if (dd > 0) w++; else if (dd === 0) d++; else l++;
  }
  const n = N;
  return `mål efter ${RED_AT}' for/imod ${(gf / n).toFixed(2)}/${(ga / n).toFixed(2)} · skud ${(shotsF / n).toFixed(1)}/${(shotsA / n).toFixed(1)} · boldbes. ${(possF / n).toFixed(0)}% · V/U/T ${(w / n * 100).toFixed(0)}/${(d / n * 100).toFixed(0)}/${(l / n * 100).toFixed(0)}%`;
}
console.log('11 mod 11:', run(false));
console.log('10 mod 11:', run(true));
