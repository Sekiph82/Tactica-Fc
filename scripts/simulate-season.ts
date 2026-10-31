// Headless test: kør en hel sæson (+ sæsonskifte) og print nøgletal.
// Kør: npx tsx scripts/simulate-season.ts [sæsoner] [klub-id]
import { readFileSync } from 'node:fs';
import { createGame, type WorldData } from '../src/game/newgame';
import { continueGame, quickPlayUserMatch } from '../src/game/sim';
import { gs } from '../src/game/state';
import { finalOrder } from '../src/game/competitions';
import { deserializeSaveState, SAVE_SCHEMA_VERSION, serializeSaveState } from '../src/game/snapshot';

const seasons = Number(process.argv[2] ?? 1);
const clubId = Number(process.argv[3] ?? 190);
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const nationIdx = (n: string) => world.nations.findIndex((x) => x.name === n);

let t0 = performance.now();
createGame(world, {
  managerName: 'Test Manager', managerNation: nationIdx('Denmark'), clubId,
  activeNations: ['Denmark', 'England', 'Germany', 'Spain', 'Italy'].map(nationIdx),
  lang: 'da', masking: true, seed: 12345,
});
const g = gs();
console.log(`Nyt spil: ${Object.keys(g.players).length} spillere, ${Object.keys(g.clubs).length} klubber, ${Object.keys(g.fixtures).length} kampe — ${(performance.now() - t0).toFixed(0)} ms`);

const startBal = new Map(Object.values(g.clubs).map((c) => [c.id, c.balance]));
t0 = performance.now();
const endSeason = g.season + seasons;
let days = 0;
let userMatches = 0;
while (g.season < endSeason || g.date < `${endSeason}-07-02`) {
  const r = continueGame();
  if (r.match !== undefined) { quickPlayUserMatch(); userMatches++; }
  days++;
  if (days > 400 * seasons + 10) break;
  if (g.date.endsWith('-06-30')) {
    const s = g.season;
    for (const id of ['DK1', 'DK2', 'GB1', 'GB2', 'L1', 'CUP-' + nationIdx('Denmark'), 'CL', 'UEFA', 'PO-GB2', 'PO-L1']) {
      const c = g.comps[id];
      if (!c) continue;
      if (c.type === 'league') {
        const order = finalOrder(c).slice(0, 4).map((cid) => g.clubs[cid].short);
        const last = finalOrder(c).slice(-3).map((cid) => g.clubs[cid].short);
        const top = c.table.slice().sort((a, b) => b.pts - a.pts)[0];
        console.log(`${s} ${id}: ${order.join(', ')} … ${last.join(', ')} | vinderpoint ${top?.pts} | færdig=${c.finished} pending=${c.pending}`);
      } else {
        console.log(`${s} ${id}: vinder ${c.winner ? g.clubs[c.winner].short : '-'} (stage ${c.stage}, færdig=${c.finished}, pending=${c.pending})`);
      }
    }
  }
}
if (g.season < endSeason || g.date < `${endSeason}-07-02`) {
  throw new Error(`Season simulation stopped early at ${g.date} / season ${g.season}; expected at least ${endSeason}-07-02`);
}
const ms = performance.now() - t0;
console.log(`${days} dage på ${(ms / 1000).toFixed(1)} s (${(ms / days).toFixed(1)} ms/dag), ${userMatches} brugerkampe`);
console.log(`Dato ${g.date}, sæson ${g.season}, brugerklub ${g.clubs[g.userClub]?.name ?? 'arbejdsløs'}, tillid ${g.board.confidence.toFixed(0)}`);
console.log(`Spillere nu ${Object.keys(g.players).length}, nyheder ${g.news.length}, tilbud ${g.offers.length}`);
const transfers = g.news.filter((n) => n.key.startsWith('transfer.')).length;
console.log(`Transfer-nyheder: ${transfers}`);
const persisted = await serializeSaveState(g);
const restored = await deserializeSaveState(persisted);
const completed = (state: typeof g) => Object.keys(state.reports).length;
const beforeRoundTrip = [g.id, g.season, g.date, g.userClub, Object.keys(g.players).length, Object.keys(g.fixtures).length, completed(g), g.seasonHistory.length, g.seasonHistory.at(-1)?.season ?? 0, g.rng].join('|');
const afterRoundTrip = [restored.id, restored.season, restored.date, restored.userClub, Object.keys(restored.players).length, Object.keys(restored.fixtures).length, completed(restored), restored.seasonHistory.length, restored.seasonHistory.at(-1)?.season ?? 0, restored.rng].join('|');
if (beforeRoundTrip !== afterRoundTrip) throw new Error('Versioned save round-trip changed the career summary');
if (restored.seasonHistory.length < seasons || completed(restored) === 0) throw new Error('Season archives or match reports are missing after save round-trip');
console.log(`Schema ${SAVE_SCHEMA_VERSION} save/load: ${restored.date}, ${restored.seasonHistory.length} archived seasons, ${completed(restored)} match reports, ${Object.keys(restored.players).length} players`);
console.log(g.news.slice(0, 12).map((n) => `${n.date} ${n.key} ${JSON.stringify(n.params)}`).join('\n'));
const sizes = JSON.stringify(g).length;
console.log(`Save-størrelse ~${(sizes / 1024 / 1024).toFixed(1)} MB`);
for (const id of [190, 206, 369, 1053, 281, 985, 11, 1003, 27, 418, 131]) {
  const c = g.clubs[id];
  if (c) console.log(`${c.short.padEnd(16)} saldo ${(startBal.get(id)! / 1e6).toFixed(1)}m -> ${(c.balance / 1e6).toFixed(1)}m  budget ${(c.transferBudget / 1e6).toFixed(1)}m  lønbudget/uge ${(c.wageBudget / 1e3).toFixed(0)}k`);
}
const moved = Object.values(g.players).filter((p) => p.joined).length;
console.log(`Spillere der har skiftet klub: ${moved}`);
let t1 = performance.now();
const json = JSON.stringify(g, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v));
console.log(`Afrundet JSON ${(json.length / 1024 / 1024).toFixed(1)} MB på ${(performance.now() - t1).toFixed(0)} ms`);
const { gzipSync } = await import('node:zlib');
t1 = performance.now();
const gz = gzipSync(json, { level: 6 });
console.log(`gzip ${(gz.length / 1024 / 1024).toFixed(1)} MB på ${(performance.now() - t1).toFixed(0)} ms`);
const top = Object.entries(g).map(([k, v]) => [k, JSON.stringify(v)?.length ?? 0] as const).sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(top.map(([k, n]) => `${k}: ${(n / 1024 / 1024).toFixed(1)}MB`).join(', '));
