import { useEffect, useRef, useState } from 'react';
import type { Fixture, GameState } from '../game/types';
import type { MatchSim } from '../game/engine/match';
import type { MatchPitchSnapshot, MatchVisualAction } from '../game/types';
import { POSITIONS } from '../game/types';
import { formationLayout } from '../game/match-pitch';
import { actionMomentWindows, distributeActionMoments, OpenFootballStateTimeline, toOpenFootballRecordingEvents } from './openFootballRecording';

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

function cssColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.startsWith('#') || value.startsWith('rgb') ? value : `#${value}`;
}

function point([x, y]: [number, number]): [number, number] {
  return [Math.max(0, Math.min(840, x * 8.4)), Math.max(0, Math.min(545, y * 5.45))];
}

function timestamp(moment: number, total: number): number {
  return Math.max(0, Math.min(MATCH_DURATION_MS, Math.round(moment / Math.max(total, 1) * MATCH_DURATION_MS)));
}

export function OpenFootballPitch({
  id,
  fixture,
  game,
  sim,
  playing,
  speed,
  onBridge,
  onReady,
  onFailure,
}: {
  id: number;
  fixture: Fixture;
  game: GameState;
  sim: MatchSim;
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

      const initial = makeInitialRecording(sim);
      const config = makeConfig(initial, game, fixture, sim, `#tactica-of-${id}`);
      viewer.MatchViewer.start(JSON.stringify(config));

      let previousSnapshotTime = 0;
      let previousBallTime = 0;
      bridge = {
        push(snapshots, goals, actions) {
          if (cancelled || snapshots.length === 0) return;
          const ball: number[][] = [];
          const players: Record<number, number[][]> = {};
          // A step may resolve a pass and shot (or a cross and header) before
          // producing its single final snapshot. Spread those action paths
          // through that step so the viewer receives each real contact in order.
          const actionWindows = actionMomentWindows(actions);
          const actionMoments = distributeActionMoments(actions);
          const actionEnds = new Set(actions.map((action) => action.moment + 1));
          const ballSamples: { moment: number; point: [number, number] }[] = [];
          for (const [index, action] of actions.entries()) {
            const window = actionWindows[index];
            const startMoment = window.start + 0.001;
            if (action.ballFrom) ballSamples.push({ moment: startMoment, point: point(action.ballFrom) });
            if (action.ballTo) ballSamples.push({ moment: window.end, point: point(action.ballTo) });
          }
          for (const snapshot of snapshots) {
            const time = timestamp(snapshot.moment, sim.totalMoments);
            if (time <= previousSnapshotTime) continue;
            const layout = formationLayout(snapshot);
            for (const [pid, pos] of layout.pos) {
              const [x, y] = point(pos);
              (players[pid] ??= []).push([time, x, y]);
            }
            if (!actionEnds.has(snapshot.moment)) ballSamples.push({ moment: snapshot.moment, point: point(layout.ball) });
            previousSnapshotTime = time;
          }
          ballSamples.sort((a, b) => a.moment - b.moment);
          for (const sample of ballSamples) {
            const time = timestamp(sample.moment, sim.totalMoments);
            if (time <= previousBallTime) continue;
            ball.push([time, sample.point[0], sample.point[1], 0]);
            previousBallTime = time;
          }
          const { events, states } = toOpenFootballRecordingEvents(actions, sim.totalMoments, actionMoments);
          const liveStates = attitudeTimeline.apply(states);
          if (ball.length || events.length || Object.keys(liveStates).length) {
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
    // This is a match-scoped WASM app. Fixture and simulator identities are stable for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fixture, game, sim]);

  useEffect(() => { bridgeRef.current?.setPlaying(playing); }, [playing]);
  useEffect(() => { bridgeRef.current?.setSpeed(speed); }, [speed]);

  return <canvas id={`tactica-of-${id}`} ref={canvas} className="open-football-canvas" style={{ visibility: ready ? 'visible' : 'hidden' }} aria-label="Live match presentation" />;
}

function makeInitialRecording(sim: MatchSim) {
  const layout = formationLayout(sim.pitch());
  const players: Record<number, number[][]> = {};
  for (const [pid, pos] of layout.pos) {
    const [x, y] = point(pos);
    players[pid] = [[0, x, y]];
  }
  const [x, y] = point(layout.ball);
  return { ball: [[0, x, y, 0]], players, events: [], states: {} };
}

function makeConfig(initial: ReturnType<typeof makeInitialRecording>, game: GameState, fixture: Fixture, sim: MatchSim, selector: string) {
  const side = (index: 0 | 1, clubId: number) => {
    const club = game.clubs[clubId];
    const shirt = cssColor(club?.colors[0], index === 0 ? '#173c87' : '#eeeeee');
    const ink = cssColor(club?.colors[1], index === 0 ? '#ffffff' : '#111111');
    const live = sim.live(index);
    const starters = live.on.filter((entry) => !entry.off).map((entry) => {
      const p = game.players[entry.id];
      const slot = live.tactic.slots[entry.slot];
      return {
        id: entry.id,
        shirt_number: entry.slot + 1,
        first_name: p?.first ?? '',
        last_name: p?.last || p?.first || `#${entry.id}`,
        position: slot?.pos === 'GK' ? 'GK' : slot?.pos ?? 'M',
        is_home: index === 0,
        starting: true,
      };
    });
    // Register the selected match bench before kick-off. The viewer creates
    // actors from this team sheet, then only reveals a substitute once the
    // authoritative TACTICA position timeline first contains that player.
    // Without this roster, TACTICA could make a valid substitution while the
    // viewer had no actor to render for the incoming player.
    const starterIds = new Set(starters.map((player) => player.id));
    const substitutes = live.bench.filter((id) => !starterIds.has(id)).map((id, benchIndex) => {
      const p = game.players[id];
      const bestPosition = p?.pos.length ? p.pos.indexOf(Math.max(...p.pos)) : -1;
      return {
        id,
        shirt_number: 12 + benchIndex,
        first_name: p?.first ?? '',
        last_name: p?.last || p?.first || `#${id}`,
        position: bestPosition >= 0 ? POSITIONS[bestPosition] ?? 'M' : 'M',
        is_home: index === 0,
        starting: false,
      };
    });
    return { color: { background: shirt, foreground: ink }, players: [...starters, ...substitutes] };
  };
  const home = side(0, fixture.home);
  const away = side(1, fixture.away);
  return {
    canvas: selector,
    api_base: '',
    inline_recording: JSON.stringify(initial),
    embedded: true,
    match_time_ms: MATCH_DURATION_MS,
    home: home.color,
    away: away.color,
    home_name: game.clubs[fixture.home]?.short ?? 'Home',
    away_name: game.clubs[fixture.away]?.short ?? 'Away',
    players: [...home.players, ...away.players],
    lineup: false,
    goals: [],
    chances: [],
    substitutions: [],
    debug: false,
    perf: false,
    labels: { first_half: '1st', second_half: '2nd', loading: '', no_recording: '', full_time: '', substitutes: '' },
  };
}


