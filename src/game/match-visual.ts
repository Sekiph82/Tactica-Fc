import type { MatchPitchSnapshot, MatchVisualAction } from './types';

/** A recorded engine action paired with the pitch state produced by that same step. */
export interface MatchVisualFrame {
  action: MatchVisualAction;
  snap: MatchPitchSnapshot;
}

/** Keep the live simulation close to the actions that the viewer can show. */
export function hasVisualQueueCapacity(pendingFrames: number, capacity = 1): boolean {
  return pendingFrames < capacity;
}

/** Keep queued presentation events attached to their own engine-time positions. */
export function pairVisualActionsWithSnapshot(actions: readonly MatchVisualAction[], snap: MatchPitchSnapshot): MatchVisualFrame[] {
  return actions.map((action) => {
    const actor = snap.players.find((p) => p.id === action.actor);
    const target = action.target === undefined ? undefined : snap.players.find((p) => p.id === action.target);
    const holder = target?.team === action.toPoss ? target.id : actor?.team === action.toPoss ? actor.id : 0;
    // An engine step can record more than one event (for example pass, tackle, turnover).
    // Give each queued event its own possession/zone layout instead of replaying every event
    // over the final snapshot of that whole step.
    const shotOutcome = action.outcome === 'offTarget' ? 'off' : action.outcome;
    const shot = action.kind === 'shot' && ['goal', 'saved', 'off', 'blocked', 'offside', 'post'].includes(shotOutcome)
      ? { team: action.team, outcome: shotOutcome as NonNullable<MatchPitchSnapshot['shot']>['outcome'], zone: action.toZone }
      : null;
    return { action, snap: { ...snap, zone: action.toZone, poss: action.toPoss, holder, shot } };
  });
}
