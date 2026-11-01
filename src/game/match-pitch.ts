import { hash01 } from './rng';
import type { MatchPitchPlayer, MatchPitchSnapshot } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const zonePoint = (zone: number): [number, number] => [10 + Math.floor(zone / 3) * 20, 16.67 + (zone % 3) * 33.33];

/** Deterministic open-play formation layout shared by the match engine and SVG renderer. */
export function formationLayout(
  s: Pick<MatchPitchSnapshot, 'zone' | 'poss' | 'holder' | 'moment' | 'players'>,
  gap = 3.2,
): { pos: Map<number, [number, number]>; ball: [number, number]; holder?: MatchPitchPlayer } {
  const [zx, zy] = zonePoint(s.zone);
  const pos = new Map<number, [number, number]>();
  for (const p of s.players) {
    const prog = p.team === 0 ? zx / 100 : 1 - zx / 100;
    const attacking = p.team === s.poss;
    const f = attacking ? 0.25 + 0.6 * prog : 0.1 * prog;
    const bx0 = p.dx + (p.ax - p.dx) * f, by0 = p.dy + (p.ay - p.dy) * f;
    let x = bx0, y = by0;
    if (p.gk) y = 50 + (zy - 50) * 0.12;
    else {
      x += (zx - x) * 0.1;
      y += (zy - y) * 0.14;
      const dx = x - bx0, dy = y - by0, d = Math.hypot(dx, dy), max = 9;
      if (d > max) { x = bx0 + (dx / d) * max; y = by0 + (dy / d) * max; }
    }
    // Keep a tiny player-specific offset for readable spacing, but never
    // re-roll it per engine moment: time-varying jitter made stationary
    // players visibly twitch while the viewer interpolated between frames.
    x += (hash01(p.id, p.team, 5) - 0.5) * 1.2;
    y += (hash01(p.id, p.team, 6) - 0.5) * 1.2;
    pos.set(p.id, [clamp(x, 1, 99), clamp(y, 2, 98)]);
  }

  let holder = s.players.find((p) => p.id === s.holder && p.team === s.poss);
  if (!holder) {
    let best = Infinity;
    for (const p of s.players) {
      if (p.team !== s.poss || p.gk) continue;
      const [x, y] = pos.get(p.id)!;
      const d = (x - zx) ** 2 + (y - zy) ** 2;
      if (d < best) { best = d; holder = p; }
    }
  }

  let ball: [number, number] = [zx, zy];
  if (holder) {
    const [hx, hy] = pos.get(holder.id)!;
    const nx = clamp(hx + (zx - hx) * 0.5, 1, 99), ny = clamp(hy + (zy - hy) * 0.5, 2, 98);
    pos.set(holder.id, [nx, ny]);
    const dir = holder.team === 0 ? 1 : -1;
    ball = [clamp(nx + dir * 1.4, 1, 99), ny + 0.6];
    let nearest: { id: number; d: number } | null = null;
    for (const p of s.players) {
      if (p.team === holder.team || p.gk) continue;
      const [x, y] = pos.get(p.id)!;
      const d = (x - nx) ** 2 + (y - ny) ** 2;
      if (!nearest || d < nearest.d) nearest = { id: p.id, d };
    }
    if (nearest) {
      const [x, y] = pos.get(nearest.id)!;
      pos.set(nearest.id, [x + (nx + dir * 3 - x) * 0.55, y + (ny - y) * 0.55]);
    }
  }

  const ids = [...pos.keys()];
  for (let it = 0; it < 3; it++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i])!, b = pos.get(ids[j])!;
        const dx = b[0] - a[0], dy = (b[1] - a[1]) * 0.68, d = Math.hypot(dx, dy);
        if (d > 0 && d < gap) {
          const push = (gap - d) / 2 / d;
          if (ids[i] !== holder?.id) pos.set(ids[i], [a[0] - dx * push, a[1] - (dy / 0.68) * push]);
          if (ids[j] !== holder?.id) pos.set(ids[j], [b[0] + dx * push, b[1] + (dy / 0.68) * push]);
        }
      }
    }
  }
  return { pos, ball, holder };
}

export function playerPoint(layout: ReturnType<typeof formationLayout>, playerId: number): [number, number] | undefined {
  const point = layout.pos.get(playerId);
  return point ? [point[0], point[1]] : undefined;
}
