import { ageOn } from './dates';
import { forEachHuman } from './humans';
import { hash, Rng } from './rng';
import { addNews, gs, squad } from './state';

const WEDDING_CHANCE_PER_PLAYER_DAY = 0.0001;

/** Rare, deterministic personal news with a small, persisted morale effect. */
export function lifeEventsDaily() {
  const g = gs();
  forEachHuman(() => {
    const clubId = g.userClub;
    const club = g.clubs[clubId];
    if (!club) return;

    const dateSeed = Number(g.date.replace(/-/g, ''));
    for (const player of squad(clubId)) {
      if (player.marriedOn || ageOn(player.dob, g.date) < 21) continue;
      const roll = new Rng(hash(g.seed, clubId, player.id, dateSeed, 0x57454444));
      if (!roll.chance(WEDDING_CHANCE_PER_PLAYER_DAY)) continue;

      player.marriedOn = g.date;
      player.morale = Math.min(20, player.morale + 0.5);
      addNews({
        cat: 'general',
        key: 'news.playerWedding',
        params: { player: `${player.first} ${player.last}`.trim() },
        link: { kind: 'player', id: player.id },
      });
      break;
    }
  });
}
