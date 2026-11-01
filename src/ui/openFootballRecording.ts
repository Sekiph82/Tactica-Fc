import type { MatchVisualAction } from '../game/types';

const MATCH_DURATION_MS = 505_340;

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
    const state = `TACTICA: ${attitude}`;
    if (entries.at(-1)?.[1] !== state) entries.push([time, state]);
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
    } else if (action.kind === 'tackle') {
      addState(action.actor, time, 'Tackling');
    }
  }

  return { events, states };
}
