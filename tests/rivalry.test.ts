import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyActionAs } from '../src/game/actions';
import { enableMultiplayer } from '../src/game/humans';
import { createGame, type WorldData } from '../src/game/newgame';
import { mpAdvance } from '../src/game/sim';
import { gs } from '../src/game/state';
import { h2hFor } from '../src/game/h2h';
import { askingPrice } from '../src/game/transfers';

const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);

describe('multiplayer: rivalisering, budrunder og autopilot', () => {
  it('indbyrdes regnskab, lukket budrunde og assistent ved udløbet frist', () => {
    createGame(world, { managerName: 'Anna', managerNation: ni('Denmark'), clubId: 190, activeNations: [ni('Denmark')], lang: 'da', masking: true, seed: 5 });
    enableMultiplayer('p1', 'Anna');
    applyActionAs('p2', { t: 'join', name: 'Bo', club: 206, nation: ni('Denmark') });
    const g = gs();
    // lukket budrunde: begge byder på samme spiller hos en AI-klub
    g.clubs[190].transferBudget = 30e6; g.clubs[206].transferBudget = 30e6;
    const p = Object.values(g.players).find((x) => x.club && g.clubs[x.club].manager > 0 && g.clubs[x.club].nation === ni('Denmark') && askingPrice(x) > 5e5 && askingPrice(x) < 3e6)!;
    const ask = askingPrice(p);
    applyActionAs('p1', { t: 'bid', pid: p.id, fee: Math.round(ask * 1.3), loan: false });
    applyActionAs('p2', { t: 'bid', pid: p.id, fee: Math.round(ask * 1.1), loan: false });
    expect(g.offers.filter((o) => o.player === p.id && o.auction).length).toBe(2);
    // Bo når ikke at trykke Klar: assistenten tager over
    g.humans!.find((h) => h.pid === 'p2')!.autopilot = true;
    for (let i = 0; i < 80 && g.date < '2025-12-01'; i++) mpAdvance();
    const bo = g.offers.find((o) => o.player === p.id && o.buyer === 206)!;
    expect(bo.outbid).toBe(true);
    // de to hold mødes i Superligaen 22. november → indbyrdes regnskab fra begge sider
    const a = h2hFor('p1', 'p2'), b = h2hFor('p2', 'p1');
    expect(a && a.games).toBeGreaterThan(0);
    expect(a!.w).toBe(b!.l);
    expect(a!.gf).toBe(b!.ga);
  }, 120_000);
});
