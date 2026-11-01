import type { MatchVisualAction } from '../game/types';

const MATCH_DURATION_MS = 505_340;
const ACTION_ATTITUDE_MS = 2_400;

export interface OpenFootballRecordingEvent {
  timestamp: number;
  category: 'ball';
  description: string;
}

export interface OpenFootballActionRecording {
  events: OpenFootballRecordingEvent[];
  /** Viewer wire shape: state transitions are [timestamp, "Group: State"]. */
  states: Record<number, [number, string][]>;
}

/**
 * The viewer appends live state tracks and cannot remove an already queued
 * transition. Reassert the latest attitude at any earlier pending reset so a
 * later action from another batch is not accidentally cleared by it.
 */
export class OpenFootballStateTimeline {
  private readonly expiries = new Map<number, number[]>();

  apply(incoming: Record<number, [number, string][]>): Record<number, [number, string][]> {
    const output: Record<number, [number, string][]> = {};
    for (const [rawPlayerId, entries] of Object.entries(incoming)) {
      const playerId = Number(rawPlayerId);
      const scheduled = this.expiries.get(playerId) ?? [];
      let nextScheduled = scheduled.filter((expiry) => expiry >= entries[0]?.[0]);
      const playerOutput = output[playerId] = [];

      for (const [time, state] of entries) {
        playerOutput.push([time, state]);
        nextScheduled = nextScheduled.filter((expiry) => expiry >= time);
        // Correct every reset already sent to the viewer that this newer
        // action now outlives. Stable timestamp sorting makes the correction
        // win at the same time as the old neutral transition.
        for (const expiry of nextScheduled) playerOutput.push([expiry, state]);

        const resetAt = Math.min(MATCH_DURATION_MS, time + ACTION_ATTITUDE_MS);
        if (resetAt > time) {
          playerOutput.push([resetAt, 'TACTICA: Neutral']);
          nextScheduled.push(resetAt);
        }
      }

      playerOutput.sort((a, b) => a[0] - b[0]);
      for (let index = playerOutput.length - 1; index > 0; index--) {
        if (playerOutput[index][0] === playerOutput[index - 1][0]) playerOutput.splice(index - 1, 1);
      }
      this.expiries.set(playerId, [...new Set(nextScheduled)].sort((a, b) => a - b));
    }
    return output;
  }
}

/**
 * Adapt only presentation cues from TACTICA's authoritative match timeline to
 * the Open Football viewer's recording schema. This never advances the match
 * engine or decides an outcome.
 */
export function toOpenFootballRecordingEvents(
  actions: readonly MatchVisualAction[],
  totalMoments: number,
): OpenFootballActionRecording {
  const events: OpenFootballRecordingEvent[] = [];
  const states: Record<number, [number, string][]> = {};
  const eventKeys = new Set<string>();

  const addEvent = (timestamp: number, description: string) => {
    const key = `${timestamp}:${description}`;
    if (eventKeys.has(key)) return;
    eventKeys.add(key);
    events.push({ timestamp, category: 'ball', description });
  };

  const addState = (playerId: number | undefined, time: number, attitude: string) => {
    if (playerId === undefined) return;
    const entries = states[playerId] ??= [];
    entries.push([time, `TACTICA: ${attitude}`]);
  };

  for (const action of actions) {
    const time = Math.max(0, Math.min(MATCH_DURATION_MS,
      Math.round(action.moment / Math.max(totalMoments, 1) * MATCH_DURATION_MS)));
    const contact = action.ballTo ?? action.to;
    const px = Math.max(0, Math.min(840, contact[0] * 8.4));
    const py = Math.max(0, Math.min(545, contact[1] * 5.45));
    const position = `[[${Number(px.toFixed(2))}, ${Number(py.toFixed(2))}, 0]]`;

    // The upstream viewer uses these exact recorded contact cues to animate
    // blocks and headed clearances against the ball's real recorded path.
    if ((action.kind === 'shot' || action.kind === 'cross') && action.outcome === 'blocked' && action.target !== undefined) {
      addEvent(time, `Blocked(${action.target}, ${position})`);
      addState(action.target, time, 'Tackling');
    } else if (action.kind === 'cross' && action.outcome === 'cleared' && action.target !== undefined) {
      addEvent(time, `HeadedClear(${action.target}, ${position})`);
      addState(action.target, time, 'Alert');
    } else if (action.kind === 'deflection') {
      addEvent(time, `Blocked(${action.actor}, ${position})`);
      addState(action.actor, time, 'Intercepting');
    }

    // These are viewer-supported idle attitudes, attached to engine-picked
    // runners/defenders so the same action also reads between ball contacts.
    if (action.kind === 'pass' && action.outcome === 'complete') {
      addState(action.target, time, 'Supporting Attack');
    } else if (action.kind === 'longBall' && action.outcome === 'complete') {
      addState(action.target, time, 'Cross Receiving');
    } else if (action.kind === 'throughBall' && action.outcome === 'complete') {
      addState(action.target, time, 'Running In Behind');
    } else if (action.kind === 'cross' && action.outcome === 'complete') {
      addState(action.target, time, 'Cross Receiving');
    } else if (action.kind === 'throughBall' && action.outcome === 'offside') {
      addState(action.target, time, 'Running In Behind');
    } else if (action.kind === 'throughBall' && action.outcome === 'intercepted') {
      addState(action.target, time, 'Intercepting');
    } else if (action.kind === 'tackle') {
      addState(action.actor, time, 'Tackling');
    }
  }

  for (const entries of Object.values(states)) {
    entries.sort((a, b) => a[0] - b[0]);
    for (let i = entries.length - 1; i > 0; i--) {
      if (entries[i][0] === entries[i - 1][0]) entries.splice(i - 1, 1);
    }
  }

  return { events, states };
}
