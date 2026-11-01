import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ageOn } from '../src/game/dates';
import { caFromValue, makePlayer, type SubPos } from '../src/game/data/generate';
import { MatchSim, quickMatch, type EngineTeam } from '../src/game/engine/match';
import { hasVisualQueueCapacity, pairVisualActionsWithSnapshot } from '../src/game/match-visual';
import { A } from '../src/game/attributes';
import { formationLayout, playerPoint } from '../src/game/match-pitch';
import { Rng } from '../src/game/rng';
import { autoSelect, formationSlots, newTactic } from '../src/game/tactics';
import type { Foot, Player } from '../src/game/types';

const world = JSON.parse(readFileSync('public/data/world.json', 'utf8'));
const date = '2025-08-01';
const squads = new Map<number, Player[]>();
const clubs: number[] = world.clubs.filter((c: unknown[]) => c[4] === 'GB1').map((c: unknown[]) => c[0] as number);
for (const r of world.players) {
  if (!clubs.includes(r[5])) continue;
  const p = makePlayer({
    id: r[0], first: r[1], last: r[2], dob: r[3], nation: r[4], club: r[5], sub: r[6] as SubPos, foot: r[7] as Foot, height: r[8],
    ca: caFromValue(r[9], ageOn(r[3], date)), value: r[9], date, seed: 1,
  });
  if (!squads.has(p.club)) squads.set(p.club, []);
  squads.get(p.club)!.push(p);
}
const team = (club: number, f = '4-4-2'): EngineTeam => {
  const ps = squads.get(club)!;
  return { club, tactic: autoSelect(newTactic(f), ps), players: new Map(ps.map((p) => [p.id, p])) };
};

describe('matchmotor', () => {
  it('visual action timeline følger simuleringen uden at ændre resultatet', () => {
    const [h, a] = [clubs[0], clubs[1]];
    const visual = new MatchSim(team(h), team(a), { commentary: false, recordVisualEvents: true }, new Rng(31415)).runToEnd();
    const plain = new MatchSim(team(h), team(a), { commentary: false }, new Rng(31415)).runToEnd();
    const { visualTimeline, ...visualReport } = visual;
    const { visualTimeline: _unused, ...plainReport } = plain;
    expect(visualTimeline?.length).toBeGreaterThan(0);
    expect(visualReport).toEqual(plainReport);
    for (const action of visualTimeline ?? []) {
      expect(visual.players.some((p) => p.id === action.actor)).toBe(true);
      expect(Number.isInteger(action.fromZone) && action.fromZone >= 0 && action.fromZone < 15).toBe(true);
      expect(Number.isInteger(action.toZone) && action.toZone >= 0 && action.toZone < 15).toBe(true);
      expect(action.from.every(Number.isFinite)).toBe(true);
      expect(action.to.every(Number.isFinite)).toBe(true);
      if (action.kind === 'shot') {
        const outcome = action.outcome === 'offTarget' ? 'off' : action.outcome;
        expect(visual.shots.some((shot) => shot.m === action.minute && shot.t === action.team && shot.p === action.actor
          && shot.zone === action.fromZone && (outcome === 'post' ? shot.post : shot.outcome === outcome))).toBe(true);
      }
    }
  });

  it('keeps each queued visual action paired with the pitch snapshot from the same engine step', () => {
    const home = team(clubs[0]);
    home.tactic = { ...home.tactic, team: { ...home.tactic.team, passing: 2 } };
    const sim = new MatchSim(home, team(clubs[1]), { commentary: false, recordVisualEvents: true }, new Rng(1));
    const frames: ReturnType<typeof pairVisualActionsWithSnapshot> = [];
    let seen = 0;
    while (sim.step()) {
      const fresh = sim.visualTimeline.slice(seen);
      if (fresh.length) frames.push(...pairVisualActionsWithSnapshot(fresh, sim.pitch()));
      seen = sim.visualTimeline.length;
    }

    expect(frames.map((frame) => frame.action)).toEqual(sim.visualTimeline);
    expect(frames.some((frame) => frame.action.kind === 'longBall')).toBe(true);
    expect(frames.some((frame) => frame.action.kind === 'cross')).toBe(true);
    for (const frame of frames) {
      expect(frame.snap.moment).toBe(frame.action.moment + 1);
      expect(frame.snap.players.some((player) => player.id === frame.action.actor)).toBe(true);
    }
  });

  it('keeps idle player layout points stable across engine moments to avoid visual jitter', () => {
    const sim = new MatchSim(team(clubs[0]), team(clubs[1]), { commentary: false }, new Rng(17));
    const snapshot = sim.pitch();
    const first = formationLayout({ ...snapshot, moment: 1 });
    const later = formationLayout({ ...snapshot, moment: 400 });

    expect([...later.pos.entries()]).toEqual([...first.pos.entries()]);
    expect(later.ball).toEqual(first.ball);
  });

  it('streams persistent player centers with bounded movement and leaves the match result unchanged', () => {
    const sim = new MatchSim(team(clubs[0]), team(clubs[1]), { commentary: false }, new Rng(8128));
    let previous = new Map(sim.pitch().players.map((player) => [player.id, [player.x!, player.y!] as [number, number]]));
    let checked = 0;
    while (checked < 80 && sim.step()) {
      const snapshot = sim.pitch();
      const layout = formationLayout(snapshot);
      for (const player of snapshot.players) {
        const current = [player.x!, player.y!] as [number, number];
        expect(layout.pos.get(player.id)).toEqual(current);
        const before = previous.get(player.id);
        if (before) {
          const movement = Math.hypot(current[0] - before[0], current[1] - before[1]);
          const frameScale = 240 / sim.totalMoments;
          expect(movement).toBeLessThanOrEqual((player.gk ? 5.5 : 10.5) * frameScale + 1e-9);
        }
        previous.set(player.id, current);
      }
      checked++;
    }
    expect(checked).toBe(80);
  });

  it('back-pressures the live simulation when a visual action is waiting to be shown', () => {
    expect(hasVisualQueueCapacity(0)).toBe(true);
    expect(hasVisualQueueCapacity(1)).toBe(false);
    expect(hasVisualQueueCapacity(2)).toBe(false);
    expect(hasVisualQueueCapacity(2, 3)).toBe(true);
    expect(hasVisualQueueCapacity(3, 3)).toBe(false);
  });

  it('records pass endpoints at deterministic historical player positions', () => {
    const sim = new MatchSim(team(clubs[0]), team(clubs[1]), { commentary: false, recordVisualEvents: true }, new Rng(90210));
    let pass = undefined as (typeof sim.visualTimeline)[number] | undefined;
    let before = sim.pitch();
    while (!pass && sim.step()) {
      pass = sim.visualTimeline.find((a) => a.kind === 'pass' && a.outcome === 'complete' && a.target);
      if (!pass) before = sim.pitch();
    }
    expect(pass).toBeDefined();
    const action = pass!;
    const from = formationLayout({ ...before, zone: action.fromZone, poss: action.fromPoss, holder: action.actor, moment: action.moment });
    const to = formationLayout({ ...before, zone: action.toZone, poss: action.toPoss, holder: action.target!, moment: action.moment });
    expect(action.from).toEqual(playerPoint(from, action.actor));
    expect(action.to).toEqual(playerPoint(to, action.target!));
    expect(action.ballFrom).toEqual(from.ball);
    expect(action.ballTo).toEqual(to.ball);
    expect(action.from).not.toEqual([10 + Math.floor(action.fromZone / 3) * 20, 16.67 + (action.fromZone % 3) * 33.33]);
  });

  it('records saved-shot and post rebounds at their engine-resolved ball positions without changing results', () => {
    let found: { seed: number; report: ReturnType<MatchSim['runToEnd']>; action: NonNullable<ReturnType<MatchSim['runToEnd']>['visualTimeline']>[number] } | undefined;
    for (let seed = 1; seed <= 32 && !found; seed++) {
      const report = new MatchSim(team(clubs[0]), team(clubs[1]), { commentary: false, recordVisualEvents: true }, new Rng(seed)).runToEnd();
      const action = report.visualTimeline?.find((entry) => entry.kind === 'rebound');
      if (action) found = { seed, report, action };
    }
    expect(found).toBeDefined();
    const { seed, report, action } = found!;
    expect(['parried', 'postRebound']).toContain(action.outcome);
    expect(action.target).toBeDefined();
    expect(action.ballFrom?.every(Number.isFinite)).toBe(true);
    expect(action.ballTo?.every(Number.isFinite)).toBe(true);
    const sourceShot = report.shots.find((shot) => shot.m === action.minute
      && (action.outcome === 'parried'
        ? shot.outcome === 'saved' && shot.t !== action.team
        : shot.post && shot.p === action.actor && shot.t === action.team));
    expect(sourceShot).toBeDefined();
    expect(action.ballFrom).toEqual(action.outcome === 'parried'
      ? [sourceShot!.t === 0 ? 96 : 4, 50]
      : [sourceShot!.t === 0 ? 100 : 0, 46]);
    const { visualTimeline: _timeline, ...visualReport } = report;
    const plainReport = new MatchSim(team(clubs[0]), team(clubs[1]), { commentary: false }, new Rng(seed)).runToEnd();
    expect(visualReport).toEqual(plainReport);
  });

  it('records held saves, corner deflections, and keeper distribution without changing results', () => {
    const found = new Map<string, { seed: number; report: ReturnType<MatchSim['runToEnd']>; action: NonNullable<ReturnType<MatchSim['runToEnd']>['visualTimeline']>[number] }>();
    for (let seed = 1; seed <= 32 && found.size < 4; seed++) {
      const report = new MatchSim(team(clubs[0]), team(clubs[1]), { commentary: false, recordVisualEvents: true }, new Rng(seed)).runToEnd();
      const timeline = report.visualTimeline ?? [];
      for (const [index, action] of timeline.entries()) {
        if (action.kind !== 'keeper' || !['held', 'deflectedForCorner', 'distributed', 'goalKick'].includes(action.outcome) || found.has(action.outcome)) continue;
        if (action.outcome === 'distributed' && !timeline.slice(0, index).some((prior) => prior.kind === 'keeper' && prior.outcome === 'held' && prior.actor === action.actor)) continue;
        found.set(action.outcome, { seed, report, action });
      }
    }
    expect(found.has('held')).toBe(true);
    expect(found.has('deflectedForCorner')).toBe(true);
    expect(found.has('distributed')).toBe(true);
    expect(found.has('goalKick')).toBe(true);
    for (const { seed, report, action } of found.values()) {
      expect(action.ballFrom?.every(Number.isFinite)).toBe(true);
      expect(action.ballTo?.every(Number.isFinite)).toBe(true);
      const timeline = report.visualTimeline ?? [];
      if (action.outcome === 'distributed') {
        const actionIndex = timeline.indexOf(action);
        const held = timeline.slice(0, actionIndex).reverse().find((entry) => entry.kind === 'keeper'
          && entry.outcome === 'held' && entry.actor === action.actor);
        expect(held).toBeDefined();
        expect(action.target).toBeDefined();
        expect(action.ballFrom).toEqual(held!.ballTo);
      } else if (action.outcome === 'goalKick') {
        const actionIndex = timeline.indexOf(action);
        const missedShot = timeline.slice(0, actionIndex).reverse().find((entry) => entry.kind === 'shot'
          && entry.outcome === 'offTarget' && entry.team !== action.team && entry.moment === action.moment - 1);
        expect(missedShot).toBeDefined();
        expect(action.target).toBeDefined();
        expect(action.fromPoss).toBe(action.team);
        expect(action.toPoss).toBe(action.team);
        if (action.team === 0) expect(action.ballFrom?.[0]).toBeLessThan(25);
        else expect(action.ballFrom?.[0]).toBeGreaterThan(75);
        expect(action.ballFrom?.every(Number.isFinite)).toBe(true);
        expect(action.ballTo?.every(Number.isFinite)).toBe(true);
      } else {
        const savedShot = report.shots.find((shot) => shot.m === action.minute && shot.outcome === 'saved'
          && shot.t !== action.team);
        expect(savedShot).toBeDefined();
        expect(action.ballFrom).toEqual([savedShot!.t === 0 ? 96 : 4, 50]);
        if (action.outcome === 'deflectedForCorner') {
          const cornerCross = timeline.slice(timeline.indexOf(action) + 1).find((entry) => entry.moment === action.moment && entry.kind === 'cross');
          expect(cornerCross?.ballFrom).toEqual(action.ballTo);
        }
      }
      const { visualTimeline: _timeline, ...visualReport } = report;
      const plainReport = new MatchSim(team(clubs[0]), team(clubs[1]), { commentary: false }, new Rng(seed)).runToEnd();
      expect(visualReport).toEqual(plainReport);
    }
  });

  it('models open-play goalkeeper clearances from the held ball without graphics changing results', () => {
    const clearanceTeam = (club: number) => {
      const side = team(club);
      side.tactic = { ...side.tactic, team: { ...side.tactic.team, passing: 2 } };
      return side;
    };
    const keepers = new Set([0, 1].flatMap((side) => {
      const lineup = clearanceTeam(clubs[side]).tactic;
      return lineup.lineup.filter((_, slot) => lineup.slots[slot].pos === 'GK');
    }));
    let found: { seed: number; report: ReturnType<MatchSim['runToEnd']>; action: NonNullable<ReturnType<MatchSim['runToEnd']>['visualTimeline']>[number] } | undefined;
    for (let seed = 1; seed <= 48 && !found; seed++) {
      const report = new MatchSim(clearanceTeam(clubs[0]), clearanceTeam(clubs[1]), { commentary: false, recordVisualEvents: true }, new Rng(seed)).runToEnd();
      const timeline = report.visualTimeline ?? [];
      const action = timeline.find((entry) => entry.kind === 'longBall' && keepers.has(entry.actor)
        && timeline.slice(0, timeline.indexOf(entry)).some((prior) => prior.kind === 'keeper' && prior.outcome === 'held'
          && prior.actor === entry.actor && prior.ballTo?.[0] === entry.ballFrom?.[0] && prior.ballTo?.[1] === entry.ballFrom?.[1]));
      if (action) found = { seed, report, action };
    }
    expect(found).toBeDefined();
    const { seed, report, action } = found!;
    expect(keepers.has(action.actor)).toBe(true);
    expect(action.target).toBeDefined();
    const fromBlock = Math.floor(action.fromZone / 3);
    expect(action.team === 0 ? fromBlock : 4 - fromBlock).toBeLessThan(2);
    expect(action.toZone).not.toBe(action.fromZone);
    expect(action.ballFrom).toBeDefined();
    expect(action.ballTo).toBeDefined();
    const { visualTimeline: _timeline, ...visualReport } = report;
    const plainReport = new MatchSim(clearanceTeam(clubs[0]), clearanceTeam(clubs[1]), { commentary: false }, new Rng(seed)).runToEnd();
    expect(visualReport).toEqual(plainReport);
  });

  it('records shot and cross deflection contacts and corner destinations without changing results', () => {
    const found = new Map<string, { seed: number; report: ReturnType<MatchSim['runToEnd']>; action: NonNullable<ReturnType<MatchSim['runToEnd']>['visualTimeline']>[number] }>();
    for (let seed = 1; seed <= 32 && found.size < 2; seed++) {
      const report = new MatchSim(team(clubs[0]), team(clubs[1]), { commentary: false, recordVisualEvents: true }, new Rng(seed)).runToEnd();
      for (const action of report.visualTimeline ?? []) {
        if (action.kind === 'deflection' && (action.outcome === 'controlled' || action.outcome === 'deflectedForCorner') && !found.has(action.outcome)) {
          found.set(action.outcome, { seed, report, action });
        }
      }
    }
    expect(found.has('controlled')).toBe(true);
    expect(found.has('deflectedForCorner')).toBe(true);
    for (const { seed, report, action } of found.values()) {
      const timeline = report.visualTimeline ?? [];
      const actionIndex = timeline.indexOf(action);
      const block = timeline.slice(0, actionIndex).reverse().find((entry) => entry.moment === action.moment
        && (entry.kind === 'shot' || entry.kind === 'cross') && entry.outcome === 'blocked'
        && entry.target === action.actor && entry.team !== action.team);
      expect(block).toBeDefined();
      expect(action.ballFrom).toEqual(block!.ballTo);
      expect(action.ballTo?.every(Number.isFinite)).toBe(true);
      if (action.outcome === 'deflectedForCorner') {
        const cornerCross = timeline.slice(actionIndex + 1).find((entry) => entry.moment === action.moment && entry.kind === 'cross');
        expect(cornerCross?.ballFrom).toEqual(action.ballTo);
      }
      const { visualTimeline: _timeline, ...visualReport } = report;
      const plainReport = new MatchSim(team(clubs[0]), team(clubs[1]), { commentary: false }, new Rng(seed)).runToEnd();
      expect(visualReport).toEqual(plainReport);
    }
  });

  it('records engine-resolved loose-ball recovery without changing results', () => {
    let found: { seed: number; report: ReturnType<MatchSim['runToEnd']>; action: NonNullable<ReturnType<MatchSim['runToEnd']>['visualTimeline']>[number] } | undefined;
    const home = team(clubs[0]);
    const away = team(clubs[1]);
    home.tactic.team.offside = true;
    away.tactic.team.offside = true;
    for (let seed = 1; seed <= 32 && !found; seed++) {
      const report = new MatchSim(home, away, { commentary: false, recordVisualEvents: true }, new Rng(seed)).runToEnd();
      const timeline = report.visualTimeline ?? [];
      for (const action of timeline) {
      if (action.kind !== 'looseBall' || action.outcome !== 'recovered' || !action.target) continue;
      const source = timeline.slice(0, timeline.indexOf(action)).reverse().find((entry) => entry.kind === 'throughBall'
        && entry.outcome === 'offside' && entry.team !== action.team && entry.ballTo
        && entry.ballTo[0] === action.ballFrom?.[0] && entry.ballTo[1] === action.ballFrom?.[1]);
      if (!source) continue;
        found = { seed, report, action };
        break;
      }
    }
    expect(found).toBeDefined();
    const { seed, report, action } = found!;
    expect(action.target).toBe(action.actor);
    expect(action.ballFrom?.every(Number.isFinite)).toBe(true);
    expect(action.ballTo?.every(Number.isFinite)).toBe(true);
    const timeline = report.visualTimeline ?? [];
    const source = timeline.slice(0, timeline.indexOf(action)).reverse().find((entry) => entry.kind === 'throughBall'
      && entry.outcome === 'offside' && entry.team !== action.team && entry.ballTo
      && entry.ballTo[0] === action.ballFrom?.[0] && entry.ballTo[1] === action.ballFrom?.[1]);
    expect(source).toBeDefined();
    expect(action.ballFrom).toEqual(source!.ballTo);
    const { visualTimeline: _timeline, ...visualReport } = report;
    const plainHome = team(clubs[0]);
    const plainAway = team(clubs[1]);
    plainHome.tactic.team.offside = true;
    plainAway.tactic.team.offside = true;
    const plainReport = new MatchSim(plainHome, plainAway, { commentary: false }, new Rng(seed)).runToEnd();
    expect(visualReport).toEqual(plainReport);
  });

  it('applies a live formation change to the next pitch snapshot without changing its 22 players', () => {
    const sim = new MatchSim(team(clubs[0]), team(clubs[1]), { commentary: false }, new Rng(9173));
    expect(sim.step()).toBe(true);
    const before = sim.pitch();
    const live = sim.live(0);
    sim.setTactic(0, {
      ...live.tactic,
      formation: '3-5-2',
      slots: formationSlots('3-5-2'),
      lineup: live.tactic.lineup.slice(),
    });
    const after = sim.pitch();
    const positionsBefore = new Map(before.players.map((player) => [player.id, [player.ax, player.ay, player.dx, player.dy]]));
    const moved = after.players.filter((player) => {
      const prior = positionsBefore.get(player.id);
      return prior && (prior[0] !== player.ax || prior[1] !== player.ay || prior[2] !== player.dx || prior[3] !== player.dy);
    });
    expect(after.players).toHaveLength(22);
    expect(after.players.map((player) => player.id).sort((a, b) => a - b)).toEqual(before.players.map((player) => player.id).sort((a, b) => a - b));
    expect(moved.length).toBeGreaterThan(0);
    expect(sim.live(0).tactic.formation).toBe('3-5-2');
    expect(sim.changes.some((change) => change.t === 0 && change.kind === 'formation' && change.to === '3-5-2')).toBe(true);
  });

  it('keeps a live substitution synchronized across the engine lineup and pitch snapshot', () => {
    const sim = new MatchSim(team(clubs[0]), team(clubs[1]), { commentary: false }, new Rng(751));
    expect(sim.step()).toBe(true);
    const before = sim.live(0);
    const out = before.on.find((player) => !player.off && before.tactic.slots[player.slot]?.pos !== 'GK')!;
    const incoming = before.bench[0];
    const slot = out.slot;

    expect(sim.substitute(0, out.id, incoming)).toBe(true);

    const after = sim.live(0);
    const snapshot = sim.pitch();
    const substitute = after.on.find((player) => player.id === incoming && !player.off);
    const pitchPlayer = snapshot.players.find((player) => player.id === incoming);
    expect(after.on.filter((player) => !player.off)).toHaveLength(11);
    expect(after.subsLeft).toBe(before.subsLeft - 1);
    expect(after.tactic.lineup[slot]).toBe(incoming);
    expect(after.bench).not.toContain(incoming);
    expect(after.on.some((player) => player.id === out.id && !player.off)).toBe(false);
    expect(substitute?.slot).toBe(slot);
    expect(substitute?.cond).toBeGreaterThan(0);
    expect(pitchPlayer).toMatchObject({ team: 0, num: slot + 1 });
    expect(sim.events.some((event) => event.k === 'sub' && event.t === 0 && event.p === incoming && event.p2 === out.id)).toBe(true);

    const report = sim.runToEnd();
    expect(report.players.find((player) => player.id === incoming)?.sub).toBe(true);
    expect(report.players.find((player) => player.id === out.id)?.sub).toBe(false);
  });

  it('afgør pokalkampe med en gyldig straffesparkskonkurrence', () => {
    const r = new Rng(7);
    let shootouts = 0, homeWins = 0;
    for (let i = 0; i < 400; i++) {
      const h = r.pick(clubs);
      const a = r.pick(clubs.filter((c) => c !== h));
      const rep = quickMatch(team(h), team(a), { needsWinner: (x, y) => x === y }, r);
      if (rep.stats[0].goals !== rep.stats[1].goals) { expect(rep.pens).toBeUndefined(); continue; }
      shootouts++;
      expect(rep.et).toBe(true);
      const so = rep.shootout!;
      const score = [0, 1].map((t) => so.filter((k) => k.t === t && k.outcome === 'goal').length);
      expect(score).toEqual(rep.pens);
      expect(score[0]).not.toBe(score[1]);
      if (score[0] > score[1]) homeWins++;
      // skiftevis hjemme/ude
      so.forEach((k, j) => expect(k.t).toBe(j % 2));
      // stoppet præcis ved det spark, der afgjorde den (fem hver, derefter sudden death)
      const decided = (ks: typeof so) => {
        const sc = [0, 1].map((t) => ks.filter((k) => k.t === t && k.outcome === 'goal').length);
        const n = [0, 1].map((t) => ks.filter((k) => k.t === t).length);
        if (n[0] < 5 || n[1] < 5) return sc[0] + 5 - n[0] < sc[1] || sc[1] + 5 - n[1] < sc[0];
        return n[0] === n[1] && sc[0] !== sc[1];
      };
      expect(decided(so)).toBe(true);
      for (let j = 1; j < so.length; j++) expect(decided(so.slice(0, j))).toBe(false);
    }
    expect(shootouts).toBeGreaterThan(15);
    expect(homeWins).toBeGreaterThan(shootouts * 0.25);
    expect(homeWins).toBeLessThan(shootouts * 0.75);
  });

  it('giver realistiske gennemsnit (mål, hjemmesejre, skud)', () => {
    const r = new Rng(99);
    let goals = 0, home = 0, shots = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      const h = r.pick(clubs);
      const a = r.pick(clubs.filter((c) => c !== h));
      const rep = quickMatch(team(h), team(a), {}, r);
      goals += rep.stats[0].goals + rep.stats[1].goals;
      if (rep.stats[0].goals > rep.stats[1].goals) home++;
      shots += rep.stats[0].shots + rep.stats[1].shots;
    }
    expect(goals / N).toBeGreaterThan(2.1);
    expect(goals / N).toBeLessThan(3.3);
    expect(home / N).toBeGreaterThan(0.36);
    expect(home / N).toBeLessThan(0.56);
    expect(shots / N / 2).toBeGreaterThan(8);
  });

  it('har ingen formation-exploits (samme trup, 4-2-4 mod 4-4-2)', () => {
    const r = new Rng(7);
    const c = clubs[0];
    let pts = 0;
    const N = 500;
    for (let i = 0; i < N; i++) {
      const A = team(c, '4-2-4');
      const B = { ...team(c, '4-4-2'), club: -1 };
      const rep = i % 2 ? quickMatch(A, B, {}, r) : quickMatch(B, A, {}, r);
      const my = i % 2 ? rep.stats[0].goals : rep.stats[1].goals;
      const op = i % 2 ? rep.stats[1].goals : rep.stats[0].goals;
      pts += my > op ? 3 : my === op ? 1 : 0;
    }
    expect(pts / N).toBeLessThan(1.75);
  });

  it('stærkere hold vinder oftere', () => {
    const r = new Rng(3);
    const strength = (c: number) => squads.get(c)!.map((p) => p.ca).sort((a, b) => b - a).slice(0, 14).reduce((s, v) => s + v, 0);
    const sorted = clubs.slice().sort((a, b) => strength(b) - strength(a));
    const top = sorted[0], bottom = sorted[sorted.length - 1];
    let w = 0, l = 0;
    for (let i = 0; i < 200; i++) {
      const rep = quickMatch(team(top), team(bottom), {}, r);
      if (rep.stats[0].goals > rep.stats[1].goals) w++;
      else if (rep.stats[0].goals < rep.stats[1].goals) l++;
    }
    expect(w).toBeGreaterThan(l * 2.5);
  });
});

describe('instruktioner mod modstanderen', () => {
  it('tæt markering svækker den markerede spiller, og hårde tacklinger giver flere frispark', () => {
    const [h, a] = [clubs[0], clubs[1]];
    const away = team(a);
    const stars = [...away.tactic.lineup].map((id) => away.players.get(id)!).sort((x, y) => (y.attrs[2] + y.attrs[6]) - (x.attrs[2] + x.attrs[6])).slice(0, 2);
    const withOi = (home: ReturnType<typeof team>) => ({ ...home, tactic: { ...home.tactic, opp: { fixture: 1, targets: [{ pid: stars[0].id, kind: 'tight' as const }, { pid: stars[1].id, kind: 'hard' as const }] } } });
    // samme frø → samme dagsform; kun instruktionen er forskellig
    const effOf = (oi: boolean) => {
      const sim = new MatchSim(oi ? withOi(team(h)) : team(h), team(a), { commentary: false, fixtureId: 1 }, new Rng(5));
      const sp = (sim.teams[1] as unknown as { on: { p: { id: number }; eff: Float32Array }[] }).on.find((x) => x.p.id === stars[0].id)!;
      return sp.eff[A.finishing];
    };
    expect(effOf(true) / effOf(false)).toBeCloseTo(0.92, 2);
    const fouls = (oi: boolean) => {
      const r = new Rng(3);
      let n = 0;
      for (let i = 0; i < 300; i++) n += quickMatch(oi ? withOi(team(h)) : team(h), team(a), { fixtureId: 1 }, r).stats[0].fouls;
      return n;
    };
    expect(fouls(true)).toBeGreaterThan(fouls(false));
  });
});

describe('vejr', () => {
  it('skybrud giver flere fejlafleveringer end klart vejr', () => {
    const pct = (weather: 'clear' | 'heavyRain') => {
      const r = new Rng(11);
      let ok = 0, all = 0;
      for (let i = 0; i < 150; i++) {
        const rep = quickMatch(team(clubs[2]), team(clubs[3]), { weather }, r);
        for (const s of rep.stats) { ok += s.passesCompleted; all += s.passes; }
      }
      return ok / all;
    };
    expect(pct('heavyRain')).toBeLessThan(pct('clear') - 0.01);
  });
});

describe('fart', () => {
  it('en hurtig angriber skaber mere mod langsomme forsvarere end en langsom angriber', () => {
    const [h, a] = [clubs[4], clubs[5]];
    const run = (fast: boolean) => {
      const r = new Rng(21);
      let xg = 0;
      for (let i = 0; i < 300; i++) {
        const home = team(h), away = team(a);
        // modstanderens forsvarere er langsomme; vores angribere enten hurtige eller langsomme
        for (const id of away.tactic.lineup) { const p = away.players.get(id)!; if (p.pos[2] >= 15) { p.attrs[A.pace] = 7; p.attrs[A.acceleration] = 7; } }
        for (const id of home.tactic.lineup) { const p = home.players.get(id)!; if (p.pos[6] >= 15 || p.pos[5] >= 15) { p.attrs[A.pace] = fast ? 18 : 8; p.attrs[A.acceleration] = fast ? 18 : 8; } }
        xg += quickMatch(home, away, {}, r).stats[0].xg;
      }
      return xg;
    };
    expect(run(true)).toBeGreaterThan(run(false) * 1.05);
  });
});
