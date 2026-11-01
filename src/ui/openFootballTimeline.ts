/** One shared match-time scale for every TACTICA-to-viewer presentation track. */
export const OPEN_FOOTBALL_MATCH_DURATION_MS = 505_340;
export const OPEN_FOOTBALL_EXTRA_TIME_DURATION_MS = Math.round(OPEN_FOOTBALL_MATCH_DURATION_MS / 3);
export const OPEN_FOOTBALL_MAX_MATCH_DURATION_MS = OPEN_FOOTBALL_MATCH_DURATION_MS + OPEN_FOOTBALL_EXTRA_TIME_DURATION_MS;

/** One additional engine moment on the same 8:25 presentation clock. */
export function openFootballShootoutStepMs(totalMoments: number): number {
  return OPEN_FOOTBALL_MATCH_DURATION_MS / Math.max(totalMoments, 1);
}

/** Keep each actual penalty kick on its own playable beat after extra time. */
export function openFootballShootoutDuration(kicksRecorded: number, totalMoments: number): number {
  return OPEN_FOOTBALL_MAX_MATCH_DURATION_MS + (Math.max(0, kicksRecorded) + 1) * openFootballShootoutStepMs(totalMoments);
}

/** Map an authoritative TACTICA moment onto regulation, extra-time, and shootout viewer time. */
export function openFootballTimestamp(moment: number, totalMoments: number): number {
  const regulationMoments = Math.max(totalMoments, 1);
  if (moment <= regulationMoments) {
    return Math.max(0, Math.round(moment / regulationMoments * OPEN_FOOTBALL_MATCH_DURATION_MS));
  }
  const extraTimeMoments = Math.max(1, Math.round(regulationMoments / 3));
  const beyondRegulation = moment - regulationMoments;
  if (beyondRegulation <= extraTimeMoments) {
    return OPEN_FOOTBALL_MATCH_DURATION_MS + Math.round(beyondRegulation / extraTimeMoments * OPEN_FOOTBALL_EXTRA_TIME_DURATION_MS);
  }
  // Shootout steps have no advancing football minute in MatchSim. Their
  // presentation moments are appended after 120' by the manager screen.
  return OPEN_FOOTBALL_MAX_MATCH_DURATION_MS + Math.round((beyondRegulation - extraTimeMoments) * openFootballShootoutStepMs(regulationMoments));
}

/** Fallback for legacy events that carry a match minute but no exact moment. */
export function openFootballMinuteTimestamp(minute: number, regulationMinutes = 90): number {
  return openFootballTimestamp(minute, regulationMinutes);
}
