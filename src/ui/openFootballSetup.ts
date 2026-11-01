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
