// Zonebaseret matchmotor i CM3-stil.
//
// Banen er delt i 5 bånd (længde) × 3 baner (bredde) = 15 zoner i absolutte koordinater
// (hjemmeholdet angriber mod x=100). Hver spiller har en angrebs- og en forsvarsposition,
// afledt af formation og instruktioner, og "dækker" zoner med en gaussisk vægt.
// Hvert "moment" vælger boldholderen en handling (aflevering, dribling, indlæg, gennembrud,
// skud), og den afgøres som en duel mellem angriberens og forsvarerens attributter, justeret
// for overtal i zonen. Formationens form bestemmer derfor naturligt, hvor man vinder og
// taber kampen. Der er ingen særlige "exploit"-genveje – se docs/ENGINE.md.

import { A, fitFactor, slotFit, slotRole } from '../attributes';
import type { Rng } from '../rng';
import { formationLayout, playerPoint } from '../match-pitch';
import { weatherFx, type Weather, type WeatherFx } from '../weather';
import type {
  CommentaryLine, MatchEvent, MatchPitchSnapshot, MatchReport, MatchStatsSide, MatchVisualAction, Player, PlayerInstructions, PlayerMatchLine,
  OppInstructions, ShootoutKick, TacticChange, ShotRecord, Tactic, TeamInstructions,
} from '../types';

export interface EngineTeam {
  club: number;
  tactic: Tactic;
  players: Map<number, Player>;
  morale?: number; // holdmoral-bonus (-1..1)
  /** Holdsnakkens virkning pr. spiller (faktor, fx 1.03) */
  talk?: Record<number, number>;
}

export interface EngineOptions {
  commentary: boolean;
  /** Record authoritative action metadata for the live match renderer (does not affect RNG or outcomes). */
  recordVisualEvents?: boolean;
  neutral?: boolean;
  importance?: number; // 0-1
  /** Afgør om der skal findes en vinder ved dette resultat (forlænget + straffe) */
  needsWinner?: (hg: number, ag: number) => boolean;
  fixtureId?: number;
  /** Kampdato (bruges til midlertidige effekter som "tændt" efter en samtale) */
  date?: string;
  /** AI håndterer udskiftninger for hold 0/1 */
  aiSubs?: [boolean, boolean];
  /** Turneringen bruger VAR (videodommer) – tætte offsidesituationer bliver tjekket */
  var?: boolean;
  /** Vejret (påvirker afleveringer, luftdueller, træthed og afslutninger) */
  weather?: Weather;
  /** Antal udskiftninger (moderne regler: 5, klassiske: 3) */
  subs?: number;
}

interface SP {
  p: Player;
  team: number;
  slot: number;
  eff: Float32Array;
  cond: number;
  instr: PlayerInstructions;
  ax: number; ay: number; dx: number; dy: number;
  off: boolean;
  yellow: number;
  line: PlayerMatchLine;
  rating: number;
  enteredAt: number;
}

interface ZoneEntry { sp: SP; w: number }

interface TeamRT {
  idx: number;
  club: number;
  tactic: Tactic;
  ti: TeamInstructions;
  on: SP[];
  benchIds: number[];
  subsLeft: number;
  players: Map<number, Player>;
  zAtt: ZoneEntry[][];
  zDef: ZoneEntry[][];
  wAtt: number[];
  wDef: number[];
  stats: MatchStatsSide;
  homeMult: number;
  moraleMult: number;
  /** Holdsnak: faktor pr. spiller-id */
  talk: Map<number, number>;
  /** Antal spillere på banen (færre efter røde kort) */
  men: number;
  all: SP[]; // alle der har været på banen
  /** AI-trænerens udgangspunkt for mentaliteten (til justeringer undervejs) */
  baseMentality?: number;
}

const ZB = 5;
const ZL = 3;
const NZ = ZB * ZL;
/** Global afslutningsskala (kalibreret mod ~2,7 mål/kamp, se scripts/calibrate.ts) */
const FINISH_SCALE = 1.5;
const zoneX = (b: number) => 10 + b * 20;
const zoneY = (l: number) => 16.67 + l * 33.33;

/** Dæmper niveauforskelle en smule: uden den bliver topholdene urealistisk dominerende (150 mål, 60-målsscorere) */
const SQUASH = 0.84;
/** Fordel pr. ekstra mand på banen i hver duel (røde kort) – kalibreret mod rigtige kampe, se scripts/redcard.ts */
const MAN_EDGE = 0.45;
/** Chance for direkte rødt kort pr. frispark (plus spillerens 'beskidthed') */
const RED_BASE = 0.0029;
/** Ekstra chancekvalitet pr. manglende forsvarsspiller */
const SPACE_XG = 0.17;
const squash = (v: number) => 11 + (v - 11) * SQUASH;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

function emptyStats(): MatchStatsSide {
  return { goals: 0, shots: 0, onTarget: 0, xg: 0, possession: 0, corners: 0, fouls: 0, yellows: 0, reds: 0, offsides: 0, passes: 0, passesCompleted: 0 };
}

export class MatchSim {
  readonly teams: [TeamRT, TeamRT];
  readonly opts: EngineOptions;
  private r: Rng;
  totalMoments: number;
  moment = 0;
  /** Hjørnespark i kampen (til 2D-visningen): hvem tog det, fra hvilken side, og førte det til et skud */
  corners: { m: number; t: number; taker: number; lane: number; moment: number; shot?: boolean }[] = [];
  minute = 0;
  half = 1;
  extraTime = false;
  finished = false;
  poss = 0;
  zone = 7; // midten
  /** Til 2D-visningen: spilleren med bolden (påvirker ikke kampen) */
  holder = 0;
  /** Stable visual-only player centers, advanced once per engine moment. */
  private playerCenters = new Map<number, [number, number]>();
  private breakaway: SP | null = null;
  /** hvordan gennembruddet opstod (kontra / gennembrudsaflevering) – vises i 2D */
  private breakawayOrigin = '';
  /** Goalkeeper who currently holds the live ball, pending a deterministic distribution to the next carrier. */
  private keeperHeld: SP | null = null;
  private keeperBallPoint: [number, number] | null = null;
  private keeperReleaseOutcome: 'distributed' | 'goalKick' | null = null;
  private looseBall: { team: number; zone: number; point: [number, number] } | null = null;
  /** The latest shot belongs to one discrete engine moment, not the whole displayed minute. */
  private lastShotMoment = -1;
  /** oprindelse for næste afslutning (indlæg, dribling, pres …) */
  private originNext = '';
  /** højt pres: en angriber har erobret bolden højt og får en chance */
  private pressed: SP | null = null;
  /** højdepunkter uden afslutning (redningstacklinger) til 2D-visningen */
  highlights: { m: number; t: number; kind: string; p: number; p2: number; moment: number }[] = [];
  /** taktiske ændringer i kampen (formation, mentalitet, instruktioner) – udskiftninger står i events */
  changes: TacticChange[] = [];
  private rebound: SP | null = null;
  private lastPasser: SP | null = null;
  private lastPasserMoment = -10;
  commentary: CommentaryLine[] = [];
  events: MatchEvent[] = [];
  /** Authoritative action timeline for the live renderer; omitted from quick simulations by default. */
  visualTimeline: MatchVisualAction[] = [];
  private pendingVisualPass: MatchVisualAction | null = null;
  shots: ShotRecord[] = [];
  momentum: number[] = [];
  heat: [number[], number[]] = [new Array(NZ).fill(0), new Array(NZ).fill(0)];
  zonePoss: number[] = new Array(NZ).fill(0);
  zoneTotal: number[] = new Array(NZ).fill(0);
  pens?: [number, number];
  /** straffesparkskonkurrencen, mens den står på (og bagefter til rapporten) */
  shootout?: { takers: [SP[], SP[]]; score: [number, number]; kicks: ShootoutKick[] };
  /** Instruktioner mod modstanderen pr. hold (gives af hold i og rammer hold 1-i) */
  private oi: [OppInstructions | undefined, OppInstructions | undefined] = [undefined, undefined];
  private wx: WeatherFx;
  private momentumBucket = 0;
  private bucketThreat = 0;

  constructor(home: EngineTeam, away: EngineTeam, opts: EngineOptions, r: Rng) {
    this.r = r;
    this.opts = opts;
    this.wx = weatherFx(opts.weather);
    const oiFor = (t: EngineTeam) => (t.tactic.opp && t.tactic.opp.fixture === opts.fixtureId ? t.tactic.opp : undefined);
    this.oi = [oiFor(home), oiFor(away)];
    this.teams = [this.makeTeam(home, 0), this.makeTeam(away, 1)];
    const tempo = (this.teams[0].ti.tempo + this.teams[1].ti.tempo) / 2;
    this.totalMoments = Math.round(240 * (1 + 0.07 * (tempo - 1)));
    this.poss = r.chance(0.5) ? 0 : 1;
    this.updateVisualPositions(true);
    if (opts.weather && opts.weather !== 'clear' && opts.weather !== 'cloudy') this.line(`weather-${opts.weather}`);
    this.line('kickoff', this.teams[this.poss].on[10]);
  }

  // ---------- opsætning ----------

  private makeTeam(t: EngineTeam, idx: number): TeamRT {
    const homeMult = this.opts.neutral ? 1 : idx === 0 ? 1.025 : 0.99;
    const rt: TeamRT = {
      idx,
      club: t.club,
      tactic: t.tactic,
      ti: t.tactic.team,
      on: [],
      benchIds: t.tactic.bench.slice(),
      subsLeft: this.opts.subs ?? 5,
      players: t.players,
      zAtt: [], zDef: [], wAtt: [], wDef: [],
      stats: emptyStats(),
      homeMult,
      moraleMult: 1 + (t.morale ?? 0) * 0.03,
      talk: new Map(Object.entries(t.talk ?? {}).map(([k, v]) => [Number(k), v])),
      men: 11,
      all: [],
    };
    t.tactic.lineup.forEach((id, slot) => {
      const p = t.players.get(id);
      if (p) rt.on.push(this.makeSP(rt, p, slot, 0));
    });
    this.buildZones(rt);
    return rt;
  }

  private makeSP(rt: TeamRT, p: Player, slot: number, minute: number): SP {
    const s = rt.tactic.slots[slot];
    const fit = fitFactor(slotFit(p, s));
    const consistency = p.attrs[A.consistency];
    const firedUp = p.fired && this.opts.date && p.fired >= this.opts.date ? 0.02 : 0;
    const form = clamp(this.r.normal(1 + firedUp, 0.065 * (1.2 - consistency / 20) * (firedUp ? 0.7 : 1)), 0.86, 1.12);
    const imp = this.opts.importance ? 0.97 + 0.06 * (p.attrs[A.importantMatches] / 20) * this.opts.importance + (1 - this.opts.importance) * 0.03 : 1;
    const morale = 0.95 + 0.1 * (p.morale / 20);
    const talk = rt.talk.get(p.id) ?? 1;
    const mult = fit * form * imp * morale * rt.homeMult * rt.moraleMult * talk;
    const eff = new Float32Array(36);
    for (let i = 0; i < 36; i++) eff[i] = squash(p.attrs[i]) * mult;
    // Mentale/fysiske påvirkes mindre af forkert position
    const physMult = form * morale * rt.homeMult * talk;
    for (const k of [A.pace, A.acceleration, A.stamina, A.strength, A.jumping, A.naturalFitness] as number[]) eff[k] = squash(p.attrs[k]) * physMult;
    // instruktioner fra modstanderen rettet mod denne spiller
    for (const tg of this.oi[1 - rt.idx]?.targets ?? []) {
      if (tg.pid !== p.id) continue;
      const hit = (keys: number[], f: number) => { for (const k of keys) eff[k] *= f; };
      if (tg.kind === 'tight') hit([A.offTheBall, A.finishing, A.heading, A.anticipation], 0.92);
      else if (tg.kind === 'press') hit([A.passing, A.decisions, A.creativity, A.technique], 0.93);
      else if (tg.kind === 'hard') hit([A.dribbling, A.technique, A.flair, A.agility], 0.92);
      else if (tg.kind === 'weakFoot' && p.foot !== 'B') hit([A.finishing, A.longShots, A.dribbling, A.crossing], 0.94);
    }
    const sp: SP = {
      p, team: rt.idx, slot, eff,
      cond: clamp(p.condition / 100, 0.3, 1),
      instr: rt.tactic.individual[slot],
      ax: 0, ay: 0, dx: 0, dy: 0,
      off: false, yellow: 0,
      rating: 6.2,
      enteredAt: minute,
      line: { id: p.id, team: rt.idx, rating: 6, goals: 0, assists: 0, minutes: 0, yellow: 0, red: false, injured: false, sub: minute > 0, slot, shots: 0, tackles: 0, passes: 0, passesOk: 0, cond: p.condition },
    };
    rt.all.push(sp);
    return sp;
  }

  /** Beregn zonedækning for et hold (efter formation, instruktioner og hvem der er på banen) */
  buildZones(rt: TeamRT) {
    rt.men = rt.on.filter((s) => !s.off).length;
    const ti = rt.ti;
    rt.zAtt = Array.from({ length: NZ }, () => []);
    rt.zDef = Array.from({ length: NZ }, () => []);
    rt.wAtt = new Array(NZ).fill(0);
    rt.wDef = new Array(NZ).fill(0);
    for (const sp of rt.on) {
      if (sp.off) continue;
      const s = rt.tactic.slots[sp.slot];
      sp.instr = rt.tactic.individual[sp.slot] ?? sp.instr;
      const role = slotRole(s);
      let adv = 0;
      switch (role) {
        case 'GK': adv = 0; break;
        case 'CB': adv = 8; break;
        case 'FB': adv = 12 + sp.instr.runs * 7; break;
        case 'DM': adv = 7 + sp.instr.runs * 3; break;
        case 'CM': adv = 9 + sp.instr.runs * 5; break;
        case 'WM': adv = 11 + sp.instr.runs * 5; break;
        case 'AM': adv = 8 + sp.instr.runs * 5; break;
        case 'W': adv = 8 + sp.instr.runs * 5; break;
        case 'ST': adv = 6 + sp.instr.runs * 3; break;
      }
      if (role !== 'GK') adv += (ti.mentality - 2) * 3.5;
      const widthShift = s.side === 'C' ? 0 : (ti.width - 1) * 6 * (s.side === 'L' ? -1 : 1);
      let axr = clamp(s.x + adv, 2, 94);
      let ayr = clamp(s.y + widthShift, 3, 97);
      let dxr = role === 'GK' ? s.x : clamp(s.x - 6 - (2 - ti.mentality) * 3 + (ti.closingDown - 1) * 4, 3, 85);
      let dyr = clamp(s.y + (50 - s.y) * 0.15, 3, 97);
      if (rt.idx === 1) { axr = 100 - axr; ayr = 100 - ayr; dxr = 100 - dxr; dyr = 100 - dyr; }
      sp.ax = axr; sp.ay = ayr; sp.dx = dxr; sp.dy = dyr;
      const free = sp.instr.freeRole ? 1.4 : 1;
      const sxA = 16 * free, syA = 20 * free;
      const sxD = role === 'GK' ? 8 : 15, syD = role === 'GK' ? 14 : 19;
      for (let b = 0; b < ZB; b++) {
        for (let l = 0; l < ZL; l++) {
          const z = b * ZL + l;
          const wa = Math.exp(-(((zoneX(b) - axr) ** 2) / (2 * sxA * sxA) + ((zoneY(l) - ayr) ** 2) / (2 * syA * syA)));
          if (wa > 0.06 && role !== 'GK') { rt.zAtt[z].push({ sp, w: wa }); rt.wAtt[z] += wa; }
          const wd = Math.exp(-(((zoneX(b) - dxr) ** 2) / (2 * sxD * sxD) + ((zoneY(l) - dyr) ** 2) / (2 * syD * syD)));
          if (wd > 0.06) { rt.zDef[z].push({ sp, w: wd * (sp.instr.tightMarking ? 1.1 : 1) }); rt.wDef[z] += wd; }
        }
      }
    }
    // Hvis ingen er i en zone (fx efter røde kort) – nærmeste fallback
    for (let z = 0; z < NZ; z++) {
      if (rt.zAtt[z].length === 0) {
        const near = rt.on.filter((s) => !s.off && slotRole(rt.tactic.slots[s.slot]) !== 'GK').sort((a, b) => dist(a.ax, a.ay, z) - dist(b.ax, b.ay, z))[0];
        if (near) rt.zAtt[z].push({ sp: near, w: 0.05 });
      }
      if (rt.zDef[z].length === 0) {
        const near = rt.on.filter((s) => !s.off).sort((a, b) => dist(a.dx, a.dy, z) - dist(b.dx, b.dy, z))[0];
        if (near) rt.zDef[z].push({ sp: near, w: 0.05 });
      }
    }
  }

  // ---------- hjælpere ----------

  private a(sp: SP, i: number): number {
    return sp.eff[i] * (0.68 + 0.32 * sp.cond);
  }
  private rb(team: number, z = this.zone): number {
    const b = Math.floor(z / ZL);
    return team === 0 ? b : ZB - 1 - b;
  }
  private zoneFor(team: number, rb: number, lane: number): number {
    const b = team === 0 ? rb : ZB - 1 - rb;
    const l = team === 0 ? lane : ZL - 1 - lane;
    return b * ZL + l;
  }
  private laneOf(team: number, z = this.zone): number {
    const l = z % ZL;
    return team === 0 ? l : ZL - 1 - l;
  }
  private pick(list: ZoneEntry[], weight?: (sp: SP) => number, exclude?: SP): SP | null {
    let total = 0;
    for (const e of list) if (!e.sp.off && e.sp !== exclude) total += e.w * (weight ? weight(e.sp) : 1);
    if (total <= 0) return list.find((e) => !e.sp.off)?.sp ?? null;
    let x = this.r.next() * total;
    for (const e of list) {
      if (e.sp.off || e.sp === exclude) continue;
      x -= e.w * (weight ? weight(e.sp) : 1);
      if (x <= 0) return e.sp;
    }
    return list[list.length - 1].sp;
  }
  private gk(t: TeamRT): SP {
    return t.on.find((s) => !s.off && t.tactic.slots[s.slot].pos === 'GK') ?? t.on.find((s) => !s.off)!;
  }
  private overload(z: number, att: TeamRT, def: TeamRT): number {
    // undertal mærkes over hele banen: modstanderen har altid en fri mand
    return 0.5 * Math.log((att.wAtt[z] + 0.45) / (def.wDef[z] + 0.45)) + MAN_EDGE * (att.men - def.men);
  }
  private rate(sp: SP | null, d: number) {
    if (sp) sp.rating += d;
  }
  private line(k: string, a?: SP | null, b?: SP | null, hi = false) {
    if (!this.opts.commentary) return;
    this.commentary.push({ m: this.minute, k, a: a ? name(a.p) : undefined, b: b ? name(b.p) : undefined, t: a ? a.team : undefined, hi });
  }

  private pitchPlayers(includeCenters = false) {
    return this.teams.flatMap((t) => t.on.filter((sp) => !sp.off).map((sp) => {
      const center = includeCenters ? this.playerCenters.get(sp.p.id) : undefined;
      return {
        id: sp.p.id, team: t.idx, num: sp.slot + 1, gk: t.tactic.slots[sp.slot]?.pos === 'GK',
        ax: sp.ax, ay: sp.ay, dx: sp.dx, dy: sp.dy, name: sp.p.last,
        ...(center ? { x: center[0], y: center[1] } : {}),
      };
    }));
  }

  /** Deterministic visual movement; capped per engine frame and independent of match RNG. */
  private updateVisualPositions(initial = false) {
    const players = this.pitchPlayers();
    const targets = formationLayout({
      zone: this.zone, poss: this.poss, holder: this.holder, moment: this.moment, players,
    }).pos;
    const active = new Set<number>();
    for (const p of players) {
      active.add(p.id);
      const target = targets.get(p.id);
      if (!target) continue;
      const current = this.playerCenters.get(p.id);
      if (!current || initial) {
        this.playerCenters.set(p.id, target);
        continue;
      }
      const dx = target[0] - current[0], dy = target[1] - current[1];
      const distance = Math.hypot(dx, dy);
      const frameScale = 240 / Math.max(1, this.totalMoments);
      const maxStep = (p.gk ? 5.5 : 10.5) * frameScale;
      const scale = distance > maxStep ? maxStep / distance : 1;
      this.playerCenters.set(p.id, [current[0] + dx * scale, current[1] + dy * scale]);
    }
    for (const id of this.playerCenters.keys()) if (!active.has(id)) this.playerCenters.delete(id);
  }

  /** Build the same deterministic open-play layout the renderer uses, without consuming simulation RNG. */
  private visualPositions(zone: number, poss: number, holder: number) {
    return formationLayout({
      zone, poss, holder, moment: this.moment,
      players: this.pitchPlayers(true),
    });
  }

  /** Finalize a short-pass animation with the carrier the match engine actually selected. */
  private resolvePendingVisualPass(receiver: SP | null) {
    const action = this.pendingVisualPass;
    if (!action) return;

    if (receiver) {
      const layout = this.visualPositions(action.toZone, action.team, receiver.p.id);
      const receivePoint = playerPoint(layout, receiver.p.id);
      action.target = receiver.p.id;
      action.to = receivePoint ?? layout.ball ?? action.to;
      action.ballTo = receivePoint ?? layout.ball ?? action.ballTo;
      action.toPoss = action.team;
    } else {
      action.target = undefined;
      const layout = this.visualPositions(action.toZone, action.toPoss, 0);
      action.to = layout.ball ?? action.to;
      action.ballTo = layout.ball ?? action.ballTo;
    }

    this.visualTimeline.push(action);
    this.pendingVisualPass = null;
  }

  /** Model the already-resolved goal kick's presentation owner without selecting a new receiver or consuming RNG. */
  private startGoalKick(T: TeamRT) {
    const zone = this.zoneFor(T.idx, 0, 1);
    const keeper = this.gk(T);
    this.zone = zone;
    this.poss = T.idx;
    this.holder = keeper.p.id;
    this.keeperHeld = keeper;
    this.keeperReleaseOutcome = 'goalKick';
    this.keeperBallPoint = this.opts.recordVisualEvents ? this.visualPositions(zone, T.idx, keeper.p.id).ball : null;
  }

  private visualAction(kind: MatchVisualAction['kind'], team: number, actor: SP, fromZone: number, toZone: number, outcome: string, target?: SP | null, to?: [number, number], ballFrom?: [number, number], deferRecording = false): MatchVisualAction | undefined {
    if (!this.opts.recordVisualEvents) return undefined;
    const point = (zone: number): [number, number] => [zoneX(Math.floor(zone / ZL)), zoneY(zone % ZL)];
    const fromPoss = kind === 'turnover' || kind === 'deflection' || kind === 'looseBall' ? 1 - team
      : kind === 'tackle' ? target?.team ?? 1 - team
      : kind === 'shot' ? team
      : kind === 'rebound' ? actor.team
      : kind === 'keeper' ? outcome === 'distributed' || outcome === 'goalKick' ? team : 1 - team
      : this.poss;
    const toPoss = kind === 'tackle' ? team : target?.team ?? team;
    const beforeHolder = kind === 'tackle' ? target?.p.id ?? this.holder : actor.p.id;
    const before = this.visualPositions(fromZone, fromPoss, beforeHolder);
    const afterHolder = kind === 'tackle' ? actor.p.id : target?.p.id ?? (toPoss === team ? actor.p.id : 0);
    const after = this.visualPositions(toZone, toPoss, afterHolder);
    const eventTarget = kind === 'tackle' ? actor : target;
    const action: MatchVisualAction = {
      moment: this.moment,
      minute: this.minute,
      team,
      kind,
      actor: actor.p.id,
      target: target?.p.id,
      fromZone,
      toZone,
      fromPoss,
      toPoss,
      from: playerPoint(before, actor.p.id) ?? before.ball ?? point(fromZone),
      to: to ?? (eventTarget ? playerPoint(after, eventTarget.p.id) : undefined) ?? after.ball ?? point(toZone),
      ballFrom: ballFrom ?? before.ball ?? playerPoint(before, actor.p.id) ?? point(fromZone),
      ballTo: to ?? after.ball ?? (eventTarget ? playerPoint(after, eventTarget.p.id) : undefined) ?? point(toZone),
      outcome,
    };
    if (!deferRecording) this.visualTimeline.push(action);
    return action;
  }

  // Sammensatte evner
  private passQ(s: SP) { return 0.45 * this.a(s, A.passing) + 0.2 * this.a(s, A.decisions) + 0.15 * this.a(s, A.technique) + 0.2 * this.a(s, A.creativity); }
  private pressQ(s: SP, t: TeamRT) { return 0.3 * this.a(s, A.anticipation) + 0.3 * this.a(s, A.positioning) + 0.2 * this.a(s, A.workRate) * (0.85 + t.ti.closingDown * 0.1) + 0.2 * this.a(s, t.ti.marking === 'man' ? A.marking : A.tackling); }
  private dribQ(s: SP) { return 0.4 * this.a(s, A.dribbling) + 0.2 * this.a(s, A.pace) + 0.15 * this.a(s, A.acceleration) + 0.15 * this.a(s, A.agility) + 0.1 * this.a(s, A.flair); }
  private tackQ(s: SP, t: TeamRT) { return (0.45 * this.a(s, A.tackling) + 0.2 * this.a(s, A.positioning) + 0.15 * this.a(s, A.pace) + 0.2 * this.a(s, A.anticipation)) * (1 + (t.ti.tackling - 1) * 0.04); }
  private aerial(s: SP) { return 0.45 * this.a(s, A.heading) + 0.35 * this.a(s, A.jumping) + 0.2 * this.a(s, A.strength); }
  private finQ(s: SP) { return 0.62 * this.a(s, A.finishing) + 0.13 * this.a(s, A.technique) + 0.1 * this.a(s, A.decisions) + 0.15 * this.a(s, A.anticipation); }
  private gkQ(s: SP) { return 0.35 * this.a(s, A.reflexes) + 0.25 * this.a(s, A.handling) + 0.2 * this.a(s, A.positioning) + 0.2 * this.a(s, A.agility); }
  private gk1v1(s: SP) { return 0.5 * this.a(s, A.oneOnOnes) + 0.3 * this.a(s, A.reflexes) + 0.2 * this.a(s, A.anticipation); }
  /** Fart + acceleration (til direkte fartdueller) */
  private speed(s: SP) { return this.a(s, A.pace) + this.a(s, A.acceleration); }
  private runQ(s: SP) { return 0.4 * this.a(s, A.offTheBall) + 0.3 * this.a(s, A.pace) + 0.3 * this.a(s, A.anticipation); }

  // ---------- simulering ----------

  /** Kør et moment. Returnerer false når kampen er slut. */
  step(): boolean {
    if (this.finished) return false;
    const regular = this.totalMoments;
    const etMoments = Math.round(regular / 3);
    const limit = this.extraTime ? regular + etMoments : regular;
    if (this.moment >= limit) {
      if (!this.extraTime && this.opts.needsWinner?.(this.teams[0].stats.goals, this.teams[1].stats.goals)) {
        this.extraTime = true;
        this.line('extratime');
        this.kickoff(1);
      } else if (this.extraTime && !this.pens && this.opts.needsWinner?.(this.teams[0].stats.goals, this.teams[1].stats.goals)) {
        // straffesparkskonkurrence: ét spark pr. trin, så den kan følges live
        this.moment++;
        if (!this.shootout) { this.startShootout(); return true; }
        if (this.shootoutKick()) return true;
        this.finish();
        return false;
      } else {
        this.finish();
        return false;
      }
    }
    const i = this.moment;
    const minute = i < regular ? Math.floor((i * 90) / regular) + 1 : 90 + Math.floor(((i - regular) * 30) / etMoments) + 1;
    if (i === Math.floor(regular / 2)) {
      this.resolvePendingVisualPass(null);
      this.line('halftime');
      this.half = 2;
      this.kickoff(1);
      this.recoverHalftime();
    }
    this.minute = minute;
    this.tickFatigue();
    if (i % 12 === 0) this.aiManage();
    this.play();
    this.updateVisualPositions();
    this.moment++;
    // momentum pr. 5 minutter
    const bucket = Math.floor((minute - 1) / 5);
    if (bucket !== this.momentumBucket) {
      this.momentum[this.momentumBucket] = Math.round(this.bucketThreat * 100) / 100;
      this.momentumBucket = bucket;
      this.bucketThreat = 0;
    }
    return true;
  }

  runToEnd(): MatchReport {
    while (this.step());
    return this.report();
  }

  private kickoff(team: number) {
    this.poss = team;
    this.zone = 7;
    this.breakaway = null;
    this.rebound = null;
    this.keeperHeld = null;
    this.keeperBallPoint = null;
    this.keeperReleaseOutcome = null;
    this.looseBall = null;
    this.pressed = null;
  }

  private recoverHalftime() {
    for (const t of this.teams) for (const s of t.on) s.cond = Math.min(1, s.cond + 0.04);
  }

  private tickFatigue() {
    for (const t of this.teams) {
      // tæt markering og pres af modstanderens spillere koster kræfter
      const extra = (this.oi[t.idx]?.targets ?? []).filter((x) => x.kind === 'tight' || x.kind === 'press').length;
      const tf = (1 + 0.15 * (t.ti.tempo - 1) + 0.12 * (t.ti.closingDown - 1)) * (1 + 0.035 * extra) * this.wx.fatigue;
      for (const s of t.on) {
        if (s.off) continue;
        const isGK = t.tactic.slots[s.slot].pos === 'GK';
        const drain = 0.00143 * (1.3 - s.p.attrs[A.stamina] / 36) * (isGK ? 0.25 : tf * (1 + 0.12 * Math.max(0, 11 - t.men))) * (1 + 0.06 * (s.p.attrs[A.workRate] - 10) / 10) * (1.1 - s.p.attrs[A.naturalFitness] / 100);
        s.cond = Math.max(0.2, s.cond - drain);
      }
    }
  }

  private play() {
    const T = this.teams[this.poss];
    const O = this.teams[1 - this.poss];
    const z = this.zone;
    T.stats.possession++;
    this.heat[T.idx][z]++;
    this.zoneTotal[z]++;
    if (T.idx === 0) this.zonePoss[z]++;
    const rb = this.rb(T.idx);
    this.bucketThreat += (T.idx === 0 ? 1 : -1) * (rb === 4 ? 0.6 : rb === 3 ? 0.25 : 0);

    // Retur / gennembrud fra forrige moment
    if (this.rebound) {
      const s = this.rebound;
      this.rebound = null;
      this.shoot(T, O, s, 'rebound');
      return;
    }
    if (this.pressed) {
      const s = this.pressed;
      this.pressed = null;
      this.originNext = 'press';
      this.shoot(T, O, s, 'box', 0.03);
      return;
    }
    if (this.breakaway) {
      const s = this.breakaway;
      const origin = this.breakawayOrigin;
      this.breakaway = null;
      this.breakawayOrigin = '';
      if (this.r.chance(0.55)) {
        // redningstackling: den sidste forsvarer når hjem (tackling + fart mod løberens fart + dribling)
        const cover = this.pick(O.zDef[this.zone], (x) => this.a(x, A.pace) + this.a(x, A.tackling));
        if (cover && this.r.chance(clamp(0.1 + (this.a(cover, A.tackling) + this.a(cover, A.pace) - this.a(s, A.pace) - this.a(s, A.dribbling)) / 80, 0.04, 0.3))) {
          // hårde tacklinger: risiko for frispark/straffe og kort
          if (O.ti.tackling === 2 && this.r.chance(0.35) && this.foulCheck(T, O, s, cover, true)) return;
          cover.line.tackles++;
          this.rate(cover, 0.2);
          this.line('lastditch', cover, s, true);
          this.highlights.push({ m: this.minute, t: T.idx, kind: 'lastDitch', p: s.p.id, p2: cover.p.id, moment: this.moment });
          if (this.r.chance(0.4)) return this.corner(T, O);
          this.turnover(cover);
          return;
        }
        this.originNext = origin;
        this.shoot(T, O, s, 'oneOnOne');
        return;
      }
    }

    const distributor = this.keeperHeld;
    const distributionOrigin = this.keeperBallPoint ?? undefined;
    const releaseOutcome = this.keeperReleaseOutcome ?? 'distributed';
    this.keeperHeld = null;
    this.keeperBallPoint = null;
    this.keeperReleaseOutcome = null;
    // In open play, some keeper claims turn into an intentional clearance. Use match RNG and the
    // keeper's actual passing skill; when selected, the same long-ball resolver decides receiver
    // and outcome. Goal kicks keep their existing restart distribution path.
    if (distributor && releaseOutcome === 'distributed' && T.ti.passing === 2) {
      const clearanceP = clamp(0.22 + (this.a(distributor, A.passing) - 10) * 0.012, 0.1, 0.35);
      if (this.r.chance(clearanceP)) {
        this.longBall(T, O, distributor, distributionOrigin);
        return;
      }
    }
    const loose = this.looseBall;
    const carrier = this.pick(T.zAtt[z]);
    if (!carrier) { this.resolvePendingVisualPass(null); this.turnover(null); return; }
    this.resolvePendingVisualPass(carrier);
    this.looseBall = null;
    if (loose && loose.team === T.idx) this.visualAction('looseBall', T.idx, carrier, loose.zone, z, 'recovered', carrier, undefined, loose.point);
    else if (distributor && distributor.team === T.idx) this.visualAction('keeper', T.idx, distributor, z, z, releaseOutcome, carrier, undefined, distributionOrigin);
    this.holder = carrier.p.id;
    // Løbende dueller/frispark uden for de egentlige aktioner
    if (this.r.chance(0.11)) {
      const def = this.pick(O.zDef[z]);
      if (def && this.foulCheck(T, O, carrier, def, true)) return;
    }
    const lane = this.laneOf(T.idx);
    const wide = lane !== 1;
    const ins = carrier.instr;
    const ti = T.ti;
    const r = this.r.next();

    if (rb <= 1) {
      const longP = [0.06, 0.15, 0.36][ti.passing];
      if (r < longP) return this.longBall(T, O, carrier);
      if (r < longP + 0.05 + (ins.runWithBall ? 0.05 : 0)) return this.dribble(T, O, carrier);
      return this.pass(T, O, carrier, 0.72 + 0.07 * (ti.tempo - 1) + 0.04 * (ti.mentality - 2) - (ti.passing === 0 ? 0.08 : 0) + (ti.passing === 2 ? 0.06 : 0));
    }
    if (rb === 2) {
      const throughP = (ins.throughBalls ? 0.11 : 0.04) + (this.a(carrier, A.creativity) - 10) / 250;
      const longP = [0.02, 0.06, 0.16][ti.passing];
      const dribP = 0.07 + (ins.runWithBall ? 0.08 : 0) + this.a(carrier, A.flair) / 300;
      const lsP = 0.02 + ins.longShots * 0.015;
      if (r < throughP) return this.throughBall(T, O, carrier);
      if (r < throughP + longP) return this.longBall(T, O, carrier);
      if (r < throughP + longP + dribP) return this.dribble(T, O, carrier);
      if (r < throughP + longP + dribP + lsP) return this.shoot(T, O, carrier, 'long');
      return this.pass(T, O, carrier, 0.62 + 0.06 * (ti.tempo - 1) + 0.04 * (ti.mentality - 2));
    }
    if (rb === 3) {
      const crossP = wide ? 0.18 + 0.12 * ins.crossing + 0.05 * (ti.width - 1) : 0;
      const lsP = 0.13 + 0.05 * ins.longShots + (this.a(carrier, A.longShots) - 10) / 200;
      const throughP = (ins.throughBalls ? 0.16 : 0.08) + (this.a(carrier, A.creativity) - 10) / 250;
      const dribP = 0.1 + (ins.runWithBall ? 0.08 : 0) + this.a(carrier, A.flair) / 300;
      let acc = crossP;
      if (r < acc) return this.cross(T, O, carrier);
      if (r < (acc += lsP)) return this.shoot(T, O, carrier, 'long');
      if (r < (acc += throughP)) return this.throughBall(T, O, carrier);
      if (r < (acc += dribP)) return this.dribble(T, O, carrier);
      return this.pass(T, O, carrier, 0.58 + 0.04 * (ti.mentality - 2));
    }
    // rb 4: feltet
    if (wide) {
      if (r < 0.4) return this.cross(T, O, carrier);
      if (r < 0.62) return this.shoot(T, O, carrier, 'boxWide');
      if (r < 0.78) return this.dribble(T, O, carrier);
      return this.pass(T, O, carrier, 0.0, true);
    }
    if (r < 0.6) {
      // midtbanespillere der løber med ind i feltet afslutter også – ellers scorer angriberen næsten alt
      if (this.r.chance(0.3)) {
        const late = this.pick(T.zAtt[this.zoneFor(T.idx, 3, lane)], (x) => Math.sqrt(this.finQ(x)) * (x.instr.runs + 1), carrier);
        if (late) { this.lastPasser = carrier; this.lastPasserMoment = this.moment; return this.shoot(T, O, late, 'box'); }
      }
      return this.shoot(T, O, carrier, 'box');
    }
    if (r < 0.74) return this.dribble(T, O, carrier);
    return this.pass(T, O, carrier, 0.0, true);
  }

  private pass(T: TeamRT, O: TeamRT, s: SP, forwardP: number, cutback = false) {
    const fromZone = this.zone;
    const rb = this.rb(T.idx);
    const lane = this.laneOf(T.idx);
    let trb = rb, tl = lane, base: number;
    if (cutback) {
      trb = 4; tl = 1; base = 0.62;
    } else if (this.r.chance(forwardP) && rb < 4) {
      trb = rb + 1;
      base = rb <= 1 ? 0.86 : rb === 2 ? 0.77 : 0.7;
      // banevalg: bred taktik søger kanterne
      const wideP = 0.25 + 0.15 * T.ti.width;
      tl = this.r.chance(0.55) ? lane : lane === 1 ? (this.r.chance(wideP) ? (this.r.chance(0.5) ? 0 : 2) : 1) : 1;
      // angrib især en bestemt side
      const fl = this.oi[T.idx]?.focusLane;
      if (fl !== undefined && fl !== tl && this.r.chance(0.3)) tl = fl;
    } else {
      const back = rb > 0 && this.r.chance(0.3);
      trb = back ? rb - 1 : rb;
      tl = lane === 1 ? (this.r.chance(0.5) ? 0 : 2) : 1;
      base = 0.92;
    }
    base += this.wx.pass;
    if (T.ti.passing === 0) base += 0.035;
    if (T.ti.passing === 2) base -= 0.03;
    const tz = this.zoneFor(T.idx, trb, tl);
    const def = this.pick(O.zDef[tz]);
    T.stats.passes++;
    s.line.passes++;
    const dq = def ? this.pressQ(def, O) : 6;
    const p = logistic(logit(base) + (this.passQ(s) - dq) / 4.5 + this.overload(tz, T, O) * 0.8 - (O.ti.closingDown - 1) * 0.12);
    if (this.r.chance(p)) {
      T.stats.passesCompleted++;
      s.line.passesOk++;
      this.rate(s, trb > rb ? 0.025 : 0.008);
      this.zone = tz;
      const cutbackShooter = cutback ? this.pick(T.zAtt[tz], (x) => Math.sqrt(this.finQ(x)), s) : null;
      const passAction = this.visualAction('pass', T.idx, s, fromZone, tz, 'complete', cutbackShooter, undefined, undefined, !cutback);
      if (!cutback && passAction) {
        this.pendingVisualPass = passAction;
      }
      this.lastPasser = s;
      this.lastPasserMoment = this.moment;
      if (cutback) {
        if (cutbackShooter) { this.lastPasser = s; this.shoot(T, O, cutbackShooter, 'cutback'); }
      }
      if (trb >= 3 && this.r.chance(0.04)) this.line('pass-forward', s);
    } else {
      this.rate(s, -0.04);
      this.rate(def, 0.05);
      if (def) def.line.tackles++;
      this.zone = tz;
      if (def) this.visualAction('tackle', O.idx, def, fromZone, tz, 'won', s);
      else this.visualAction('pass', T.idx, s, fromZone, tz, 'intercepted');
      this.turnover(def);
    }
  }

  private longBall(T: TeamRT, O: TeamRT, s: SP, ballFrom?: [number, number]) {
    const fromZone = this.zone;
    const rb = this.rb(T.idx);
    const trb = Math.min(4, rb + 2 + (this.r.chance(0.3) ? 1 : 0));
    const lane = this.r.chance(0.5) ? 1 : this.r.chance(0.5) ? 0 : 2;
    const tz = this.zoneFor(T.idx, Math.min(3, trb), lane);
    const recv = this.pick(T.zAtt[tz], (x) => this.aerial(x) ** 2, s);
    const def = this.pick(O.zDef[tz], (x) => this.aerial(x) ** 2);
    T.stats.passes++;
    s.line.passes++;
    if (!recv) { this.zone = tz; this.visualAction('longBall', T.idx, s, fromZone, tz, 'uncontested', undefined, undefined, ballFrom); this.turnover(def); return; }
    const pq = this.a(s, A.passing) * 0.6 + this.a(s, A.technique) * 0.4;
    const p = logistic(logit(0.42) + (this.aerial(recv) - (def ? this.aerial(def) : 5)) / 4 + (pq - 10) / 12 + this.overload(tz, T, O) * 0.6 + this.wx.air);
    this.zone = tz;
    if (this.r.chance(p)) {
      T.stats.passesCompleted++;
      s.line.passesOk++;
      this.rate(recv, 0.04);
      this.visualAction('longBall', T.idx, s, fromZone, tz, 'complete', recv, undefined, ballFrom);
      this.lastPasser = s;
      this.lastPasserMoment = this.moment;
      if (this.r.chance(0.06)) this.line('longball', s, recv);
    } else {
      this.rate(def, 0.05);
      this.visualAction('longBall', T.idx, s, fromZone, tz, 'intercepted', def, undefined, ballFrom);
      this.turnover(def);
    }
  }

  private dribble(T: TeamRT, O: TeamRT, s: SP) {
    const fromZone = this.zone;
    const rb = this.rb(T.idx);
    const def = this.pick(O.zDef[this.zone], (x) => this.tackQ(x, O));
    const dq = def ? this.tackQ(def, O) : 5;
    // på kanten er der plads at løbe i: en hurtig kantspiller mod en langsom back er en fordel i sig selv
    const wide = this.laneOf(T.idx) !== 1;
    const speedDuel = wide && def ? (this.speed(s) - this.speed(def)) / 22 : 0;
    const p = logistic(logit(0.5) + (this.dribQ(s) - dq) / 4 + this.overload(this.zone, T, O) * 0.6 + speedDuel);
    if (this.r.chance(p)) {
      this.rate(s, 0.07);
      if (rb < 4) {
        this.zone = this.zoneFor(T.idx, rb + 1, this.laneOf(T.idx));
        this.visualAction('dribble', T.idx, s, fromZone, this.zone, 'complete');
        if (rb + 1 >= 3 && this.r.chance(0.18)) this.line('dribble', s, def);
      } else {
        this.line('dribble-box', s, def);
        this.visualAction('dribble', T.idx, s, fromZone, this.zone, 'complete');
        this.originNext = 'dribble';
        this.shoot(T, O, s, 'box', 0.04);
      }
      return;
    }
    if (def) { def.line.tackles++; this.rate(def, 0.07); }
    this.rate(s, -0.03);
    if (def) this.visualAction('tackle', O.idx, def, fromZone, this.zone, 'won', s);
    else this.visualAction('dribble', T.idx, s, fromZone, this.zone, 'tackled');
    if (def && this.foulCheck(T, O, s, def)) return;
    this.turnover(def);
  }

  private throughBall(T: TeamRT, O: TeamRT, s: SP) {
    const fromZone = this.zone;
    const rb = this.rb(T.idx);
    const lane = this.laneOf(T.idx);
    const tz = this.zoneFor(T.idx, Math.min(4, rb + 1), lane === 1 ? 1 : this.r.chance(0.6) ? 1 : lane);
    const runner = this.pick(T.zAtt[tz], (x) => this.runQ(x) * (x.instr.runs + 1), s);
    if (!runner) return this.pass(T, O, s, 0.5);
    const def = this.pick(O.zDef[tz], (x) => this.a(x, A.positioning));
    T.stats.passes++;
    s.line.passes++;
    // Offside-fælde
    if (O.ti.offside && this.r.chance(clamp(0.24 - (this.a(runner, A.anticipation) - 10) / 90, 0.08, 0.35))) {
      T.stats.offsides++;
      this.rate(runner, -0.05);
      this.line('offside', runner);
      this.visualAction('throughBall', T.idx, s, fromZone, this.zoneFor(T.idx, Math.min(4, rb + 1), 1), 'offside', runner);
      this.highlights.push({ m: this.minute, t: T.idx, kind: 'offside', p: runner.p.id, p2: s.p.id, moment: this.moment });
      this.zone = this.zoneFor(T.idx, Math.min(4, rb + 1), 1);
      this.turnover(null);
      return;
    }
    const tq = 0.5 * this.a(s, A.creativity) + 0.3 * this.a(s, A.passing) + 0.2 * this.a(s, A.decisions);
    const dq = def ? 0.35 * this.a(def, A.positioning) + 0.35 * this.a(def, A.anticipation) + 0.3 * this.a(def, A.pace) : 5;
    // stikningen bag kæden: løberens fart mod forsvarerens (en hurtig angriber mod langsomme forsvarere er en fordel)
    const speedDuel = def ? (this.speed(runner) - this.speed(def)) / 22 : 0;
    const p = logistic(logit(0.36) + (0.5 * tq + 0.5 * this.runQ(runner) - dq) / 4 + (O.ti.offside ? 0.35 : 0) + this.overload(tz, T, O) * 0.4 + speedDuel);
    if (this.r.chance(p)) {
      T.stats.passesCompleted++;
      s.line.passesOk++;
      this.rate(s, 0.1);
      this.lastPasser = s;
      this.lastPasserMoment = this.moment;
      this.zone = this.zoneFor(T.idx, Math.min(4, rb + 1), 1);
      this.visualAction('throughBall', T.idx, s, fromZone, this.zone, 'complete', runner);
      if (rb + 1 >= 3) {
        this.line('throughball', s, runner);
        this.breakaway = runner;
        this.breakawayOrigin = 'through';
      }
    } else {
      this.rate(s, -0.03);
      this.rate(def, 0.05);
      this.zone = tz;
      this.visualAction('throughBall', T.idx, s, fromZone, tz, 'intercepted', def);
      this.turnover(def);
    }
  }

  private cross(T: TeamRT, O: TeamRT, s: SP, setPiece = false, bonus = 0, ballOrigin?: [number, number]) {
    const fromZone = this.zone;
    const boxZ = this.zoneFor(T.idx, 4, 1);
    const blocker = this.pick(O.zDef[this.zone]);
    const cq = 0.7 * this.a(s, setPiece ? A.corners : A.crossing) + 0.3 * this.a(s, A.technique);
    const deliver = logistic(logit(setPiece ? 0.72 : 0.62) + (cq - (blocker ? this.a(blocker, A.positioning) : 5)) / 5 + bonus + this.wx.air);
    if (!this.r.chance(deliver)) {
      this.rate(s, -0.03);
      const blockLayout = blocker && this.opts.recordVisualEvents ? this.visualPositions(fromZone, T.idx, s.p.id) : undefined;
      const blockPoint = blocker && blockLayout ? playerPoint(blockLayout, blocker.p.id) : undefined;
      this.visualAction('cross', T.idx, s, fromZone, boxZ, 'blocked', blocker, blockPoint, ballOrigin);
      const deflection = blocker && blockPoint
        ? { kind: 'deflection' as const, actor: blocker, team: O.idx, zone: fromZone, ball: blockPoint, outcome: 'controlled' }
        : undefined;
      if (!setPiece && this.r.chance(0.5)) {
        return this.corner(T, O, deflection && { ...deflection, outcome: 'deflectedForCorner' });
      }
      this.zone = boxZ;
      this.turnover(blocker, deflection);
      return;
    }
    const target = this.pick(T.zAtt[boxZ], (x) => this.aerial(x) ** 1.3 * (x.instr.runs + 1), s);
    const marker = this.pick(O.zDef[boxZ], (x) => this.aerial(x) ** 2);
    if (!target) { this.zone = boxZ; this.visualAction('cross', T.idx, s, fromZone, boxZ, 'noTarget', undefined, undefined, ballOrigin); this.turnover(marker); return; }
    const gk = this.gk(O);
    const claim = setPiece ? 0.12 : 0.08;
    if (this.r.chance(claim * (this.a(gk, A.handling) / 12))) {
      this.rate(gk, 0.05);
      this.zone = boxZ;
      this.visualAction('cross', T.idx, s, fromZone, boxZ, 'claimed', gk, [O.idx === 0 ? 4 : 96, 50], ballOrigin);
      this.line('gk-claims', gk);
      this.turnover(gk);
      return;
    }
    const p = logistic(logit(setPiece ? 0.42 : 0.5) + (this.aerial(target) - (marker ? this.aerial(marker) : 5)) / 3.5 + this.overload(boxZ, T, O) * 0.5);
    if (this.r.chance(p)) {
      this.rate(s, 0.05);
      this.lastPasser = s;
      this.lastPasserMoment = this.moment;
      this.zone = boxZ;
      this.visualAction('cross', T.idx, s, fromZone, boxZ, 'complete', target, undefined, ballOrigin);
      if (this.opts.commentary && this.r.chance(0.5)) this.line(setPiece ? 'corner-in' : 'cross', s, target);
      if (!setPiece) this.originNext = 'cross';
      this.shoot(T, O, target, 'header');
    } else {
      this.rate(marker, 0.05);
      this.zone = boxZ;
      this.visualAction('cross', T.idx, s, fromZone, boxZ, 'cleared', marker, undefined, ballOrigin);
      if (this.r.chance(0.42)) return this.corner(T, O);
      this.turnover(marker);
    }
  }

  private corner(T: TeamRT, O: TeamRT, origin?: { kind: 'keeper' | 'deflection'; actor: SP; team: number; zone: number; ball: [number, number]; outcome: string }) {
    T.stats.corners++;
    const takerId = T.tactic.corners;
    const taker = T.on.find((x) => x.p.id === takerId && !x.off) ?? this.pick(T.zAtt[this.zoneFor(T.idx, 3, 1)]) ?? T.on[0];
    const lane = this.r.chance(0.5) ? 0 : 2;
    const cornerZone = this.zoneFor(T.idx, 4, lane);
    this.zone = cornerZone;
    const cornerFlag: [number, number] = [T.idx === 0 ? 99.3 : 0.7, lane === 0 ? 1.5 : 98.5];
    if (origin) this.visualAction(origin.kind, origin.team, origin.actor, origin.zone, cornerZone, origin.outcome, taker, cornerFlag, origin.ball);
    this.corners.push({ m: this.minute, t: T.idx, taker: taker.p.id, lane, moment: this.moment });
    if (this.r.chance(0.3)) this.line('corner', taker);
    this.cross(T, O, taker, true, 0, cornerFlag);
  }

  private foulCheck(T: TeamRT, O: TeamRT, victim: SP, def: SP, forced = false): boolean {
    const dirt = def.p.attrs[A.dirtiness] + this.a(def, A.aggression);
    // en spiller med gult kort holder igen i tacklingerne
    if (def.yellow > 0 && !forced && this.r.chance(0.6)) return false;
    let fp = forced ? 1 + (O.ti.tackling - 1) * 0.25 + (dirt - 20) / 40 - 0.25 : 0.11 + (O.ti.tackling - 1) * 0.05 + (dirt - 20) / 220;
    // … også i de pressede dueller (ellers bliver andet gule kort alt for almindeligt)
    if (def.yellow > 0) fp *= 0.6;
    // hårde tacklinger på en bestemt spiller giver flere frispark (og kort)
    if (this.oi[O.idx]?.targets.some((x) => x.pid === victim.p.id && x.kind === 'hard')) fp *= 1.45;
    if (!this.r.chance(clamp(fp, 0.03, forced ? 1 : 0.35))) return false;
    O.stats.fouls++;
    this.rate(def, -0.05);
    this.injuryCheck(victim);
    // Kort
    // kalibreret (scripts/cards.ts): ~2 røde kort pr. hold pr. sæson, heraf ~40% andet gule kort
    const yp = (0.13 + 0.1 * (def.p.attrs[A.dirtiness] / 20) + (O.ti.tackling === 2 ? 0.03 : 0) - (def.p.attrs[A.temperament] - 10) / 200) * (def.yellow > 0 ? 0.2 : 1);
    if (this.r.chance(RED_BASE + def.p.attrs[A.dirtiness] / 8000)) this.sendOff(O, def, false);
    else if (this.r.chance(yp)) this.book(O, def);
    const rb = this.rb(T.idx);
    const lane = this.laneOf(T.idx);
    if (this.poss !== T.idx) return true; // røde kort kan ikke flytte bolden; sikkerhed
    // kun en del af frisparkene i feltet er straffespark (~0,3 pr. kamp); resten er frispark lige uden for
    if (rb === 4 && this.r.chance(0.3)) {
      this.line('penalty', victim, def, true);
      const takerId = T.tactic.penalties;
      const taker = T.on.find((x) => x.p.id === takerId && !x.off) ?? victim;
      this.shoot(T, O, taker, 'pen');
      return true;
    }
    if (rb >= 3) {
      this.line('freekick', victim, def);
      const takerId = T.tactic.freeKicks;
      const taker = T.on.find((x) => x.p.id === takerId && !x.off) ?? victim;
      if (lane === 1 && this.r.chance(0.55)) this.shoot(T, O, taker, 'fk');
      else this.cross(T, O, taker, true, 0.2);
      return true;
    }
    if (this.r.chance(0.08)) this.line('foul', def, victim);
    return true; // bolden forbliver hos angriberne
  }

  private book(t: TeamRT, sp: SP) {
    sp.yellow++;
    t.stats.yellows++;
    this.rate(sp, -0.3);
    if (sp.yellow >= 2) {
      this.sendOff(t, sp, true);
      return;
    }
    sp.line.yellow = 1;
    this.events.push({ m: this.minute, t: t.idx, k: 'yellow', p: sp.p.id });
    this.line('yellow', sp, null, true);
  }

  private sendOff(t: TeamRT, sp: SP, second: boolean) {
    sp.off = true;
    sp.line.red = true;
    sp.line.yellow = second ? 1 : sp.line.yellow;
    t.stats.reds++;
    this.rate(sp, -1.5);
    this.events.push({ m: this.minute, t: t.idx, k: 'red', p: sp.p.id });
    this.line(second ? 'second-yellow' : 'red', sp, null, true);
    sp.line.minutes = this.minute - sp.enteredAt;
    this.buildZones(t);
  }

  private injuryCheck(sp: SP) {
    const p = 0.013 * (0.35 + sp.p.attrs[A.injuryProneness] / 12) * (sp.cond < 0.55 ? 1.6 : 1);
    if (!this.r.chance(p)) return;
    sp.line.injured = true;
    const t = this.teams[sp.team];
    this.events.push({ m: this.minute, t: t.idx, k: 'injury', p: sp.p.id });
    this.line('injury', sp, null, true);
    // menneskets hold skifter selv ud (kampen pauses i UI'et) – kun AI-hold skifter automatisk
    if (t.subsLeft > 0 && t.benchIds.length && this.opts.aiSubs?.[t.idx] !== false) {
      this.autoSub(t, sp);
    } else {
      sp.cond = Math.min(sp.cond, 0.35);
    }
  }

  private shoot(T: TeamRT, O: TeamRT, s: SP, kind: string, bonus = 0) {
    this.holder = s.p.id;
    const z = this.zone;
    const base: Record<string, number> = { box: 0.145, boxWide: 0.055, long: 0.035, header: 0.095, oneOnOne: 0.33, cutback: 0.21, pen: 0.76, fk: 0.055, rebound: 0.24 };
    let xg = (base[kind] ?? 0.08) + bonus;
    if (kind === 'box' || kind === 'boxWide' || kind === 'header' || kind === 'long' || kind === 'cutback') {
      xg *= clamp(1.28 - 0.16 * O.wDef[z], 0.55, 1.3);
      // mere plads når forsvaret er i undertal
      if (O.men < T.men) xg *= 1 + SPACE_XG * (T.men - O.men);
    }
    xg = clamp(xg, 0.01, 0.8);
    T.stats.shots++;
    T.stats.xg += xg;
    s.line.shots++;
    this.bucketThreat += (T.idx === 0 ? 1 : -1) * xg * 4;
    const gk = this.gk(O);
    const q = kind === 'header' ? this.aerial(s) * 0.6 + this.a(s, A.heading) * 0.4
      : kind === 'long' ? 0.7 * this.a(s, A.longShots) + 0.3 * this.a(s, A.technique)
      : kind === 'pen' ? 0.6 * this.a(s, A.penalties) + 0.2 * this.a(s, A.technique) + 0.2 * s.p.attrs[A.pressure]
      : kind === 'fk' ? 0.7 * this.a(s, A.freeKicks) + 0.3 * this.a(s, A.technique)
      : this.finQ(s);
    const gq = kind === 'oneOnOne' ? this.gk1v1(gk) : this.gkQ(gk);
    const mult = (kind === 'pen' ? 1.04 : FINISH_SCALE) * Math.exp((q - gq) / 13);
    const goalP = clamp(xg * mult * (kind === 'pen' ? 1 : this.wx.finish), 0.004, 0.92);
    const assister = this.lastPasser && this.lastPasser !== s && this.lastPasser.team === T.idx && this.moment - this.lastPasserMoment <= 2 ? this.lastPasser : null;
    const rec: ShotRecord = { m: this.minute, t: T.idx, zone: z, xg: Math.round(xg * 100) / 100, outcome: 'off', p: s.p.id, kind };
    if (this.originNext) { rec.origin = this.originNext; this.originNext = ''; }
    // skud direkte efter et hjørnespark (samme øjeblik)
    const cn = this.corners.at(-1);
    if (cn && cn.moment === this.moment && cn.t === T.idx && !cn.shot) { cn.shot = true; rec.corner = cn.taker; }
    this.shots.push(rec);
    this.lastShotMoment = this.moment;
    // Blokering
    if ((kind === 'box' || kind === 'long' || kind === 'boxWide') && this.r.chance(clamp(0.1 + 0.05 * O.wDef[z], 0.08, 0.3))) {
      rec.outcome = 'blocked';
      const blk = this.pick(O.zDef[z]);
      const goalLine: [number, number] = [T.idx === 0 ? 100 : 0, 50];
      const blockLayout = blk && this.opts.recordVisualEvents ? this.visualPositions(z, T.idx, s.p.id) : undefined;
      const blockPoint = blk && blockLayout ? playerPoint(blockLayout, blk.p.id) ?? goalLine : goalLine;
      this.visualAction('shot', T.idx, s, z, z, 'blocked', blk, blockPoint);
      this.rate(blk, 0.06);
      this.line('shot-blocked', s, blk);
      const deflection = blk
        ? { kind: 'deflection' as const, actor: blk, team: O.idx, zone: z, ball: blockPoint, outcome: 'controlled' }
        : undefined;
      if (this.r.chance(0.55)) return this.corner(T, O, deflection && { ...deflection, outcome: 'deflectedForCorner' });
      this.turnover(blk, deflection);
      return;
    }
    if (this.r.chance(goalP)) {
      // offside? Gennembrud og afslutninger i feltet kan være offside – linjedommeren kan tage fejl,
      // men med VAR bliver tætte situationer tjekket og rettet
      const risk = kind === 'oneOnOne' ? 0.2 : kind === 'box' || kind === 'cutback' || kind === 'header' || kind === 'rebound' ? 0.1 : 0;
      let routineCheck = false;
      if (risk > 0) {
        const reallyOff = this.r.chance(risk + (O.ti.offside ? 0.04 : 0));
        const flagged = reallyOff ? this.r.chance(0.85) : this.r.chance(0.025);
        const checked = !!this.opts.var && (reallyOff !== flagged || flagged || this.r.chance(0.12));
        const disallow = checked ? reallyOff : flagged;
        if (disallow) {
          rec.outcome = 'offside';
          T.stats.offsides++;
          this.rate(s, -0.05);
          // først jubel – så kommer skuffelsen
          this.line('goal-cheer', s, null, true);
          if (checked) { this.line('var-check', s, null, true); this.line('var-disallowed', s, null, true); }
          else this.line('goal-offside', s, null, true);
          this.events.push({ m: this.minute, t: T.idx, k: 'offside-goal', p: s.p.id });
          this.visualAction('shot', T.idx, s, z, z, 'offside', null, [T.idx === 0 ? 100 : 0, 50]);
          this.zone = this.zoneFor(O.idx, 0, 1);
          this.poss = O.idx;
          return;
        }
        // flaget gik op, men VAR godkender målet
        if (checked && flagged) { this.line('var-check', s, null, true); this.line('var-given', s, null, true); }
        else routineCheck = checked;
      }
      rec.outcome = 'goal';
      T.stats.onTarget++;
      this.goal(T, O, s, assister, kind);
      this.visualAction('shot', T.idx, s, z, z, 'goal', gk, [T.idx === 0 ? 100 : 0, 50]);
      // rutinetjek: målet står ved magt
      if (routineCheck) { this.line('var-check', s, null, true); this.line('var-stands', s, null, true); }
      return;
    }
    const onT = clamp(0.19 + q / 70 + (kind === 'oneOnOne' ? 0.12 : 0) + (kind === 'pen' ? 0.5 : 0), 0.2, 0.92);
    if (this.r.chance((onT - goalP) / (1 - goalP))) {
      rec.outcome = 'saved';
      const savePoint: [number, number] = [T.idx === 0 ? 96 : 4, 50];
      this.visualAction('shot', T.idx, s, z, z, 'saved', gk, savePoint);
      T.stats.onTarget++;
      this.rate(s, 0.08);
      this.rate(gk, 0.22 + xg * 0.8);
      if (assister) this.rate(assister, 0.08);
      this.line(kind === 'pen' ? 'pen-saved' : kind === 'header' ? 'header-saved' : xg > 0.25 ? 'bigsave' : 'save', s, gk, kind === 'pen' || xg > 0.25);
      if (kind === 'pen') this.events.push({ m: this.minute, t: T.idx, k: 'pen-miss', p: s.p.id });
      const rr = this.r.next();
      if (rr < 0.12) {
        const fol = this.pick(T.zAtt[z], (x) => Math.sqrt(this.finQ(x)));
        if (fol) {
          this.visualAction('rebound', O.idx, gk, z, z, 'parried', fol, undefined, savePoint);
          this.rebound = fol;
          return;
        }
      }
      if (rr < 0.48) return this.corner(T, O, { kind: 'keeper', actor: gk, team: O.idx, zone: z, ball: savePoint, outcome: 'deflectedForCorner' });
      const keeperZone = this.zoneFor(O.idx, 0, 1);
      this.visualAction('keeper', O.idx, gk, z, keeperZone, 'held', undefined, undefined, savePoint);
      this.keeperHeld = gk;
      this.keeperBallPoint = this.opts.recordVisualEvents ? this.visualPositions(keeperZone, O.idx, gk.p.id).ball : null;
      this.holder = gk.p.id;
      this.zone = keeperZone;
      this.poss = O.idx;
      return;
    }
    rec.outcome = 'off';
    // træværket: gode afslutninger kan ramme stolpen/overliggeren – og give returbold
    if (kind !== 'pen' && xg >= 0.08 && this.r.chance(0.16)) {
      rec.post = true;
      const postPoint: [number, number] = [T.idx === 0 ? 100 : 0, 46];
      this.visualAction('shot', T.idx, s, z, z, 'post', null, postPoint);
      this.line('post', s, null, true);
      const fol = this.r.chance(0.3) ? this.pick(T.zAtt[z], (x) => Math.sqrt(this.finQ(x)), s) : null;
      if (fol) {
        this.visualAction('rebound', T.idx, s, z, z, 'postRebound', fol, undefined, postPoint);
        this.rebound = fol;
        return;
      }
      this.startGoalKick(O);
      return;
    }
    this.rate(s, kind === 'oneOnOne' || kind === 'pen' ? -0.35 : -0.05);
    this.visualAction('shot', T.idx, s, z, z, 'offTarget', null, [T.idx === 0 ? 101 : -1, 50]);
    this.line(kind === 'pen' ? 'pen-miss' : kind === 'header' ? 'header-wide' : kind === 'oneOnOne' ? 'miss-1v1' : kind === 'long' ? 'long-wide' : 'wide', s, null, kind === 'pen' || kind === 'oneOnOne');
    if (kind === 'pen') this.events.push({ m: this.minute, t: T.idx, k: 'pen-miss', p: s.p.id });
    this.startGoalKick(O);
  }

  private goal(T: TeamRT, O: TeamRT, s: SP, assister: SP | null, kind: string) {
    T.stats.goals++;
    s.line.goals++;
    this.rate(s, 1.0);
    if (assister && kind !== 'pen' && kind !== 'fk') {
      assister.line.assists++;
      this.rate(assister, 0.5);
    }
    const gk = this.gk(O);
    this.rate(gk, -0.25);
    for (const e of O.zDef[this.zone]) if (e.w > 0.35) this.rate(e.sp, -0.08);
    this.events.push({ m: this.minute, t: T.idx, k: 'goal', p: s.p.id, p2: assister && kind !== 'pen' ? assister.p.id : undefined });
    const key = kind === 'pen' ? 'goal-pen' : kind === 'header' ? 'goal-header' : kind === 'fk' ? 'goal-fk' : kind === 'long' ? 'goal-long' : kind === 'oneOnOne' ? 'goal-1v1' : 'goal';
    this.line(key, s, assister, true);
    this.line('score', null, null, true);
    // moral-sving
    T.moraleMult = Math.min(1.06, T.moraleMult + 0.01);
    O.moraleMult = Math.max(0.94, O.moraleMult - 0.008);
    this.kickoff(O.idx);
  }

  private turnover(winner: SP | null, deflection?: { kind: 'deflection'; ball: [number, number]; outcome: string }) {
    const O = this.teams[1 - this.poss];
    const previousVisual = this.visualTimeline.at(-1);
    const alreadyPresented = !!winner && previousVisual?.moment === this.moment && previousVisual.toPoss === O.idx
      && (previousVisual.actor === winner.p.id || previousVisual.target === winner.p.id);
    // A blocked shot/cross already names the defender as its target, but that
    // contact alone does not show whether they controlled or deflected the
    // ball. Keep the resolved follow-up action in the visual timeline.
    if (winner && (deflection || !alreadyPresented)) this.visualAction(deflection?.kind ?? 'turnover', O.idx, winner, this.zone, this.zone, deflection?.outcome ?? 'won', undefined, undefined, deflection?.ball);
    if (winner) {
      this.looseBall = null;
      if (O.tactic.slots[winner.slot]?.pos === 'GK') {
        this.keeperHeld = winner;
        this.keeperBallPoint = this.opts.recordVisualEvents ? this.visualPositions(this.zone, O.idx, winner.p.id).ball : null;
        this.holder = winner.p.id;
      }
    } else {
      const previous = this.opts.recordVisualEvents ? this.visualTimeline.at(-1) : undefined;
      const point = previous?.moment === this.moment && previous.ballTo
        ? previous.ballTo
        : this.looseBall?.point ?? this.visualPositions(this.zone, this.poss, 0).ball;
      this.looseBall = this.opts.recordVisualEvents ? { team: O.idx, zone: this.zone, point } : null;
      this.holder = 0;
    }
    this.poss = O.idx;
    this.lastPasser = null;
    // højt pres ("Ofte"): erobrer en angriber bolden højt på banen, er der straks en chance (arbejdsrate + aggression)
    if (winner && O.ti.closingDown === 2 && this.rb(O.idx) >= 3 && this.r.chance(clamp(0.05 + (this.a(winner, A.workRate) + this.a(winner, A.aggression) - 20) / 200, 0.02, 0.12))) {
      this.pressed = winner;
      this.line('press-win', winner, null, true);
      return;
    }
    // Kontra
    if (O.ti.counter) {
      const rb = this.rb(O.idx);
      if (rb <= 2 && this.r.chance(0.32)) {
        const T2 = this.teams[1 - O.idx];
        const runner = this.pick(O.zAtt[this.zoneFor(O.idx, Math.min(4, rb + 2), 1)], (x) => this.a(x, A.pace) ** 2);
        const chaser = this.pick(T2.zDef[this.zoneFor(O.idx, Math.min(4, rb + 2), 1)], (x) => this.a(x, A.pace));
        if (runner) {
          const p = logistic((this.a(runner, A.pace) + this.a(runner, A.acceleration) - (chaser ? this.a(chaser, A.pace) + this.a(chaser, A.acceleration) : 10)) / 6 + 0.3 * Math.log((T2.wDef[this.zoneFor(O.idx, 3, 1)] + 0.4) ** -1 + 1));
          if (this.r.chance(p * 0.55)) {
            this.zone = this.zoneFor(O.idx, Math.min(3, rb + 2), 1);
            this.line('counter', winner ?? runner, runner);
            if (this.r.chance(0.35)) { this.breakaway = runner; this.breakawayOrigin = 'counter'; }
          }
        }
      }
    }
  }

  // ---------- udskiftninger ----------

  substitute(teamIdx: number, outId: number, inId: number): boolean {
    const t = this.teams[teamIdx];
    if (t.subsLeft <= 0) return false;
    const out = t.on.find((s) => s.p.id === outId && !s.off);
    const p = t.players.get(inId);
    if (!out || !p || !t.benchIds.includes(inId)) return false;
    const sp = this.makeSP(t, p, out.slot, this.minute);
    out.off = true;
    out.line.minutes = this.minute - out.enteredAt;
    t.on[t.on.indexOf(out)] = sp;
    t.benchIds = t.benchIds.filter((id) => id !== inId);
    t.subsLeft--;
    t.tactic = { ...t.tactic, lineup: t.tactic.lineup.map((id) => (id === outId ? inId : id)) };
    this.events.push({ m: this.minute, t: teamIdx, k: 'sub', p: inId, p2: outId });
    this.line('sub', sp, out);
    this.buildZones(t);
    return true;
  }

  /** Holdsnak (fx i pausen): ny faktor pr. spiller; erstatter den tidligere snaks virkning */
  applyTalk(teamIdx: number, boosts: Record<number, number>) {
    const t = this.teams[teamIdx];
    for (const sp of t.on) {
      if (sp.off) continue;
      const old = t.talk.get(sp.p.id) ?? 1;
      const nf = boosts[sp.p.id] ?? 1;
      for (let i = 0; i < 36; i++) sp.eff[i] = (sp.eff[i] / old) * nf;
    }
    t.talk = new Map(Object.entries(boosts).map(([k, v]) => [Number(k), v]));
    this.buildZones(t);
  }

  setTactic(teamIdx: number, tactic: Tactic) {
    const t = this.teams[teamIdx];
    // taktiske ændringer registreres (vises på momentumgrafen og i analysen)
    if (tactic.formation !== t.tactic.formation) this.changes.push({ m: this.minute, t: teamIdx, kind: 'formation', to: tactic.formation });
    if (tactic.team.mentality !== t.ti.mentality) this.changes.push({ m: this.minute, t: teamIdx, kind: 'mentality', from: String(t.ti.mentality), to: String(tactic.team.mentality) });
    else if (tactic.formation === t.tactic.formation && JSON.stringify(tactic.team) !== JSON.stringify(t.ti)) this.changes.push({ m: this.minute, t: teamIdx, kind: 'instructions' });
    // Pladser kan være byttet om
    t.tactic = { ...tactic, lineup: t.tactic.lineup.slice(), bench: t.tactic.bench.slice() };
    t.ti = tactic.team;
    // omplacér spillere på banen efter ny opstilling
    tactic.lineup.forEach((id, slot) => {
      const sp = t.on.find((s) => s.p.id === id && !s.off);
      if (sp && sp.slot !== slot) {
        sp.slot = slot;
        const fit = fitFactor(slotFit(sp.p, tactic.slots[slot]));
        const oldFit = sp.eff[A.passing] / Math.max(0.01, sp.p.attrs[A.passing]);
        for (let i = 0; i < 36; i++) sp.eff[i] = (sp.eff[i] / oldFit) * fit;
      }
    });
    t.tactic.lineup = t.on.filter((s) => !s.off).reduce((arr, s) => { arr[s.slot] = s.p.id; return arr; }, tactic.slots.map(() => 0));
    this.buildZones(t);
    this.line('tactic-change', null, null);
  }

  private autoSub(t: TeamRT, out: SP) {
    const slot = t.tactic.slots[out.slot];
    const cands = t.benchIds.map((id) => t.players.get(id)!).filter(Boolean);
    if (!cands.length) return;
    const best = cands.sort((a, b) => fitFactor(slotFit(b, slot)) * b.ca - fitFactor(slotFit(a, slot)) * a.ca)[0];
    this.substitute(t.idx, out.p.id, best.id);
  }

  private aiManage() {
    if (this.minute < 46) return;
    for (const t of this.teams) if (this.opts.aiSubs?.[t.idx]) this.aiShift(t);
    if (this.minute < 55) return;
    for (const t of this.teams) {
      if (!this.opts.aiSubs?.[t.idx]) continue;
      if (t.subsLeft <= 0) continue;
      const chance = this.minute >= 80 ? 0.6 : this.minute >= 68 ? 0.45 : 0.3;
      if (!this.r.chance(chance)) continue;
      const cands = t.on.filter((s) => !s.off && t.tactic.slots[s.slot].pos !== 'GK');
      const worst = cands.sort((a, b) => a.cond * 10 + a.rating - (b.cond * 10 + b.rating))[0];
      if (worst && (worst.cond < 0.72 || worst.rating < 6.1)) this.autoSub(t, worst);
    }
  }

  /** AI-træneren reagerer på stillingen: jagter udligning eller lukker kampen */
  private aiShift(t: TeamRT) {
    const o = this.teams[1 - t.idx];
    const diff = t.stats.goals - o.stats.goals;
    const base = (t.baseMentality ??= t.ti.mentality);
    let want = base;
    if (diff < 0 && this.minute >= 55) want = Math.min(4, base + (this.minute >= 75 || diff <= -2 ? 2 : 1));
    else if (diff > 0 && this.minute >= 70) want = Math.max(0, base - (diff === 1 && this.minute >= 82 ? 2 : 1));
    if (want === t.ti.mentality) return;
    const chasing = want > base;
    const ti: TeamInstructions = { ...t.ti, mentality: want, counter: chasing ? false : want < base || t.ti.counter, tempo: chasing ? 2 : t.ti.tempo };
    this.changes.push({ m: this.minute, t: t.idx, kind: 'mentality', from: String(t.ti.mentality), to: String(want) });
    t.ti = ti;
    t.tactic = { ...t.tactic, team: ti };
    this.buildZones(t);
    const capt = t.on.find((s) => !s.off && s.p.id === t.tactic.captain) ?? t.on.find((s) => !s.off) ?? null;
    this.line(chasing ? 'ai-push' : want < base ? 'ai-shut' : 'tactic-change', capt, null);
    // jagter: skift en ekstra angriber ind for den svageste midtbanespiller
    if (chasing && t.subsLeft > 0 && this.minute >= 60) {
      const bench = t.benchIds.map((id) => t.players.get(id)).filter((p): p is Player => !!p && p.pos[0] < 15);
      const att = bench.sort((a, b) => b.attrs[A.finishing] + b.attrs[A.offTheBall] - (a.attrs[A.finishing] + a.attrs[A.offTheBall]))[0];
      const out = t.on.filter((s) => !s.off && ['DM', 'M', 'WB'].includes(t.tactic.slots[s.slot].pos)).sort((a, b) => a.rating - b.rating)[0];
      if (att && out && att.attrs[A.finishing] >= 11) this.substitute(t.idx, out.p.id, att.id);
    }
  }

  // ---------- straffe ----------

  private startShootout() {
    // lige mange skytter på hver side (holdet med flest spillere må undvære sine dårligste)
    const on = this.teams.map((t) => t.on.filter((s) => !s.off).sort((a, b) => this.a(b, A.penalties) - this.a(a, A.penalties)));
    const n = Math.min(on[0].length, on[1].length);
    this.shootout = { takers: [on[0].slice(0, n), on[1].slice(0, n)], score: [0, 0], kicks: [] };
    this.line('shootout', null, null, true);
  }

  /** Ét spark. Returnerer true, så længe konkurrencen ikke er afgjort. */
  private shootoutKick(): boolean {
    const so = this.shootout!;
    const k = so.kicks.length;
    const ti = k % 2, round = Math.floor(k / 2);
    const s = so.takers[ti][round % so.takers[ti].length];
    const gk = this.gk(this.teams[1 - ti]);
    const p = clamp(0.75 * Math.exp((0.7 * this.a(s, A.penalties) + 0.3 * s.p.attrs[A.pressure] - this.gkQ(gk)) / 22), 0.5, 0.92);
    // ét tal afgør både mål og (ved brændt) redning eller forbi
    const u = this.r.next();
    const scored = u < p, saved = !scored && u < p + (1 - p) * 0.65;
    if (scored) so.score[ti]++;
    so.kicks.push({ t: ti, p: s.p.id, gk: gk.p.id, outcome: scored ? 'goal' : saved ? 'saved' : 'off' });
    this.line(scored ? 'so-score' : saved ? 'so-miss' : 'so-wide', s, gk);
    const [a, b] = so.score;
    const taken = [Math.ceil((k + 1) / 2), Math.floor((k + 1) / 2)];
    let over: boolean;
    if (taken[1] < 5 || taken[0] < 5) over = a + (5 - taken[0]) < b || b + (5 - taken[1]) < a;
    else over = taken[0] === taken[1] && a !== b;
    if (!over && k < 60) return true;
    this.pens = [a, b];
    this.line('shootout-end', so.takers[a > b ? 0 : 1][0], null, true);
    return false;
  }

  // ---------- afslutning ----------

  private finish() {
    this.resolvePendingVisualPass(null);
    this.finished = true;
    this.momentum[this.momentumBucket] = Math.round(this.bucketThreat * 100) / 100;
    this.line('fulltime', null, null, true);
    const [h, a] = this.teams;
    const tot = h.stats.possession + a.stats.possession;
    h.stats.possession = Math.round((h.stats.possession / tot) * 100);
    a.stats.possession = 100 - h.stats.possession;
    h.stats.xg = Math.round(h.stats.xg * 100) / 100;
    a.stats.xg = Math.round(a.stats.xg * 100) / 100;
    const endMin = this.extraTime ? 120 : 90;
    for (const t of this.teams) {
      const opp = this.teams[1 - t.idx];
      const res = Math.sign(t.stats.goals - opp.stats.goals);
      for (const s of t.all) {
        if (!s.line.red && !s.off) s.line.minutes = endMin - s.enteredAt;
        else if (s.off && s.line.minutes === 0) s.line.minutes = Math.max(1, this.minute - s.enteredAt);
        let r = s.rating + res * 0.25;
        const role = slotRole(t.tactic.slots[s.slot]);
        if (opp.stats.goals === 0 && (role === 'GK' || role === 'CB' || role === 'FB') && s.line.minutes >= 60) r += 0.35;
        // korte indhop trækkes mod 6
        const w = Math.min(1, s.line.minutes / 60);
        r = 6.2 + (r - 6.2) * w;
        s.line.rating = Math.round(clamp(r, 1, 10) * 10) / 10;
        s.line.cond = Math.round(s.cond * 100);
      }
    }
  }

  report(): MatchReport {
    const all = [...this.teams[0].all, ...this.teams[1].all];
    const mom = all.slice().sort((a, b) => b.line.rating - a.line.rating)[0];
    return {
      fixture: this.opts.fixtureId ?? 0,
      home: this.teams[0].club,
      away: this.teams[1].club,
      stats: [this.teams[0].stats, this.teams[1].stats],
      players: all.map((s) => s.line),
      events: this.events,
      shots: this.shots,
      momentum: this.momentum.map((v) => v ?? 0),
      heat: this.heat,
      zoneControl: this.zonePoss.map((v, i) => (this.zoneTotal[i] ? Math.round((v / this.zoneTotal[i]) * 100) / 100 : 0.5)),
      mom: mom?.p.id ?? 0,
      commentary: this.commentary,
      visualTimeline: this.opts.recordVisualEvents ? this.visualTimeline : undefined,
      et: this.extraTime || undefined,
      pens: this.pens,
      shootout: this.shootout?.kicks,
      weather: this.opts.weather,
      changes: this.changes,
      formations: [this.teams[0].tactic.formation, this.teams[1].tactic.formation],
    };
  }

  /** Aktuelle on-pitch spillere (til live UI) */
  /** Øjebliksbillede til 2D-visningen: boldens zone, hvem der har den, og spillernes positioner fra taktikken */
  pitch(): MatchPitchSnapshot {
    const last = this.shots.at(-1);
    return {
      zone: this.zone,
      poss: this.poss,
      holder: this.holder,
      moment: this.moment,
      shot: last && last.m === this.minute && this.lastShotMoment === this.moment - 1 ? { team: last.t, outcome: last.post ? 'post' : last.outcome, zone: last.zone } : null,
      players: this.pitchPlayers(true),
    };
  }

  live(teamIdx: number) {
    const t = this.teams[teamIdx];
    return {
      on: t.on.map((s) => ({ id: s.p.id, slot: s.slot, off: s.off, cond: Math.round(s.cond * 100), rating: Math.round(clamp(s.rating, 1, 10) * 10) / 10, yellow: s.yellow, injured: s.line.injured, goals: s.line.goals, red: !!s.line.red, enteredAt: s.enteredAt })),
      /** udskiftede spillere (til karakteroversigten) */
      gone: t.all.filter((s) => !t.on.includes(s)).map((s) => ({ id: s.p.id, slot: s.slot, rating: Math.round(clamp(s.rating, 1, 10) * 10) / 10, yellow: s.yellow, goals: s.line.goals, enteredAt: s.enteredAt })),
      bench: t.benchIds.slice(),
      subsLeft: t.subsLeft,
      stats: t.stats,
      tactic: t.tactic,
    };
  }
}

function dist(x: number, y: number, z: number) {
  const b = Math.floor(z / ZL), l = z % ZL;
  return (zoneX(b) - x) ** 2 + (zoneY(l) - y) ** 2;
}

function name(p: Player) {
  return p.last || p.first;
}

/** Hurtig simulering uden kommentarer */
export function quickMatch(home: EngineTeam, away: EngineTeam, opts: Omit<EngineOptions, 'commentary'>, r: Rng): MatchReport {
  const sim = new MatchSim(home, away, { ...opts, commentary: false, aiSubs: opts.aiSubs ?? [true, true] }, r);
  return sim.runToEnd();
}

/** Zoneprofil for et hold – bruges af assistentens modstanderanalyse og den gennemsigtige motor */
export function zoneProfile(team: EngineTeam, asHome = true): { att: number[]; def: number[]; attQ: number[]; defQ: number[] } {
  const dummyRng = { next: () => 0.5, normal: (m: number) => m, chance: () => false } as unknown as Rng;
  const sim = new MatchSim(asHome ? team : team, team, { commentary: false, neutral: true }, dummyRng);
  const t = sim.teams[0];
  const q = (list: ZoneEntry[], f: (s: SP) => number) => {
    let s = 0, w = 0;
    for (const e of list) { s += f(e.sp) * e.w; w += e.w; }
    return w ? s / w : 0;
  };
  return {
    att: t.wAtt.map((v) => Math.round(v * 100) / 100),
    def: t.wDef.map((v) => Math.round(v * 100) / 100),
    attQ: t.zAtt.map((l) => Math.round(q(l, (s) => (s.eff[A.passing] + s.eff[A.dribbling] + s.eff[A.finishing] + s.eff[A.creativity]) / 4) * 10) / 10),
    defQ: t.zDef.map((l) => Math.round(q(l, (s) => (s.eff[A.tackling] + s.eff[A.marking] + s.eff[A.positioning] + s.eff[A.anticipation]) / 4) * 10) / 10),
  };
}

export const ZONES = { bands: ZB, lanes: ZL, count: NZ };
