import { useEffect, useRef, useState } from 'react';
import type { MatchPitchSnapshot, MatchVisualAction } from '../game/types';
import { formationLayout } from '../game/match-pitch';
import { actionMomentWindows, actionPresentationWindows, OpenFootballStateTimeline, narratedActionIndexes, toOpenFootballBallTracks, toOpenFootballNarrationTracks, toOpenFootballPlayerTracks, toOpenFootballRecordingEvents, type OpenFootballNarrationCue } from './openFootballRecording';
import type { OpenFootballSetup } from './openFootballSetup';
import { OPEN_FOOTBALL_MATCH_DURATION_MS, openFootballTimestamp } from './openFootballTimeline';

const VIEWER_READY_TIMEOUT_MS = 60_000;
const VIEWER_STOP_TIMEOUT_MS = 20_000;
let nextViewerSessionId = 1;
let pendingViewerStop: { viewer: ViewerModule; sessionId: number } | null = null;

export interface OpenFootballBridge {
  push(
    snapshots: readonly MatchPitchSnapshot[],
    goals: readonly { player_id: number; time: number; is_auto_goal: boolean }[],
    actions: readonly MatchVisualAction[],
    narration: readonly OpenFootballNarrationCue[],
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
    stop: (sessionId: number) => void;
    isRunning: (sessionId: number) => boolean;
    pushRecording: (recording: string) => void;
    setPlaying: (playing: boolean) => void;
    setSpeed: (speed: number) => void;
    setDuration: (durationMs: number) => void;
    setHostTime: (timeMs: number) => void;
  };
};

async function waitForPreviousViewerStop() {
  const pending = pendingViewerStop;
  if (!pending) return;
  const deadline = Date.now() + VIEWER_STOP_TIMEOUT_MS;
  while (pending.viewer.MatchViewer.isRunning(pending.sessionId)) {
    if (Date.now() >= deadline) {
      throw new Error('The previous match viewer did not stop; refusing to open a second viewer.');
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  if (pendingViewerStop === pending) pendingViewerStop = null;
}

export interface OpenFootballProgress {
  phase: 'starting' | 'building' | 'recording' | 'squad' | 'ready';
  done: number;
  total: number;
}

function point([x, y]: [number, number]): [number, number] {
  return [Math.max(0, Math.min(840, x * 8.4)), Math.max(0, Math.min(545, y * 5.45))];
}

/**
 * Keep the ball visibly in flight between the real action endpoints. The
 * engine decides every endpoint and outcome; these extra samples only shape
 * the path the viewer draws between them.
 */
function ballPath(action: MatchVisualAction, start: number, end: number) {
  const from = point(action.ballFrom ?? action.from);
  const to = point(action.ballTo ?? action.to);
  const lift = action.kind === 'cross' || action.kind === 'longBall' ? 3.2 : action.kind === 'shot' ? 1.35 : 0.12;
  const distanceMeters = Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.125;
  const targetPace = action.kind === 'shot' ? 25 : action.kind === 'longBall' ? 22 : action.kind === 'cross' ? 20 : 18;
  // Open Football reads ball contacts on 30 ms probes. A dense, plausible
  // track lets it infer the kick, flight and reception instead of treating
  // one large endpoint jump as a placement/teleport.
  const launch = Math.ceil((start + 100) / 30) * 30;
  const duration = Math.min(Math.max(30, end - launch), Math.max(300, distanceMeters / targetPace * 1000));
  const arrival = launch + duration;
  const firstProbe = launch;
  const lastProbe = Math.floor(arrival / 30) * 30;
  const span = Math.max(30, lastProbe - firstProbe);
  const samples: { moment: number; point: [number, number]; height: number }[] = [];
  // A short, stationary pre-contact run gives the viewer enough history for
  // its 150 ms backswing detector. The ball starts at the real action origin.
  for (let time = Math.max(0, firstProbe - 180); time < firstProbe; time += 30) {
    samples.push({ moment: time, point: from, height: 0 });
  }
  for (let time = firstProbe; time <= lastProbe; time += 30) {
    const progress = Math.max(0, Math.min(1, (time - firstProbe) / span));
    // Smooth acceleration off the boot and deceleration into the receiver.
    const eased = progress * progress * (3 - 2 * progress);
    const arc = 4 * progress * (1 - progress) * lift;
    samples.push({
      moment: time,
      point: [from[0] + (to[0] - from[0]) * eased, from[1] + (to[1] - from[1]) * eased],
      height: arc,
    });
  }
  samples.push({ moment: arrival, point: to, height: 0 });
  for (let time = Math.ceil(arrival / 30) * 30; time < end; time += 30) {
    samples.push({ moment: time, point: to, height: 0 });
  }
  samples.push({ moment: end, point: to, height: 0 });
  return { samples, arrival };
}

export function OpenFootballPitch({
  id,
  setup,
  playing,
  speed,
  onBridge,
  onReady,
  onProgress,
  onNarration,
  onFailure,
}: {
  id: number;
  setup: OpenFootballSetup;
  playing: boolean;
  speed: number;
  onBridge: (bridge: OpenFootballBridge | null) => void;
  onReady: (ready: boolean) => void;
  onProgress: (progress: OpenFootballProgress) => void;
  onNarration: (line: { text: string; minute: number; moment: number; hg: number; ag: number } | null) => void;
  onFailure: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bridgeRef = useRef<OpenFootballBridge | null>(null);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const [ready, setReady] = useState(false);
  playingRef.current = playing;
  speedRef.current = speed;

  useEffect(() => {
    let cancelled = false;
    let ready = false;
    let failureReported = false;
    let timedOut = false;
    let viewerStarted = false;
    let viewer: ViewerModule | null = null;
    let sessionId: number | undefined;
    let readyTimeout: number | undefined;
    let bridge: OpenFootballBridge | null = null;
    const attitudeTimeline = new OpenFootballStateTimeline();
    const narrationTracks: { at: number; moment: number; minute: number; text: string; hg: number; ag: number }[] = [];
    let playbackHead = 0;
    let hostCeiling = 0;
    let lastClock = performance.now();
    let lastNarrationKey = '';
    let narrationFrame = 0;
    const progress = (event: Event) => {
      if (cancelled) return;
      const detail = (event as CustomEvent<Partial<OpenFootballProgress>>).detail;
      const phase = detail?.phase;
      if (phase === 'starting' || phase === 'building' || phase === 'recording' || phase === 'squad' || phase === 'ready') {
        onProgress({ phase, done: Number(detail.done) || 0, total: Number(detail.total) || 0 });
      }
      if (phase !== 'ready' || ready) return;
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
      await waitForPreviousViewerStop();
      if (cancelled) return;
      const base = `${import.meta.env.BASE_URL}open-football-viewer/`;
      const loadedViewer = await import(/* @vite-ignore */ `${base}match_viewer.js`) as ViewerModule;
      viewer = loadedViewer;
      const wasmUrl = new URL(`${base}match_viewer_bg.wasm`, document.baseURI);
      await loadedViewer.default(wasmUrl);
      if (cancelled || timedOut || !canvas.current) return;

      const initial = makeInitialRecording(setup.initialSnapshot);
      sessionId = nextViewerSessionId++;
      const config = makeConfig(initial, setup, `#tactica-of-${id}`, sessionId);
      config.renderer = await preferredRenderer();
      if (cancelled || timedOut || !canvas.current) return;
      loadedViewer.MatchViewer.start(JSON.stringify(config));
      viewerStarted = true;
      loadedViewer.MatchViewer.setHostTime(0);

      const followNarration = (now: number) => {
        const elapsed = Math.max(0, Math.min(100, now - lastClock));
        lastClock = now;
        if (playingRef.current) playbackHead = Math.min(hostCeiling + 125, playbackHead + elapsed * speedRef.current);
        let active: typeof narrationTracks[number] | undefined;
        for (const cue of narrationTracks) {
          if (cue.at > playbackHead) break;
          active = cue;
        }
        const key = active ? `${active.at}:${active.text}` : '';
        if (key !== lastNarrationKey) {
          lastNarrationKey = key;
          onNarration(active ? { text: active.text, minute: active.minute, moment: active.moment, hg: active.hg, ag: active.ag } : null);
        }
        if (!cancelled) narrationFrame = window.requestAnimationFrame(followNarration);
      };
      narrationFrame = window.requestAnimationFrame(followNarration);

      let previousSnapshotTime = 0;
      let previousHostTime = 0;
      let previousBallTime = 0;
      const previousPlayerTimes = new Map<number, number>();
      const presentedPlayerPositions = new Map<number, [number, number]>(
        [...formationLayout(setup.initialSnapshot).pos].map(([pid, pos]) => [pid, point(pos)]),
      );
      bridge = {
        push(snapshots, goals, actions, narration) {
          if (cancelled || snapshots.length === 0) return;
          // Keep authoritative possession and off-ball movement flowing between
          // commentary events. Explicit actions below still define the narrated
          // scene's ball path and contact points.
          const narratedSnapshots = snapshots;
          const narratedActionIds = new Set(narratedActionIndexes(narration, actions));
          const narratedActions = actions.filter((_action, index) => narratedActionIds.has(index));
          narrationTracks.push(...toOpenFootballNarrationTracks(narration, setup.totalMoments));
          narrationTracks.sort((left, right) => left.at - right.at);
          if (narratedSnapshots.length === 0 && narratedActions.length === 0 && narration.length === 0) return;
          const ball: number[][] = [];
          const players: Record<number, number[][]> = {};
          // A step may resolve a pass and shot (or a cross and header) before
          // producing its single final snapshot. Spread those action paths
          // through that step so the viewer receives each real contact in order.
          const orderedActions = narratedActions
            .map((action, index) => ({ action, index }))
            .sort((left, right) => left.action.moment - right.action.moment || left.index - right.index)
            .map(({ action }) => action);
          const actionWindows = actionPresentationWindows(orderedActions, setup.totalMoments);
          const actionMoments = actionMomentWindows(orderedActions).map((window) => window.event);
          const ballSamples: { moment: number; point: [number, number]; height?: number; priority: number }[] = [];
          const playerSamples: { id: number; time: number; point: [number, number]; priority: number }[] = [];
          const addSceneStart = (id: number, time: number, next: [number, number]) => {
            const lastTime = previousPlayerTimes.get(id) ?? 0;
            const lastPosition = presentedPlayerPositions.get(id);
            const holdUntil = Math.max(lastTime, time - 1);
            if (lastPosition && holdUntil > lastTime) playerSamples.push({ id, time: holdUntil, point: lastPosition, priority: 0 });
            playerSamples.push({ id, time, point: next, priority: 2 });
            presentedPlayerPositions.set(id, next);
          };
          const orderedSnapshots = narratedSnapshots
            .map((snapshot, index) => ({ snapshot, index }))
            .sort((left, right) => left.snapshot.moment - right.snapshot.moment || left.index - right.index)
            .map(({ snapshot }) => snapshot);
          // Record the full lineup at each narrated scene. Without these tracks
          // the viewer drops players that are not the current action's actor
          // or receiver, leaving only a handful of figures on the pitch.
          const scenePlayerTracks = toOpenFootballPlayerTracks(orderedSnapshots, setup.totalMoments);
          for (const [rawId, samples] of Object.entries(scenePlayerTracks)) {
            const playerId = Number(rawId);
            for (const [time, x, y] of samples) {
              playerSamples.push({ id: playerId, time, point: [x, y], priority: 0 });
              presentedPlayerPositions.set(playerId, [x, y]);
            }
          }
          for (const [time, x, y, height] of toOpenFootballBallTracks(orderedSnapshots, setup.totalMoments)) {
            ballSamples.push({ moment: time, point: [x, y], height, priority: 0 });
          }
          for (const [index, action] of orderedActions.entries()) {
            const window = actionWindows[index];
            const startTime = window.start;
            const endTime = window.end;
            const path = ballPath(action, startTime, endTime);
            for (const sample of path.samples) {
              ballSamples.push({ moment: sample.moment, point: sample.point, height: sample.height, priority: 1 });
            }
            addSceneStart(action.actor, startTime, point(action.from));
            if (['dribble', 'tackle', 'turnover', 'deflection', 'looseBall'].includes(action.kind)) {
              playerSamples.push({ id: action.actor, time: endTime, point: point(action.to), priority: 2 });
              presentedPlayerPositions.set(action.actor, point(action.to));
            }
            if (action.target !== undefined) {
              const targetStart = startTime;
              const targetPosition = presentedPlayerPositions.get(action.target) ?? point(action.to);
              addSceneStart(action.target, targetStart, targetPosition);
              const arrivalTime = ['pass', 'longBall', 'throughBall', 'cross'].includes(action.kind)
                ? path.arrival
                : endTime;
              playerSamples.push({ id: action.target, time: arrivalTime, point: point(action.to), priority: 2 });
              presentedPlayerPositions.set(action.target, point(action.to));
            }
          }
          for (const snapshot of orderedSnapshots) {
            const time = openFootballTimestamp(snapshot.moment, setup.totalMoments);
            if (time <= previousSnapshotTime) continue;
            previousSnapshotTime = time;
          }
          playerSamples.sort((a, b) => a.time - b.time || b.priority - a.priority);
          for (const sample of playerSamples) {
            const time = sample.time;
            if (time <= (previousPlayerTimes.get(sample.id) ?? 0)) continue;
            (players[sample.id] ??= []).push([time, sample.point[0], sample.point[1]]);
            previousPlayerTimes.set(sample.id, time);
          }
          ballSamples.sort((a, b) => a.moment - b.moment || b.priority - a.priority);
          for (const sample of ballSamples) {
            const time = sample.moment;
            if (time <= previousBallTime) continue;
            ball.push([time, sample.point[0], sample.point[1], sample.height ?? 0]);
            previousBallTime = time;
          }
          const { events, states } = toOpenFootballRecordingEvents(orderedActions, setup.totalMoments, actionMoments);
          const liveStates = attitudeTimeline.apply(states);
          if (ball.length || Object.keys(players).length || goals.length || events.length || Object.keys(liveStates).length) {
            loadedViewer.MatchViewer.pushRecording(JSON.stringify({ ball, players, goals, events, states: liveStates }));
            // Use the newest accepted snapshot, not the raw batch tail. Delayed
            // or reordered polls must never move the viewer's playback ceiling back.
            const tracksEnd = Math.max(previousSnapshotTime, previousBallTime, ...previousPlayerTimes.values());
            const cueEnd = Math.max(0, ...narration.map((line) => line.atTimeMs ?? openFootballTimestamp(line.atMoment ?? line.moment, setup.totalMoments)));
            const batchCeiling = Math.max(tracksEnd, cueEnd);
            if (batchCeiling > previousHostTime) {
              hostCeiling = Math.max(hostCeiling, batchCeiling);
              loadedViewer.MatchViewer.setHostTime(batchCeiling);
              previousHostTime = batchCeiling;
            }
          }
        },
        setPlaying(value) { loadedViewer.MatchViewer.setPlaying(value); },
        setSpeed(value) { loadedViewer.MatchViewer.setSpeed(value); },
        setDuration(value) { loadedViewer.MatchViewer.setDuration(value); },
        setHostTime(value) { loadedViewer.MatchViewer.setHostTime(value); },
      };
      bridgeRef.current = bridge;
      bridge.setSpeed(speed);
      bridge.setPlaying(playing);
      onBridge(bridge);
    };
    void start().catch(fail);
    return () => {
      cancelled = true;
      if (narrationFrame) window.cancelAnimationFrame(narrationFrame);
      if (readyTimeout !== undefined) window.clearTimeout(readyTimeout);
      bridge?.setPlaying(false);
      if (viewerStarted && viewer && sessionId !== undefined) {
        viewer.MatchViewer.stop(sessionId);
        pendingViewerStop = { viewer, sessionId };
      }
      bridgeRef.current = null;
      document.removeEventListener('match-viewer-progress', progress);
      setReady(false);
      onReady(false);
      onBridge(null);
      onNarration(null);
    };
    // This is a match-scoped WASM app. The prepared presentation setup is stable for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, setup, onProgress]);

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

function makeConfig(initial: ReturnType<typeof makeInitialRecording>, setup: OpenFootballSetup, selector: string, sessionId: number) {
  return {
    session_id: sessionId,
    canvas: selector,
    renderer: 'webgl2' as 'webgpu' | 'webgl2',
    api_base: '',
    inline_recording: JSON.stringify(initial),
    embedded: true,
    initial_zoom: 0.45,
    tactical_overview: true,
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
