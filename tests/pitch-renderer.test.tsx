import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { Pitch2D } from '../src/ui/Pitch2D';
import type { MatchPitchSnapshot, MatchVisualAction } from '../src/game/types';
import { setLang } from '../src/i18n';

beforeEach(() => setLang('en'));

const snapshot: MatchPitchSnapshot = {
  zone: 7,
  poss: 0,
  holder: 2,
  moment: 12,
  shot: null,
  players: Array.from({ length: 22 }, (_, index) => {
    const team = index < 11 ? 0 : 1;
    const slot = index % 11;
    return {
      id: index + 1,
      team,
      num: slot + 1,
      gk: slot === 0,
      ax: team === 0 ? 12 + slot * 7 : 88 - slot * 7,
      ay: 12 + (slot % 6) * 9,
      dx: team === 0 ? 8 + slot * 7 : 92 - slot * 7,
      dy: 12 + (slot % 6) * 9,
      name: `Player ${index + 1}`,
    };
  }),
};

const action: MatchVisualAction = {
  moment: 12,
  minute: 23,
  team: 0,
  kind: 'throughBall',
  actor: 2,
  target: 15,
  fromZone: 4,
  toZone: 10,
  fromPoss: 0,
  toPoss: 0,
  from: [32, 34],
  to: [67, 45],
  ballFrom: [33, 34],
  ballTo: [68, 45],
  outcome: 'complete',
};

function renderPitch() {
  return renderToStaticMarkup(<Pitch2D
    snap={snapshot}
    me={0}
    colors={['#f5f5f5', '#111111', '#13294b', '#ffffff']}
    minute="23:00"
    banner="Through ball"
    bannerCls=""
    stepMs={500}
    action={action}
  />);
}

function renderShot(actor: number) {
  return renderToStaticMarkup(<Pitch2D
    snap={snapshot}
    me={0}
    colors={['#f5f5f5', '#111111', '#13294b', '#ffffff']}
    minute="23:00"
    banner="Shot"
    bannerCls=""
    stepMs={500}
    action={{ ...action, kind: 'shot', actor, target: actor === 2 ? 12 : 1, ballTo: [4, 50], outcome: 'saved' }}
  />);
}

function renderPass(actor: number) {
  return renderToStaticMarkup(<Pitch2D
    snap={snapshot}
    me={0}
    colors={['#f5f5f5', '#111111', '#13294b', '#ffffff']}
    minute="23:00"
    banner="Pass"
    bannerCls=""
    stepMs={500}
    action={{ ...action, kind: 'pass', actor, target: actor === 2 ? 12 : 1 }}
  />);
}

function renderTackle(actor: number) {
  return renderToStaticMarkup(<Pitch2D
    snap={snapshot}
    me={0}
    colors={['#f5f5f5', '#111111', '#13294b', '#ffffff']}
    minute="23:00"
    banner="Tackle"
    bannerCls=""
    stepMs={500}
    action={{ ...action, kind: 'tackle', actor, target: actor === 2 ? 15 : 1, outcome: 'won' }}
  />);
}

function renderKeeperRecovery() {
  return renderToStaticMarkup(<Pitch2D
    snap={snapshot}
    me={0}
    colors={['#f5f5f5', '#111111', '#13294b', '#ffffff']}
    minute="23:00"
    banner="Keeper claims the ball"
    bannerCls=""
    stepMs={500}
    action={{ ...action, kind: 'keeper', actor: 1, target: undefined, outcome: 'held' }}
  />);
}

function renderCelebration(actor: number) {
  const team = actor === 2 ? 0 : 1;
  return renderToStaticMarkup(<Pitch2D
    snap={{ ...snapshot, holder: actor, shot: { team, outcome: 'goal', zone: 9 } }}
    me={0}
    colors={['#f5f5f5', '#111111', '#13294b', '#ffffff']}
    minute="23:00"
    banner="Goal"
    bannerCls="goal"
    stepMs={500}
    action={{ ...action, kind: 'shot', actor, target: team === 0 ? 12 : 1, ballTo: [team === 0 ? 105 : 0, 50], outcome: 'goal' }}
  />);
}

function renderLongBall(actor: number) {
  return renderToStaticMarkup(<Pitch2D
    snap={snapshot} me={0} colors={['#f5f5f5', '#111111', '#13294b', '#ffffff']}
    minute="23:00" banner="Long ball" bannerCls="" stepMs={500}
    action={{ ...action, kind: 'longBall', actor, target: actor === 2 ? 12 : 1 }}
  />);
}

function renderCross(actor: number) {
  return renderToStaticMarkup(<Pitch2D
    snap={snapshot} me={0} colors={['#f5f5f5', '#111111', '#13294b', '#ffffff']}
    minute="23:00" banner="Cross" bannerCls="" stepMs={500}
    action={{ ...action, kind: 'cross', actor, target: actor === 2 ? 12 : 1 }}
  />);
}

const keeperShotAction: MatchVisualAction = {
  ...action,
  kind: 'shot',
  target: 1,
  to: [8, 50],
  ballTo: [8, 50],
  outcome: 'saved',
};

function renderKeeperSave() {
  return renderToStaticMarkup(<Pitch2D
    snap={snapshot}
    me={0}
    colors={['#f5f5f5', '#111111', '#13294b', '#ffffff']}
    minute="23:00"
    banner="Saved"
    bannerCls=""
    stepMs={500}
    action={keeperShotAction}
  />);
}

describe('Pitch2D renderer fixture', () => {
  it('renders 22 upright players, a pass-pose transition layer, two goalkeepers, and the animated ball deterministically', () => {
    const first = renderPitch();
    const second = renderPitch();

    expect(first).toBe(second);
    expect((first.match(/class="p2d-player(?:\s|"| managed)/g) ?? []).length).toBe(22);
    expect((first.match(/class="p2d-sprite(?:\s|"| idle| running)/g) ?? []).length).toBe(23);
    expect((first.match(/match-goalkeeper-(?:lime|orange)\.png/g) ?? []).length).toBe(2);
    expect(first).toContain('class="p2d-ball"');
    expect(first).toContain('class="p2d-sprite running"');
    expect(first).toContain('<animate attributeName="y"');
    expect(first).toContain('class="p2d-sprite pass-prep"');
    expect(first).toContain('class="p2d-sprite pass-pose"');
    expect(first).toContain('repeatCount="indefinite"');
    expect(first).toContain('<animateMotion');
    expect(first).toContain('<g class="p2d-camera">');
    expect(first).toContain('aria-pressed="false"');
    expect(first).toContain('Focus on ball');
    expect(first).toContain('class="p2d-stadium"');
    expect(first).toContain('transform="scale(-1 1)"');
    expect(first).toContain('aria-label="2D football pitch"');
  });

  it('transitions a targeted goalkeeper from the standing kit sprite into the matching save pose', () => {
    const saved = renderKeeperSave();

    expect(saved).toContain('class="p2d-sprite keeper-set"');
    expect(saved).toContain('class="p2d-sprite reacting keeper-diving"');
    expect(saved).toContain('match-gk-dive-lime.png');
    expect(saved).toContain('class="p2d-sprite shot-prep"');
    expect(saved).toContain('class="p2d-sprite shot-pose"');
    expect(saved).toContain('match-action-shot-white.png');
  });

  it('returns a goalkeeper from the save pose to the upright keeper sprite when holding the ball', () => {
    const recovered = renderKeeperRecovery();
    expect(recovered).toContain('class="p2d-sprite keeper-down"');
    expect(recovered).toContain('class="p2d-sprite keeper-recovering"');
    expect(recovered).toContain('match-gk-dive-lime.png');
    expect(recovered).toContain('match-goalkeeper-lime.png');
  });

  it('uses kit-matched shooting artwork for either team', () => {
    expect(renderShot(2)).toContain('match-action-shot-white.png');
    expect(renderShot(13)).toContain('match-action-shot-striped.png');
  });

  it('uses kit-matched passing artwork for either team', () => {
    expect(renderPass(2)).toContain('match-action-pass-white.png');
    expect(renderPass(13)).toContain('match-action-pass-striped.png');
  });

  it('uses kit-matched upright tackle poses for either team', () => {
    expect(renderTackle(2)).toContain('match-action-tackle-white.png');
    expect(renderTackle(13)).toContain('match-action-tackle-striped.png');
    expect(renderTackle(2)).toContain('class="p2d-sprite tackle-pose"');
  });

  it('uses the scorer kit-matched upright celebration pose', () => {
    expect(renderCelebration(2)).toContain('match-action-celebration-white.png');
    expect(renderCelebration(13)).toContain('match-action-celebration-striped.png');
    expect(renderCelebration(2)).toContain('class="p2d-sprite celebration-pose"');
  });

  it('uses the correct kit-matched long-ball and cross poses', () => {
    expect(renderLongBall(2)).toContain('match-action-longball-white.png');
    expect(renderLongBall(13)).toContain('match-action-longball-striped.png');
    expect(renderCross(2)).toContain('match-action-cross-white.png');
    expect(renderCross(13)).toContain('match-action-cross-striped.png');
  });

  it('ships both shot sprites as transparent 256-by-384 PNGs', () => {
    for (const name of ['match-action-shot-white.png', 'match-action-shot-striped.png', 'match-action-pass-white.png', 'match-action-pass-striped.png', 'match-action-tackle-white.png', 'match-action-tackle-striped.png', 'match-action-celebration-white.png', 'match-action-celebration-striped.png', 'match-action-longball-white.png', 'match-action-longball-striped.png', 'match-action-cross-white.png', 'match-action-cross-striped.png']) {
      const png = readFileSync(fileURLToPath(new URL(`../public/${name}`, import.meta.url)));
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(16)).toBe(256);
      expect(png.readUInt32BE(20)).toBe(384);
      expect(png[25]).toBe(6);
    }
  });
});
