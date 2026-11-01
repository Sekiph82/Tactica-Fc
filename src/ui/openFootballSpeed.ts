const VIEWER_MATCH_DURATION_MS = 505_340;
const MIN_SPEED = 0.1;

export interface HeadToHeadPlayback {
  halfMinutes: number;
  homeSpeed: number;
  awaySpeed: number;
}

/** Keep the viewer's wall clock aligned with the authoritative match clock. */
export function openFootballPlaybackSpeed(singlePlayerSpeed: number, headToHead?: HeadToHeadPlayback): number {
  if (!headToHead) return Math.max(MIN_SPEED, singlePlayerSpeed);

  const halfMinutes = Math.max(MIN_SPEED, headToHead.halfMinutes);
  const managersSpeed = Math.max(MIN_SPEED, Math.min(headToHead.homeSpeed, headToHead.awaySpeed));
  return VIEWER_MATCH_DURATION_MS / (halfMinutes * 120_000) * managersSpeed;
}
