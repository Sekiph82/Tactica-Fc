import { describe, expect, it } from 'vitest';
import type { MatchVisualAction } from '../src/game/types';
import { OpenFootballStateTimeline, toOpenFootballPlayerPositions, toOpenFootballRecordingEvents } from '../src/ui/openFootballRecording';

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
  it('uses engine-selected receiver and runner centers at their action moment', () => {
    const positions = toOpenFootballPlayerPositions([
      action({ kind: 'pass', moment: 12, actor: 5, target: 8, from: [20, 50], to: [41, 35] }),
      action({ kind: 'throughBall', moment: 13, actor: 8, target: 9, from: [41, 35], to: [64, 40] }),
    ], 100);
    expect(positions.get(12)).toEqual(new Map([[8, [41, 35]]]));
    expect(positions.get(13)).toEqual(new Map([[9, [64, 40]]]));
  });

  it('uses resolved carry/tackle endpoints but never treats a shot goal point as a player position', () => {
    const positions = toOpenFootballPlayerPositions([
      action({ kind: 'dribble', moment: 7, actor: 11, target: undefined, from: [70, 50], to: [75, 48] }),
      action({ kind: 'tackle', moment: 8, actor: 22, target: 11, from: [76, 48], to: [74, 49] }),
      action({ kind: 'shot', moment: 9, actor: 11, target: 1, to: [100, 50] }),
    ], 100);
    expect(positions.get(7)).toEqual(new Map([[11, [75, 48]]]));
    expect(positions.get(8)).toEqual(new Map([[22, [74, 49]]]));
    expect(positions.has(9)).toBe(false);
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
    expect(states[10]).toEqual([[252670, 'TACTICA: Cross Receiving']]);
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

  it('leaves unrelated actions out and clamps blocked-contact coordinates/time to viewer bounds', () => {
    const { events, states } = toOpenFootballRecordingEvents([
      action({ kind: 'shot', outcome: 'blocked', moment: 200, ballTo: [120, -10] }),
    ], 100);
    expect(events).toEqual([{
      timestamp: 505340,
      category: 'ball',
      description: 'Blocked(22, [[840, 0, 0]])',
    }]);
    expect(states[22]).toEqual([[505340, 'TACTICA: Tackling']]);
  });
});
