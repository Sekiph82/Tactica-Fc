// Viser klubomdømmets udvikling i Superligaen over tre sæsoner (start → december → efter sæsonen) og ligaens snit.
// Kør: npx tsx scripts/reputation.ts
import { readFileSync } from 'node:fs';
import { createGame, type WorldData } from '../src/game/newgame';
import { continueGame, quickPlayUserMatch } from '../src/game/sim';
import { gs } from '../src/game/state';
import { finalOrder } from '../src/game/competitions';
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);
createGame(world, { managerName: 'T', managerNation: ni('Denmark'), clubId: world.clubs.find((c) => c[2] === 'Vejle Boldklub')![0], activeNations: ['Denmark', 'England', 'Spain'].map(ni), lang: 'da', masking: true, seed: 12 });
const g = gs();
const avgRep = (lg: string) => { const cs = Object.values(g.clubs).filter((c) => c.league === lg); return (cs.reduce((s, c) => s + c.rep, 0) / cs.length).toFixed(1); };
console.log('start', 'DK1', avgRep('DK1'), 'EPL', avgRep(Object.keys(g.comps).find((k) => g.comps[k].name.includes('Premier'))!));
const dk = 'DK1';
let n = 0;
for (let s = 0; s < 3; s++) {
  const before = new Map(Object.values(g.clubs).filter((c) => c.league === dk).map((c) => [c.id, c.rep]));
  const season = g.season;
  let order: number[] = [];
  const mid: Record<number, number> = {};
  while (g.season === season && n++ < 2000) {
    g.board.confidence = 80;
    if (g.date.endsWith('-12-01')) for (const [id] of before) mid[id] = g.clubs[id].rep;
    if (g.comps[dk]?.finished && !order.length) order = finalOrder(g.comps[dk]);
    const r = continueGame(); if (r.match !== undefined) quickPlayUserMatch();
  }
  console.log(`\nsæson ${season}:  plads  klub              omdømme start → dec → efter`);
  order.forEach((id, i) => console.log(`  ${String(i + 1).padStart(2)}  ${g.clubs[id].short.padEnd(16)} ${before.get(id)} → ${mid[id]} → ${g.clubs[id].rep}`));
  console.log('snit DK1', avgRep(g.clubs[order[0]].league));
}
