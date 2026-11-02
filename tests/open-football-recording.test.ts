import { describe, expect, it } from 'vitest';
import type { MatchPitchSnapshot, MatchVisualAction } from '../src/game/types';
import { OpenFootballStateTimeline, toOpenFootballBallTracks, toOpenFootballNarrationTracks, toOpenFootballPlayerTracks, toOpenFootballRecordingEvents } from '../src/ui/openFootballRecording';

function action(overrides: Partial<MatchVisualAction> = {}): MatchVisualAction {
  return {
    moment: 50,
    minute: 10,
    team: 0,
    kind: 'shot',
    actor: 11,
    target: 22,
    fromZone: 0,
    toZone: 0,
    fromPoss: 0,
    toPoss: 1,
    from: [70, 50],
    to: [90, 50],
    ballFrom: [70, 50],
    ballTo: [91, 52],
    outcome: 'blocked',
    ...overrides,
  };
}

describe('TACTICA to Open Football viewer recording adapter', () => {
  it('keeps the full 22-player lineup visible at each narrated scene, including non-participants', () => {
    const players = Array.from({ length: 22 }, (_, index) => ({
      id: index + 1,
      team: index < 11 ? 0 : 1,
      num: index + 1,
      gk: index % 11 === 0,
      ax: index < 11 ? 25 : 75,
      ay: 10 + (index % 11) * 8,
      dx: index < 11 ? 25 : 75,
      dy: 10 + (index % 11) * 8,
      name: `Player ${index + 1}`,
    }));
    const snapshot: MatchPitchSnapshot = { moment: 50, zone: 4, poss: 0, holder: 6, shot: null, players };
    const next: MatchPitchSnapshot = {
      ...snapshot,
      moment: 100,
      players: players.map((player) => ({ ...player, x: player.ax + 2, y: player.ay })),
    };

    const tracks = toOpenFootballPlayerTracks([snapshot, next], 100);

    expect(Object.keys(tracks)).toHaveLength(22);
    expect(tracks[1][0][0]).toBe(252670);
    expect(tracks[1][1]).toEqual([505340, 226.8, 54.5]);
    expect(tracks[22]).toHaveLength(2);
    expect(tracks[22][0][0]).toBe(252670);
    expect(tracks[22][1][0]).toBe(505340);
  });

  it('streams possession ball samples at each engine snapshot between narrated actions', () => {
    const players = [
      { id: 7, team: 0, num: 7, gk: false, ax: 30, ay: 45, dx: 30, dy: 45, x: 30, y: 45, name: 'Carrier' },
      { id: 18, team: 1, num: 7, gk: false, ax: 70, ay: 55, dx: 70, dy: 55, x: 70, y: 55, name: 'Defender' },
    ];
    const first: MatchPitchSnapshot = { moment: 1, zone: 4, poss: 0, holder: 7, shot: null, players };
    const second: MatchPitchSnapshot = {
      ...first,
      moment: 2,
      zone: 5,
      players: players.map((player) => ({ ...player, x: (player.x ?? 0) + 2 })),
    };

    const ball = toOpenFootballBallTracks([first, second], 100);

    expect(ball).toHaveLength(2);
    expect(ball[0][0]).toBe(5053);
    expect(ball[1][0]).toBe(10107);
    expect(ball[1].slice(1, 3)).not.toEqual(ball[0].slice(1, 3));
  });

  it('keeps a cross and its later goal narration synchronized to separate clip times', () => {
    const cues = toOpenFootballNarrationTracks([
      { moment: 50, atTimeMs: 252000, minute: 45, text: 'Semenyo ortasını Haaland’ye gönderiyor.', hg: 0, ag: 0 },
      { moment: 50, atTimeMs: 253100, minute: 45, text: 'GOOOL! Haaland kafayla ağlarda!', hg: 0, ag: 1 },
      { moment: 50, atTimeMs: 253100, minute: 45, text: 'Wolves 0-1 Man City', hg: 0, ag: 1 },
    ], 100);

    expect(cues).toEqual([
      { at: 252000, moment: 50, minute: 45, text: 'Semenyo ortasını Haaland’ye gönderiyor.', hg: 0, ag: 0 },
      { at: 253100, moment: 50, minute: 45, text: 'GOOOL! Haaland kafayla ağlarda! · Wolves 0-1 Man City', hg: 0, ag: 1 },
    ]);
  });

  it('translates a blocked shot into the viewer contact cue at the engine event time and location', () => {
    const { events, states } = toOpenFootballRecordingEvents([action()], 100);
    expect(events).toEqual([{
      timestamp: 252670,
      category: 'ball',
      description: 'Blocked(22, [[764.4, 283.4, 0]])',
    }]);
    expect(states[22]).toEqual([[252670, 'TACTICA: Tackling']]);
  });

  it('translates a cleared cross into a headed-clear cue for the engine-selected defender', () => {
    const { events, states } = toOpenFootballRecordingEvents([action({
      kind: 'cross', outcome: 'cleared', target: 7, ballTo: [99, 2],
    })], 100);
    expect(events[0]).toEqual({
      timestamp: 252670,
      category: 'ball',
      description: 'HeadedClear(7, [[831.6, 10.9, 0]])',
    });
    expect(states[7]).toEqual([[252670, 'TACTICA: Alert']]);
  });

  it('passes the selected runner and receiver into viewer-supported attacking attitudes', () => {
    const { events, states } = toOpenFootballRecordingEvents([
      action({ kind: 'throughBall', outcome: 'complete', target: 9 }),
      action({ kind: 'cross', outcome: 'complete', target: 10 }),
    ], 100);
    expect(events).toEqual([]);
    expect(states[9]).toEqual([[252670, 'TACTICA: Running In Behind']]);
    expect(states[10]).toEqual([[255197, 'TACTICA: Cross Receiving']]);
  });

  it('lets newer action states supersede reset markers already sent in earlier live batches', () => {
    const timeline = new OpenFootballStateTimeline();
    expect(timeline.apply({ 22: [[100, 'TACTICA: Running In Behind']] })).toEqual({
      22: [[100, 'TACTICA: Running In Behind'], [2500, 'TACTICA: Neutral']],
    });
    expect(timeline.apply({ 22: [[2000, 'TACTICA: Intercepting']] })).toEqual({
      22: [[2000, 'TACTICA: Intercepting'], [2500, 'TACTICA: Intercepting'], [4400, 'TACTICA: Neutral']],
    });
  });

  it('keeps overlapping state corrections in time order within one streamed batch', () => {
    const timeline = new OpenFootballStateTimeline();
    timeline.apply({ 22: [[100, 'TACTICA: Running In Behind']] });
    expect(timeline.apply({ 22: [
      [200, 'TACTICA: Cross Receiving'],
      [300, 'TACTICA: Tackling'],
    ] })).toEqual({
      22: [
        [200, 'TACTICA: Cross Receiving'],
        [300, 'TACTICA: Tackling'],
        [2500, 'TACTICA: Tackling'],
        [2600, 'TACTICA: Tackling'],
        [2700, 'TACTICA: Neutral'],
      ],
    });
  });

  it('leaves unrelated actions out and keeps shootout contact time and clamped field coordinates', () => {
    const { events, states } = toOpenFootballRecordingEvents([
      action({ kind: 'shot', outcome: 'blocked', moment: 200, ballTo: [120, -10] }),
    ], 100);
    expect(events).toEqual([{
      timestamp: 1012365,
      category: 'ball',
      description: 'Blocked(22, [[840, 0, 0]])',
    }]);
    expect(states[22]).toEqual([[1012365, 'TACTICA: Tackling']]);
  });
});
