import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyActionAs } from '../src/game/actions';
import { activate, enableMultiplayer, withHuman } from '../src/game/humans';
import { createGame, type WorldData } from '../src/game/newgame';
import { serializeState, deserializeState } from '../src/game/snapshot';
import { mpAdvance } from '../src/game/sim';
import { gs, squad } from '../src/game/state';

const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);

describe('online multiplayer (motor)', () => {
  it('to managere kan spille en hel sæson side om side', () => {
    createGame(world, { managerName: 'Anna', managerNation: ni('Denmark'), clubId: 190, activeNations: [ni('Denmark')], lang: 'da', masking: true, seed: 3 });
    enableMultiplayer('p1', 'Anna');
    expect(applyActionAs('p2', { t: 'join', name: 'Bo', club: 206, nation: ni('Denmark') })).toBe('ok');
    const g = gs();
    expect(g.humans!.length).toBe(2);
    expect(g.clubs[190].manager).toBe(-1);
    expect(g.clubs[206].manager).toBe(-1);
    // Bo byder på en spiller fra Anna
    const target = squad(190).sort((a, b) => b.ca - a.ca)[5];
    const bid = applyActionAs('p2', { t: 'bid', pid: target.id, fee: target.value * 2, loan: false });
    expect(typeof bid).toBe('object');
    const annaHasBid = withHuman('p1', () => g.news.some((n) => n.key === 'transfer.incomingBid'));
    expect(annaHasBid).toBe(true);
    applyActionAs('p1', { t: 'respond', pid: target.id, buyer: 206, action: 'accept' });
    const offer = g.offers.find((o) => o.player === target.id && o.buyer === 206)!;
    expect(offer.status).toBe('negotiating');

    let turns = 0;
    let humanMatchTurns = 0;
    while (g.season === 2025 && turns < 200) {
      const r = mpAdvance();
      if (r.reason === 'match') humanMatchTurns++;
      turns++;
    }
    expect(g.season).toBe(2026);
    expect(humanMatchTurns).toBeGreaterThan(25);
    // menneskeklubber styres af mennesker – medmindre manageren er blevet fyret
    for (const h of g.humans!) {
      const club = h.pid === g.active ? g.userClub : h.userClub;
      if (club) expect(g.clubs[club].manager).toBe(-1);
    }
    // begge har fået kampnyheder og rapporter med kommentar
    for (const pid of ['p1', 'p2']) {
      withHuman(pid, () => {
        expect(g.news.filter((n) => n.cat === 'match').length).toBeGreaterThan(10);
        expect(g.manager.history.length + g.manager.sacked).toBeGreaterThanOrEqual(1);
      });
    }
    const someReport = Object.values(g.reports)[0];
    expect(someReport.commentary.length).toBeGreaterThan(20);
    activate('p1');
  }, 120_000);

  it('øjebliksbillede kan serialiseres og læses igen', async () => {
    const g = gs();
    const blob = await serializeState(g);
    const back = await deserializeState(blob);
    expect(back.humans!.length).toBe(2);
    expect(back.date).toBe(g.date);
    expect(Object.keys(back.players).length).toBe(Object.keys(g.players).length);
  });
});
