import type { MatchVisualAction } from '../game/types';
import type { MatchPitchSnapshot } from '../game/types';
import { formationLayout } from '../game/match-pitch';
import { OPEN_FOOTBALL_MATCH_DURATION_MS, openFootballTimestamp } from './openFootballTimeline';
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

export interface OpenFootballNarrationCue {
  moment: number;
  atMoment?: number;
  atTimeMs?: number;
  minute: number;
  text: string;
  hg: number;
  ag: number;
  /** Source commentary identity, used to select the matching visual action. */
  kind?: string;
  actorId?: number;
  targetId?: number;
}

const COMMENTARY_ACTION_KIND: Record<string, MatchVisualAction['kind']> = {
  'pass-forward': 'pass', longball: 'longBall', dribble: 'dribble', 'dribble-box': 'dribble',
  throughball: 'throughBall', offside: 'throughBall', cross: 'cross', 'corner-in': 'cross',
  'shot-blocked': 'shot', 'goal-cheer': 'shot', 'goal-offside': 'shot', 'goal-pen': 'shot',
  'goal-header': 'shot', 'goal-fk': 'shot', 'goal-long': 'shot', 'goal-1v1': 'shot', goal: 'shot',
  'var-check': 'shot', 'var-disallowed': 'shot', 'var-given': 'shot', 'var-stands': 'shot',
  'pen-saved': 'shot', 'header-saved': 'shot', bigsave: 'shot', save: 'shot', post: 'shot',
  'pen-miss': 'shot', 'header-wide': 'shot', 'miss-1v1': 'shot', 'long-wide': 'shot', wide: 'shot',
};

/** Find the action described by a commentary line, never merely the first action sharing its minute. */
export function findNarrationActionIndex(
  line: Pick<OpenFootballNarrationCue, 'moment' | 'kind' | 'actorId' | 'targetId'>,
  actions: readonly MatchVisualAction[],
): number {
  if (!line.kind) return -1;
  const expectedKind = line.kind === 'score' ? 'shot' : COMMENTARY_ACTION_KIND[line.kind];
  if (!expectedKind) return -1;
  let bestIndex = -1;
  let bestScore = -Infinity;
  for (const [index, action] of actions.entries()) {
    if (action.moment !== line.moment || action.kind !== expectedKind) continue;
    const offsideRunnerCue = line.kind === 'offside';
    if (line.actorId !== undefined && (offsideRunnerCue ? action.target : action.actor) !== line.actorId) continue;
    // Goal commentary's second player is the assister, while the visual action target is the keeper.
    const goalCue = line.kind.startsWith('goal-') || line.kind === 'goal';
    if (!goalCue && !offsideRunnerCue && line.targetId !== undefined && action.target !== line.targetId) continue;
    if (line.kind === 'score' && action.outcome !== 'goal') continue;
    if (line.kind === 'goal-offside' && action.outcome !== 'offside') continue;
    if (line.kind.startsWith('goal-') && !['goal-offside', 'goal-cheer'].includes(line.kind) && action.outcome !== 'goal') continue;
    if (line.kind === 'goal-cheer' && !['goal', 'offside'].includes(action.outcome)) continue;
    const score = (line.actorId !== undefined ? 4 : 0) + (!goalCue && !offsideRunnerCue && line.targetId !== undefined ? 2 : 0);
    if (score > bestScore || (score === bestScore && index > bestIndex)) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex;
}

/** Select only engine actions explicitly represented by commentary cues. */
export function narratedActionIndexes(
  lines: readonly Pick<OpenFootballNarrationCue, 'moment' | 'kind' | 'actorId' | 'targetId'>[],
  actions: readonly MatchVisualAction[],
): number[] {
  return [...new Set(lines.map((line) => findNarrationActionIndex(line, actions)).filter((index) => index >= 0))].sort((a, b) => a - b);
}

/** Keep distinct same-moment events on their own visual timestamps. */
export function toOpenFootballNarrationTracks(
  lines: readonly OpenFootballNarrationCue[],
  totalMoments: number,
): { at: number; moment: number; minute: number; text: string; hg: number; ag: number }[] {
  const cues = new Map<string, { at: number; moment: number; minute: number; text: string; hg: number; ag: number }>();
  for (const line of lines) {
    const at = line.atTimeMs ?? openFootballTimestamp(line.atMoment ?? line.moment, totalMoments);
    const key = `${line.moment}:${at}`;
    const current = cues.get(key);
    cues.set(key, {
      at,
      moment: line.moment,
      minute: line.minute,
      text: current ? `${current.text} · ${line.text}` : line.text,
      hg: line.hg,
      ag: line.ag,
    });
  }
  return [...cues.values()].sort((left, right) => left.at - right.at || left.moment - right.moment);
}

/** Keep every player visible, using only the authoritative snapshots attached to narrated scenes. */
export function toOpenFootballPlayerTracks(
  snapshots: readonly MatchPitchSnapshot[],
  totalMoments: number,
): Record<number, [number, number, number][]> {
  const tracks: Record<number, [number, number, number][]> = {};
  for (const snapshot of snapshots) {
    const time = openFootballTimestamp(snapshot.moment, totalMoments);
    const positions = formationLayout(snapshot).pos;
    for (const [playerId, [x, y]] of positions) {
      const track = tracks[playerId] ??= [];
      const sample: [number, number, number] = [time, Math.max(0, Math.min(840, x * 8.4)), Math.max(0, Math.min(545, y * 5.45))];
      if (track.at(-1)?.[0] === time) track[track.length - 1] = sample;
      else track.push(sample);
    }
  }
  return tracks;
}

/** Keep the ball on the engine's possession/contact point between narrated actions. */
export function toOpenFootballBallTracks(
  snapshots: readonly MatchPitchSnapshot[],
  totalMoments: number,
): [number, number, number, number][] {
  return snapshots.map((snapshot) => {
    const [x, y] = formationLayout(snapshot).ball;
    return [
      openFootballTimestamp(snapshot.moment, totalMoments),
      Math.max(0, Math.min(840, x * 8.4)),
      Math.max(0, Math.min(545, y * 5.45)),
      0,
    ];
  });
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
      const playerOutput: [number, string][] = output[playerId] = [];

      for (const [time, state] of entries) {
        playerOutput.push([time, state]);
        nextScheduled = nextScheduled.filter((expiry) => expiry >= time);
        // Correct every reset already sent to the viewer that this newer
        // action now outlives. Stable timestamp sorting makes the correction
        // win at the same time as the old neutral transition.
        for (const expiry of nextScheduled) playerOutput.push([expiry, state]);

        const resetAt = Math.min(OPEN_FOOTBALL_MATCH_DURATION_MS, time + ACTION_ATTITUDE_MS);
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

/** Give engine actions sharing a simulation moment ordered presentation windows within that moment. */
export function actionMomentWindows(actions: readonly MatchVisualAction[]): { start: number; event: number; end: number }[] {
  const counts = new Map<number, number>();
  for (const action of actions) counts.set(action.moment, (counts.get(action.moment) ?? 0) + 1);
  const offsets = new Map<number, number>();
  return actions.map((action) => {
    const count = counts.get(action.moment) ?? 1;
    const index = offsets.get(action.moment) ?? 0;
    offsets.set(action.moment, index + 1);
    const start = action.moment + index / count;
    const end = action.moment + (index + 1) / count;
    // A single action belongs to the exact engine moment. For multiple actions
    // in one step, use the start of each ordered sub-window so captions, goals,
    // and ball contacts do not drift into the following match minute.
    return { start, event: start, end };
  });
}

/** Convert simulation actions into ordered, continuous video clips on the match clock. */
export function actionPresentationWindows(
  actions: readonly MatchVisualAction[],
  totalMoments: number,
): { start: number; event: number; end: number }[] {
  const engineWindows = actionMomentWindows(actions);
  let lastEnd = 0;
  return actions.map((action, index) => {
    const base = openFootballTimestamp(engineWindows[index].start, totalMoments);
    const start = Math.max(base, lastEnd);
    const duration = action.kind === 'shot' || action.kind === 'cross' ? 1_100
      : action.kind === 'longBall' || action.kind === 'throughBall' ? 1_000
      : action.kind === 'pass' ? 850
      : 700;
    const end = start + duration;
    lastEnd = end;
    return { start, event: start + Math.min(300, duration * 0.35), end };
  });
}

/** Give engine actions sharing a simulation moment ordered presentation times within that moment. */
export function distributeActionMoments(actions: readonly MatchVisualAction[]): number[] {
  return actionMomentWindows(actions).map((window) => window.event);
}

/**
 * Adapt only presentation cues from TACTICA's authoritative match timeline to
 * the Open Football viewer's recording schema. This never advances the match
 * engine or decides an outcome.
 */
export function toOpenFootballRecordingEvents(
  actions: readonly MatchVisualAction[],
  totalMoments: number,
  presentationMoments = distributeActionMoments(actions),
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

  for (const [index, action] of actions.entries()) {
    const time = openFootballTimestamp(presentationMoments[index], totalMoments);
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
