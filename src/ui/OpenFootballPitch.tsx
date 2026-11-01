import { useEffect, useRef, useState } from 'react';
import type { MatchPitchSnapshot, MatchVisualAction } from '../game/types';
import { formationLayout } from '../game/match-pitch';
import { actionMomentWindows, OpenFootballStateTimeline, toOpenFootballRecordingEvents } from './openFootballRecording';
import type { OpenFootballSetup } from './openFootballSetup';
import { OPEN_FOOTBALL_MATCH_DURATION_MS, openFootballTimestamp } from './openFootballTimeline';

const VIEWER_READY_TIMEOUT_MS = 60_000;

export interface OpenFootballBridge {
  push(
    snapshots: readonly MatchPitchSnapshot[],
    goals: readonly { player_id: number; time: number; is_auto_goal: boolean }[],
    actions: readonly MatchVisualAction[],
  ): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  setDuration(durationMs: number): void;
  setHostTime(timeMs: number): void;
}

type ViewerModule = {
  default: (input: URL) => Promise<unknown>;
  MatchViewer: {
    start: (config: string) => void;
    pushRecording: (recording: string) => void;
    setPlaying: (playing: boolean) => void;
    setSpeed: (speed: number) => void;
    setDuration: (durationMs: number) => void;
    setHostTime: (timeMs: number) => void;
  };
};

function point([x, y]: [number, number]): [number, number] {
  return [Math.max(0, Math.min(840, x * 8.4)), Math.max(0, Math.min(545, y * 5.45))];
}

export function OpenFootballPitch({
  id,
  setup,
  playing,
  speed,
  onBridge,
  onReady,
  onFailure,
}: {
  id: number;
  setup: OpenFootballSetup;
  playing: boolean;
  speed: number;
  onBridge: (bridge: OpenFootballBridge | null) => void;
  onReady: (ready: boolean) => void;
  onFailure: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bridgeRef = useRef<OpenFootballBridge | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let ready = false;
    let failureReported = false;
    let timedOut = false;
    let viewerStarted = false;
    let readyTimeout: number | undefined;
    let bridge: OpenFootballBridge | null = null;
    const attitudeTimeline = new OpenFootballStateTimeline();
    const progress = (event: Event) => {
      if ((event as CustomEvent<{ phase?: string }>).detail?.phase !== 'ready' || cancelled || ready) return;
      ready = true;
      if (readyTimeout !== undefined) window.clearTimeout(readyTimeout);
      setReady(true);
      onReady(true);
    };
    const fail = (error: unknown) => {
      if (cancelled || ready || failureReported) return;
      failureReported = true;
      if (readyTimeout !== undefined) window.clearTimeout(readyTimeout);
      console.error('Open Football viewer failed to become ready', error);
      onFailure();
    };
    document.addEventListener('match-viewer-progress', progress);
    readyTimeout = window.setTimeout(() => {
      // Do not start Bevy after its caller has already been told startup timed
      // out. If Bevy has started, keep listening: a slow device can still
      // finish later and recover the waiting match without a second app.
      timedOut = !viewerStarted;
      fail(new Error(`Viewer startup exceeded ${VIEWER_READY_TIMEOUT_MS} ms`));
    }, VIEWER_READY_TIMEOUT_MS);
    const start = async () => {
      const base = `${import.meta.env.BASE_URL}open-football-viewer/`;
      const viewer = await import(/* @vite-ignore */ `${base}match_viewer.js`) as ViewerModule;
      const wasmUrl = new URL(`${base}match_viewer_bg.wasm`, document.baseURI);
      await viewer.default(wasmUrl);
      if (cancelled || timedOut || !canvas.current) return;

      const initial = makeInitialRecording(setup.initialSnapshot);
      const config = makeConfig(initial, setup, `#tactica-of-${id}`);
      config.renderer = await preferredRenderer();
      if (cancelled || timedOut || !canvas.current) return;
      viewerStarted = true;
      viewer.MatchViewer.start(JSON.stringify(config));
      viewer.MatchViewer.setHostTime(0);

      let previousSnapshotTime = 0;
      let previousHostTime = 0;
      let previousBallTime = 0;
      const previousPlayerTimes = new Map<number, number>();
      const previousPlayerPositions = new Map<number, { team: number; x: number; y: number; moment: number }>();
      const lastMovementCueTimes = new Map<number, number>();
      let previousBallPosition: { x: number; y: number; moment: number } | undefined;
      bridge = {
        push(snapshots, goals, actions) {
          if (cancelled || snapshots.length === 0) return;
          const ball: number[][] = [];
          const players: Record<number, number[][]> = {};
          // A step may resolve a pass and shot (or a cross and header) before
          // producing its single final snapshot. Spread those action paths
          // through that step so the viewer receives each real contact in order.
          const orderedActions = actions
            .map((action, index) => ({ action, index }))
            .sort((left, right) => left.action.moment - right.action.moment || left.index - right.index)
            .map(({ action }) => action);
          const actionWindows = actionMomentWindows(orderedActions);
          const actionMoments = actionWindows.map((window) => window.event);
          const actionEnds = new Set(orderedActions.map((action) => action.moment + 1));
          const ballSamples: { moment: number; point: [number, number] }[] = [];
          const playerSamples: { id: number; moment: number; point: [number, number] }[] = [];
          const movementStates: Record<number, [number, string][]> = {};
          const orderedSnapshots = snapshots
            .map((snapshot, index) => ({ snapshot, index }))
            .sort((left, right) => left.snapshot.moment - right.snapshot.moment || left.index - right.index)
            .map(({ snapshot }) => snapshot);
          for (const [index, action] of orderedActions.entries()) {
            const window = actionWindows[index];
            const startMoment = window.start + 0.001;
            if (action.ballFrom) ballSamples.push({ moment: startMoment, point: point(action.ballFrom) });
            if (action.ballTo) ballSamples.push({ moment: window.end, point: point(action.ballTo) });
            playerSamples.push({ id: action.actor, moment: startMoment, point: point(action.from) });
            if (['dribble', 'tackle', 'turnover', 'deflection', 'looseBall'].includes(action.kind)) {
              playerSamples.push({ id: action.actor, moment: window.end, point: point(action.to) });
            }
            if (action.target !== undefined && ['pass', 'longBall', 'throughBall', 'cross'].includes(action.kind)) {
              playerSamples.push({ id: action.target, moment: window.end, point: point(action.to) });
            }
          }
          for (const snapshot of orderedSnapshots) {
            const time = openFootballTimestamp(snapshot.moment, setup.totalMoments);
            if (time <= previousSnapshotTime) continue;
            const layout = formationLayout(snapshot);
            for (const [pid, pos] of layout.pos) {
              playerSamples.push({ id: pid, moment: snapshot.moment, point: point(pos) });
            }
            const stepScale = 240 * (snapshot.moment - (previousBallPosition?.moment ?? snapshot.moment)) / Math.max(1, setup.totalMoments);
            const movementThreshold = Math.max(0.12, stepScale * 0.3);
            for (const player of snapshot.players) {
              const current = layout.pos.get(player.id);
              if (!current) continue;
              const previous = previousPlayerPositions.get(player.id);
              if (previous && snapshot.moment > previous.moment && !player.gk && player.id !== snapshot.holder) {
                const attackDirection = player.team === 0 ? 1 : -1;
                const forwardRun = player.team === snapshot.poss
                  && (current[0] - previous.x) * attackDirection > movementThreshold;
                const closingDown = player.team !== snapshot.poss && previousBallPosition
                  && Math.hypot(previous.x - previousBallPosition.x, previous.y - previousBallPosition.y)
                    - Math.hypot(current[0] - previousBallPosition.x, current[1] - previousBallPosition.y) > movementThreshold;
                const cue = forwardRun ? 'Supporting Attack' : closingDown ? 'Pressing' : undefined;
                const lastCueAt = lastMovementCueTimes.get(player.id) ?? -Infinity;
                if (cue && time - lastCueAt >= 2_400) {
                  (movementStates[player.id] ??= []).push([time, `TACTICA: ${cue}`]);
                  lastMovementCueTimes.set(player.id, time);
                }
              }
              previousPlayerPositions.set(player.id, { team: player.team, x: current[0], y: current[1], moment: snapshot.moment });
            }
            previousBallPosition = { x: layout.ball[0], y: layout.ball[1], moment: snapshot.moment };
            if (!actionEnds.has(snapshot.moment)) ballSamples.push({ moment: snapshot.moment, point: point(layout.ball) });
            previousSnapshotTime = time;
          }
          playerSamples.sort((a, b) => a.moment - b.moment);
          for (const sample of playerSamples) {
            const time = openFootballTimestamp(sample.moment, setup.totalMoments);
            if (time <= (previousPlayerTimes.get(sample.id) ?? 0)) continue;
            (players[sample.id] ??= []).push([time, sample.point[0], sample.point[1]]);
            previousPlayerTimes.set(sample.id, time);
          }
          ballSamples.sort((a, b) => a.moment - b.moment);
          for (const sample of ballSamples) {
            const time = openFootballTimestamp(sample.moment, setup.totalMoments);
            if (time <= previousBallTime) continue;
            ball.push([time, sample.point[0], sample.point[1], 0]);
            previousBallTime = time;
          }
          const { events, states } = toOpenFootballRecordingEvents(orderedActions, setup.totalMoments, actionMoments);
          for (const [playerId, entries] of Object.entries(movementStates)) {
            states[Number(playerId)] = [...entries, ...(states[Number(playerId)] ?? [])];
          }
          const liveStates = attitudeTimeline.apply(states);
          if (ball.length || Object.keys(players).length || goals.length || events.length || Object.keys(liveStates).length) {
            viewer.MatchViewer.pushRecording(JSON.stringify({ ball, players, goals, events, states: liveStates }));
            // Use the newest accepted snapshot, not the raw batch tail. Delayed
            // or reordered polls must never move the viewer's playback ceiling back.
            if (previousSnapshotTime > previousHostTime) {
              viewer.MatchViewer.setHostTime(previousSnapshotTime);
              previousHostTime = previousSnapshotTime;
            }
          }
        },
        setPlaying(value) { viewer.MatchViewer.setPlaying(value); },
        setSpeed(value) { viewer.MatchViewer.setSpeed(value); },
        setDuration(value) { viewer.MatchViewer.setDuration(value); },
        setHostTime(value) { viewer.MatchViewer.setHostTime(value); },
      };
      bridgeRef.current = bridge;
      bridge.setSpeed(speed);
      bridge.setPlaying(playing);
      onBridge(bridge);
    };
    void start().catch(fail);
    return () => {
      cancelled = true;
      if (readyTimeout !== undefined) window.clearTimeout(readyTimeout);
      bridge?.setPlaying(false);
      bridgeRef.current = null;
      document.removeEventListener('match-viewer-progress', progress);
      setReady(false);
      onReady(false);
      onBridge(null);
    };
    // This is a match-scoped WASM app. The prepared presentation setup is stable for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, setup]);

  useEffect(() => { bridgeRef.current?.setPlaying(playing); }, [playing]);
  useEffect(() => { bridgeRef.current?.setSpeed(speed); }, [speed]);

  return <canvas id={`tactica-of-${id}`} ref={canvas} className="open-football-canvas" style={{ visibility: ready ? 'visible' : 'hidden' }} aria-label="Live match presentation" />;
}

function makeInitialRecording(snapshot: MatchPitchSnapshot) {
  const layout = formationLayout(snapshot);
  const players: Record<number, number[][]> = {};
  for (const [pid, pos] of layout.pos) {
    const [x, y] = point(pos);
    players[pid] = [[0, x, y]];
  }
  const [x, y] = point(layout.ball);
  return { ball: [[0, x, y, 0]], players, events: [], states: {} };
}

async function preferredRenderer(): Promise<'webgpu' | 'webgl2'> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown | null> } }).gpu;
  if (!gpu) return 'webgl2';
  try {
    return (await gpu.requestAdapter()) ? 'webgpu' : 'webgl2';
  } catch {
    return 'webgl2';
  }
}

function makeConfig(initial: ReturnType<typeof makeInitialRecording>, setup: OpenFootballSetup, selector: string) {
  return {
    canvas: selector,
    renderer: 'webgl2' as 'webgpu' | 'webgl2',
    api_base: '',
    inline_recording: JSON.stringify(initial),
    embedded: true,
    match_time_ms: OPEN_FOOTBALL_MATCH_DURATION_MS,
    home: setup.homeColor,
    away: setup.awayColor,
    home_name: setup.homeName,
    away_name: setup.awayName,
    players: setup.players,
    lineup: false,
    goals: [],
    chances: [],
    substitutions: [],
    debug: false,
    perf: false,
    labels: { first_half: '1st', second_half: '2nd', loading: '', no_recording: '', full_time: '', substitutes: '' },
  };
}
