import { describe, expect, it } from 'vitest';
import type { MatchVisualAction } from '../src/game/types';
import { toOpenFootballRecordingEvents } from '../src/ui/openFootballRecording';

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
