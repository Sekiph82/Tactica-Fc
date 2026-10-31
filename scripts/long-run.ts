// Langtidstest: kør N sæsoner og mål om verden holder sig sund (regens, pensioner, trupper, økonomi).
// Kør: npx tsx scripts/long-run.ts [sæsoner]
import { readFileSync } from 'node:fs';
import { createGame, type WorldData } from '../src/game/newgame';
import { continueGame, quickPlayUserMatch } from '../src/game/sim';
import { gs, squad } from '../src/game/state';
import { ageOn } from '../src/game/dates';

const seasons = Number(process.argv[2] ?? 5);
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);
createGame(world, { managerName: 'T', managerNation: ni('Denmark'), clubId: 190, activeNations: ['Denmark', 'England'].map(ni), lang: 'da', masking: true, seed: 11 });
const g = gs();
const t0 = performance.now();

function report(label: string) {
  const ps = Object.values(g.players);
  const clubs = Object.values(g.clubs);
  const sizes = clubs.map((c) => squad(c.id).length).sort((a, b) => a - b);
  const regens = ps.filter((p) => p.regen);
  const ages = ps.map((p) => ageOn(p.dob, g.date));
  const avgAge = ages.reduce((s, a) => s + a, 0) / ages.length;
  const topCA = ps.map((p) => p.ca).sort((a, b) => b - a).slice(0, 50);
  const top = (topCA.reduce((s, v) => s + v, 0) / topCA.length).toFixed(0);
  const wonder = regens.filter((p) => p.pa >= 165).length;
  const bestRegen = regens.sort((a, b) => b.ca - a.ca)[0];
  const free = ps.filter((p) => !p.club).length;
  const old = ps.filter((p) => ageOn(p.dob, g.date) >= 36).length;
  const balances = clubs.map((c) => c.balance).sort((a, b) => a - b);
  const broke = balances.filter((b) => b < 0).length;
  console.log(`${label} ${g.date} | spillere ${ps.length} (fri ${free}) | regens ${regens.length} (wonderkids ${wonder}) | snitalder ${avgAge.toFixed(1)} | 36+: ${old} | trup min/median/max ${sizes[0]}/${sizes[Math.floor(sizes.length / 2)]}/${sizes[sizes.length - 1]} (<16: ${sizes.filter((s) => s < 16).length}) | top-50 CA ${top} | bedste regen ${bestRegen ? `${bestRegen.last} CA ${Math.round(bestRegen.ca)}/PA ${bestRegen.pa} (${ageOn(bestRegen.dob, g.date)} år)` : '-'} | klubber i minus ${broke}`);
}

report('start ');
let lastSeason = g.season;
let retiredNews = 0, youthNews = 0;
while (g.season < 2025 + seasons) {
  const r = continueGame();
  if (r.match !== undefined) quickPlayUserMatch();
  if (g.season !== lastSeason) {
    retiredNews = g.news.filter((n) => n.key === 'news.retired').length;
    youthNews = g.news.filter((n) => n.key === 'news.youth').length;
    report(`sæson ${lastSeason}/${String(lastSeason + 1).slice(2)} slut →`);
    console.log(`   nyheder i indbakken: pension ${retiredNews}, egne ungdomsspillere ${youthNews}, klub ${g.clubs[g.userClub]?.name ?? 'arbejdsløs'}, ligaer: ${Object.values(g.comps).filter((c) => c.type === 'league').length}, kampe ${Object.keys(g.fixtures).length}`);
    lastSeason = g.season;
  }
}
console.log(`tid: ${((performance.now() - t0) / 1000).toFixed(0)} s`);
{
  const minus = Object.values(g.clubs).filter((c) => c.balance < 0);
  const byLeague: Record<string, number> = {};
  for (const c of minus) byLeague[`${c.league}${g.comps[c.league] ? '' : '*'}`] = (byLeague[`${c.league}${g.comps[c.league] ? '' : '*'}`] ?? 0) + 1;
  console.log('klubber i minus pr. liga (* = ikke simuleret):', JSON.stringify(byLeague));
}
