import { useEffect, useRef, useState } from 'react';
import type { MatchPitchSnapshot, MatchVisualAction } from '../game/types';
import { formationLayout } from '../game/match-pitch';
import { actionMomentWindows, OpenFootballStateTimeline, toOpenFootballRecordingEvents } from './openFootballRecording';
import type { OpenFootballSetup } from './openFootballSetup';

const MATCH_DURATION_MS = 505_340;

export interface OpenFootballBridge {
  push(
    snapshots: readonly MatchPitchSnapshot[],
    goals: readonly { player_id: number; time: number; is_auto_goal: boolean }[],
    actions: readonly MatchVisualAction[],
  ): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
}

type ViewerModule = {
  default: (input: URL) => Promise<unknown>;
  MatchViewer: {
    start: (config: string) => void;
    pushRecording: (recording: string) => void;
    setPlaying: (playing: boolean) => void;
    setSpeed: (speed: number) => void;
  };
};

function point([x, y]: [number, number]): [number, number] {
  return [Math.max(0, Math.min(840, x * 8.4)), Math.max(0, Math.min(545, y * 5.45))];
}

function timestamp(moment: number, total: number): number {
  return Math.max(0, Math.min(MATCH_DURATION_MS, Math.round(moment / Math.max(total, 1) * MATCH_DURATION_MS)));
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
    let bridge: OpenFootballBridge | null = null;
    const attitudeTimeline = new OpenFootballStateTimeline();
    const progress = (event: Event) => {
      if ((event as CustomEvent<{ phase?: string }>).detail?.phase === 'ready') { setReady(true); onReady(true); }
    };
    document.addEventListener('match-viewer-progress', progress);
    const start = async () => {
      const base = `${import.meta.env.BASE_URL}open-football-viewer/`;
      const viewer = await import(/* @vite-ignore */ `${base}match_viewer.js`) as ViewerModule;
      const wasmUrl = new URL(`${base}match_viewer_bg.wasm`, document.baseURI);
      await viewer.default(wasmUrl);
      if (cancelled || !canvas.current) return;

      const initial = makeInitialRecording(setup.initialSnapshot);
      const config = makeConfig(initial, setup, `#tactica-of-${id}`);
      viewer.MatchViewer.start(JSON.stringify(config));

      let previousSnapshotTime = 0;
      let previousBallTime = 0;
      const previousPlayerTimes = new Map<number, number>();
      bridge = {
        push(snapshots, goals, actions) {
          if (cancelled || snapshots.length === 0) return;
          const ball: number[][] = [];
          const players: Record<number, number[][]> = {};
          // A step may resolve a pass and shot (or a cross and header) before
          // producing its single final snapshot. Spread those action paths
          // through that step so the viewer receives each real contact in order.
          const actionWindows = actionMomentWindows(actions);
          const actionMoments = actionWindows.map((window) => window.event);
          const actionEnds = new Set(actions.map((action) => action.moment + 1));
          const ballSamples: { moment: number; point: [number, number] }[] = [];
          const playerSamples: { id: number; moment: number; point: [number, number] }[] = [];
          for (const [index, action] of actions.entries()) {
            const window = actionWindows[index];
            const startMoment = window.start + 0.001;
            if (action.ballFrom) ballSamples.push({ moment: startMoment, point: point(action.ballFrom) });
            if (action.ballTo) ballSamples.push({ moment: window.end, point: point(action.ballTo) });
            playerSamples.push({ id: action.actor, moment: startMoment, point: point(action.from) });
            if (action.target !== undefined && ['pass', 'longBall', 'throughBall', 'cross'].includes(action.kind)) {
              playerSamples.push({ id: action.target, moment: window.end, point: point(action.to) });
            }
          }
          for (const snapshot of snapshots) {
            const time = timestamp(snapshot.moment, setup.totalMoments);
            if (time <= previousSnapshotTime) continue;
            const layout = formationLayout(snapshot);
            for (const [pid, pos] of layout.pos) {
              playerSamples.push({ id: pid, moment: snapshot.moment, point: point(pos) });
            }
            if (!actionEnds.has(snapshot.moment)) ballSamples.push({ moment: snapshot.moment, point: point(layout.ball) });
            previousSnapshotTime = time;
          }
          playerSamples.sort((a, b) => a.moment - b.moment);
          for (const sample of playerSamples) {
            const time = timestamp(sample.moment, setup.totalMoments);
            if (time <= (previousPlayerTimes.get(sample.id) ?? 0)) continue;
            (players[sample.id] ??= []).push([time, sample.point[0], sample.point[1]]);
            previousPlayerTimes.set(sample.id, time);
          }
          ballSamples.sort((a, b) => a.moment - b.moment);
          for (const sample of ballSamples) {
            const time = timestamp(sample.moment, setup.totalMoments);
            if (time <= previousBallTime) continue;
            ball.push([time, sample.point[0], sample.point[1], 0]);
            previousBallTime = time;
          }
          const { events, states } = toOpenFootballRecordingEvents(actions, setup.totalMoments, actionMoments);
          const liveStates = attitudeTimeline.apply(states);
          if (ball.length || Object.keys(players).length || goals.length || events.length || Object.keys(liveStates).length) {
            viewer.MatchViewer.pushRecording(JSON.stringify({ ball, players, goals, events, states: liveStates }));
          }
        },
        setPlaying(value) { viewer.MatchViewer.setPlaying(value); },
        setSpeed(value) { viewer.MatchViewer.setSpeed(value); },
      };
      bridgeRef.current = bridge;
      bridge.setSpeed(speed);
      bridge.setPlaying(playing);
      onBridge(bridge);
    };
    void start().catch((error) => { console.error('Open Football viewer failed to start', error); onFailure(); });
    return () => {
      cancelled = true;
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

function makeConfig(initial: ReturnType<typeof makeInitialRecording>, setup: OpenFootballSetup, selector: string) {
  return {
    canvas: selector,
    api_base: '',
    inline_recording: JSON.stringify(initial),
    embedded: true,
    match_time_ms: MATCH_DURATION_MS,
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
