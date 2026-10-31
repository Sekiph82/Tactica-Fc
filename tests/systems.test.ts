import { describe, expect, it } from 'vitest';
import { roundRobin } from '../src/game/competitions';
import { makePlayer } from '../src/game/data/generate';
import { attrRange } from '../src/game/scouting';
import { calendar, leagueCalendar, leagueDates } from '../src/game/competitions';
import { LEAGUE_RULES } from '../src/game/leagues';
import { leadLoss } from '../src/game/analysis';

describe('kampprogram', () => {
  it('cirkelmetoden: alle møder alle præcis én gang', () => {
    const clubs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const rounds = roundRobin(clubs);
    expect(rounds.length).toBe(11);
    const seen = new Set<string>();
    for (const r of rounds) {
      const playing = r.flat();
      expect(new Set(playing).size).toBe(playing.length);
      for (const [h, a] of r) seen.add([h, a].sort().join('-'));
    }
    expect(seen.size).toBe((12 * 11) / 2);
  });

  it('ulige antal hold giver fridage', () => {
    const rounds = roundRobin([1, 2, 3, 4, 5]);
    expect(rounds.length).toBe(5);
    expect(rounds.every((r) => r.length === 2)).toBe(true);
  });

  it('kalenderen har nok lørdage til en 38-runders liga', () => {
    const cal = calendar(2025);
    expect(cal.saturdays.length + cal.tuesdays.length).toBeGreaterThanOrEqual(46);
    expect(cal.saturdays[0] >= '2025-08-01').toBe(true);
    expect(cal.cl.final > cal.cl.sf[1]).toBe(true);
  });
});

describe('scouting', () => {
  it('den sande værdi ligger altid i intervallet, og intervallet indsnævres', () => {
    const p = makePlayer({ id: 42, first: 'A', last: 'B', dob: '2000-01-01', nation: 0, club: 1, sub: 'CM', foot: 'R', height: 180, ca: 130, date: '2025-07-01', seed: 1 });
    for (let i = 0; i < 36; i++) {
      for (const k of [0, 25, 50, 75, 100]) {
        const [lo, hi] = attrRange(p, i, k);
        const v = Math.round(p.attrs[i]);
        expect(lo).toBeLessThanOrEqual(v);
        expect(hi).toBeGreaterThanOrEqual(v);
        expect(lo).toBeGreaterThanOrEqual(1);
        expect(hi).toBeLessThanOrEqual(20);
      }
      const wide = attrRange(p, i, 0);
      const exact = attrRange(p, i, 100);
      expect(exact[0]).toBe(exact[1]);
      expect(wide[1] - wide[0]).toBeGreaterThan(0);
    }
  });
});

describe('spillergenerering', () => {
  it('er deterministisk pr. seed og id', () => {
    const a = makePlayer({ id: 7, first: 'A', last: 'B', dob: '1999-03-03', nation: 0, club: 1, sub: 'CF', foot: 'L', height: 185, ca: 150, date: '2025-07-01', seed: 5 });
    const b = makePlayer({ id: 7, first: 'A', last: 'B', dob: '1999-03-03', nation: 0, club: 1, sub: 'CF', foot: 'L', height: 185, ca: 150, date: '2025-07-01', seed: 5 });
    expect(a.attrs).toEqual(b.attrs);
    expect(a.pos[6]).toBe(20);
  });
});

describe('tabt føring', () => {
  it('finder føringen, udligningen og ændringen i chancerne', () => {
    const ev = (m: number, t: number, k = 'goal') => ({ m, t, k, p: 1 });
    const shot = (m: number, t: number, xg: number, zone: number) => ({ m, t, xg, zone, outcome: 'off' as const, p: 1, kind: 'normal' });
    const side = { goals: 2, shots: 0, onTarget: 0, xg: 0, possession: 50, corners: 0, fouls: 0, yellows: 0, reds: 0, offsides: 0, passes: 0, passesCompleted: 0 };
    const rep = {
      fixture: 1, home: 1, away: 2, stats: [side, { ...side }], players: [], momentum: [], heat: [[], []], zoneControl: [], mom: 0, commentary: [], formations: ['4-4-2', '4-4-2'],
      events: [ev(10, 0), ev(20, 0), ev(70, 1), ev(80, 1), ev(60, 1, 'sub')],
      shots: [shot(10, 0, 0.4, 13), shot(20, 0, 0.3, 13), shot(65, 1, 0.3, 0), shot(70, 1, 0.4, 0), shot(80, 1, 0.5, 0)],
      changes: [{ m: 62, t: 1, kind: 'mentality' as const, from: '2', to: '4' }],
    };
    const a = leadLoss(rep as unknown as Parameters<typeof leadLoss>[0], 0)!;
    expect(a.lead).toBe(2);
    expect(a.leadMin).toBe(20);
    expect(a.lostMin).toBe(80);
    expect(a.xgAfter[1]).toBeCloseTo(1.2);
    expect(a.oppSubs).toBe(1);
    expect(a.oppChanges.length).toBe(1);
    expect(a.weakLane).toBe('left');
    // en sejr er ikke en tabt føring
    expect(leadLoss({ ...rep, stats: [{ ...side, goals: 3 }, side] } as unknown as Parameters<typeof leadLoss>[0], 0)).toBeNull();
  });
});

describe('dansk sæsonkalender', () => {
  it('Superligaen starter i juli og holder vinterpause fra december til februar', () => {
    const cal = leagueCalendar(calendar(2025), LEAGUE_RULES.DK1, 2025);
    const dates = leagueDates(cal, 32);
    expect(dates.length).toBe(32);
    expect(dates[0] < '2025-08-01').toBe(true);
    for (const d of dates) expect(d > '2025-12-08' && d < '2026-02-14').toBe(false);
    expect(dates.at(-1)! <= '2026-06-01').toBe(true);
  });
});
