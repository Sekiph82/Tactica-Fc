// Klassisk 2D-kampvisning (inspireret af CM/FM): spillerne bevæger sig mellem deres forsvars- og
// angrebspositioner fra taktikken, alt efter hvor bolden er – så man kan se, hvad taktikken gør.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MatchPitchSnapshot, MatchVisualAction, ShotRecord } from '../game/types';
import { hash01 } from '../game/rng';
import { formationLayout } from '../game/match-pitch';
import { t } from '../i18n';

export type Snap = MatchPitchSnapshot;
/** Straffespark: hvilket hold skyder, og hvor langt tilløbet er nået (0 opstilling, 1 tilløb, 2 skud). so = straffesparkskonkurrence */
type PenSnap = Snap & { pen: number; penStep: number; so?: boolean };

/** Hjørnespark: hvilket hold, fra hvilken side (0 = top, 2 = bund), hvem tager det, hvem afslutter, og hvor langt vi er (0 klar, 1 indlæg, 2 afslutning/clearing) */
type CornerSnap = Snap & { corner: { team: number; lane: number; taker: number; target?: number; step: number; cleared?: boolean } };

/** Hjørnesparksopstilling: skytten ved flaget, angribere og forsvarere i feltet, resten længere ude */
function cornerLayout(s: CornerSnap): { pos: Map<number, [number, number]>; ball: [number, number]; holder?: Snap['players'][number] } {
  const c = s.corner;
  const toRight = c.team === 0;
  const dir = toRight ? 1 : -1;
  const goalX = toRight ? 100 : 0;
  const flag: [number, number] = [toRight ? 99.3 : 0.7, c.lane === 0 ? 1.5 : 98.5];
  const pos = new Map<number, [number, number]>();
  const att = s.players.filter((p) => p.team === c.team && !p.gk && p.id !== c.taker)
    .sort((a, b) => dir * (b.ax - a.ax)); // de mest offensive først
  const def = s.players.filter((p) => p.team !== c.team && !p.gk);
  // fem angribere i feltet (afslutteren foran), to ved feltets kant, resten bliver hjemme
  const target = att.find((p) => p.id === c.target);
  const inBox = [...(target ? [target] : []), ...att.filter((p) => p !== target)].slice(0, 5);
  const spots: [number, number][] = [[8, 50 + (c.lane === 0 ? -4 : 4)], [6, 38], [11, 60], [13, 45], [5, 64]];
  inBox.forEach((p, i) => pos.set(p.id, [goalX - dir * spots[i][0], spots[i][1]]));
  const rest = att.filter((p) => !inBox.includes(p));
  rest.forEach((p, i) => pos.set(p.id, i < 2 ? [goalX - dir * 20, 38 + i * 24] : [50 - dir * (6 + i * 3), 30 + ((i * 17) % 40)]));
  // forsvarerne markerer angriberne i feltet (lidt nærmere målet), resten dækker stolper og kant
  def.forEach((p, i) => {
    const m = inBox[i];
    if (m) { const [x, y] = pos.get(m.id)!; pos.set(p.id, [x + dir * 2.6, y + 3]); }
    else pos.set(p.id, i % 2 ? [goalX - dir * 2, c.lane === 0 ? 44 : 56] : [goalX - dir * (16 + i), 30 + ((i * 13) % 40)]);
  });
  for (const p of s.players.filter((x) => x.gk)) pos.set(p.id, p.team === c.team ? [toRight ? 8 : 92, 50] : [toRight ? 98.5 : 1.5, 50]);
  const taker = s.players.find((p) => p.id === c.taker);
  if (taker) pos.set(taker.id, [flag[0] - dir * 1.2, flag[1] + (c.lane === 0 ? 1.5 : -1.5)]);
  let ball: [number, number] = flag;
  let holder = taker;
  if (c.step >= 1 && inBox[0]) {
    const [x, y] = pos.get(inBox[0].id)!;
    ball = [x + dir * 0.8, y];
    holder = inBox[0];
  }
  if (c.step >= 2) {
    if (c.cleared) {
      // forsvaret header bolden væk
      ball = [goalX - dir * 24, c.lane === 0 ? 30 : 70];
      holder = undefined;
    } else if (s.shot) {
      const o = s.shot.outcome;
      ball = o === 'goal' || o === 'offside' ? [goalX - dir * 0.5, 47] : o === 'saved' ? [goalX - dir * 2, 51] : o === 'blocked' ? [goalX - dir * 9, 50] : missSpot(toRight, s.moment);
    }
  }
  return { pos, ball, holder };
}

/** Direkte frispark: skytten ~22 m fra mål, en mur på fire, målmanden på stregen */
type FkSnap = Snap & { fk: number; fkStep: number; fkY: number };
function fkLayout(s: FkSnap): { pos: Map<number, [number, number]>; ball: [number, number]; holder?: Snap['players'][number] } {
  const toRight = s.fk === 0;
  const dir = toRight ? 1 : -1;
  const goalX = toRight ? 100 : 0;
  const bx = goalX - dir * 21, by = s.fkY;
  const pos = new Map<number, [number, number]>();
  const shooter = s.players.find((p) => p.id === s.holder);
  const def = s.players.filter((p) => p.team !== s.fk && !p.gk);
  const att = s.players.filter((p) => p.team === s.fk && !p.gk && p.id !== shooter?.id);
  // muren: fire forsvarere 9 m fra bolden mellem bold og mål
  const wx = bx + dir * 8.5, wy = by + (50 - by) * 0.4;
  def.forEach((p, i) => pos.set(p.id, i < 4 ? [wx, wy - 4.5 + i * 3] : [goalX - dir * (6 + (i % 3) * 3), 34 + ((i * 11) % 32)]));
  att.forEach((p, i) => pos.set(p.id, i < 4 ? [goalX - dir * (7 + (i % 2) * 3), 38 + i * 7] : [50 - dir * (5 + i), 25 + ((i * 13) % 50)]));
  for (const p of s.players.filter((x) => x.gk)) pos.set(p.id, p.team === s.fk ? [toRight ? 8 : 92, 50] : [goalX - dir * 1.5, 48]);
  if (shooter) pos.set(shooter.id, [bx - dir * (s.fkStep === 0 ? 4 : 1), by + 1.5]);
  let ball: [number, number] = [bx, by];
  if (s.shot) {
    const o = s.shot.outcome as string;
    ball = o === 'goal' ? [goalX - dir * 0.5, 45] : o === 'saved' ? [goalX - dir * 2, 47] : o === 'post' ? [goalX - dir * 0.4, 44.3] : o === 'blocked' ? [wx - dir * 1, wy] : missSpot(toRight, s.moment);
  }
  return { pos, ball, holder: shooter };
}

/**
 * Straffesparksopstilling: skytten ved pletten, målmanden på stregen, alle andre uden for feltet.
 * I en straffesparkskonkurrence skydes der altid mod samme mål, og spillerne står i midtercirklen.
 */
function penLayout(s: PenSnap): { pos: Map<number, [number, number]>; ball: [number, number]; holder?: Snap['players'][number] } {
  const toRight = s.so ? true : s.pen === 0;
  const dir = toRight ? 1 : -1;
  const goalX = toRight ? 100 : 0;
  const spotX = toRight ? 89 : 11;
  const edgeX = toRight ? 80 : 20;
  const pos = new Map<number, [number, number]>();
  const shooter = s.players.find((p) => p.id === s.holder);
  // skuddets side og målmandens gæt (samme for alle billeder af sparket)
  const aim = hash01(Math.floor(s.moment / 10), s.holder, 21) < 0.5 ? -1 : 1;
  const out = s.penStep >= 2 ? s.shot?.outcome : undefined;
  const dive = out === 'saved' ? aim : out === 'goal' ? (hash01(Math.floor(s.moment / 10), s.holder, 22) < 0.8 ? -aim : aim) : out ? (hash01(Math.floor(s.moment / 10), s.holder, 23) < 0.5 ? -1 : 1) : 0;
  const k = [0, 0];
  for (const p of s.players) {
    if (p.id === shooter?.id) continue;
    if (p.gk) {
      const defending = p.team !== s.pen;
      if (defending) pos.set(p.id, [goalX - dir * (dive ? 1.6 : 1), 50 + dive * 5.5]);
      else pos.set(p.id, s.so ? [goalX - dir * 13, 17] : [p.team === 0 ? 6 : 94, 50]);
      continue;
    }
    const i = k[p.team]++;
    if (s.so) {
      // midtercirklen: hvert hold i to rækker på sin side af midterlinjen
      const row = i % 2, col = Math.floor(i / 2) % 5;
      pos.set(p.id, [50 + (p.team === 0 ? -1 : 1) * (2.6 + row * 4.4), 36 + col * 7]);
      continue;
    }
    // spredt i to rækker uden for feltet
    const n = k[0] + k[1] - 1;
    const row = n % 2, col = Math.floor(n / 2) % 9;
    pos.set(p.id, [edgeX - dir * (row * 6 + Math.abs(col - 4) * 0.8), 20 + col * 7.5 + row * 3.5]);
  }
  const back = s.penStep === 0 ? 6 : s.penStep === 1 ? 2 : 0.5;
  if (shooter) pos.set(shooter.id, [spotX - dir * back, 50 + (s.penStep === 0 ? 3 : 1)]);
  let ball: [number, number] = [spotX, 50];
  if (out) {
    ball = out === 'goal' || out === 'offside' ? [goalX - dir * 0.5, 50 + aim * 4] : out === 'saved' ? [goalX - dir * 4.5, 50 + aim * 9] : [goalX + dir * 0.5, 50 + aim * 10.5];
  }
  return { pos, ball, holder: shooter };
}
const W = 105, H = 68;

/** Hvor bolden ender ved et forbiskud: lige uden for stolpen eller bag mål (over overliggeren) – aldrig langt væk */
function missSpot(toRight: boolean, seed: number): [number, number] {
  const u = hash01(seed, 13, 3), v = hash01(seed, 14, 4);
  const lineX = toRight ? 100.9 : -0.9;
  if (u < 0.35) return [toRight ? 101.6 : -1.6, 46.5 + v * 7]; // over mål
  return [lineX, u < 0.68 ? 42.5 - v * 3 : 57.5 + v * 3]; // forbi stolpen
}

/**
 * Spillernes positioner ud fra taktikken og boldens zone – og bolden ved boldholderens fødder.
 * Returnerer positionerne, boldens placering og hvem der har bolden.
 */
function layout(s: Snap, gap = 3.2): { pos: Map<number, [number, number]>; ball: [number, number]; holder?: Snap['players'][number] } {
  if ((s as PenSnap).pen !== undefined) return penLayout(s as PenSnap);
  if ((s as CornerSnap).corner) return cornerLayout(s as CornerSnap);
  if ((s as FkSnap).fk !== undefined) return fkLayout(s as FkSnap);
  const { pos, ball: formationBall, holder } = formationLayout(s, gap);
  let ball = formationBall;
  if (s.shot) {
    // afslutning: bolden på vej mod (eller i) mål
    const toRight = s.shot.team === 0;
    const inNet = s.shot.outcome === 'goal' || s.shot.outcome === 'offside';
    if ((s.shot.outcome as string) === 'post') {
      // på stolpen/overliggeren
      return { pos, ball: [toRight ? 99.6 : 0.4, 44.2], holder: undefined };
    }
    ball = s.shot.outcome === 'off' ? missSpot(toRight, s.moment) : [inNet ? (toRight ? 99.5 : 0.5) : toRight ? 96 : 4, 46 + hash01(s.moment, 14, 4) * 8];
  }
  return { pos, ball, holder };
}

const narrowQuery = '(max-width: 860px)';
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(narrowQuery).matches);
  useEffect(() => {
    const m = matchMedia(narrowQuery);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

function kitLuminance(color: string): number {
  let rgb: number[] | undefined;
  const value = color.trim();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  } else {
    const values = value.match(/\d+/g);
    if (values?.length && values.length >= 3) rgb = values.slice(0, 3).map(Number);
  }
  if (!rgb) return value.toLowerCase().includes('white') ? 1 : 0.35;
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

/** Straffesparkskonkurrencens tavle: hvert holds spark (✓ mål, ✕ brændt, ○ mangler af de første fem) */
export interface ShootoutTally { names: [string, string]; kicks: [string[], string[]] }

export function Pitch2D({ snap, me, colors, stepMs, shootout, weather, action }: {
  snap: Snap; me: number; colors: [string, string, string, string]; minute: string; banner: string; bannerCls: string; stepMs: number; flash?: string; shootout?: ShootoutTally; weather?: string; action?: MatchVisualAction;
}) {
  const s = snap;
  const spriteScope = useId().replace(/:/g, '');
  const [focusBall, setFocusBall] = useState(false);
  // på smalle skærme er banen lille – større spillere og navne, så de kan læses
  const narrow = useNarrow();
  const k = narrow ? 1.4 : 1;
  const playerSquash = narrow ? 0.76 : 0.48;
  const reducedMotion = useReducedMotion();
  const { pos, ball, holder } = useMemo(() => layout(s, 3.2 * k), [s, k]);
  const previousPositions = useRef<Map<number, [number, number]>>(new Map());
  const runningPlayers = useMemo(() => {
    const moving = new Set<number>();
    for (const [id, [x, y]] of pos) {
      const before = previousPositions.current.get(id);
      if (before && Math.hypot(x - before[0], y - before[1]) > 0.55) moving.add(id);
    }
    return moving;
  }, [pos]);
  useEffect(() => {
    previousPositions.current = new Map([...pos].map(([id, point]) => [id, [point[0], point[1]]]));
  }, [pos]);
  const [bx, by] = ball;
  // Players and the ball share the photographed grass as their playing surface.
  // The rear touchline is narrower in the stadium photo, so project x with mild perspective.
  const X = (x: number, y = 50) => {
    const depth = Math.max(0, Math.min(1, y / 100));
    return (x / 100) * W * (0.94 + depth * 0.06) + (1 - depth) * W * 0.03;
  };
  const Y = (y: number) => H * (0.125 + (y / 100) * 0.73);
  const cameraZoom = focusBall ? 1.08 : 1;
  const cameraX = X(bx, by);
  // Keep the camera centered on the photographed pitch instead of panning past the grass.
  const cameraY = Y(by);
  const cameraTransform = focusBall
    ? `translate(${W / 2 - cameraX * cameraZoom} ${H / 2 - cameraY * cameraZoom}) scale(${cameraZoom})`
    : undefined;
  const dur = `${Math.max(80, Math.min(900, stepMs))}ms`;
  const actionBallFrom = action ? action.ballFrom ?? action.from : undefined;
  const actionBallTo = action ? action.ballTo ?? action.to : undefined;
  const movingBall = action && actionBallFrom && actionBallTo
    && Math.hypot(actionBallTo[0] - actionBallFrom[0], actionBallTo[1] - actionBallFrom[1]) > 0.5 ? action : undefined;
  return (
    <div className={`pitch2d wx-${weather ?? 'clear'}`}>
      {(weather === 'rain' || weather === 'heavyRain' || weather === 'snow') && <div className="p2d-wx" aria-hidden />}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t('match.pitchAria')}>
        <g className="p2d-camera" transform={cameraTransform}>
        <image className="p2d-stadium" x="0" y="0" width={W} height={H} href={`${import.meta.env.BASE_URL}match-stadium.png`} preserveAspectRatio="none" />
        {s.players.map((p) => {
          const [x, y] = pos.get(p.id) ?? [p.dx, p.dy];
          const [bg, fg] = p.team === 0 ? [colors[0], colors[1]] : [colors[2], colors[3]];
          // The broadcast camera looks down from the far touchline, so nearer players should read larger.
          const depthScale = 0.74 + Math.max(0, Math.min(H, y)) / H * 0.34;
          const variation = p.id % 2 === 0 ? 'alt' : 'base';
          const whiteKit = kitLuminance(bg) > 0.62;
          const imageName = p.gk
            ? p.team === 0 ? 'match-goalkeeper-lime.png' : 'match-goalkeeper-orange.png'
            : whiteKit ? `match-player-white-${variation}.png` : `match-player-striped-${variation}.png`;
          const spriteUrl = `${import.meta.env.BASE_URL}${imageName}`;
          const runSpriteUrl = `${import.meta.env.BASE_URL}${whiteKit ? 'match-run-white.png' : 'match-run-striped.png'}`;
          const shotSpriteUrl = `${import.meta.env.BASE_URL}${whiteKit ? 'match-action-shot-white.png' : 'match-action-shot-striped.png'}`;
          const passSpriteUrl = `${import.meta.env.BASE_URL}${whiteKit ? 'match-action-pass-white.png' : 'match-action-pass-striped.png'}`;
          const tackleSpriteUrl = `${import.meta.env.BASE_URL}${whiteKit ? 'match-action-tackle-white.png' : 'match-action-tackle-striped.png'}`;
          const celebrationSpriteUrl = `${import.meta.env.BASE_URL}${whiteKit ? 'match-action-celebration-white.png' : 'match-action-celebration-striped.png'}`;
          const longBallSpriteUrl = `${import.meta.env.BASE_URL}${whiteKit ? 'match-action-longball-white.png' : 'match-action-longball-striped.png'}`;
          const crossSpriteUrl = `${import.meta.env.BASE_URL}${whiteKit ? 'match-action-cross-white.png' : 'match-action-cross-striped.png'}`;
          const acting = action?.actor === p.id ? action.kind : undefined;
          const receiving = action?.target === p.id;
          const celebrating = s.shot?.outcome === 'goal' && s.holder === p.id;
          const keeperResponding = p.gk && action?.kind === 'shot' && action.target === p.id;
          const keeperDiving = keeperResponding && !reducedMotion && (action?.outcome === 'saved' || action?.outcome === 'goal');
          const keeperRecovering = p.gk && action?.kind === 'keeper' && action.actor === p.id && action.outcome === 'held';
          const diveLeft = keeperDiving && (action.ballTo ?? action.to)[0] < x;
          const keeperDiveSpriteUrl = `${import.meta.env.BASE_URL}${p.team === 0 ? 'match-gk-dive-lime.png' : 'match-gk-dive-orange.png'}`;
          const displayedSpriteUrl = keeperDiving ? keeperDiveSpriteUrl : spriteUrl;
          const spriteWidth = keeperDiving ? 6.4 * k : 4.2 * k;
          const spriteHeight = keeperDiving ? 3.6 * k : 5.3 * k;
          // Keep the body upright while players face their team's attacking direction.
          const spriteFacing = keeperDiving ? (diveLeft ? -1 : 1) : p.team === 0 ? 1 : -1;
          const shotPose = !p.gk && acting === 'shot';
          const passPose = !p.gk && ['pass', 'throughBall'].includes(acting ?? '');
          const tacklePose = !p.gk && acting === 'tackle';
          const celebrationPose = !p.gk && celebrating;
          const longBallPose = !p.gk && acting === 'longBall';
          const crossPose = !p.gk && acting === 'cross';
          const dedicatedPose = celebrationPose ? 'celebration' : shotPose ? 'shot' : passPose ? 'pass' : tacklePose ? 'tackle' : crossPose ? 'cross' : longBallPose ? 'longball' : undefined;
          const dedicatedPoseUrl = celebrationPose ? celebrationSpriteUrl : shotPose ? shotSpriteUrl : passPose ? passSpriteUrl : tacklePose ? tackleSpriteUrl : crossPose ? crossSpriteUrl : longBallSpriteUrl;
          const actionRun = (action?.actor === p.id && action.kind === 'dribble')
            || (action?.target === p.id && ['longBall', 'throughBall', 'cross', 'rebound', 'deflection', 'keeper', 'looseBall'].includes(action.kind));
          const running = !p.gk && !dedicatedPose && (runningPlayers.has(p.id) || actionRun);
          const idle = !running && !acting && !celebrating && !keeperResponding;
          return (
            <g key={p.id} className={`p2d-player${p.team === me ? ' managed' : ''}${acting ? ' acting' : ''}${receiving ? ' receiving' : ''}${celebrating ? ' celebrating' : ''}${keeperResponding ? ' keeper-responding' : ''}`} data-action={acting} data-action-outcome={action?.actor === p.id ? action.outcome : undefined} data-keeper-outcome={keeperResponding ? action?.outcome : undefined} style={{ transform: `translate(${X(x, y)}px, ${Y(y)}px)`, transitionDuration: reducedMotion ? '0ms' : dur }}>
              <title>{p.name}</title>
              {receiving && <ellipse className="p2d-receive-ring" rx={1.9 * k * depthScale} ry={2.3 * k * depthScale} fill="none" stroke="#a5f3fc" strokeWidth={0.38 * k * depthScale}>
                {!reducedMotion && <animate attributeName="opacity" values="0.25;1;0.25" dur="520ms" repeatCount="1" />}
              </ellipse>}
              {p.id === holder?.id && <ellipse rx={1.72 * k * depthScale} ry={2.15 * k * depthScale} fill="none" stroke="#fff4b0" strokeWidth={0.28 * k * depthScale} opacity="0.9" />}
              <g transform={`scale(${playerSquash * depthScale * spriteFacing} ${depthScale})`}>
                {keeperRecovering ? reducedMotion ? (
                  <image className="p2d-sprite" x={-spriteWidth / 2} y={-spriteHeight / 2} width={spriteWidth} height={spriteHeight} href={spriteUrl} preserveAspectRatio="xMidYMid meet" />
                ) : (
                  <>
                    <image key={`keeper-down-${action?.moment}`} className="p2d-sprite keeper-down" x={-spriteWidth / 2} y={-spriteHeight / 2} width={6.4 * k} height={3.6 * k} href={keeperDiveSpriteUrl} preserveAspectRatio="xMidYMid meet" />
                    <image key={`keeper-recover-${action?.moment}`} className="p2d-sprite keeper-recovering" x={-spriteWidth / 2} y={-spriteHeight / 2} width={spriteWidth} height={spriteHeight} href={spriteUrl} preserveAspectRatio="xMidYMid meet" />
                  </>
                ) : dedicatedPose ? reducedMotion ? (
                  <image key={`${dedicatedPose}-${action?.moment}`} className={`p2d-sprite ${dedicatedPose}-pose`} x={-spriteWidth / 2} y={-spriteHeight / 2} width={spriteWidth} height={spriteHeight} href={dedicatedPoseUrl} preserveAspectRatio="xMidYMid meet" />
                ) : (
                  <>
                    <image key={`${dedicatedPose}-set-${action?.moment}`} className={`p2d-sprite ${dedicatedPose}-prep`} x={-spriteWidth / 2} y={-spriteHeight / 2} width={spriteWidth} height={spriteHeight} href={spriteUrl} preserveAspectRatio="xMidYMid meet" />
                    <image key={`${dedicatedPose}-${action?.moment}`} className={`p2d-sprite ${dedicatedPose}-pose`} x={-spriteWidth / 2} y={-spriteHeight / 2} width={spriteWidth} height={spriteHeight} href={dedicatedPoseUrl} preserveAspectRatio="xMidYMid meet" />
                  </>
                ) : running && !reducedMotion ? (
                  <>
                    <defs>
                      <clipPath id={`${spriteScope}-run-${p.id}`} clipPathUnits="userSpaceOnUse">
                        <rect x={-((5.3 * k * 256 / 384) / 2)} y={-2.65 * k} width={5.3 * k * 256 / 384} height={5.3 * k} />
                      </clipPath>
                    </defs>
                    <g clipPath={`url(#${spriteScope}-run-${p.id})`}>
                      <image key={`run-${p.id}`} className="p2d-sprite running" x={-((5.3 * k * 256 / 384) / 2)} y={-2.65 * k} width={5.3 * k * 256 / 384} height={15.9 * k} href={runSpriteUrl} preserveAspectRatio="none">
                        <animate attributeName="y"
                          values={`${-2.65 * k};${-7.95 * k};${-13.25 * k}`}
                          dur="540ms" repeatCount="indefinite" calcMode="discrete" />
                      </image>
                    </g>
                  </>
                ) : keeperDiving ? (
                  <>
                    <image className="p2d-sprite keeper-set" x={-(4.2 * k) / 2} y={-(5.3 * k) / 2} width={4.2 * k} height={5.3 * k} href={spriteUrl} preserveAspectRatio="xMidYMid meet" />
                    <image key={`dive-${action?.moment}`} className="p2d-sprite reacting keeper-diving" x={-spriteWidth / 2} y={-spriteHeight / 2} width={spriteWidth} height={spriteHeight} href={displayedSpriteUrl} preserveAspectRatio="xMidYMid meet" />
                  </>
                ) : (
                  <image key={p.id} className={`p2d-sprite${idle ? ' idle' : ''}`} x={-spriteWidth / 2} y={-spriteHeight / 2} width={spriteWidth} height={spriteHeight} href={spriteUrl} preserveAspectRatio="xMidYMid meet" />
                )}
                {!keeperDiving && <text transform={`scale(${p.team === 0 ? 1 : -1} 1)`} y={0.32 * k} textAnchor="middle" fontSize={0.68 * k} fontWeight="900" fill={fg} stroke="rgba(0,0,0,.32)" strokeWidth="0.12" paintOrder="stroke">{p.num}</text>}
              </g>
              {p.id === holder?.id && <text y={-2.7 * k * depthScale} textAnchor="middle" fontSize={1.9 * k * depthScale} fontWeight="700" fill="#fff" stroke="rgba(0,0,0,0.6)" strokeWidth="0.25" paintOrder="stroke">{p.name}</text>}
            </g>
          );
        })}
        <g className="p2d-ball" transform={`translate(${movingBall ? 0 : X(bx, by)} ${movingBall ? 0 : Y(by)})`}>
          <image x={-0.4 * Math.sqrt(k)} y={-0.4 * Math.sqrt(k)} width={0.8 * Math.sqrt(k)} height={0.8 * Math.sqrt(k)} href={`${import.meta.env.BASE_URL}match-ball.png`} preserveAspectRatio="xMidYMid meet" />
          {movingBall && !reducedMotion && (
            <animateMotion
              key={`${movingBall.moment}-${movingBall.kind}-${movingBall.actor}-${movingBall.target ?? 0}-${movingBall.outcome}-${movingBall.ballFrom?.join(',') ?? ''}-${movingBall.ballTo?.join(',') ?? ''}`}
              path={`M ${X((movingBall.ballFrom ?? movingBall.from)[0], (movingBall.ballFrom ?? movingBall.from)[1])} ${Y((movingBall.ballFrom ?? movingBall.from)[1])} L ${X((movingBall.ballTo ?? movingBall.to)[0], (movingBall.ballTo ?? movingBall.to)[1])} ${Y((movingBall.ballTo ?? movingBall.to)[1])}`}
              dur={`${Math.max(120, Math.min(650, stepMs))}ms`}
              fill="freeze"
            />
          )}
        </g>
        </g>
      </svg>
      <div className="p2d-topmeta">
        {holder && <div className="p2d-poss" style={{ background: s.poss === 0 ? colors[0] : colors[2], color: s.poss === 0 ? colors[1] : colors[3] }}>⚽ {holder.name}</div>}
        <button type="button" className="p2d-camera-control" aria-pressed={focusBall} onClick={() => setFocusBall((value) => !value)}>
          {t(focusBall ? 'match.camera.full' : 'match.camera.focus')}
        </button>
      </div>
      {shootout && (
        <div className="p2d-so">
          {[0, 1].map((tm) => (
            <div key={tm}>
              <span className="p2d-so-name" style={{ background: tm === 0 ? colors[0] : colors[2], color: tm === 0 ? colors[1] : colors[3] }}>{shootout.names[tm]}</span>
              {[...shootout.kicks[tm], ...new Array(Math.max(0, 5 - shootout.kicks[tm].length)).fill('')].map((o, i) => (
                <span key={i} className={`p2d-so-k ${o === 'goal' ? 'good' : o ? 'bad' : ''}`}>{o === 'goal' ? '✓' : o ? '✕' : '○'}</span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * En chance som korte 2D-billeder: opspil på midtbanen → aflevering → afslutning → udfald.
 * Bygget ud fra motorens registrerede skud, så det, man ser, er præcis det, der skete.
 */
export function highlightFrames(base: Snap, shot: ShotRecord, assister?: number): Snap[] {
  const team = shot.t;
  const lane = shot.zone % 3;
  const abs = (rb: number) => (team === 0 ? rb : 4 - rb);
  const mates = base.players.filter((p) => p.team === team && !p.gk);
  // opspilleren: en midtbanespiller (tættest på midten) – afleveringen: assistgiveren eller en offensiv holdkammerat
  const mid = mates.slice().sort((a, b) => Math.abs((a.dx + a.ax) / 2 - 50) - Math.abs((b.dx + b.ax) / 2 - 50))[0];
  const fwd = (assister && mates.find((p) => p.id === assister)) || mates.filter((p) => p.id !== shot.p).sort((a, b) => (team === 0 ? b.ax - a.ax : a.ax - b.ax))[0];
  const f = (rb: number, l: number, holder: number | undefined, k: number, sh: Snap['shot'] = null): Snap => ({ ...base, poss: team, zone: abs(rb) * 3 + l, holder: holder ?? shot.p, moment: base.moment * 10 + k, shot: sh });
  if (shot.corner) {
    const cn = (step: number, sh: Snap['shot'] = null): Snap => ({ ...f(4, lane, step === 0 ? shot.corner : shot.p, step, sh), corner: { team, lane: lane === 1 ? 0 : lane, taker: shot.corner!, target: shot.p, step } } as CornerSnap);
    return [cn(0), cn(1), cn(2, { team, outcome: shot.outcome, zone: shot.zone })];
  }
  const out: Snap['shot'] = { team, outcome: (shot.post ? 'post' : shot.outcome) as Snap['shot'] extends infer X ? X extends { outcome: infer O } ? O : never : never, zone: shot.zone };
  const wl = lane === 1 ? (hash01(base.moment, shot.p, 9) < 0.5 ? 0 : 2) : lane;
  if (shot.kind === 'fk') {
    const fy = 50 + (hash01(base.moment, shot.p, 11) - 0.5) * 22;
    const fk = (step: number, sh: Snap['shot'] = null): Snap => ({ ...f(3, 1, shot.p, step, sh), fk: team, fkStep: step, fkY: fy } as FkSnap);
    return [fk(0), fk(1), fk(2, out)];
  }
  // oprindelsen afgør, hvordan aktionen bygges op (taktik og attributter bag chancen)
  switch (shot.origin) {
    case 'counter': return [f(1, 1, shot.p, 1), f(2, 1, shot.p, 2), f(3, 1, shot.p, 3), f(4, 1, shot.p, 4), f(4, 1, shot.p, 5, out)];
    case 'through': return [f(2, 1, fwd?.id === shot.p ? mid?.id : (assister ?? mid?.id), 1), f(3, 1, shot.p, 2), f(4, 1, shot.p, 3), f(4, 1, shot.p, 4, out)];
    case 'cross': return [f(3, wl, assister ?? fwd?.id, 1), f(4, wl, assister ?? fwd?.id, 2), f(4, 1, shot.p, 3), f(4, 1, shot.p, 4, out)];
    case 'dribble': return [f(3, lane, shot.p, 1), f(4, lane, shot.p, 2), f(4, 1, shot.p, 3), f(4, 1, shot.p, 4, out)];
    case 'press': {
      // modstanderen har bolden i sit eget felt – presset tvinger fejlen frem
      const opp = base.players.find((p) => p.team !== team && !p.gk)?.id;
      return [{ ...f(4, lane, opp, 1), poss: 1 - team }, f(4, lane, shot.p, 2), f(4, 1, shot.p, 3, out)];
    }
  }
  if (shot.kind === 'cutback') return [f(3, wl, assister ?? fwd?.id, 1), f(4, wl, assister ?? fwd?.id, 2), f(4, 1, shot.p, 3), f(4, 1, shot.p, 4, out)];
  if (shot.kind === 'long') return [f(2, lane, mid?.id, 1), f(3, 1, shot.p, 2), f(3, 1, shot.p, 3, out)];
  if (shot.kind === 'pen') {
    const pen = (step: number, sh: Snap['shot'] = null): Snap => ({ ...f(4, 1, shot.p, step, sh), pen: team, penStep: step } as PenSnap);
    return [pen(0), pen(1), pen(2, { team, outcome: shot.outcome, zone: shot.zone })];
  }
  return [
    f(2, lane === 1 ? 1 : lane, mid?.id, 1),
    f(3, lane, fwd?.id, 2),
    f(4, lane, shot.p, 3),
    f(4, lane, shot.p, 4, out),
  ];
}

/** Et spark i straffesparkskonkurrencen: skytten lægger bolden → tilløb → udfald */
export function shootoutFrames(base: Snap, k: { t: number; p: number; outcome: string }): Snap[] {
  const pen = (step: number, sh: Snap['shot'] = null): Snap => ({ ...base, poss: k.t, zone: 13, holder: k.p, moment: base.moment * 10 + step, shot: sh, pen: k.t, penStep: step, so: true } as PenSnap);
  return [pen(0), pen(1), pen(2, { team: k.t, outcome: k.outcome as NonNullable<Snap['shot']>['outcome'], zone: 13 })];
}

/** Mellem sparkene i straffesparkskonkurrencen: alle i midtercirklen, bolden på pletten */
export function shootoutIdle(base: Snap, next: number): Snap {
  return { ...base, poss: next, zone: 13, holder: 0, shot: null, pen: next, penStep: 0, so: true } as PenSnap;
}

/** Et hjørnespark uden afslutning: klar ved flaget → indlæg → forsvaret rydder */
export function cornerFrames(base: Snap, c: { t: number; taker: number; lane: number }): Snap[] {
  const cn = (step: number): Snap => ({ ...base, poss: c.t, holder: c.taker, moment: base.moment * 10 + step, shot: null, corner: { team: c.t, lane: c.lane, taker: c.taker, step, cleared: true } } as CornerSnap);
  return [cn(0), cn(1), cn(2)];
}

/** Redningstackling: løberen er alene mod målmanden – den sidste forsvarer glider ind og tager bolden */
export function lastDitchFrames(base: Snap, h: { t: number; p: number; p2: number }): Snap[] {
  const abs = (rb: number) => (h.t === 0 ? rb : 4 - rb);
  const f = (rb: number, holder: number, poss: number, k: number): Snap => ({ ...base, poss, zone: abs(rb) * 3 + 1, holder, moment: base.moment * 10 + k, shot: null });
  return [f(3, h.p, h.t, 1), f(4, h.p, h.t, 2), f(4, h.p2, 1 - h.t, 3)];
}

/** Offside: afleveringen spilles frem, løberen er for tidligt af sted – linjevogteren løfter flaget */
export function offsideFrames(base: Snap, h: { t: number; p: number; p2: number }): Snap[] {
  const abs = (rb: number) => (h.t === 0 ? rb : 4 - rb);
  const f = (rb: number, holder: number, k: number): Snap => ({ ...base, poss: h.t, zone: abs(rb) * 3 + 1, holder, moment: base.moment * 10 + k, shot: null });
  return [f(2, h.p2, 1), f(4, h.p, 2)];
}

/** Frispark med kort eller en skade: modstanderen har bolden, og situationen stopper op */
export function incidentFrames(base: Snap, e: { t: number; p: number }): Snap[] {
  // den anden part har bolden et sted på midten af banen
  const victimTeam = 1 - e.t;
  const rb = 2;
  const abs = victimTeam === 0 ? rb : 4 - rb;
  const f = (k: number): Snap => ({ ...base, poss: victimTeam, zone: abs * 3 + 1, holder: 0, moment: base.moment * 10 + k, shot: null });
  return [f(1), f(2)];
}
