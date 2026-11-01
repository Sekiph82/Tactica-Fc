import { describe, expect, it } from 'vitest';
import { openFootballPlaybackSpeed } from '../src/ui/openFootballSpeed';

describe('Open Football live playback speed', () => {
  it('uses the selected single-player match speed directly', () => {
    expect(openFootballPlaybackSpeed(1)).toBe(1);
    expect(openFootballPlaybackSpeed(4)).toBe(4);
    expect(openFootballPlaybackSpeed(8)).toBe(8);
  });

  it('matches head-to-head playback to the configured half duration and slower manager', () => {
    expect(openFootballPlaybackSpeed(8, { halfMinutes: 3, homeSpeed: 2, awaySpeed: 1 }))
      .toBeCloseTo(505_340 / 360_000);
    expect(openFootballPlaybackSpeed(1, { halfMinutes: 6, homeSpeed: 4, awaySpeed: 2 }))
      .toBeCloseTo(2 * 505_340 / 720_000);
  });

  it('keeps the computed viewer multiplier positive for the shortest valid setting', () => {
    expect(openFootballPlaybackSpeed(1, { halfMinutes: 0, homeSpeed: 0, awaySpeed: 4 }))
      .toBeGreaterThan(0);
  });
});
