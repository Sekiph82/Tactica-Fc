// Fordeling af assistentens træningsforslag pr. position (tjek at forslagene passer til positionerne).
// Kør: npx tsx scripts/training-advice.ts
import { readFileSync } from 'node:fs';
import { createGame, type WorldData } from '../src/game/newgame';
import { gs } from '../src/game/state';
import { trainingAdvice } from '../src/game/training';
import { naturalRole } from '../src/game/attributes';
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);
createGame(world, { managerName: 'T', managerNation: ni('Denmark'), clubId: world.clubs.find((c) => c[2] === 'FC København')![0], activeNations: ['Denmark', 'England'].map(ni), lang: 'da', masking: true, seed: 4 });
const g = gs();
const tab: Record<string, Record<string, number>> = {};
for (const p of Object.values(g.players)) {
  if (!p.club) continue;
  const r = naturalRole(p), a = trainingAdvice(p).key;
  (tab[r] ??= {})[a] = (tab[r][a] ?? 0) + 1;
}
for (const [r, m] of Object.entries(tab)) {
  const tot = Object.values(m).reduce((s, x) => s + x, 0);
  console.log(r.padEnd(3), Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v / tot * 100)}%`).join(' · '));
}
