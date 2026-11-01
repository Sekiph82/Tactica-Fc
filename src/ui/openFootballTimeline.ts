/** One shared match-time scale for every TACTICA-to-viewer presentation track. */
export const OPEN_FOOTBALL_MATCH_DURATION_MS = 505_340;

/** Map an authoritative TACTICA moment onto the viewer's regulation-time timeline. */
export function openFootballTimestamp(moment: number, totalMoments: number): number {
  return Math.max(0, Math.min(
    OPEN_FOOTBALL_MATCH_DURATION_MS,
    Math.round(moment / Math.max(totalMoments, 1) * OPEN_FOOTBALL_MATCH_DURATION_MS),
  ));
}

/** Fallback for legacy events that carry a match minute but no exact moment. */
export function openFootballMinuteTimestamp(minute: number, regulationMinutes = 90): number {
  return openFootballTimestamp(minute, regulationMinutes);
}
