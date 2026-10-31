// Hvor mange spillere på et givet niveau (CA 125-150) er realistiske for en lille klub, ved forskellig omdømme og lønrum.
// Kør: npx tsx scripts/realism.ts
import { readFileSync } from 'node:fs';
import { createGame, type WorldData } from '../src/game/newgame';
import { gs, squad } from '../src/game/state';
import { transferRealism, playerInterest, askingPrice, wageDemand } from '../src/game/transfers';
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);
createGame(world, { managerName: 'T', managerNation: ni('Denmark'), clubId: world.clubs.find((c) => c[2] === 'Vejle Boldklub')![0], activeNations: ['Denmark', 'England', 'Spain', 'Germany', 'Italy'].map(ni), lang: 'da', masking: true, seed: 12 });
const g = gs();
const c = g.clubs[g.userClub];
c.transferBudget = 3_000_000;
const bill = squad(c.id).reduce((s, x) => s + (x.contract?.wage ?? 0), 0);
for (const rep of [38, 46, 55]) {
  c.rep = rep;
  for (const head of [1.02, 1.15]) {
    c.wageBudget = Math.round(bill * head);
    const pool = Object.values(g.players).filter((p) => p.club !== c.id && p.ca >= 125 && p.ca <= 150);
    const by = [0, 0, 0]; const why: Record<string, number> = {};
    let wants = 0, afford = 0;
    for (const p of pool) {
      const r = transferRealism(p); by[r.level]++;
      if (playerInterest(p, c) === 'yes') wants++;
      if ((p.club ? askingPrice(p) : 0) <= c.transferBudget) afford++;
      if (r.level > 0) for (const k of r.reasons) why[k] = (why[k] ?? 0) + 1;
    }
    console.log(`omdømme ${rep} lønrum ${Math.round((head - 1) * 100)}%: CA125-150 ${pool.length} → realistisk ${by[0]} · måske ${by[1]} · urealistisk ${by[2]} | vil komme ${wants} · har råd ${afford}`);
    console.log('   ', Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(' · '));
  }
}
const sample = Object.values(g.players).filter((p) => p.ca >= 125 && p.ca <= 135);
console.log('spiller-omdømme ved CA 125-135: snit', (sample.reduce((s, p) => s + p.rep, 0) / sample.length).toFixed(0), 'løn snit', Math.round(sample.reduce((s, p) => s + wageDemand(p, c), 0) / sample.length), '€/uge; Vejles lønsum', bill);
