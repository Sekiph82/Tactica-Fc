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
 * Adapt only presentation cues from TACTICA's authoritative match timeline to
 * the Open Football viewer's recording schema. This never advances the match
 * engine or decides an outcome.
 */
export function toOpenFootballRecordingEvents(
  actions: readonly MatchVisualAction[],
  totalMoments: number,
): OpenFootballActionRecording {
  const events: OpenFootballRecordingEvent[] = [];
  const pendingStates: Record<number, { time: number; order: number; attitude: string }[]> = {};
  const eventKeys = new Set<string>();
  let stateOrder = 0;

  const addEvent = (timestamp: number, description: string) => {
    const key = `${timestamp}:${description}`;
    if (eventKeys.has(key)) return;
    eventKeys.add(key);
    events.push({ timestamp, category: 'ball', description });
  };

  const addState = (playerId: number | undefined, time: number, attitude: string) => {
    if (playerId === undefined) return;
    (pendingStates[playerId] ??= []).push({ time, order: stateOrder++, attitude });
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
    if (action.kind === 'throughBall' && action.outcome === 'complete') {
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

  const states: Record<number, [number, string][]> = {};
  for (const [playerId, queued] of Object.entries(pendingStates)) {
    const ordered = queued.sort((a, b) => a.time - b.time || a.order - b.order);
    const transitions = ordered.filter((entry, index) => entry.time !== ordered[index + 1]?.time);
    const entries = states[Number(playerId)] = [];
    for (let index = 0; index < transitions.length; index++) {
      const transition = transitions[index];
      const nextTime = transitions[index + 1]?.time ?? MATCH_DURATION_MS + 1;
      entries.push([transition.time, `TACTICA: ${transition.attitude}`]);

      // Viewer states remain in force until another state arrives. Reset short
      // gestures after their dwell, unless a newer action should take over.
      const resetAt = transition.time + ACTION_ATTITUDE_MS;
      if (resetAt < nextTime && resetAt < MATCH_DURATION_MS) entries.push([resetAt, 'TACTICA: Neutral']);
    }
  }

  return { events, states };
}
