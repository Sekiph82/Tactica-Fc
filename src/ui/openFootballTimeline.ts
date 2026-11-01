/** One shared match-time scale for every TACTICA-to-viewer presentation track. */
export const OPEN_FOOTBALL_MATCH_DURATION_MS = 505_340;
export const OPEN_FOOTBALL_EXTRA_TIME_DURATION_MS = Math.round(OPEN_FOOTBALL_MATCH_DURATION_MS / 3);
export const OPEN_FOOTBALL_MAX_MATCH_DURATION_MS = OPEN_FOOTBALL_MATCH_DURATION_MS + OPEN_FOOTBALL_EXTRA_TIME_DURATION_MS;

/** Map an authoritative TACTICA moment onto the viewer's regulation-time timeline. */
export function openFootballTimestamp(moment: number, totalMoments: number): number {
  const regulationMoments = Math.max(totalMoments, 1);
  if (moment <= regulationMoments) {
    return Math.max(0, Math.round(moment / regulationMoments * OPEN_FOOTBALL_MATCH_DURATION_MS));
  }
  const extraTimeMoments = Math.max(1, Math.round(regulationMoments / 3));
  const extraTimeProgress = Math.max(0, Math.min(1, (moment - regulationMoments) / extraTimeMoments));
  return OPEN_FOOTBALL_MATCH_DURATION_MS + Math.round(extraTimeProgress * OPEN_FOOTBALL_EXTRA_TIME_DURATION_MS);
}

/** Fallback for legacy events that carry a match minute but no exact moment. */
export function openFootballMinuteTimestamp(minute: number, regulationMinutes = 90): number {
  return openFootballTimestamp(minute, regulationMinutes);
}
