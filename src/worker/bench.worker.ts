// Web Worker: taktik-benchmark (forbedring #8 + #9). Kører hundredvis af kampe uden at blokere UI'et.
import { quickMatch } from '../game/engine/match';
import { Rng } from '../game/rng';
import { autoSelect, newTactic } from '../game/tactics';
import type { Player, Tactic } from '../game/types';

export interface BenchRequest {
  players: Player[];
  tactic: Tactic;
  opponents: string[];
  matches: number;
  seed: number;
}

export interface BenchRow {
  formation: string;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  xg: number;
  xga: number;
  poss: number;
}

self.onmessage = (e: MessageEvent<BenchRequest>) => {
  const { players, tactic, opponents, matches, seed } = e.data;
  const map = new Map(players.map((p) => [p.id, p]));
  const r = new Rng(seed);
  const rows: BenchRow[] = [];
  for (const f of opponents) {
    const row: BenchRow = { formation: f, w: 0, d: 0, l: 0, gf: 0, ga: 0, xg: 0, xga: 0, poss: 0 };
    const oppTactic = autoSelect(newTactic(f), players);
    for (let i = 0; i < matches; i++) {
      const home = i % 2 === 0;
      const me = { club: 1, tactic, players: map };
      const op = { club: 2, tactic: oppTactic, players: map };
      const rep = home ? quickMatch(me, op, {}, r) : quickMatch(op, me, {}, r);
      const ms = rep.stats[home ? 0 : 1];
      const os = rep.stats[home ? 1 : 0];
      row.gf += ms.goals; row.ga += os.goals; row.xg += ms.xg; row.xga += os.xg; row.poss += ms.possession;
      if (ms.goals > os.goals) row.w++; else if (ms.goals === os.goals) row.d++; else row.l++;
    }
    rows.push(row);
    (self as unknown as Worker).postMessage({ progress: rows.length / opponents.length, rows });
  }
  (self as unknown as Worker).postMessage({ done: true, rows });
};
