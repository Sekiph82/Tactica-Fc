// Verdens spillere over seks sæsoner fordelt på evne (CA), unge talenter og ligaernes styrke.
// Kør: npx tsx scripts/player-pool.ts   (mål: stabilt antal spillere på mellemniveau og en jævn strøm af unge talenter)
import { readFileSync } from 'node:fs';
import { createGame, type WorldData } from '../src/game/newgame';
import { continueGame, quickPlayUserMatch } from '../src/game/sim';
import { gs, squad } from '../src/game/state';
import { ageOn } from '../src/game/dates';
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);
createGame(world, { managerName: 'T', managerNation: ni('Denmark'), clubId: world.clubs.find((c) => c[2] === 'Vejle Boldklub')![0], activeNations: ['Denmark', 'England', 'Spain'].map(ni), lang: 'da', masking: true, seed: 21 });
const g = gs();
const top14 = (cid: number) => { const s = squad(cid).map((p) => p.ca).sort((a, b) => b - a).slice(0, 14); return s.reduce((x, y) => x + y, 0) / Math.max(1, s.length); };
const lg = (name: string) => Object.values(g.comps).find((c) => c.type === 'league' && c.name.includes(name));
const report = () => {
  const ps = Object.values(g.players);
  const band = (lo: number, hi: number) => ps.filter((p) => p.ca >= lo && p.ca < hi).length;
  const young = (lo: number) => ps.filter((p) => p.ca >= lo && ageOn(p.dob, g.date) <= 23).length;
  const sl = lg('Superliga'), epl = lg('Premier');
  const avg = (c?: { clubs: number[] }) => c ? (c.clubs.reduce((s, id) => s + top14(id), 0) / c.clubs.length).toFixed(0) : '-';
  console.log(`${g.date} spillere ${ps.length} | CA 110-125: ${band(110, 125)} · 125-140: ${band(125, 140)} · 140-155: ${band(140, 155)} · 155+: ${band(155, 999)} | unge ≤23 med CA≥125: ${young(125)} | snit top-14: Superliga ${avg(sl)}, PL ${avg(epl)}`);
};
report();
let n = 0;
for (let s = 0; s < 6; s++) { const season = g.season; while (g.season === season && n++ < 4000) { g.board.confidence = 80; const r = continueGame(); if (r.match !== undefined) quickPlayUserMatch(); } report(); }
{
  const ps = Object.values(g.players).filter((p) => p.ca >= 155);
  const groups: Record<string, number> = {};
  for (const p of ps) { const a = ageOn(p.dob, g.date); const k = `${a <= 23 ? '≤23' : a <= 28 ? '24-28' : a <= 31 ? '29-31' : '32+'}${p.regen ? ' (ny)' : ''}`; groups[k] = (groups[k] ?? 0) + 1; }
  console.log('CA 155+ fordelt på alder:', JSON.stringify(groups));
  const old = Object.values(g.players).filter((p) => ageOn(p.dob, g.date) >= 33);
  console.log('spillere 33+:', old.length, 'heraf CA≥140:', old.filter((p) => p.ca >= 140).length);
}
