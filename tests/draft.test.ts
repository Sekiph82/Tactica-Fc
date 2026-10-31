import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyActionAs } from '../src/game/actions';
import { withHuman } from '../src/game/humans';
import type { WorldData } from '../src/game/newgame';
import {
  BENCH_PLACE, BUDGET, SQUAD, aiBidLimit, aiTeam, allKeepers, draftGrades, maxBidFor, nominatorSlot, placesFor, seasonPreview, autoKeepers, autoPick, buildDraftGame, canPlace, clubIdOf, draftPool, nextDraftOrder, slotForPick, totalPicks,
  type DraftPick, type DraftTeam,
} from '../src/game/draft';
import { mpAdvance } from '../src/game/sim';
import { gs, squad } from '../src/game/state';
import { naturalRole, positionString } from '../src/game/attributes';
import { formationSlots } from '../src/game/tactics';
import { serializeState, deserializeState } from '../src/game/snapshot';

const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;

function runDraft(teams: DraftTeam[], order: number[], keepers = 0): DraftPick[] {
  const pool = draftPool(world, 7, world.season);
  const picks: DraftPick[] = [];
  for (let n = 0; n < totalPicks(order, keepers); n++) {
    const team = teams.find((t) => t.slot === slotForPick(order, n))!;
    const pk = autoPick(team, picks, pool, allKeepers(teams))!;
    expect(pk).toBeTruthy();
    picks.push(pk);
  }
  return picks;
}

describe('draft-liga', () => {
  it('puljen er de 500 bedste og beregnes ens hver gang', () => {
    const a = draftPool(world, 7, world.season);
    expect(a).toHaveLength(500);
    expect(a[0].ca).toBeGreaterThanOrEqual(a[499].ca);
    const ids = a.map((p) => p.id).join(',');
    // samme seed giver samme pulje (ny beregning uden cache)
    const copy = { ...world, players: world.players.slice() };
    expect(draftPool(copy, 7, world.season).map((p) => p.id).join(',')).toBe(ids);
    expect(draftPool(copy, 7, world.season)[10].attrs).toEqual(a[10].attrs);
  });

  it('snake draft: rækkefølgen vendes hver runde', () => {
    const order = [3, 1, 2];
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => slotForPick(order, n))).toEqual([3, 1, 2, 2, 1, 3, 3]);
  });

  it('automatiske valg giver 11 passende startere og en målmand på bænken', () => {
    const teams = [1, 2, 3, 4].map((s) => aiTeam(s, []));
    const picks = runDraft(teams, [1, 2, 3, 4]);
    const pool = Object.fromEntries(draftPool(world, 7, world.season).map((p) => [p.id, p]));
    expect(new Set(picks.map((p) => p.player)).size).toBe(picks.length);
    for (const t of teams) {
      const mine = picks.filter((p) => p.slot === t.slot);
      expect(mine).toHaveLength(SQUAD);
      expect(new Set(mine.filter((p) => p.place >= 0).map((p) => p.place)).size).toBe(11);
      const bench = mine.filter((p) => p.place === BENCH_PLACE).map((p) => pool[p.player]);
      expect(bench).toHaveLength(5);
      expect(bench.some((p) => naturalRole(p) === 'GK')).toBe(true);
    }
    // startere står kun på pladser, der vises i deres positionsfelt
    for (const pk of picks.filter((p) => p.place >= 0)) {
      const t = teams.find((x) => x.slot === pk.slot)!;
      const slot = formationSlots(t.formation)[pk.place];
      const ps = positionString(pool[pk.player]);
      const name = slot.pos === 'ST' ? 'F' : slot.pos;
      expect(ps.split(' ')[0].split('/')).toContain(name);
      if (slot.pos !== 'GK') expect(ps.split(' ')[1] ?? '').toContain(slot.side);
    }
    // en markspiller kan ikke stå i mål
    const outfield = Object.values(pool).find((p) => naturalRole(p) === 'ST')!;
    const empty: DraftTeam = { ...aiTeam(9, []), formation: '4-4-2' };
    expect(canPlace(empty, [], outfield, 0, pool)).toBe(false);
  });

  it('en hel sæson med to managere og to AI-hold, slutspil og ny draft med keepers', async () => {
    const teams: DraftTeam[] = [
      { ...aiTeam(1, []), ai: false, pid: 'p1', manager: 'Anna', name: 'Anna FC', short: 'ANN' },
      { ...aiTeam(2, []), ai: false, pid: 'p2', manager: 'Bo', name: 'Bo United', short: 'BOU' },
      aiTeam(3, ['Anna FC']),
      aiTeam(4, ['Anna FC']),
    ];
    const picks = runDraft(teams, [2, 4, 1, 3]);
    const g = buildDraftGame({ world, seed: 7, season: 1, lang: 'da', settings: { rounds: 2, playoff: 'semis', keepers: 2, injuries: true }, teams, picks, hostPid: 'p1' });
    expect(Object.keys(g.clubs)).toHaveLength(4);
    expect(squad(clubIdOf(1))).toHaveLength(16);
    expect(g.userClub).toBe(clubIdOf(1));
    expect(g.tactic!.lineup.filter(Boolean)).toHaveLength(11);
    // to gange mod alle = 6 runder à 2 kampe
    expect(Object.values(g.fixtures).filter((f) => f.comp === 'DL')).toHaveLength(12);
    let turns = 0;
    let r = { days: 0, reason: '' };
    while (!g.draft!.seasonOver && turns < 60) { r = mpAdvance(); turns++; }
    expect(g.draft!.seasonOver).toBe(true);
    expect(r.reason).toBe('season');
    expect(g.comps.DL.finished).toBe(true);
    expect(g.comps.DLPO.finished).toBe(true);
    expect(Object.values(g.fixtures).filter((f) => f.comp === 'DLPO')).toHaveLength(3);
    const h = g.draft!.history[0];
    expect(h.table).toHaveLength(4);
    expect(h.playoffWinner).toBeTruthy();
    expect(Object.values(g.draft!.allTime).reduce((a, x) => a + x.p, 0)).toBe(24);
    // ingen økonomi, transfers eller pressemøder undervejs
    withHuman('p2', () => {
      expect(g.news.some((n) => n.cat === 'finance' || n.cat === 'transfer' || n.key.startsWith('press'))).toBe(false);
      expect(g.news.filter((n) => n.cat === 'match').length).toBeGreaterThan(5);
    });
    // ingen træthed, moral eller præstationer – runderne spilles dag for dag
    expect(Object.values(g.players).every((p) => p.condition === 100 && Math.abs(p.morale - 13) < 0.01)).toBe(true);
    withHuman('p1', () => expect(g.news.some((n) => n.key.startsWith('ach'))).toBe(false));
    const dates = [...new Set(Object.values(g.fixtures).filter((f) => f.comp === 'DL').map((f) => f.date))].sort();
    expect(dates).toHaveLength(6);
    expect(new Date(dates[5]).getTime() - new Date(dates[0]).getTime()).toBe(5 * 86_400_000);
    // skader er højst to uger
    expect(Object.values(g.players).every((p) => (p.injury?.days ?? 0) <= 14)).toBe(true);

    // næste sæson: sidst placerede vælger først, keepers beholdes på deres pladser
    const order = nextDraftOrder();
    expect(order[0]).toBe(h.table[3].club - 900_000);
    const blob = await serializeState(g);
    const state = await deserializeState(blob);
    const teams2 = teams.map((t) => ({ ...t, keep: autoKeepers(clubIdOf(t.slot), 2, state) }));
    expect(teams2[0].keep).toHaveLength(2);
    const picks2 = runDraft(teams2, order, 2);
    expect(picks2.length).toBe(4 * 14);
    const g2 = buildDraftGame({ world, seed: 7, season: 2, lang: 'da', settings: g.draft!.settings, teams: teams2, picks: picks2, hostPid: 'p1', prev: state.draft });
    expect(g2.draft!.history).toHaveLength(1);
    expect(g2.draft!.season).toBe(2);
    expect(squad(clubIdOf(2))).toHaveLength(16);
    expect(squad(clubIdOf(2)).map((p) => p.id)).toEqual(expect.arrayContaining(teams2[1].keep.map((k) => k.player)));
  }, 120_000);

  it('en langtidsskadet spiller kan erstattes med en udraftet', () => {
    const g = gs();
    const p = squad(g.userClub).find((x) => naturalRole(x) !== 'GK')!;
    p.injury = { key: 'hamstring', days: 10 };
    const inn = Object.values(g.players).find((x) => !x.club && naturalRole(x) !== 'GK')!;
    expect(applyActionAs(g.active!, { t: 'draftReplace', out: p.id, inn: inn.id })).toBe('ok');
    expect(g.players[inn.id].club).toBe(g.userClub);
    expect(g.players[p.id].club).toBe(0);
  });
});

describe('draft uden skader', () => {
  it('bænken behøver ingen målmand', () => {
    const pool = draftPool(world, 7, world.season);
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
    const team: DraftTeam = { ...aiTeam(5, []), formation: '4-4-2' };
    const st = pool.filter((p) => naturalRole(p) === 'ST');
    // fire markspillere på bænken: den femte må også være en markspiller, når der ikke er skader
    const picks: DraftPick[] = st.slice(0, 4).map((p) => ({ slot: 5, player: p.id, place: BENCH_PLACE }));
    expect(canPlace(team, picks, st[4], BENCH_PLACE, byId, true)).toBe(false);
    expect(canPlace(team, picks, st[4], BENCH_PLACE, byId, false)).toBe(true);
  });
});

describe('draft fra én liga', () => {
  it('puljen er de bedste fra Superligaen, og draft og sæson virker', () => {
    const dk = new Set(world.clubs.filter((c) => c[4] === 'DK1').map((c) => c[0]));
    const F = world.playerFields.indexOf('club');
    const fromDk = new Set(world.players.filter((r) => dk.has(r[F] as number)).map((r) => r[world.playerFields.indexOf('id')] as number));
    const pool = draftPool(world, 7, world.season, 'DK1');
    expect(pool.length).toBeGreaterThan(64);
    expect(pool.length).toBeLessThanOrEqual(500);
    expect(pool.every((p) => fromDk.has(p.id))).toBe(true);
    expect(pool[0].ca).toBeGreaterThanOrEqual(pool.at(-1)!.ca);
    const teams = [{ ...aiTeam(1, []), ai: false, pid: 'p1' }, aiTeam(2, []), aiTeam(3, []), aiTeam(4, [])];
    const picks: DraftPick[] = [];
    const order = [1, 2, 3, 4];
    for (let n = 0; n < totalPicks(order, 0); n++) picks.push(autoPick(teams.find((t) => t.slot === slotForPick(order, n))!, picks, pool)!);
    expect(picks.every((p) => fromDk.has(p.player))).toBe(true);
    const g = buildDraftGame({ world, seed: 7, season: 1, lang: 'da', settings: { rounds: 1, playoff: 'none', keepers: 0, injuries: true, pool: 'DK1' }, teams, picks, hostPid: 'p1' });
    expect(Object.keys(g.players)).toHaveLength(pool.length);
    expect(squad(clubIdOf(1))).toHaveLength(16);
    let turns = 0;
    while (!g.draft!.seasonOver && turns++ < 30) mpAdvance();
    expect(g.draft!.seasonOver).toBe(true);
  });
});

describe('draft efter nationalitet', () => {
  it('alle danske spillere – uanset klub', () => {
    const dk = world.nations.findIndex((n) => n.name === 'Denmark');
    const pool = draftPool(world, 7, world.season, `n:${dk}`);
    expect(pool.length).toBeGreaterThan(64);
    expect(pool.every((p) => p.nation === dk)).toBe(true);
    // også danskere i udenlandske klubber
    const N = world.playerFields.indexOf('nation'), C = world.playerFields.indexOf('club'), I = world.playerFields.indexOf('id');
    const dk1 = new Set(world.clubs.filter((c) => c[4] === 'DK1').map((c) => c[0]));
    const abroad = new Set(world.players.filter((r) => r[N] === dk && !dk1.has(r[C] as number)).map((r) => r[I] as number));
    expect(pool.some((p) => abroad.has(p.id))).toBe(true);
  });
});

describe('draftkarakterer og auktion', () => {
  it('karakterer: det stærkeste hold får den bedste karakter, og alle får kup og tvivlsomt valg', () => {
    const pool = draftPool(world, 7, world.season);
    const teams = [1, 2, 3, 4].map((s) => aiTeam(s, []));
    const picks: DraftPick[] = [];
    const order = [1, 2, 3, 4];
    for (let n = 0; n < totalPicks(order, 0); n++) picks.push(autoPick(teams.find((t) => t.slot === slotForPick(order, n))!, picks, pool)!);
    const grades = draftGrades(teams, picks, pool);
    expect(grades).toHaveLength(4);
    const best = grades.slice().sort((a, b) => b.score - a.score)[0];
    const worst = grades.slice().sort((a, b) => a.score - b.score)[0];
    expect(['A+', 'A', 'B+'].includes(best.grade)).toBe(true);
    expect(['C', 'D', 'F', 'B'].includes(worst.grade)).toBe(true);
    for (const g of grades) { expect(g.steal).toBeTruthy(); expect(g.reach).toBeTruthy(); expect(g.line).toMatch(/^dr\.grade\./); }
  });

  it('en hel auktion med AI-hold: alle hold fyldes, ingen overskrider budgettet', () => {
    const pool = draftPool(world, 7, world.season);
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
    const teams = [1, 2, 3, 4].map((s) => ({ ...aiTeam(s, []), budget: BUDGET }));
    const picks: DraftPick[] = [];
    const order = [1, 2, 3, 4];
    let idx = 0, guard = 0;
    while (picks.length < 64 && guard++ < 500) {
      const slot = nominatorSlot(order, idx, teams, picks)!;
      const nom = teams.find((t) => t.slot === slot)!;
      const pk = autoPick(nom, picks, pool)!;
      const p = byId[pk.player];
      let bid = Math.max(1, Math.round(aiBidLimit(nom, picks, p, byId) * 0.4)), bidder = slot;
      for (;;) {
        const rivals = teams.filter((t) => t.slot !== bidder).map((t) => ({ t, l: aiBidLimit(t, picks, p, byId) })).filter((x) => x.l > bid).sort((a, b) => b.l - a.l);
        if (!rivals.length) break;
        bid = Math.min(rivals[0].l, bid + 1); bidder = rivals[0].t.slot;
      }
      const w = teams.find((t) => t.slot === bidder)!;
      expect(bid).toBeLessThanOrEqual(maxBidFor(w, picks));
      const place = placesFor(w, picks, p, byId)[0];
      picks.push({ slot: bidder, player: p.id, place: place ?? BENCH_PLACE, price: bid });
      w.budget! -= bid;
      idx = order.indexOf(slot) + 1;
    }
    expect(picks).toHaveLength(64);
    for (const t of teams) {
      expect(picks.filter((p) => p.slot === t.slot)).toHaveLength(16);
      expect(t.budget!).toBeGreaterThanOrEqual(0);
    }
    // stjernerne koster mere end reservespillerne
    const top = picks.slice().sort((a, b) => byId[b.player].ca - byId[a.player].ca);
    expect(top[0].price!).toBeGreaterThan(top.at(-1)!.price!);
  });
});

describe('sæsonprognose', () => {
  it('stærkeste hold er favorit, procenterne giver mening og er ens hver gang', () => {
    const pool = draftPool(world, 7, world.season);
    const teams = [1, 2, 3, 4, 5, 6].map((s) => aiTeam(s, []));
    const picks: DraftPick[] = [];
    const order = [1, 2, 3, 4, 5, 6];
    for (let n = 0; n < totalPicks(order, 0); n++) picks.push(autoPick(teams.find((t) => t.slot === slotForPick(order, n))!, picks, pool)!);
    const a = seasonPreview(teams, picks, pool, 2);
    const b = seasonPreview(teams, picks, pool, 2);
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);
    expect(a.reduce((s, x) => s + x.title, 0)).toBeGreaterThanOrEqual(98);
    expect(a.reduce((s, x) => s + x.title, 0)).toBeLessThanOrEqual(102);
    expect(a[0].strength).toBeGreaterThanOrEqual(a[5].strength);
    expect(a[0].title).toBeGreaterThan(a[5].title);
    expect(a[0].expPts).toBeGreaterThan(a[5].expPts);
    expect(a.every((x) => x.star && x.lines.gk > 0)).toBe(true);
  });
});
