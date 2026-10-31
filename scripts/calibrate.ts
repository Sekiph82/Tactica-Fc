// Kalibrering af matchmotoren mod rigtige fodboldstatistikker.
// Kør: npx tsx scripts/calibrate.ts [antal kampe] [liga]
import { readFileSync } from 'node:fs';
import { makePlayer, type SubPos } from '../src/game/data/generate';
import { quickMatch, type EngineTeam } from '../src/game/engine/match';
import { Rng } from '../src/game/rng';
import { autoSelect, newTactic } from '../src/game/tactics';
import type { Player, Foot } from '../src/game/types';
import { ageOn } from '../src/game/dates';
import { caFromValue } from '../src/game/data/generate';

const N = Number(process.argv[2] ?? 2000);
const LEAGUE = process.argv[3] ?? 'GB1';
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8'));
const date = '2025-08-01';
const clubs = world.clubs.filter((c: unknown[]) => c[4] === LEAGUE).map((c: unknown[]) => c[0] as number);
const squads = new Map<number, Player[]>();
for (const r of world.players) {
  const club = r[5];
  if (!clubs.includes(club)) continue;
  const age = ageOn(r[3], date);
  const p = makePlayer({
    id: r[0], first: r[1], last: r[2], dob: r[3], nation: r[4], club, sub: r[6] as SubPos, foot: r[7] as Foot, height: r[8],
    ca: caFromValue(r[9], age), value: r[9], caps: r[11], stats: { apps: r[14], minutes: r[15], goals: r[16], assists: r[17], yellows: r[18], reds: r[19] },
    date, seed: 42,
  });
  if (!squads.has(club)) squads.set(club, []);
  squads.get(club)!.push(p);
}
const team = (club: number, formation = '4-4-2'): EngineTeam => {
  const ps = squads.get(club)!;
  return { club, tactic: autoSelect(newTactic(formation), ps), players: new Map(ps.map((p) => [p.id, p])) };
};

const rng = new Rng(7);
const band = [0, 0, 0, 0, 0];
let goals = 0, hw = 0, dr = 0, shots = 0, sot = 0, xg = 0, cards = 0, corners = 0, fouls = 0, poss = 0, ratings = 0, rc = 0, reds = 0, inj = 0;
const clubGoals = new Map<number, number>(), playerGoals = new Map<number, [number, number]>();
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const h = rng.pick(clubs), a = rng.pick(clubs.filter((c: number) => c !== h));
  const rep = quickMatch(team(h), team(a), {}, rng);
  const [s0, s1] = rep.stats;
  goals += s0.goals + s1.goals;
  if (s0.goals > s1.goals) hw++; else if (s0.goals === s1.goals) dr++;
  shots += s0.shots + s1.shots; sot += s0.onTarget + s1.onTarget; xg += s0.xg + s1.xg;
  cards += s0.yellows + s1.yellows; corners += s0.corners + s1.corners; fouls += s0.fouls + s1.fouls;
  poss += s0.possession;
  reds += s0.reds + s1.reds;
  clubGoals.set(h, (clubGoals.get(h) ?? 0) + s0.goals); clubGoals.set(a, (clubGoals.get(a) ?? 0) + s1.goals);
  for (const p of rep.players) {
    if (p.injured) inj++;
    if (p.goals) { const c = p.team === 0 ? h : a; const cur = playerGoals.get(p.id) ?? [c, 0]; cur[1] += p.goals; playerGoals.set(p.id, cur); }
  }
  for (let z = 0; z < 15; z++) { const b = Math.floor(z / 3); band[b] += rep.heat[0][z]; }
  for (const p of rep.players) if (p.minutes >= 60) { ratings += p.rating; rc++; }
}
const ms = performance.now() - t0;
console.log(`${N} kampe (${LEAGUE}) på ${ms.toFixed(0)} ms (${(ms / N).toFixed(2)} ms/kamp)`);
console.log(`mål/kamp ${(goals / N).toFixed(2)} (mål 2.7) | hjemmesejr ${(hw / N * 100).toFixed(1)}% (45) uafgjort ${(dr / N * 100).toFixed(1)}% (25)`);
console.log(`skud/hold ${(shots / N / 2).toFixed(1)} (12.5) på mål ${(sot / N / 2).toFixed(1)} (4.3) xG/hold ${(xg / N / 2).toFixed(2)}`);
console.log(`gule/kamp ${(cards / N).toFixed(1)} (3.5) hjørne/kamp ${(corners / N).toFixed(1)} (10) frispark ${(fouls / N).toFixed(1)} (22) hjemme-poss ${(poss / N).toFixed(1)}% | snit-karakter ${(ratings / rc).toFixed(2)}`);

{
  const best = new Map<number, number>();
  for (const [, [c, n]] of playerGoals) best.set(c, Math.max(best.get(c) ?? 0, n));
  const shares = [...best].filter(([c]) => (clubGoals.get(c) ?? 0) >= 30).map(([c, n]) => n / clubGoals.get(c)!);
  console.log(`røde/kamp ${(reds / N).toFixed(2)} (0.12) | skader i kamp/kamp ${(inj / N).toFixed(2)} (~0.3) | topscorerens andel af holdets mål ${(shares.reduce((x, y) => x + y, 0) / shares.length * 100).toFixed(0)}% (~30%), max ${(Math.max(...shares) * 100).toFixed(0)}%`);
}
console.log('hjemmeholdets moments pr. bånd', band.map((b) => (b / N).toFixed(1)).join(' '));
// Exploit-test: samme trup, forskellige formationer mod 4-4-2
const forms = ['4-4-2', '4-2-4', '3-4-3', '4-3-3', '4-2-3-1', '5-3-2', '3-5-2', '4-5-1', '4-4-2 Diamond'];
const c0 = clubs[Number(process.env.C ?? 0)];
for (const f of forms) {
  let pts = 0, gf = 0, ga = 0;
  const M = Number(process.env.M ?? 300);
  for (let i = 0; i < M; i++) {
    const home = i % 2 === 0;
    const A = team(c0, f), B = team(c0, '4-4-2');
    B.club = -1;
    const rep = home ? quickMatch(A, B, {}, rng) : quickMatch(B, A, {}, rng);
    const my = home ? rep.stats[0].goals : rep.stats[1].goals;
    const op = home ? rep.stats[1].goals : rep.stats[0].goals;
    gf += my; ga += op;
    pts += my > op ? 3 : my === op ? 1 : 0;
  }
  console.log(`${f.padEnd(14)} vs 4-4-2 (samme trup): ${(pts / M).toFixed(2)} point/kamp, ${(gf / M).toFixed(2)}-${(ga / M).toFixed(2)}`);
}
