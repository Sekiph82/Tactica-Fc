import { useEffect, useRef, useState } from 'react';
import { opponentReport } from '../../game/analysis';
import type { MatchSim } from '../../game/engine/match';
import { createLiveMatch, quickReport, userTactic } from '../../game/sim';
import { WEATHER_ICON, weatherFor } from '../../game/weather';
import { act } from '../../game/actions';
import { humanManager, isHumanClub } from '../../game/humans';
import { isBotClub } from '../../game/bots';
import { session, skippedMatches, type LiveCmd } from '../../online/client';
import { fixturesOn, gs, notify, squad } from '../../game/state';
import type { MatchPitchSnapshot, MatchReport, MatchVisualAction, OppInstructions, OppKind, ShootoutKick } from '../../game/types';
import { hasVisualQueueCapacity, pairVisualActionsWithSnapshot, type MatchVisualFrame } from '../../game/match-visual';
import { actionPresentationWindows, findNarrationActionIndex, narratedActionIndexes } from '../openFootballRecording';
import { t } from '../../i18n';
import { Bar, ClubLink, Crest, Panel, Pct, PlayerLink, posStr, Rating, Tabs } from '../components';
import { useGame, useNav } from '../core';
import { commentaryText } from '../commentary';
import { Head } from './common';
import { Pitch2D, cornerFrames, highlightFrames, incidentFrames, lastDitchFrames, offsideFrames, shootoutFrames, type Snap } from '../Pitch2D';
import { LeagueTable, LeagueTables } from './Competitions';
import { leagueRows } from '../../game/competitions';
import { TacticEditor } from './Tactics';
import { stageLabel } from './Fixtures';
import { useHotkeys } from '../hotkeys';
import { TeamTalk } from '../teamtalk';
import { talkDone } from '../../game/teamtalk';
import { OpenFootballPitch, type OpenFootballBridge, type OpenFootballProgress } from '../OpenFootballPitch';
import { makeOpenFootballSetup, type OpenFootballSetup } from '../openFootballSetup';
import { openFootballPlaybackSpeed } from '../openFootballSpeed';
import { OPEN_FOOTBALL_MATCH_DURATION_MS, OPEN_FOOTBALL_MAX_MATCH_DURATION_MS, openFootballMinuteTimestamp, openFootballShootoutDuration, openFootballTimestamp } from '../openFootballTimeline';
import { statColors, teamColors } from './matchColors';

// Den igangværende kamp overlever navigation mellem skærme
let live: { fixture: number; sim: MatchSim; viewerSetup: OpenFootballSetup; lines: { text: string; cls: string; m: number; moment: number; hg: number; ag: number; k?: string; aId?: number; bId?: number }[]; consumed: number; visualQueue: MatchVisualFrame[]; visualSeen: number; viewerEventsSeen?: number; viewer?: OpenFootballBridge; viewerPrimed?: boolean; halfShown?: boolean; shotsSeen?: number; cornersSeen?: number; h2hInit?: boolean; evSeen?: number; h2h?: H2hState; ldSeen?: number; prevTab?: string; finishFrameSent?: boolean; finishPresentationReady?: boolean; finishPresentationTimer?: ReturnType<typeof setTimeout>; extraTimeDurationSent?: boolean; shootoutPresentationStarted?: boolean; shootoutKicksSeen?: number } | null = null;

/** Stage and play one engine-resolved shootout kick on its own viewer beat. */
function shootoutPresentation(base: MatchPitchSnapshot, kick: ShootoutKick | undefined, moment: number) {
  const direction = kick?.t === 1 ? -1 : 1;
  const spot: [number, number] = [50 + direction * 38, 50];
  const goalX = direction === 1 ? 100 : 0;
  const keeperX = goalX - direction * 4;
  const keeperY = kick?.outcome === 'saved' ? (kick.p % 2 ? 46 : 54) : 50;
  const ballTo: [number, number] = kick?.outcome === 'goal'
    ? [goalX, 50]
    : kick?.outcome === 'saved'
      ? [keeperX, keeperY]
      : [goalX + direction * 2, kick && kick.p % 2 ? 39 : 61];
  const players = base.players.map((player, index) => {
    const angle = (index / Math.max(1, base.players.length)) * Math.PI * 2;
    let x = 50 + Math.cos(angle) * 6;
    let y = 50 + Math.sin(angle) * 8;
    if (player.gk) { x = player.team === 0 ? 4 : 96; y = 50; }
    if (kick?.gk === player.id) { x = keeperX; y = 50; }
    if (kick?.p === player.id) { x = spot[0] + direction * 4; y = 50; }
    return { ...player, x, y };
  });
  const snapshot: MatchPitchSnapshot = {
    ...base,
    moment,
    poss: kick?.t ?? base.poss,
    holder: kick?.p ?? base.holder,
    shot: kick ? { team: kick.t, outcome: kick.outcome === 'goal' ? 'goal' : kick.outcome === 'saved' ? 'saved' : 'off', zone: 0 } : null,
    players,
  };
  const action: MatchVisualAction | undefined = kick ? {
    moment: moment - 1,
    minute: 120,
    team: kick.t,
    kind: 'shot',
    actor: kick.p,
    target: kick.gk,
    fromZone: 0,
    toZone: 0,
    fromPoss: kick.t,
    toPoss: kick.t,
    from: spot,
    to: ballTo,
    ballFrom: spot,
    ballTo,
    outcome: kick.outcome,
  } : undefined;
  return { snapshot, action };
}

export function MatchScreen({ id }: { id: number }) {
  const g = useGame()!;
  const { nav } = useNav();
  const f = g.fixtures[id];
  const [phase, setPhase] = useState<'pre' | 'live'>(live?.fixture === id ? 'live' : 'pre');
  if (!f) return <Head title="?" />;
  // en kamp for en klub, man ikke (længere) styrer – fx lige efter et jobskifte
  if (!f.result && f.home !== g.userClub && f.away !== g.userClub && live?.fixture !== id) {
    return <div><Head title={t('match.notYours')} /><p className="muted">{t('match.notYoursText', { club: g.clubs[g.userClub]?.name ?? '' })}</p><button className="primary" onClick={() => nav({ name: 'inbox' })}>{t('nav.inbox')}</button></div>;
  }
  if (f.result && g.reports[id] && phase !== 'live') {
    return <div><Head title={t('match.played')} /><button onClick={() => nav({ name: 'report', id })}>{t('fix.report')}</button></div>;
  }
  // online: udeholdet i en kamp mod en anden manager følger kampen live
  if (!f.result && g.pendingFixture === id && g.humans && f.away === g.userClub && isHumanClub(f.home) && !isBotClub(f.home) && session()) return <FollowMatch id={id} />;
  if (phase === 'pre') return <PreMatch id={id} onPlay={() => setPhase('live')} onQuick={() => { const rep = quickReport(); if (rep) { act({ t: 'matchResult', fixture: f.id, rep }); nav({ name: 'report', id: f.id }); } }} />;
  return <LiveMatch id={id} onViewerRetry={() => setPhase('pre')} />;
}

function PreMatch({ id, onPlay, onQuick }: { id: number; onPlay: () => void; onQuick: () => void }) {
  const g = useGame()!;
  const { nav } = useNav();
  const f = g.fixtures[id];
  const [rep] = useState(() => opponentReport(f));
  const tac = userTactic(false);
  const isToday = g.pendingFixture === id;
  // online: to menneskelige managere mod hinanden – hjemmeholdets manager spiller kampen
  const awayVsHuman = !!g.humans && f.away === g.userClub && isHumanClub(f.home) && !isBotClub(f.home);
  const homeVsHuman = !!g.humans && !!session() && f.home === g.userClub && isHumanClub(f.away) && !isBotClub(f.away);
  useHotkeys((e) => { if (isToday && !awayVsHuman && e.key === 'Enter') { onPlay(); return true; } });
  return (
    <div>
      <Head title={`${g.comps[f.comp]?.name} – ${stageLabel(f)}`} />
      <Scoreboard home={f.home} away={f.away} hg={null} ag={null} minute={t('match.preview')} />
      <div className="insight weather-note">{WEATHER_ICON[weatherFor(f)]} <b>{t(`wx.${weatherFor(f)}`)}</b> – {t(`wx.d.${weatherFor(f)}`)}</div>
      <div className="cols">
        <Panel title={t('nav.tactics')}>
          <div className="kv">
            <span>{t('an.formation')}</span><span>{tac.formation} · {t(`ment.${tac.team.mentality}`)}</span>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => nav({ name: 'tactics' })}>{t('nav.tactics')}</button>
          </div>
        </Panel>
        <Panel title={t('an.opponent', { club: rep.opp.short })}>
          <div className="kv">
            <span>{t('an.formation')}</span><span>{rep.oppTactic.formation} ({t(`ment.${rep.oppTactic.team.mentality}`)})</span>
            <span>{t('col.form')}</span><span>{rep.form || '-'}</span>
            <span>{t('an.keyPlayers')}</span><span>{rep.keyPlayers.map((pid) => <span key={pid}><PlayerLink p={g.players[pid]} short /> </span>)}</span>
            <span>{t('an.odds')}</span><span><b className="good"><Pct v={rep.probs[0]} /></b> / <Pct v={rep.probs[1]} /> / <b className="bad"><Pct v={rep.probs[2]} /></b></span>
          </div>
          <div className="gap" />
          {rep.insights.map((i, k) => <div key={k} className={`insight ${i.tone}`}>{t(i.key, { ...i.params, lane: i.params?.lane ? t(`lane.${i.params.lane}`) : undefined })}</div>)}
        </Panel>
      </div>
      {isToday && !awayVsHuman && <OppInstructionsPanel fixture={id} rep={rep} />}
      {isToday && !gs().draft && <TeamTalk fixture={id} stage="pre" pids={[...tac.lineup, ...tac.bench].filter(Boolean)} diff={0} ratings={{}} />}
      {isToday && awayVsHuman ? (
        <div className="insight">{t('mp.h2hAway', { name: humanManager(f.home)?.name ?? '' })}</div>
      ) : isToday ? (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {!homeVsHuman && <button onClick={onQuick}>{t('match.quick')}</button>}
          <button className="primary continue" onClick={onPlay}>{homeVsHuman ? t('mp.h2hReady') : t('match.kickoff')}</button>
        </div>
      ) : <div className="muted">{t('match.notToday')}</div>}
    </div>
  );
}

const OPP_KINDS: OppKind[] = ['tight', 'press', 'hard', 'weakFoot'];

/** Instruktioner mod modstanderen: op til tre af deres spillere + hvilken side vi angriber */
function OppInstructionsPanel({ fixture, rep }: { fixture: number; rep: ReturnType<typeof opponentReport> }) {
  const g = useGame()!;
  const tac = g.tactic;
  if (!tac) return null;
  const cur: OppInstructions = tac.opp?.fixture === fixture ? tac.opp : { fixture, targets: [] };
  const save = (o: OppInstructions) => act({ t: 'tactic', tactic: { ...tac, opp: o } });
  const setKind = (pid: number, kind: OppKind | '') => {
    const targets = cur.targets.filter((x) => x.pid !== pid);
    if (kind) targets.push({ pid, kind });
    save({ ...cur, targets });
  };
  const xi = rep.oppTactic.lineup.map((pid, i) => ({ p: g.players[pid], slot: rep.oppTactic.slots[i] })).filter((x) => x.p);
  // nøglespillerne først
  xi.sort((a, b) => Number(rep.keyPlayers.includes(b.p.id)) - Number(rep.keyPlayers.includes(a.p.id)));
  const full = cur.targets.length >= 3;
  return (
    <Panel title={t('oi.title')} right={<span className="muted">{t('oi.count', { n: cur.targets.length })}</span>}>
      <div className="muted" style={{ marginBottom: 10 }}>{t('oi.intro')}</div>
      <div className="row" style={{ marginBottom: 12, gap: 8 }}>
        <b>{t('oi.focus')}</b>
        <div className="seg">
          {[undefined, 0, 1, 2].map((l) => (
            <button key={String(l)} className={cur.focusLane === l ? 'on' : ''} onClick={() => save({ ...cur, focusLane: l })}>
              {l === undefined ? t('oi.none') : t(`oi.lane${l}`)}
            </button>
          ))}
        </div>
        <button className="tag good oi-suggest" title={t('oi.useSuggest')} onClick={() => save({ ...cur, focusLane: rep.attackLane })}>{t('oi.suggest', { lane: rep.attackLane === undefined ? t('oi.none') : t(`oi.lane${rep.attackLane}`) })}</button>
      </div>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>{t('col.pos')}</th><th>{t('col.name')}</th><th>{t('oi.instruction')}</th></tr></thead>
          <tbody>
            {xi.map(({ p, slot }) => {
              const mine = cur.targets.find((x) => x.pid === p.id);
              return (
                <tr key={p.id} className={mine ? 'me' : ''}>
                  <td>{slot.pos}{slot.side !== 'C' ? slot.side : ''}</td>
                  <td><PlayerLink p={p} />{rep.keyPlayers.includes(p.id) && <span className="tag warn" style={{ marginLeft: 6 }}>{t('oi.key')}</span>}</td>
                  <td>
                    <select value={mine?.kind ?? ''} disabled={!mine && full} onChange={(e) => setKind(p.id, e.target.value as OppKind | '')}>
                      <option value="">–</option>
                      {OPP_KINDS.filter((k) => k !== 'weakFoot' || p.foot !== 'B').map((k) => <option key={k} value={k}>{t(`oi.k.${k}`)}{k === 'weakFoot' ? ` (${t(p.foot === 'L' ? 'oi.right' : 'oi.left')})` : ''}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="oi-help">
        {OPP_KINDS.map((k) => <div key={k}><b>{t(`oi.k.${k}`)}</b> – {t(`oi.d.${k}`)}</div>)}
      </div>
    </Panel>
  );
}

/** De sidste n linjer, nyeste først, med en fast nøgle (linjens plads i hele kommentaren) – så en
 *  mållinje ikke flytter til et nyt element og blinker igen, hver gang der kommer en ny linje */
function lastLines<T>(lines: T[], n: number): [T, number][] {
  const from = Math.max(0, lines.length - n);
  return lines.slice(from).map((l, i) => [l, from + i] as [T, number]).reverse();
}

/** CM-stil: holdbjælker i holdfarverne med stor score og minuttet til venstre */
function CmScoreboard({ home, away, hg, ag, minute, colors }: { home: number; away: number; hg: number; ag: number; minute: string; colors: [string, string, string, string] }) {
  const g = gs();
  return (
    <div className="cm-board">
      <div className="cm-team" style={{ borderLeftColor: colors[0] }}>
        <span className="cm-name"><Crest id={home} size={30} /><span className="name-long">{g.clubs[home]?.name}</span><span className="name-short">{g.clubs[home]?.short}</span></span>
        <span className="cm-score">{hg}</span>
      </div>
      <div className="cm-minute">{minute}</div>
      <div className="cm-team away" style={{ borderRightColor: colors[2] }}>
        <span className="cm-score">{ag}</span>
        <span className="cm-name"><span className="name-long">{g.clubs[away]?.name}</span><span className="name-short">{g.clubs[away]?.short}</span><Crest id={away} size={30} /></span>
      </div>
    </div>
  );
}

type LiveTeam = ReturnType<MatchSim['live']>;

/** Spillerkarakterer for begge hold side om side (som i CM): startere, indskiftede og ubrugte reserver */
function RatingsBoard({ sim, colors }: { sim: MatchSim; colors: [string, string, string, string] }) {
  const g = gs();
  const subMinute = (team: number, id: number, field: 'p' | 'p2') => sim.events.find((e) => e.k === 'sub' && e.t === team && e[field] === id)?.m;
  const cards = (team: number, id: number) => sim.events.filter((e) => e.t === team && e.p === id && (e.k === 'yellow' || e.k === 'red')).map((e) => e.k);
  const col = (lt: LiveTeam, team: number) => {
    const [bg, fg] = team === 0 ? [colors[0], colors[1]] : [colors[2], colors[3]];
    type Row = { id: number; num: number; rating?: number; goals?: number; info?: string; dim?: boolean };
    const starters = [...lt.on.filter((x) => x.enteredAt === 0), ...lt.gone.filter((x) => x.enteredAt === 0)].sort((a, b) => a.slot - b.slot);
    const rows: Row[] = starters.map((x) => {
      const out = subMinute(team, x.id, 'p2');
      const offRed = lt.on.find((o) => o.id === x.id)?.red;
      return { id: x.id, num: x.slot + 1, rating: x.rating, goals: x.goals, info: out ? t('rt.off', { m: out }) : offRed ? t('rt.sentOff') : undefined, dim: !!out || !!offRed };
    });
    let n = 12;
    for (const x of [...lt.on, ...lt.gone].filter((y) => y.enteredAt > 0)) rows.push({ id: x.id, num: n++, rating: x.rating, goals: x.goals, info: t('rt.on', { m: subMinute(team, x.id, 'p') ?? x.enteredAt }) });
    for (const id of lt.bench) rows.push({ id, num: n++, dim: true });
    return (
      <div className="cm-col">
        {rows.map((r) => {
          const p = g.players[r.id];
          const cs = cards(team, r.id);
          return (
            <div key={r.id} className={`cm-row ${r.dim ? 'dim' : ''}`}>
              <span className="cm-num" style={{ background: bg, color: fg }}>{r.num}</span>
              <span className="cm-pl">{cs.includes('red') ? <i className="cm-card red" /> : cs.includes('yellow') ? <i className="cm-card" /> : null}<PlayerLink p={p} /></span>
              <span className="cm-info">{r.info ?? ''}</span>
              <span className="cm-rt">{r.rating !== undefined && !(r.dim && !r.info) ? <Rating r={r.rating} /> : ''}</span>
              <span className="cm-goals">{r.goals ? '⚽'.repeat(Math.min(3, r.goals)) : ''}</span>
            </div>
          );
        })}
      </div>
    );
  };
  return <div className="cm-ratings">{col(sim.live(0), 0)}{col(sim.live(1), 1)}</div>;
}

function Scoreboard({ home, away, hg, ag, minute }: { home: number; away: number; hg: number | null; ag: number | null; minute: string }) {
  return (
    <div className="scoreboard">
      <div className="team"><Crest id={home} size={34} /><ClubLink id={home} noCrest /></div>
      <div>
        <div className="score">{hg === null ? 'v' : `${hg} - ${ag}`}</div>
        <div className="minute">{minute}</div>
      </div>
      <div className="team away"><Crest id={away} size={34} /><ClubLink id={away} noCrest /></div>
    </div>
  );
}

type H2hState = { phase: 'wait' | 'countdown' | 'play' | 'half'; homeSpeed: number; awaySpeed: number; awayReady: boolean; startAt: number; halfEnd: number; played: number; lastPing: number; awayTalked: boolean; seq: number; solo: boolean; waitSince: number };

/** Udeholdets ændringer (fra live-kanalen) lægges ind i kampen */
function applyAwayCmds(sim: MatchSim, s: H2hState, cmds: LiveCmd[]) {
  for (const c of cmds) {
    s.lastPing = Date.now();
    if (c.k === 'ready') s.awayReady = true;
    else if (c.k === 'sub') sim.substitute(1, c.out, c.inn);
    else if (c.k === 'ment') { const tac = sim.live(1).tactic; sim.setTactic(1, { ...tac, team: { ...tac.team, mentality: c.v } }); }
    else if (c.k === 'tactic') sim.setTactic(1, c.tac);
    else if (c.k === 'talk') { sim.applyTalk(1, c.boosts); s.awayTalked = true; }
    else if (c.k === 'speed') s.awaySpeed = c.v;
  }
}

let bgTimer: ReturnType<typeof setInterval> | null = null;
function stopH2hBackground() { if (bgTimer) { clearInterval(bgTimer); bgTimer = null; } }

/**
 * Kamp mod en anden manager, mens hjemmeholdets manager er på en anden skærm: kampen kører videre i fast tempo,
 * live-visningen sendes stadig til udeholdet, og ved slutfløjt lægges resultatet ind.
 */
function startH2hBackground(id: number) {
  const L = live;
  const sess = session();
  if (!L || !L.h2h || !sess || bgTimer || L.fixture !== id) return;
  const g = gs();
  const f = g.fixtures[id];
  const sim = L.sim, s = L.h2h;
  const home = g.clubs[f.home].short, away = g.clubs[f.away].short;
  const msPerMoment = ((g.options.h2hHalfMinutes ?? 3) * 2 * 60_000) / sim.totalMoments;
  let n = 0, busy = false, done = false;
  bgTimer = setInterval(() => {
    const now = Date.now();
    if (s.phase === 'wait' && s.awayReady) { s.phase = 'countdown'; s.startAt = now + 4000; }
    if (s.phase === 'countdown' && now >= s.startAt) s.phase = 'play';
    if (s.phase === 'half' && (now >= s.halfEnd || s.awayTalked)) s.phase = 'play';
    if (!s.solo && s.phase === 'play' && now - s.lastPing > 30_000) { s.solo = true; sim.opts.aiSubs = [false, true]; }
    if (s.phase === 'play' && !sim.finished) {
      // tempoet er det langsomste af de to managers valg
      s.played += 250 * Math.min(s.homeSpeed, s.awaySpeed);
      const target = Math.floor(s.played / msPerMoment);
      while (sim.moment < target && sim.step()) {
        // The head-to-head background has no local pitch replay; keep its presentation cursor current.
        L.visualSeen = sim.visualTimeline?.length ?? L.visualSeen;
        L.visualQueue.length = 0;
      }
      if (sim.half === 2 && !L.halfShown && !sim.finished) { L.halfShown = true; s.phase = 'half'; s.halfEnd = now + 60_000; }
    }
    if (++n % 4 !== 0 || busy || done) return;
    // kommentaren formateres som på kampskærmen
    const ctx = { home, away, score: `${home} ${sim.teams[0].stats.goals}-${sim.teams[1].stats.goals} ${away}` };
    while (L.consumed < sim.commentary.length) {
      const l = sim.commentary[L.consumed];
      L.lines.push({ text: commentaryText(l, ctx, L.consumed), cls: l.k.startsWith('goal') && l.k !== 'goal-offside' ? 'goal' : l.hi ? 'hi' : '', m: l.m, moment: l.moment, hg: sim.teams[0].stats.goals, ag: sim.teams[1].stats.goals, k: l.k, aId: l.aId, bId: l.bId });
      L.consumed++;
    }
    const finished = sim.finished;
    const report = finished ? sim.report() : undefined;
    const st = sim.teams.map((tm) => tm.stats);
    const data: FollowData = {
      seq: ++s.seq, phase: s.phase, awayReady: s.awayReady, homeSpeed: s.homeSpeed, awaySpeed: s.awaySpeed,
      countdown: s.phase === 'countdown' ? Math.max(0, Math.ceil((s.startAt - now) / 1000)) : 0,
      halfLeft: s.phase === 'half' ? Math.max(0, Math.ceil((s.halfEnd - now) / 1000)) : 0,
      minute: finished ? t('match.ft') : `${sim.minute}'`, hg: st[0].goals, ag: st[1].goals, finished, stats: [st[0], st[1]],
      lines: L.lines.slice(-60), live: [sim.live(0), sim.live(1)], events: sim.events,
      snap: { ...sim.pitch(), zone: 7, poss: 0, holder: 0, moment: 0, shot: null }, banner: L.lines.at(-1)?.text ?? '', report,
    };
    busy = true;
    sess.livePush(id, data).then((cmds) => applyAwayCmds(sim, s, cmds)).catch(() => {}).finally(() => {
      busy = false;
      if (finished && report) {
        // slutfløjt: resultatet lægges ind (og sendes til værten) – kampen er færdig
        done = true;
        stopH2hBackground();
        act({ t: 'matchResult', fixture: id, rep: report });
        if (live === L) live = null;
      }
    });
  }, 250);
}

function LiveMatch({ id, onViewerRetry }: { id: number; onViewerRetry: () => void }) {
  const g = useGame()!;
  const { nav } = useNav();
  const f = g.fixtures[id];
  useEffect(() => {
    document.querySelector<HTMLElement>('.main')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [id]);
  if (!live || live.fixture !== id) {
    const sim = createLiveMatch(f);
    live = { fixture: id, sim, viewerSetup: makeOpenFootballSetup(g, f, sim), lines: [], consumed: 0, visualQueue: [], visualSeen: 0 };
  }
  const L = live;
  const sim = L.sim;
  const me = f.home === g.userClub ? 0 : 1;
  const [, force] = useState(0);
  // online, kamp mod en anden manager: fælles kickoff, fast tempo og fælles pause – vi (hjemmeholdet) kører kampen
  const sess = session();
  const h2h = !!sess && !!g.humans && me === 0 && isHumanClub(f.away) && !isBotClub(f.away);
  // tilstanden ligger på kampen (ikke komponenten), så den overlever, at man klikker rundt i spillet
  if (!L.h2h) L.h2h = { phase: 'wait', homeSpeed: 1, awaySpeed: 1, awayReady: false, startAt: 0, halfEnd: 0, played: 0, lastPing: Date.now(), awayTalked: false, seq: 0, solo: false, waitSince: Date.now() };
  const H = { current: L.h2h };
  const hs = H.current;
  // kampen kører i baggrunden, mens man er på andre skærme – her på kampskærmen overtager komponenten igen
  useEffect(() => {
    if (!h2h) return;
    stopH2hBackground();
    return () => { if (live && !live.sim.finished) startH2hBackground(id); };
  }, [h2h, id]);
  if (h2h && !L.h2hInit) { L.h2hInit = true; sim.opts.aiSubs = [false, false]; }
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState('commentary');
  const [report, setReport] = useState<MatchReport | null>(() => L.finishPresentationReady ? sim.report() : null);
  const [viewerBridge, setViewerBridge] = useState<OpenFootballBridge | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerProgress, setViewerProgress] = useState<OpenFootballProgress | null>(null);
  const [viewerPrimed, setViewerPrimed] = useState(() => !!L.viewerPrimed);
  const [viewerFailed, setViewerFailed] = useState(false);
  const [activeNarration, setActiveNarration] = useState<{ text: string; minute: number; moment: number; hg: number; ag: number } | null>(null);
  const [visualFrame, setVisualFrame] = useState<MatchVisualFrame | undefined>(() => L.visualQueue.shift());
  // flashes/bump/reveal: pr. billede – stor tekst, midlertidig ændring af stillingen (jubel før et annulleret mål) og hvor mange nye kommentarlinjer der vises
  const [hl, setHl] = useState<{ frames: Snap[]; i: number; outcome: string; texts: string[]; hideFrom: number; team: number; flashes?: (string | undefined)[]; bump?: number[]; reveal?: number[]; label?: string } | null>(null);
  const [msg, setMsg] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const home = g.clubs[f.home].short, away = g.clubs[f.away].short;

  const pull = () => {
    const ctx = { home, away, score: `${home} ${sim.teams[0].stats.goals}-${sim.teams[1].stats.goals} ${away}` };
    while (L.consumed < sim.commentary.length) {
      const l = sim.commentary[L.consumed];
      const cls = l.k.startsWith('goal') && l.k !== 'goal-offside' ? 'goal' : l.hi ? 'hi' : '';
      L.lines.push({ text: commentaryText(l, ctx, L.consumed), cls, m: l.m, moment: l.moment, hg: sim.teams[0].stats.goals, ag: sim.teams[1].stats.goals, k: l.k, aId: l.aId, bId: l.bId });
      L.consumed++;
    }
  };

  const advance = (maxMoments: number, untilLine = true) => {
    const before = sim.commentary.length;
    const viewerSnapshots: MatchPitchSnapshot[] = [];
    const viewerActions: MatchVisualAction[] = [];
    const shootoutGoals: { player_id: number; time: number; is_auto_goal: boolean }[] = [];
    // straffesparkskonkurrencen: højst ét spark ad gangen
    const soBefore = sim.shootout?.kicks.length ?? -1;
    let n = 0;
    // Count the frame currently animating as well as queued frames. This prevents simulation
    // time from getting ahead of what the viewer has actually shown.
    while (n < maxMoments && (!untilLine || sim.commentary.length === before) && (h2h || L.viewer || hasVisualQueueCapacity(L.visualQueue.length + (visualFrame ? 1 : 0)))) {
      if (!sim.step()) break;
      n++;
      if (sim.extraTime && L.viewer && !L.extraTimeDurationSent) {
        L.viewer.setDuration(OPEN_FOOTBALL_MAX_MATCH_DURATION_MS);
        // The simulation only enters extra time during active play. Extend and
        // resume the viewer before its regulation clock can stop at 90:00.
        L.viewer.setPlaying(true);
        L.extraTimeDurationSent = true;
      }
      const shootoutKicks = sim.shootout?.kicks ?? [];
      const shootoutKickCount = shootoutKicks.length;
      if (sim.shootout && L.viewer && (shootoutKickCount > (L.shootoutKicksSeen ?? 0) || !L.shootoutPresentationStarted)) {
        L.viewer.setDuration(openFootballShootoutDuration(shootoutKickCount, sim.totalMoments));
        // The regulation/extra-time playhead can reach its endpoint between
        // simulation steps. Reopen it before staging the first penalty beat.
        L.viewer.setPlaying(true);
        L.shootoutPresentationStarted = true;
      }
      const pitchSnapshot = sim.pitch();
      if (L.viewer) {
        if (sim.shootout && shootoutKickCount > (L.shootoutKicksSeen ?? 0)) {
          const kick = shootoutKicks[shootoutKickCount - 1];
          const extraTimeEnd = sim.totalMoments + Math.round(sim.totalMoments / 3);
          const kickMoment = extraTimeEnd + shootoutKickCount - 1 + 0.25;
          const presentation = shootoutPresentation(pitchSnapshot, kick, kickMoment + 1);
          viewerSnapshots.push(presentation.snapshot);
          if (presentation.action) {
            viewerActions.push(presentation.action);
            if (kick.outcome === 'goal') {
              shootoutGoals.push({
                player_id: kick.p,
                time: openFootballTimestamp(presentation.action.moment + 0.5, sim.totalMoments),
                is_auto_goal: false,
              });
            }
          }
          L.shootoutKicksSeen = shootoutKickCount;
        } else if (sim.shootout && !L.shootoutKicksSeen) {
          const extraTimeEnd = sim.totalMoments + Math.round(sim.totalMoments / 3);
          viewerSnapshots.push(shootoutPresentation(pitchSnapshot, undefined, extraTimeEnd + 0.05).snapshot);
        } else if (!sim.shootout) viewerSnapshots.push(pitchSnapshot);
      }
      const timeline = sim.visualTimeline ?? [];
      const freshVisual = timeline.slice(L.visualSeen);
      if (L.viewer) viewerActions.push(...freshVisual);
      if (!h2h && freshVisual.length) {
        const paired = pairVisualActionsWithSnapshot(freshVisual, pitchSnapshot);
        if (!L.viewer) L.visualQueue.push(...paired);
      }
      L.visualSeen = timeline.length;
      if ((sim.shootout?.kicks.length ?? -1) !== soBefore) break;
    }
    const linesBefore = L.lines.length;
    pull();
    // The final successful simulation step ends at moment totalMoments - 1.
    // Append one terminal sample at the exact viewer duration before stopping
    // playback, so the visual match reaches 90:00 instead of freezing one beat
    // early when the simulation reports full time on its next step.
    if (sim.finished && L.viewer && !L.finishFrameSent) viewerSnapshots.push(sim.pitch());
    if (L.viewer && viewerSnapshots.length) {
      const newLines = L.lines.slice(linesBefore);
      const lineActionCues = newLines.map((line) => ({ moment: line.moment, kind: line.k, actorId: line.aId, targetId: line.bId }));
      const selectedActionIndexes = new Set(narratedActionIndexes(lineActionCues, viewerActions));
      const narratedActions = viewerActions.filter((_action, index) => selectedActionIndexes.has(index));
      const actionWindows = actionPresentationWindows(narratedActions, sim.totalMoments);
      const narration = newLines.map((line) => {
        const actionIndex = findNarrationActionIndex({ moment: line.moment, kind: line.k, actorId: line.aId, targetId: line.bId }, narratedActions);
        const action = actionIndex >= 0 ? narratedActions[actionIndex] : undefined;
        return {
          moment: line.moment,
          atTimeMs: actionIndex >= 0
            ? action?.kind === 'shot' && (action.outcome === 'goal' || action.outcome === 'offside')
              ? actionWindows[actionIndex]?.end
              : actionWindows[actionIndex]?.event
            : undefined,
          atMoment: actionIndex >= 0 ? undefined : line.moment,
          minute: line.m,
          text: line.text,
          hg: line.hg,
          ag: line.ag,
          kind: line.k,
          actorId: line.aId,
          targetId: line.bId,
        };
      });
      const goals = sim.events.slice(L.viewerEventsSeen ?? 0).flatMap((event) => {
        if (event.k !== 'goal' || event.p === undefined) return [];
        const shotIndex = narratedActions.findIndex((action) => action.kind === 'shot' && action.outcome === 'goal'
          && action.team === event.t && action.actor === event.p && action.minute === event.m
          && newLines.some((line) => line.moment === action.moment && line.m === event.m && (line.k?.startsWith('goal') ?? false) && line.k !== 'goal-offside'));
        if (shotIndex < 0) return [];
        return [{ player_id: event.p, time: actionWindows[shotIndex]?.end ?? openFootballMinuteTimestamp(event.m), is_auto_goal: false }];
      });
      L.viewerEventsSeen = sim.events.length;
      L.viewer.push(viewerSnapshots, [...goals, ...shootoutGoals], narratedActions, narration);
      if (sim.finished) L.finishFrameSent = true;
    }
    // store chancer og mål afspilles på 2D-banen (kampen venter imens)
    const seen = L.shotsSeen ?? 0;
    const fresh = sim.shots.slice(seen);
    L.shotsSeen = sim.shots.length;
    // højdepunkter: mål, store chancer – og de taktiske situationer (kontra, gennembrud, indlæg, solo, pres, frispark, cutback, langskud, stolpe)
    // hvor mange højdepunkter: kun mål, store chancer (standard) eller alle afslutninger
    const level = g.options.highlights ?? 'big';
    const big = fresh.filter((sh) => level === 'all' || sh.outcome === 'goal' || sh.outcome === 'offside' || sh.kind === 'pen' || (level === 'big' && (sh.xg >= 0.1 || sh.kind === 'oneOnOne' || (sh.outcome === 'saved' && sh.xg >= 0.07)
      || !!sh.origin || sh.post || sh.kind === 'fk' || sh.kind === 'cutback' || (sh.kind === 'long' && (sh.outcome === 'saved' || sh.xg >= 0.05))))).at(-1);
    let started = false;
    // hjørnespark: med afslutning vises de som chancen; uden afslutning som et kort indlæg, forsvaret rydder
    const newCorners = sim.corners.slice(L.cornersSeen ?? 0);
    L.cornersSeen = sim.corners.length;
    const lastCorner = newCorners.at(-1);
    // et skud i samme minut som hjørnesparket (fx efter en clearing) vises også som hjørnesparkets afslutning
    const cornerShot = fresh.filter((sh) => sh.corner).at(-1)
      ?? (lastCorner && fresh.at(-1) && fresh.at(-1)!.m === lastCorner.m && fresh.at(-1)!.t === lastCorner.t ? { ...fresh.at(-1)!, corner: lastCorner.taker } : undefined);
    const bigOrCorner = big ? (cornerShot && cornerShot.m === big.m && cornerShot.p === big.p ? cornerShot : big) : level === 'goals' ? undefined : cornerShot;
    const plainCorner = level !== 'goals' && !bigOrCorner && fresh.length === 0 && lastCorner;
    if (plainCorner && speed < 8 && !L.viewer) {
      const taker = g.players[plainCorner.taker]?.last ?? '';
      const lastNew = L.lines.length > linesBefore ? L.lines.at(-1)!.text : '';
      // er den sidste linje bare "Hjørnespark. X gør klar", står der intet om udfaldet – så rydder forsvaret
      const result = L.lines.length > linesBefore && sim.commentary.at(-1)?.k !== 'corner' ? lastNew : '';
      setHl({ frames: cornerFrames(sim.pitch(), plainCorner), i: 0, outcome: result ? 'none' : 'cleared', texts: [t('hl.cornerSetup', { a: taker }), t('hl.cornerCross', { a: taker }), result || t('hl.cornerCleared')], hideFrom: linesBefore, team: plainCorner.t });
      started = true;
    }
    // annullerede mål vises med jubel → skuffelse i alle visninger (også kommentaren)
    if (bigOrCorner && (speed < 8 || bigOrCorner.outcome === 'goal') && !L.viewer) {
      const big = bigOrCorner;
      const assist = big.outcome === 'goal' ? sim.events.filter((e) => e.k === 'goal' && e.p === big.p).at(-1)?.p2 : undefined;
      const frames = highlightFrames(sim.pitch(), big, assist);
      // teksten følger billederne: opspil → aflevering → afslutning → det, der faktisk skete
      const name = (fr: Snap) => fr.players.find((p) => p.id === fr.holder)?.name ?? '';
      const shooter = frames.at(-1) ? name(frames.at(-1)!) : '';
      // kun linjerne om selve afslutningen: ved mål fra mållinjen og frem (mål, stilling, evt. VAR), ellers den sidste linje
      const fresh = L.lines.slice(linesBefore);
      const gi = big.outcome === 'goal' ? fresh.findIndex((l) => l.cls === 'goal') : -1;
      const result = (gi >= 0 ? fresh.slice(gi).map((l) => l.text).join(' · ') : fresh.at(-1)?.text) || (L.lines.at(-1)?.text ?? '');
      const taker = big.corner ? g.players[big.corner]?.last ?? '' : '';
      const tag = big.origin ?? (['fk', 'long', 'cutback'].includes(big.kind) ? big.kind : '');
      const texts = big.corner
        ? [t('hl.cornerSetup', { a: taker }), t('hl.cornerCross', { a: taker }), result]
        : tag
        ? frames.map((fr, i) => (i === frames.length - 1 ? result : i === 0 ? t(`hl.t.${tag}`, { a: name(fr), b: shooter }) : i === frames.length - 2 ? t('hl.shoot', { a: shooter }) : t(`hl.t2.${tag}`, { a: name(fr), b: shooter })))
        : big.kind === 'pen'
        ? [t('hl.penSetup', { a: shooter }), t('hl.penRun', { a: shooter }), result]
        : frames.map((fr, i) => (i === frames.length - 1 ? result : i === 0 ? t('hl.build', { a: name(fr) }) : i === 1 ? t('hl.pass', { a: name(fr), b: shooter }) : t('hl.shoot', { a: shooter })));
      const fl = L.lines.slice(linesBefore);
      const ci = fl.findIndex((l) => l.k === 'goal-cheer');
      if (big.outcome === 'offside' && ci >= 0) {
        // annulleret mål: MÅL! (stillingen går op) → evt. VAR-tjek → AFLYST/OFFSIDE
        const tail = fl.slice(ci);
        const gi = frames.length - 1;
        const all = [...frames, ...tail.slice(1).map((_, j) => ({ ...frames[gi], moment: frames[gi].moment + j + 1 }))];
        const tx = [...texts.slice(0, gi), ...tail.map((l) => l.text)];
        const flashes = all.map((_, j) => {
          if (j < gi) return undefined;
          const k = tail[j - gi]?.k;
          return k === 'goal-cheer' ? t('hl.goal') : k === 'var-check' ? t('hl.varCheck') : k === 'var-disallowed' ? t('hl.disallowed') : k === 'goal-offside' ? t('hl.offside') : undefined;
        });
        setHl({ frames: all, i: 0, outcome: 'offside', texts: tx, hideFrom: linesBefore, team: big.t, flashes,
          bump: all.map((_, j) => (j >= gi && j < all.length - 1 ? 1 : 0)), reveal: all.map((_, j) => (j < gi ? 0 : ci + (j - gi) + 1)) });
      } else setHl({ frames, i: 0, outcome: big.post ? 'post' : big.outcome, texts, hideFrom: linesBefore, team: big.t, label: big.corner ? undefined : tag ? `hl.k.${big.post && !big.origin ? 'post' : tag}` : big.post ? 'hl.k.post' : undefined });
      started = true;
    }
    // skade eller rødt kort på mit hold: pause og over på taktik, så man selv kan justere
    const newEv = sim.events.slice(L.evSeen ?? 0);
    L.evSeen = sim.events.length;
    const hit = newEv.filter((e) => e.t === me && (e.k === 'injury' || e.k === 'red')).at(-1);
    if (hit && !sim.finished) {
      const name = hit.p ? g.players[hit.p]?.last ?? '' : '';
      if (!h2h) setPaused(true);
      if (tab !== 'tactics') L.prevTab = tab;
      setTab('tactics');
      setMsg(t(hit.k === 'injury' ? 'match.injuryStop' : 'match.redStop', { name }));
    }
    // straffesparkskonkurrencen: hvert spark afspilles på 2D-banen
    const kick = sim.shootout && sim.shootout.kicks.length > Math.max(0, soBefore) ? sim.shootout.kicks.at(-1)! : null;
    if (kick && speed < 8 && !L.viewer) {
      const taker = g.players[kick.p]?.last ?? '';
      const result = L.lines.slice(linesBefore).find((l) => l.k?.startsWith('so-'))?.text ?? '';
      setHl({ frames: shootoutFrames(sim.pitch(), kick), i: 0, outcome: kick.outcome, texts: [t('hl.soSetup', { a: taker }), t('hl.penRun', { a: taker }), result], hideFrom: linesBefore, team: kick.t, label: 'hl.k.shootout' });
      started = true;
    }
    // redningstackling (ingen afslutning): løberen alene – forsvareren redder
    const newLd = sim.highlights.slice(L.ldSeen ?? 0);
    L.ldSeen = sim.highlights.length;
    const ld = newLd.filter((h) => h.kind === 'lastDitch').at(-1);
    if (!started && ld && level !== 'goals' && speed < 8 && !L.viewer) {
      const runner = g.players[ld.p]?.last ?? '', cover = g.players[ld.p2]?.last ?? '';
      setHl({ frames: lastDitchFrames(sim.pitch(), ld), i: 0, outcome: 'lastDitch', texts: [t('hl.t.lastDitch', { a: runner }), t('hl.t2.lastDitch', { a: runner, b: cover }), L.lines.at(-1)?.text ?? ''], hideFrom: linesBefore, team: ld.t, label: 'hl.k.lastDitch' });
      started = true;
    }
    // mindre højdepunkter (kun ved "Alle"): offside, kort og skader
    if (!started && level === 'all' && speed < 8 && !L.viewer) {
      const off = newLd.filter((h) => h.kind === 'offside').at(-1);
      const inc = newEv.filter((e) => e.k === 'yellow' || e.k === 'red' || e.k === 'injury').at(-1);
      const lineFor = (...ks: string[]) => L.lines.slice(linesBefore).reverse().find((l) => ks.some((k) => l.k?.startsWith(k)))?.text ?? L.lines.at(-1)?.text ?? '';
      if (off) {
        const runner = g.players[off.p]?.last ?? '', passer = g.players[off.p2]?.last ?? '';
        setHl({ frames: offsideFrames(sim.pitch(), off), i: 0, outcome: 'offsideFlag', texts: [t('hl.t.offside', { a: passer, b: runner }), lineFor('offside')], hideFrom: linesBefore, team: off.t, label: 'hl.k.offside' });
        started = true;
      } else if (inc) {
        const who = g.players[inc.p ?? 0]?.last ?? '';
        const kind = inc.k as 'yellow' | 'red' | 'injury';
        setHl({ frames: incidentFrames(sim.pitch(), { t: inc.t, p: inc.p ?? 0 }), i: 0, outcome: kind, texts: [t(`hl.t.${kind}`, { a: who }), lineFor(...(kind === 'red' ? ['red', 'second-yellow'] : [kind]))], hideFrom: linesBefore, team: inc.t, label: `hl.k.${kind}` });
        started = true;
      }
    }
    if (sim.finished && !report) {
      if (L.viewer && !L.finishPresentationReady) {
        if (L.finishPresentationTimer === undefined) {
          const viewerSpeed = openFootballPlaybackSpeed(speed, h2h ? {
            halfMinutes: g.options.h2hHalfMinutes ?? 3,
            homeSpeed: hs.homeSpeed,
            awaySpeed: hs.awaySpeed,
          } : undefined);
          const finalBeatMs = Math.max(0, Math.round(OPEN_FOOTBALL_MATCH_DURATION_MS / Math.max(1, sim.totalMoments) / viewerSpeed));
          L.finishPresentationTimer = setTimeout(() => {
            L.finishPresentationReady = true;
            setReport(sim.report());
          }, finalBeatMs);
        }
      } else setReport(sim.report());
    }
    else if (!started) maybeHalftime();
    if (started) {
      // The highlight sequence below represents this spell of play; discard its ordinary-play queue.
      L.visualQueue.length = 0;
      setVisualFrame(undefined);
    }
    force((x) => x + 1);
  };

  // Give the viewer one authoritative future sample before kickoff. It can
  // interpolate the opening movement instead of holding the first frame
  // until the next 2-second simulation beat arrives.
  useEffect(() => {
    if (h2h || !viewerReady || !viewerBridge || paused || report || viewerPrimed) return;
    if (L.viewerPrimed) { setViewerPrimed(true); return; }
    L.viewerPrimed = true;
    advance(1, false);
    setViewerPrimed(true);
  }, [h2h, viewerReady, viewerBridge, paused, report, viewerPrimed, L]);

  // pausen: stop og giv holdet en peptalk – bagefter tilbage til den visning, man kom fra
  const maybeHalftime = () => {
    if (sim.half === 2 && !L.halfShown && !talkDone(id, 'half') && !sim.finished) {
      L.halfShown = true;
      L.prevTab = tab === 'talk' ? 'commentary' : tab;
      if (h2h) { H.current.phase = 'half'; H.current.halfEnd = Date.now() + 60_000; }
      else setPaused(true);
      setTab('talk');
    }
  };

  // seneste udgaver til det faste ur (intervallet oprettes kun én gang)
  const advRef = useRef(advance);
  advRef.current = advance;
  const hlRef = useRef(hl);
  hlRef.current = hl;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    if (!h2h || report) return;
    const msPerMoment = ((g.options.h2hHalfMinutes ?? 3) * 2 * 60_000) / sim.totalMoments;
    const h = setInterval(() => {
      const s = H.current;
      const now = Date.now();
      // Do not start the shared kickoff clock until the match presentation is
      // ready. Otherwise a slow WASM load can advance the authoritative match
      // before the viewer has displayed its opening frame.
      if (!viewerReady) { force((x) => x + 1); return; }
      if (s.phase === 'wait' && s.awayReady) { s.phase = 'countdown'; s.startAt = now + 4000; }
      if (s.phase === 'countdown' && now >= s.startAt) {
        s.phase = 'play';
        // Match the single-player viewer's lookahead: publish the first real
        // engine step before releasing the shared kickoff clock.
        if (!L.viewerPrimed && sim.moment === 0) {
          L.viewerPrimed = true;
          s.played = msPerMoment;
          advRef.current(1, false);
        }
      }
      if (s.phase === 'half' && (now >= s.halfEnd || (s.awayTalked && talkDone(id, 'half')))) { s.phase = 'play'; setTab(L.prevTab ?? 'commentary'); }
      // udeholdet er faldet fra (intet livstegn i 30 sek.): dets assistent tager over
      if (!s.solo && s.phase === 'play' && now - s.lastPing > 30_000) { s.solo = true; sim.opts.aiSubs = [false, true]; }
      force((x) => x + 1);
      if (s.phase !== 'play' || hlRef.current) return;
      // tempoet er det langsomste af de to managers valg
      s.played += 250 * Math.min(s.homeSpeed, s.awaySpeed);
      const target = Math.floor(s.played / msPerMoment);
      if (target > sim.moment) advRef.current(target - sim.moment, false);
    }, 250);
    return () => clearInterval(h);
  }, [h2h, report, viewerReady, viewerFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (h2h) return; // fast tempo – styres ovenfor
    if (paused || report || hl || !viewerReady) return;
    const useViewer = !!viewerBridge && viewerReady && !viewerFailed;
    const ms = useViewer
      ? Math.max(30, Math.round(OPEN_FOOTBALL_MATCH_DURATION_MS / sim.totalMoments / speed))
      : Math.max(30, g.options.matchSpeed / speed);
    const h = setInterval(() => advance(useViewer ? 1 : speed >= 8 ? 40 : 12), ms);
    return () => clearInterval(h);
  }, [h2h, paused, report, hl, speed, viewerBridge, viewerReady, viewerFailed]);

  // Play every deterministic engine action in order instead of jumping directly to the newest event.
  // This clock only drives presentation; it never advances MatchSim or consumes match RNG.
  useEffect(() => {
    if (h2h || paused || hl || (viewerBridge && viewerReady && !viewerFailed)) return;
    const h = setInterval(() => {
      const next = L.visualQueue.shift();
      setVisualFrame((current) => next ?? (L.visualQueue.length === 0 ? undefined : current));
    }, Math.max(100, Math.round(600 / Math.sqrt(speed))));
    return () => clearInterval(h);
  }, [h2h, paused, hl, speed, L, viewerBridge, viewerReady, viewerFailed]);

  useEffect(() => {
    viewerBridge?.setPlaying(!paused && !report && viewerReady && !viewerFailed && (!h2h || hs.phase === 'play'));
  }, [viewerBridge, paused, report, viewerReady, viewerFailed, h2h, hs.phase]);

  // afspil højdepunktet billede for billede – det sidste billede (udfaldet) bliver stående lidt længere
  const frameMs = Math.round(950 / Math.sqrt(speed));
  useEffect(() => {
    if (!hl || paused) return;
    const last = hl.i >= hl.frames.length - 1;
    const slow = hl.flashes?.[hl.i] === t('hl.varCheck') ? 2 : hl.flashes?.[hl.i] === t('hl.goal') ? 1.6 : 1;
    const h = setTimeout(() => { if (last) { setHl(null); maybeHalftime(); } else setHl({ ...hl, i: hl.i + 1 }); }, last ? frameMs * 2.2 : frameMs * slow);
    return () => clearTimeout(h);
  }, [hl, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  });

  useHotkeys((e) => {
    const k = e.key.toLowerCase();
    if (report) {
      if (e.key === 'Enter') { done(); return true; }
      return;
    }
    if (k === 'p') { setPaused(!paused); return true; }
    if (['1', '2', '3', '4'].includes(e.key)) { setSpeed([1, 2, 4, 8][Number(e.key) - 1]); return true; }
    if (k === 't') { setPaused(true); setTab('tactics'); return true; }
    if (k === 'u' || k === 'h') { setPaused(true); setTab('tactics'); return true; }
    if (k === 'c' || k === 'k') { setTab('commentary'); return true; }
    if (k === 's') { setTab('stats'); return true; }
    if (k === 'e') { finishNow(); return true; }
  });

  const finishNow = () => {
    if (!viewerReady) return;
    while (sim.step());
    pull();
    setReport(sim.report());
  };

  const done = () => {
    if (!report) return;
    // via en handling, så resultatet også når værten i online-spil
    act({ t: 'matchResult', fixture: id, rep: report });
    live = null;
    notify();
    nav({ name: 'report', id });
  };

  const st = sim.teams.map((tm) => tm.stats);
  const myLive = sim.live(me);
  const halfTalk = !gs().draft && sim.half === 2 && !report && (tab === 'talk' || (!talkDone(id, 'half') && sim.minute <= 50));
  const myGoals = sim.teams[me].stats.goals - sim.teams[1 - me].stats.goals;
  const liveRatings = Object.fromEntries(myLive.on.filter((s) => !s.off).map((s) => [s.id, Math.round(s.rating * 10) / 10]));

  // kun kampe i samme turnering (samme liga eller pokal)
  const others = fixturesOn(f.date).map((fid) => g.fixtures[fid]).filter((x) => x && x.id !== id && x.result && x.comp === f.comp);
  const minute = sim.finished ? t('match.ft') : `${sim.minute}'`;
  // straffesparkskonkurrencen: sparket, der afspilles, tæller først, når bolden er sparket
  const soKicks = sim.shootout ? sim.shootout.kicks.slice(0, sim.shootout.kicks.length - (hl?.label === 'hl.k.shootout' && hl.i < hl.frames.length - 1 ? 1 : 0)) : null;
  const soScore = soKicks ? [0, 1].map((tm) => soKicks.filter((k) => k.t === tm && k.outcome === 'goal').length) : null;
  const minuteLabel = minute + (soScore ? ` (${t('fix.pens')}\u00a0${soScore[0]}\u2011${soScore[1]})` : '');
  const viewMinuteLabel = (activeNarration ? `${activeNarration.minute}'` : visualFrame ? `${visualFrame.action.minute}'` : minute) + (soScore ? ` (${t('fix.pens')}\u00a0${soScore[0]}\u2011${soScore[1]})` : '');
  const colors = teamColors(f.home, f.away, me);
  // et mål vises først på resultattavlen, når højdepunktet når frem til målet
  const spoil = hl && hl.outcome === 'goal' && hl.label !== 'hl.k.shootout' && hl.i < hl.frames.length - 1 ? hl.team : -1;
  // jubel før et annulleret mål: stillingen står midlertidigt et mål højere
  const fake = hl?.bump?.[hl.i] ? hl.team : -1;

  // live-visningen til udeholdet hvert sekund
  const hg = st[0].goals - (spoil === 0 ? 1 : 0) + (fake === 0 ? 1 : 0), ag = st[1].goals - (spoil === 1 ? 1 : 0) + (fake === 1 ? 1 : 0);
  const syncedLines = activeNarration ? L.lines.filter((line) => line.moment <= activeNarration.moment) : [];
  const shownLines = hl?.reveal ? syncedLines.slice(0, hl.hideFrom + hl.reveal[hl.i]) : hl && hl.i < hl.frames.length - 1 ? syncedLines.slice(0, hl.hideFrom) : syncedLines;
  const countdown = hs.phase === 'countdown' ? Math.max(0, Math.ceil((hs.startAt - Date.now()) / 1000)) : 0;
  const halfLeft = hs.phase === 'half' ? Math.max(0, Math.ceil((hs.halfEnd - Date.now()) / 1000)) : 0;
  const liveRef = useRef<FollowData | null>(null);
  if (h2h) {
    liveRef.current = {
      seq: ++hs.seq, phase: hs.phase, awayReady: hs.awayReady, homeSpeed: hs.homeSpeed, awaySpeed: hs.awaySpeed, countdown, halfLeft,
      minute: minuteLabel, hg, ag, finished: !!report, stats: [st[0], st[1]],
      lines: shownLines.slice(-60), live: [sim.live(0), sim.live(1)], events: sim.events,
      snap: hl ? hl.frames[hl.i] : { ...sim.pitch(), zone: 7, poss: 0, holder: 0, moment: 0, shot: null },
      banner: hl ? hl.texts[hl.i] ?? '' : L.lines.at(-1)?.text ?? '',
      flash: hl ? (hl.flashes ? hl.flashes[hl.i] : hl.i === hl.frames.length - 1 && hl.outcome !== 'none' ? t(`hl.${hl.outcome}`) : undefined) : undefined,
      report: report ?? undefined,
    };
  }
  useEffect(() => {
    if (!h2h || !sess) return;
    let busy = false;
    const h = setInterval(() => {
      if (busy || !liveRef.current) return;
      busy = true;
      sess.livePush(id, liveRef.current).then((cmds) => {
        // udeholdets ændringer
        applyAwayCmds(sim, H.current, cmds);
        if (cmds.length) { pull(); force((x) => x + 1); }
      }).catch(() => {}).finally(() => { busy = false; });
    }, 1000);
    return () => clearInterval(h);
  }, [h2h, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const awayName = humanManager(f.away)?.name ?? '';
  // advar mod at genindlæse/lukke midt i kampen
  useEffect(() => {
    if (report) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [report]);

  return (
    <div className="match-screen">
      <div className="match-brandline"><img src={`${import.meta.env.BASE_URL}tactica-brand/Tactica_FC_Black_Metal_32x32.png?v=25`} alt="" width="32" height="32" /><strong>TACTICA <span>FC</span></strong><span>{g.comps[f.comp]?.name} · {stageLabel(f)}</span></div>
      <Head title={`${g.comps[f.comp]?.name} – ${stageLabel(f)}`}>
        {!report && h2h && <H2hSpeed mine={hs.homeSpeed} theirs={hs.awaySpeed} name={humanManager(f.away)?.name ?? ''} onPick={(v) => { hs.homeSpeed = v; force((x) => x + 1); }} />}
        {!report && !h2h && <>
          <button data-space onClick={() => setPaused(!paused)}>{paused ? `▶ ${t('match.resume')}` : `❚❚ ${t('match.pause')}`}</button>
          {[1, 2, 4, 8].map((s) => <button key={s} className={speed === s ? 'primary small' : 'small'} onClick={() => setSpeed(s)}>{s}×</button>)}
          <button disabled={!viewerReady} onClick={finishNow}>{t('match.toEnd')}</button>
        </>}
        {!report && (
          <select className="hl-level" value={g.options.highlights ?? 'big'} title={t('hl.level')} onChange={(e) => { g.options.highlights = e.target.value as 'big'; notify(); }}>
            {(['goals', 'big', 'all'] as const).map((k) => <option key={k} value={k}>{t('hl.level')}: {t(`hl.level.${k}`)}</option>)}
          </select>
        )}
        {report && <button className="primary continue" onClick={done}>{t('match.continue')}</button>}
      </Head>
      <CmScoreboard home={f.home} away={f.away} hg={activeNarration?.hg ?? (viewerReady ? 0 : st[0].goals)} ag={activeNarration?.ag ?? (viewerReady ? 0 : st[1].goals)} colors={colors} minute={viewMinuteLabel + (paused && !report ? ' ❚❚' : '')} />
      <div className="muted kbd-hint" style={{ marginBottom: 8 }}>{report ? t('match.keysDone') : h2h ? '' : t('match.keys')}</div>
      {msg && <div className="insight">{msg}</div>}
      {h2h && hs.phase === 'half' && <div className="insight">{t('mp.h2hHalf', { s: halfLeft })}</div>}
      {h2h && (hs.phase === 'wait' || hs.phase === 'countdown') && (
        <div className="sim-overlay"><div className="sim-card">
          {hs.phase === 'wait' ? <>
            <h2>{t('mp.h2hWaitTitle')}</h2>
            <div className="muted">{t('mp.h2hWaitAway', { name: awayName })}</div>
            <div className="sim-bar"><span /></div>
            {Date.now() - hs.waitSince > 60_000 && <button className="small" onClick={() => { hs.solo = true; sim.opts.aiSubs = [false, true]; hs.awayReady = true; }}>{t('mp.h2hStartAlone', { name: awayName })}</button>}
          </> : <>
            <div className="countdown">{countdown || '⚽'}</div>
            <h2>{t('mp.h2hKickoff')}</h2>
          </>}
        </div></div>
      )}
      <div className="match2d">
          <div className="match-stage">
            <OpenFootballPitch id={id} setup={L.viewerSetup} speed={openFootballPlaybackSpeed(speed, h2h ? { halfMinutes: g.options.h2hHalfMinutes ?? 3, homeSpeed: hs.homeSpeed, awaySpeed: hs.awaySpeed } : undefined)} playing={!paused && !report && viewerReady && !viewerFailed && (h2h || viewerPrimed) && (!h2h || hs.phase === 'play')}
              onBridge={(bridge) => { L.viewer = bridge ?? undefined; setViewerBridge(bridge); }} onReady={(ready) => { setViewerReady(ready); if (ready) setViewerFailed(false); }} onProgress={setViewerProgress} onNarration={setActiveNarration}
              onFailure={() => { L.viewer = undefined; setViewerBridge(null); setViewerReady(false); setViewerFailed(true); }} />
            {!viewerReady && <div className="match-viewer-status" role="status" aria-live="polite">
              <div className="match-viewer-status-card">
                <strong>{viewerFailed ? t('match.viewerFailed') : t(viewerProgress ? `match.viewer.phase.${viewerProgress.phase}` : 'match.viewerLoading')}</strong>
                <span>{viewerFailed ? t('match.viewerRetryHint') : viewerProgress?.phase === 'building' ? t('match.viewerBuildProgress', { done: viewerProgress.done, total: viewerProgress.total }) : t('match.viewerKickoffWait')}</span>
                {!viewerFailed && viewerProgress?.phase === 'building' && <div className="viewer-progress" aria-label={t('match.viewerBuildProgress', { done: viewerProgress.done, total: viewerProgress.total })}><i style={{ width: `${viewerProgress.total ? Math.min(100, (viewerProgress.done / viewerProgress.total) * 100) : 0}%` }} /></div>}
                {viewerFailed && <button className="primary" onClick={onViewerRetry}>{t('match.viewerRetry')}</button>}
              </div>
            </div>}
          </div>
          <div className="match-actionbar">
            <strong>{activeNarration?.text ?? (viewerReady ? '' : L.lines.at(-1)?.text) ?? g.clubs[f.home]?.name}</strong>
            <div><span>{g.comps[f.comp]?.name}</span><button onClick={() => setTab('stats')}>{t('match.stats')}</button><button onClick={() => setTab('tactics')}>{t('nav.tactics')}</button></div>
          </div>
      </div>
      <Tabs tabs={[['commentary', t('match.commentary')], ['ratings', t('match.ratings')], ['stats', t('match.stats')], ['scores', t('match.vidiprinter')], ['table', t('comp.table')], ['tactics', `${t('nav.tactics')} (${t('match.subsLeft', { n: myLive.subsLeft })})`], ...(halfTalk ? [['talk', t('tt.tab')] as [string, string]] : [])]} value={tab} onChange={setTab} />
      {tab === 'talk' && halfTalk && (
        <TeamTalk fixture={id} stage="half" pids={[...myLive.on.filter((s) => !s.off).map((s) => s.id), ...myLive.bench]} diff={myGoals} ratings={liveRatings}
          onGiven={(boosts) => { sim.applyTalk(me, boosts); setTab(L.prevTab ?? 'commentary'); }} />
      )}
      {tab === 'commentary' && (
        <div className="cols match-comm">
          <div className="commentary" ref={boxRef}>
            {(hl?.reveal ? L.lines.slice(0, hl.hideFrom + hl.reveal[hl.i]) : L.lines).map((l, i) => <div key={i} className={`ln ${l.cls}`}><span className="m">{l.m}'</span>{l.text}</div>)}
          </div>
          <Panel title={t('match.vidiprinter')}>
            <div className="vidiprinter">
              {others.map((o) => {
                const goals = o.result!.scorers.filter(([m]) => m <= (sim.finished ? 200 : sim.minute));
                const hg = goals.filter(([, tm]) => tm === 0).length, ag = goals.length - hg;
                return <div key={o.id}>{g.clubs[o.home]?.short} {hg}-{ag} {g.clubs[o.away]?.short}</div>;
              })}
              {others.length === 0 && <span className="muted">{t('match.noOther')}</span>}
            </div>
          </Panel>
        </div>
      )}
      {tab === 'stats' && <StatsPanel stats={[st[0], st[1]]} home={home} away={away} colors={statColors(f.home, f.away, me)} />}
      {tab === 'ratings' && <RatingsBoard sim={sim} colors={colors} />}
      {tab === 'scores' && (
        <Panel title={t('match.vidiprinter')}>
          <div className="vidiprinter cm-scores">
            {others.map((o) => {
              const goals = o.result!.scorers.filter(([m]) => m <= (sim.finished ? 200 : sim.minute));
              const hg = goals.filter(([, tm]) => tm === 0).length, ag = goals.length - hg;
              return <div key={o.id}><span>{g.clubs[o.home]?.name}</span><b>{hg} - {ag}</b><span>{g.clubs[o.away]?.name}</span></div>;
            })}
            {others.length === 0 && <span className="muted">{t('match.noOther')}</span>}
          </div>
        </Panel>
      )}
      {tab === 'table' && g.comps[f.comp]?.type === 'league' && (g.comps[f.comp].splitDone ? <LeagueTables comp={g.comps[f.comp]} /> : <Panel className="flush"><LeagueTable rows={leagueRows(g.comps[f.comp])} comp={g.comps[f.comp]} /></Panel>)}
      {tab === 'table' && g.comps[f.comp]?.type !== 'league' && <div className="muted">{t('match.noTable')}</div>}
      {!report && <div className="muted leave-note">⚠️ {t(h2h ? 'match.leaveH2h' : g.humans ? 'match.leaveMp' : 'match.leaveSp', { name: awayName })}</div>}
      <div className="cm-venue">{g.clubs[f.home]?.stadium}{g.clubs[f.home]?.name ? `, ${g.clubs[f.home]?.name}` : ''} · {WEATHER_ICON[weatherFor(f)]} {t(`wx.${weatherFor(f)}`)}</div>
      {tab === 'tactics' && !report && (
        <SubsPanel sim={sim} me={me} live={myLive} onDone={(ok) => { setMsg(ok ? '' : t('match.subFailed')); pull(); force((x) => x + 1); }} />
      )}
      {tab === 'tactics' && !report && (
        <TacticEditor tactic={myLive.tactic} players={squad(g.userClub).filter((p) => myLive.on.some((s) => s.id === p.id && !s.off) || myLive.bench.includes(p.id))} matchMode
          cond={Object.fromEntries(myLive.on.map((s) => [s.id, s.cond]))}
          onChange={(tac) => { sim.setTactic(me, tac); pull(); force((x) => x + 1); }}
          onSub={(out, inn) => { const ok = sim.substitute(me, out, inn); setMsg(ok ? '' : t('match.subFailed')); pull(); force((x) => x + 1); }} />
      )}
    </div>
  );
}

/** Udskiftninger under kampen: bænken som tydelige kort – vælg hvem der skal ud */
function SubsPanel({ sim, me, live, onDone }: { sim: MatchSim; me: number; live: ReturnType<MatchSim['live']>; onDone: (ok: boolean) => void }) {
  const g = useGame()!;
  const onPitch = live.on.filter((s) => !s.off);
  const slotName = (slot: number) => { const sl = live.tactic.slots[slot]; return sl ? `${sl.pos}${sl.side !== 'C' ? sl.side : ''}` : ''; };
  return (
    <Panel title={`${t('match.subsTitle')} · ${t('match.subsLeft', { n: live.subsLeft })}`} className="subs-panel">
      {live.bench.length === 0 && <div className="muted">{t('common.none')}</div>}
      <div className="subs-grid">
        {live.bench.map((bid) => {
          const p = g.players[bid];
          if (!p) return null;
          return (
            <div key={bid} className="sub-card">
              <div className="sub-head"><span className="tag">{posStr(p)}</span><PlayerLink p={p} short /></div>
              <div className="row muted" style={{ fontSize: 12 }}><Bar value={p.condition} /> {Math.round(p.condition)}%</div>
              {live.subsLeft > 0 ? (
                <select value="" onChange={(e) => onDone(sim.substitute(me, Number(e.target.value), bid))}>
                  <option value="">{t('match.subInFor')}</option>
                  {onPitch.map((s) => <option key={s.id} value={s.id}>{slotName(s.slot)} {g.players[s.id]?.last} – {Math.round(s.cond)}%{s.yellow ? ' 🟨' : ''}{s.injured ? ' ✚' : ''} ({s.rating.toFixed(1)})</option>)}
                </select>
              ) : <span className="muted">{t('match.noSubsLeft')}</span>}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Tempo i en kamp mellem to managere: hver vælger, og det langsomste valg gælder */
function H2hSpeed({ mine, theirs, name, onPick }: { mine: number; theirs: number; name: string; onPick: (v: number) => void }) {
  const eff = Math.min(mine, theirs);
  return (
    <>
      <span className="muted nowrap" title={t('mp.h2hSpeedHint')}>{t('mp.h2hSpeedNow', { x: eff })}{theirs !== mine ? ` · ${t('mp.h2hSpeedTheirs', { name, x: theirs })}` : ''}</span>
      {[1, 2, 4].map((v) => <button key={v} className={mine === v ? 'primary small' : 'small'} title={t('mp.h2hSpeedHint')} onClick={() => onPick(v)}>{v}×</button>)}
    </>
  );
}

/** Det, hjemmeholdet sender til udeholdet under en kamp mellem to managere */
type FollowData = {
  seq: number; phase: 'wait' | 'countdown' | 'play' | 'half'; awayReady: boolean; homeSpeed: number; awaySpeed: number; countdown: number; halfLeft: number;
  minute: string; hg: number; ag: number; finished: boolean; stats: [MatchReport['stats'][0], MatchReport['stats'][1]];
  lines: { text: string; cls: string; m: number; moment?: number }[]; live: [LiveTeam, LiveTeam]; events: MatchSim['events'];
  snap: Snap; banner: string; flash?: string; report?: MatchReport;
};

/** Udeholdet spiller med live: kampen kører hos hjemmeholdet i fast tempo – vi sender klar, taktik, udskiftninger og peptalk */
function FollowMatch({ id }: { id: number }) {
  const g = useGame()!;
  const { nav } = useNav();
  const f = g.fixtures[id];
  useEffect(() => {
    document.querySelector<HTMLElement>('.main')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [id]);
  const sess = session()!;
  const [data, setData] = useState<FollowData | null>(null);
  const [tab, setTab] = useState('commentary');
  const [sent, setSent] = useState('');
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  readyRef.current = ready;
  const lastReadySent = useRef(0);
  const [talked, setTalked] = useState(false);
  const [mySpeed, setMySpeed] = useState(1);
  const lastSeq = useRef({ seq: -1, at: Date.now() });
  const [, force] = useState(0);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const d = await sess.liveGet<FollowData>(id);
        if (!stop && d) {
          if (d.seq !== lastSeq.current.seq) lastSeq.current = { seq: d.seq, at: Date.now() };
          // hjemmeholdet har genindlæst, og kampen venter forfra: send vores "klar" igen
          if (d.phase === 'wait' && !d.awayReady && readyRef.current && Date.now() - lastReadySent.current > 3000) {
            lastReadySent.current = Date.now();
            void sess.liveCmd(id, { k: 'ready' }).catch(() => {});
          }
          setData(d);
        }
      } catch { /* prøv igen */ }
      if (!stop) { force((x) => x + 1); setTimeout(tick, 1000); }
    };
    void tick();
    // livstegn, så hjemmeholdet ved, at vi stadig er her
    const ping = setInterval(() => { void sess.liveCmd(id, { k: 'ping' }).catch(() => {}); }, 8000);
    return () => { stop = true; clearInterval(ping); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const colors = teamColors(f.home, f.away, 1);
  const homeMgr = humanManager(f.home)?.name ?? '';
  const send = (cmd: LiveCmd, label?: string) => { void sess.liveCmd(id, cmd).then(() => { if (label) setSent(label); }).catch(() => setSent(t('mp.followFail'))); };
  const sayReady = () => { setReady(true); lastReadySent.current = Date.now(); send({ k: 'ready' }); };
  const skip = () => { skippedMatches.add(id); nav({ name: 'inbox' }); };
  const lost = !!data && !data.finished && Date.now() - lastSeq.current.at > 30_000;
  useEffect(() => {
    if (data?.finished) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [data?.finished]);
  const head = <Head title={`${g.comps[f.comp]?.name} – ${stageLabel(f)}`}>{data && !data.finished && <H2hSpeed mine={mySpeed} theirs={data.homeSpeed} name={homeMgr} onPick={(v) => { setMySpeed(v); send({ k: 'speed', v }); }} />}{data?.finished && <button className="primary continue" onClick={() => { if (data.report) act({ t: 'matchResult', fixture: id, rep: data.report }); nav({ name: data.report ? 'report' : 'inbox', id }); }}>{t('match.continue')}</button>}</Head>;
  // før kampen: klar-tjek og nedtælling
  if (!data || data.phase === 'wait' || data.phase === 'countdown') {
    const iAmReady = ready;
    return (
      <div>
        {head}
        <Scoreboard home={f.home} away={f.away} hg={null} ag={null} minute={t('match.preview')} />
        <div className="sim-card" style={{ margin: '16px auto' }}>
          {data?.phase === 'countdown' ? <><div className="countdown">{data.countdown || '⚽'}</div><h2>{t('mp.h2hKickoff')}</h2></> : <>
            <h2>{t('mp.h2hWaitTitle')}</h2>
            <div className="muted">{iAmReady ? t(data ? 'mp.h2hYouReady' : 'mp.h2hWaitHome', { name: homeMgr }) : t('mp.h2hPressReady', { name: homeMgr, min: g.options.h2hHalfMinutes ?? 3 })}</div>
            {!iAmReady ? <button className="primary continue" onClick={sayReady}>{t('mp.h2hReady')}</button> : <div className="sim-bar"><span /></div>}
            <button className="small" onClick={skip}>{t('mp.h2hSkip')}</button>
          </>}
        </div>
      </div>
    );
  }
  const mine = data.live[1];
  const proxy = { events: data.events, live: (tm: number) => data.live[tm] } as unknown as MatchSim;
  const subProxy = { substitute: (_t: number, out: number, inn: number) => { send({ k: 'sub', out, inn }, t('mp.followSubSent', { a: g.players[inn]?.last ?? '', b: g.players[out]?.last ?? '' })); return true; } } as unknown as MatchSim;
  const players = squad(g.userClub).filter((p) => mine.on.some((x) => x.id === p.id && !x.off) || mine.bench.includes(p.id));
  return (
    <div>
      {head}
      <CmScoreboard home={f.home} away={f.away} hg={data.hg} ag={data.ag} colors={colors} minute={data.minute} />
      <div className="muted kbd-hint" style={{ marginBottom: 8 }}>{t('mp.followHint', { name: homeMgr })} · ⚠️ {t('match.leaveAway', { name: homeMgr })}</div>
      {lost && <div className="insight bad">{t('mp.h2hLost', { name: homeMgr })} <button className="small" onClick={skip}>{t('mp.h2hSkip')}</button></div>}
      {data.phase === 'half' && talked && <div className="insight">{t('mp.h2hHalf', { s: data.halfLeft })}</div>}
      <div className="match2d">
        <div className="match-stage">
          <Pitch2D snap={data.snap} me={1} colors={colors} minute={data.minute} stepMs={800} banner={data.banner} bannerCls="" flash={data.flash} />
        </div>
      </div>
      <Tabs tabs={[["commentary", t('match.commentary')], ['ratings', t('match.ratings')], ['stats', t('match.stats')], ['tactics', `${t('nav.tactics')} (${t('match.subsLeft', { n: mine.subsLeft })})`]]} value={tab} onChange={setTab} />
      {data.phase === 'half' && !talked && !gs().draft && (
        <>
          <div className="insight">{t('mp.h2hHalf', { s: data.halfLeft })}</div>
          <TeamTalk fixture={id} stage="half" pids={[...mine.on.filter((x) => !x.off).map((x) => x.id), ...mine.bench]} diff={data.ag - data.hg}
            ratings={Object.fromEntries(mine.on.filter((x) => !x.off).map((x) => [x.id, Math.round(x.rating * 10) / 10]))}
            onGiven={(boosts) => { setTalked(true); send({ k: 'talk', boosts }); }} />
        </>
      )}
      {sent && <div className="insight">{sent}</div>}
      {tab === 'commentary' && <div className="commentary" style={{ height: 'auto', maxHeight: 520 }}>
        {lastLines(data.lines, 14).map(([l, k]) => <div key={`${k}-${l.m}-${l.text.length}`} className={`ln ${l.cls}`}><span className="m">{l.m}'</span>{l.text}</div>)}
      </div>}
      {tab === 'ratings' && <RatingsBoard sim={proxy} colors={colors} />}
      {tab === 'stats' && <StatsPanel stats={data.stats} home={g.clubs[f.home].name} away={g.clubs[f.away].name} colors={statColors(f.home, f.away, f.away === g.userClub ? 1 : 0)} />}
      {tab === 'tactics' && !data.finished && (
        <>
          <SubsPanel sim={subProxy} me={1} live={mine} onDone={() => {}} />
          <TacticEditor tactic={mine.tactic} players={players} matchMode
            onChange={(tac) => send({ k: 'tactic', tac }, t('mp.followTacticSent'))}
            onSub={(out, inn) => send({ k: 'sub', out, inn }, t('mp.followSubSent', { a: g.players[inn]?.last ?? '', b: g.players[out]?.last ?? '' }))} />
        </>
      )}
    </div>
  );
}

export function StatsPanel({ stats, home, away, colors }: { stats: [MatchReport['stats'][0], MatchReport['stats'][1]]; home: string; away: string; colors?: [string, string] }) {
  const possSum = stats[0].possession + stats[1].possession;
  const pct0 = possSum > 0 ? Math.round((100 * stats[0].possession) / possSum) : 50;
  const rows: [string, number, number, boolean?][] = [
    // besiddelse i procent (under kampen tælles der i øjeblikke) – altid 100 % i alt
    ['possession', pct0, 100 - pct0],
    ['xg', stats[0].xg, stats[1].xg, true],
    ['shots', stats[0].shots, stats[1].shots],
    ['onTarget', stats[0].onTarget, stats[1].onTarget],
    ['corners', stats[0].corners, stats[1].corners],
    ['fouls', stats[0].fouls, stats[1].fouls],
    ['yellows', stats[0].yellows, stats[1].yellows],
    ['reds', stats[0].reds, stats[1].reds],
    ['offsides', stats[0].offsides, stats[1].offsides],
    ['passPct', Math.round((stats[0].passesCompleted / Math.max(1, stats[0].passes)) * 100), Math.round((stats[1].passesCompleted / Math.max(1, stats[1].passes)) * 100)],
  ];
  return (
    <Panel title={`${home} – ${away}`}>
      {rows.map(([k, h, a, dec]) => {
        const tot = h + a || 1;
        return (
          <div key={k} className="statline">
            <span className="h">{dec ? h.toFixed(2) : h}{k === 'possession' || k === 'passPct' ? '%' : ''}</span>
            <span className="lbl">{t(`stat.${k}`)}</span>
            <span className="a">{dec ? a.toFixed(2) : a}{k === 'possession' || k === 'passPct' ? '%' : ''}</span>
            <div className="statbar"><i style={{ width: `${(h / tot) * 100}%`, background: colors?.[0] }} /><i style={{ width: `${(a / tot) * 100}%`, background: colors?.[1] }} /></div>
          </div>
        );
      })}
    </Panel>
  );
}
