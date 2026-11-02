import { POSITIONS, type Fixture, type GameState, type MatchPitchSnapshot } from '../game/types';
import type { MatchSim } from '../game/engine/match';

export interface OpenFootballSetup {
  initialSnapshot: MatchPitchSnapshot;
  totalMoments: number;
  homeName: string;
  awayName: string;
  homeColor: { background: string; foreground: string };
  awayColor: { background: string; foreground: string };
  players: {
    id: number;
    shirt_number: number;
    first_name: string;
    last_name: string;
    position: string;
    is_home: boolean;
    starting: boolean;
  }[];
}

function cssColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.startsWith('#') || value.startsWith('rgb') ? value : `#${value}`;
}

function rgb(value: string): [number, number, number] | undefined {
  const hex = value.trim().match(/^#?([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!hex) return undefined;
  const full = hex.length === 3 ? [...hex].map((channel) => channel + channel).join('') : hex;
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16)) as [number, number, number];
}

function colorDistance(left: string, right: string): number {
  const a = rgb(left), b = rgb(right);
  return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 0;
}

function foregroundFor(background: string): string {
  const color = rgb(background);
  if (!color) return '#111111';
  const luminance = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
  return luminance > 150 ? '#111111' : '#ffffff';
}

/**
 * Build the small, presentation-only team sheet and opening frame the Open
 * Football viewer needs. MatchSim remains authoritative; the viewer never
 * receives the simulator itself or any method that could advance it.
 */
export function makeOpenFootballSetup(game: GameState, fixture: Fixture, sim: MatchSim): OpenFootballSetup {
  const side = (index: 0 | 1, clubId: number) => {
    const club = game.clubs[clubId];
    const shirt = cssColor(club?.colors[0], index === 0 ? '#173c87' : '#eeeeee');
    const ink = cssColor(club?.colors[1], index === 0 ? '#ffffff' : '#111111');
    const live = sim.live(index);
    const starters = live.on.filter((entry) => !entry.off).map((entry) => {
      const player = game.players[entry.id];
      const slot = live.tactic.slots[entry.slot];
      return {
        id: entry.id,
        shirt_number: player?.shirtNumber ?? entry.slot + 1,
        first_name: player?.first ?? '',
        last_name: player?.last || player?.first || `#${entry.id}`,
        position: slot?.pos === 'GK' ? 'GK' : slot?.pos ?? 'M',
        is_home: index === 0,
        starting: true,
      };
    });
    const starterIds = new Set(starters.map((player) => player.id));
    const substitutes = live.bench.filter((id) => !starterIds.has(id)).map((id, benchIndex) => {
      const player = game.players[id];
      const bestPosition = player?.pos.length ? player.pos.indexOf(Math.max(...player.pos)) : -1;
      return {
        id,
        shirt_number: player?.shirtNumber ?? 12 + benchIndex,
        first_name: player?.first ?? '',
        last_name: player?.last || player?.first || `#${id}`,
        position: bestPosition >= 0 ? POSITIONS[bestPosition] ?? 'M' : 'M',
        is_home: index === 0,
        starting: false,
      };
    });
    return { color: { background: shirt, foreground: ink }, players: [...starters, ...substitutes] };
  };

  const home = side(0, fixture.home);
  const away = side(1, fixture.away);
  const homeShirt = home.color.background;
  let awayShirt = away.color.background;
  if (colorDistance(homeShirt, awayShirt) < 105) {
    const awaySecondary = cssColor(game.clubs[fixture.away]?.colors[1], '#ffffff');
    const alternateKit = ['#ffffff', '#111111', '#c8102e', '#003399', '#ffd200', '#f68b1f', '#5c2d91', '#6cabdd']
      .filter((candidate) => colorDistance(candidate, homeShirt) >= 105)
      .sort((left, right) => colorDistance(right, homeShirt) - colorDistance(left, homeShirt));
    awayShirt = colorDistance(homeShirt, awaySecondary) >= 105
      ? awaySecondary
      : alternateKit[0] ?? '#ffffff';
    away.color = { background: awayShirt, foreground: foregroundFor(awayShirt) };
  }
  return {
    initialSnapshot: sim.pitch(),
    totalMoments: sim.totalMoments,
    homeName: game.clubs[fixture.home]?.short ?? 'Home',
    awayName: game.clubs[fixture.away]?.short ?? 'Away',
    homeColor: home.color,
    awayColor: away.color,
    players: [...home.players, ...away.players],
  };
}
