// Passer evnen (CA, stjernerne) med attributterne? Måler afvigelsen nu og efter X sæsoner.
// Kør: npx tsx scripts/attrfit.ts [sæsoner]
import { readFileSync } from 'node:fs';
import { createGame, type WorldData } from '../src/game/newgame';
import { continueGame, quickPlayUserMatch } from '../src/game/sim';
import { gs } from '../src/game/state';
import { naturalRole, roleScore } from '../src/game/attributes';
import { ageOn } from '../src/game/dates';
import type { Player } from '../src/game/types';
const seasons = Number(process.argv[2] ?? 3);
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);
createGame(world, { managerName: 'T', managerNation: ni('Denmark'), clubId: 443, activeNations: ['Denmark', 'England'].map(ni), lang: 'da', masking: true, seed: 3 });
const g = gs();
const start = new Set(Object.keys(g.players).map(Number));
const startCa = new Map(Object.values(g.players).map((p) => [p.id, p.ca]));
const rs = (p: Player) => roleScore(p, naturalRole(p));
function report(label: string) {
  const ps = Object.values(g.players).filter((p) => p.club && g.comps[g.clubs[p.club]?.league] && naturalRole(p) !== 'GK');
  // lineær sammenhæng CA → rolle-score, fittet på alle
  const n = ps.length, mx = ps.reduce((s, p) => s + p.ca, 0) / n, my = ps.reduce((s, p) => s + rs(p), 0) / n;
  const b = ps.reduce((s, p) => s + (p.ca - mx) * (rs(p) - my), 0) / ps.reduce((s, p) => s + (p.ca - mx) ** 2, 0);
  const a = my - b * mx;
  const res = (p: Player) => rs(p) - (a + b * p.ca); // + = bedre attributter end CA siger
  const caEq = (p: Player) => res(p) / b; // afvigelse i CA-point
  const groups: [string, Player[]][] = [
    ['alle', ps],
    ['oprindelige', ps.filter((p) => start.has(p.id))],
    ['nye (ungdom/regens)', ps.filter((p) => !start.has(p.id))],
    ['voksede >15 CA', ps.filter((p) => start.has(p.id) && p.ca - (startCa.get(p.id) ?? p.ca) > 15)],
    ['faldt >10 CA', ps.filter((p) => start.has(p.id) && p.ca - (startCa.get(p.id) ?? p.ca) < -10)],
    ['30+ år', ps.filter((p) => ageOn(p.dob, g.date) >= 30)],
  ];
  console.log(`\n${label}: rolle-score ≈ ${a.toFixed(2)} + ${b.toFixed(3)}·CA`);
  for (const [name, list] of groups) {
    if (!list.length) continue;
    const m = list.reduce((s, p) => s + caEq(p), 0) / list.length;
    const sd = Math.sqrt(list.reduce((s, p) => s + (caEq(p) - m) ** 2, 0) / list.length);
    const off = list.filter((p) => Math.abs(caEq(p)) > 20).length / list.length * 100;
    console.log(`  ${name.padEnd(22)} n=${String(list.length).padStart(5)}  snit ${m >= 0 ? '+' : ''}${m.toFixed(1)} CA  spredning ${sd.toFixed(1)}  >20 CA ved siden af: ${off.toFixed(1)}%`);
  }
}
report('Start');
const end = g.season + seasons;
let d = 0;
while ((g.season < end || g.date < `${end}-07-02`) && d < 400 * seasons + 10) { const r = continueGame(); if (r.match !== undefined) quickPlayUserMatch(); d++; }
report(`Efter ${seasons} sæsoner`);
