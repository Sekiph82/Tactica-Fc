// Spillets dag-for-dag-løkke.
import { draftDay, draftInjuryDays, draftSeasonCheck } from './draft';
import { boardAfterMatch, boardMonthly, aiSackings, completeProjects, fillVacancies, processJobTalks, summerManagerChanges } from './board';
import { needsWinnerFn, recordResult, setupLeague, leagueRows } from './competitions';
import { t } from '../i18n';
import { addDays, day, month, weekday, daysBetween } from './dates';
import { MatchSim, quickMatch, type EngineTeam } from './engine/match';
import { weatherFor, type Weather } from './weather';
import { maxSubs } from './rules';
import { recordsAfterMatch } from './records';
import { campDaily } from './camp';
import { trialsDaily } from './trials';
import { friendliesDaily } from './friendlies';
import { achievementsAfterMatch } from './achievements';
import { storyAfterMatch } from './story';
import { gateReceipts, januaryBudgetTopUp, monthlyIncome, sponsorWinBonus, weeklyWages } from './finance';
import { rng } from './rng';
import { addNews, fixturesOn, gs, squad } from './state';
import { counterPlan, type CounterPlan } from './aitactics';
import { autoSelect, available, lineupComplete, newTactic, slotValue, validateTactic } from './tactics';
import type { Fixture, MatchReport, NewsItem, Player, Tactic } from './types';
import { monthlyDevelopment, monthlyTrainingReport, monthlyValues, weeklyDevelopment } from './training';
import { aiLoanOptions, aiPursuits, aiBidsForListed, aiBosman, aiFillSquads, aiReleaseClauses, aiRenewals, aiTransferTick, contractReminders, processOffers, refreshShortlists, resolveAuctions, resolveSignings, weeklyTransferDigest, windowNews } from './transfers';
import { afterAppearance } from './clauses';
import { knowledgeAfterMatch, scoutDaily } from './scouting';
import { monthlyClubReps, seasonRollover, youthIntake, youthPreview } from './season';
import { squadStrength } from './board';
import { chemistryMorale, monthlyPersonality } from './personality';
import { monthlyWill, weeklyPlayerContact } from './will';
import { recordRivalry } from './careers';
import { boardMeeting, fansAfterMatch, fansMonthly } from './fans';
import { expirePress, invitePress, motivation, resolvePressPromise } from './press';
import { monthlyColumn, weeklyRumours } from './media';
import { monthlyAwards, snapshotMonth } from './awards';
import { asOwner, forEachHuman, isHumanClub, isMultiplayer, ownerOf, withHuman } from './humans';
import { botsDaily, isBotClub } from './bots';
import { botsAfterMatch } from './chat';
import { recordH2H } from './h2h';
import { resolveStaffBids } from './staff';
import { rivalryAfterMatch } from './rivalry';

export const INJURIES: [string, number, number, number][] = [
  // nøgle, min dage, max dage, vægt
  ['bruise', 2, 6, 30], ['twisted-ankle', 5, 14, 18], ['hamstring', 10, 28, 16], ['groin', 8, 21, 10], ['calf', 7, 18, 10],
  ['knee', 14, 45, 6], ['back', 5, 14, 6], ['concussion', 7, 12, 3], ['broken-foot', 40, 80, 2], ['cruciate', 180, 270, 1], ['broken-leg', 100, 160, 1],
];

const pname = (p: Player) => `${p.first} ${p.last}`.trim();

// ---------- holdudtagelse ----------

export function aiTactic(clubId: number, oppId?: number, home = true): Tactic {
  const g = gs();
  const club = g.clubs[clubId];
  const m = g.staff[club.manager];
  const formation = m?.style?.formation ?? '4-4-2';
  let mentality = m?.style?.mentality ?? 2;
  let plan: CounterPlan = { team: {} };
  if (oppId !== undefined) {
    const diff = squadStrength(clubId) - squadStrength(oppId) + (home ? 3 : -3);
    if (diff > 12) mentality = Math.min(4, mentality + 1);
    else if (diff < -12) mentality = Math.max(0, mentality - 1);
    plan = counterPlan(clubId, oppId, diff, formation, mentality);
  }
  const base = newTactic(plan.formation ?? formation, mentality);
  if (mentality <= 1) base.team.counter = true;
  base.team = { ...base.team, ...plan.team };
  return autoSelect(base, squad(clubId));
}

export function userTactic(auto = false): Tactic {
  const g = gs();
  const players = squad(g.userClub);
  if (!g.tactic) g.tactic = autoSelect(newTactic('4-4-2'), players);
  let t = validateTactic(g.tactic, players);
  if (auto) t = autoSelect(t, players);
  else if (!lineupComplete(t)) {
    // assistenten udfylder tomme pladser med bedste ledige spiller
    const used = new Set(t.lineup.filter(Boolean));
    const lineup = t.lineup.slice();
    lineup.forEach((id, i) => {
      if (id) return;
      const best = players.filter((p) => available(p) && !used.has(p.id)).sort((x, y) => slotValue(y, t.slots[i]) - slotValue(x, t.slots[i]))[0];
      if (best) { lineup[i] = best.id; used.add(best.id); }
    });
    const bench = t.bench.filter((id) => !used.has(id));
    if (bench.length < 3) {
      for (const p of players.filter((x) => available(x) && !used.has(x.id) && !bench.includes(x.id)).sort((x, y) => y.ca - x.ca)) {
        if (bench.length >= 5) break;
        bench.push(p.id);
      }
    }
    t = { ...t, lineup, bench };
  }
  g.tactic = t;
  return t;
}

export function engineTeam(clubId: number, tactic: Tactic): EngineTeam {
  const map = new Map<number, Player>();
  for (const p of squad(clubId)) map.set(p.id, p);
  const g = gs();
  const talk = clubId === g.userClub && g.matchTalk && g.matchTalk.fixture === g.pendingFixture ? g.matchTalk.boosts : undefined;
  return { club: clubId, tactic, players: map, morale: chemistryMorale(tactic) + motivation(clubId, g.date), talk };
}

function importance(f: Fixture): number {
  const g = gs();
  const comp = g.comps[f.comp];
  if (!comp) return 0.3;
  if (f.stage === 'F') return 1;
  if (comp.type === 'continental') return f.stage?.startsWith('G') ? 0.6 : 0.85;
  if (comp.type === 'playoff') return 0.9;
  return comp.type === 'cup' ? 0.5 : 0.4;
}

/** Turneringer med VAR (videodommer): de største ligaer og de europæiske turneringer */
const VAR_LEAGUES = new Set(['GB1', 'ES1', 'IT1', 'L1', 'FR1', 'NL1', 'PO1', 'BE1', 'DK1', 'TR1', 'SC1', 'A1', 'C1', 'GR1', 'SE1', 'NO1', 'PL1', 'MLS1', 'BRA1', 'SA1', 'JAP1', 'MEX1', 'ARG1']);
function usesVar(f: Fixture): boolean {
  const c = gs().comps[f.comp];
  return !!c && (c.type === 'continental' || VAR_LEAGUES.has(c.id) || (c.type === 'cup' && (f.stage === 'F' || f.stage === 'SF')));
}

export function prepareMatch(f: Fixture, userAuto = false): { home: EngineTeam; away: EngineTeam; neutral: boolean; needsWinner?: (h: number, a: number) => boolean; importance: number; var: boolean; weather: Weather } {
  const ht = tacticFor(f.home, f.away, true, userAuto);
  const at = tacticFor(f.away, f.home, false, userAuto);
  return {
    home: engineTeam(f.home, ht),
    away: engineTeam(f.away, at),
    neutral: f.stage === 'F',
    needsWinner: needsWinnerFn(f),
    weather: weatherFor(f),
    importance: importance(f),
    var: usesVar(f),
  };
}

/** Taktik for en klub: menneskets egen (via dets slot) eller AI'ens */
function tacticFor(club: number, opp: number, home: boolean, userAuto: boolean): Tactic {
  const g = gs();
  if (club === g.userClub && g.userClub) return userTactic(userAuto);
  if (isHumanClub(club)) {
    const o = ownerOf(club);
    if (o) return withHuman(o, () => userTactic(userAuto));
  }
  return aiTactic(club, opp, home);
}

export function createLiveMatch(f: Fixture): MatchSim {
  const m = prepareMatch(f);
  const g = gs();
  return new MatchSim(m.home, m.away, {
    // udvikling: window.__cmForcePens tvinger forlænget spilletid og straffespark (til test af visningen)
    commentary: true, recordVisualEvents: true, neutral: m.neutral, needsWinner: import.meta.env?.DEV && (globalThis as { __cmForcePens?: boolean }).__cmForcePens ? () => true : m.needsWinner, importance: m.importance, var: m.var, weather: m.weather, subs: maxSubs(), fixtureId: f.id, date: g.date,
    aiSubs: [f.home !== g.userClub, f.away !== g.userClub],
  }, rng);
}

export function simulateFixture(f: Fixture, userAuto = true, commentary = false): MatchReport {
  const m = prepareMatch(f, userAuto);
  const opts = { neutral: m.neutral, needsWinner: m.needsWinner, importance: m.importance, var: m.var, weather: m.weather, subs: maxSubs(), fixtureId: f.id, date: gs().date };
  const rep = commentary
    ? new MatchSim(m.home, m.away, { ...opts, commentary: true, aiSubs: [true, true] }, rng).runToEnd()
    : quickMatch(m.home, m.away, opts, rng);
  applyMatchResult(f, rep);
  return rep;
}

// ---------- resultatbehandling ----------

export function applyMatchResult(f: Fixture, rep: MatchReport) {
  const g = gs();
  const [hs, as] = rep.stats;
  const scorers: [number, number, number][] = rep.events.filter((e) => e.k === 'goal').map((e) => [e.m, e.t, e.p!]);
  const gate = gateReceipts(f);
  recordResult(f, { hg: hs.goals, ag: as.goals, et: rep.et, pens: rep.pens, scorers, att: gate.att, gate: Math.round(gate.income) });
  recordsAfterMatch(f, rep, gate.att);
  achievementsAfterMatch(f, rep, gate.att);
  storyAfterMatch(f, rep, isBigMatch(f.home, f.away));
  if (g.humans) { recordH2H(f); botsAfterMatch(f); rivalryAfterMatch(f); }
  const comp = g.comps[f.comp];
  const isLeague = comp?.type === 'league';
  const played = new Set<number>();
  for (const line of rep.players) {
    const p = g.players[line.id];
    if (!p) continue;
    played.add(p.id);
    const s = p.stats;
    if (line.sub) s.subs++; else s.apps++;
    if (isLeague) { s.lgApps++; s.lgGoals += line.goals; }
    s.minutes += line.minutes;
    s.goals += line.goals;
    s.assists += line.assists;
    s.ratingSum += line.rating;
    s.ratingCount++;
    if (rep.mom === p.id) s.mom++;
    p.form = [...p.form, line.rating].slice(-5);
    if (p.contract?.appBonus || p.contract?.goalBonus || p.contract?.cleanSheetBonus || p.addOn) afterAppearance(p, line.goals, rep.stats[1 - line.team].goals === 0);
    // draft-liga: ingen træthed eller moral, der hænger ved – mange kampe kan spilles samme dag
    p.condition = g.draft ? 100 : Math.max(20, Math.min(100, line.cond));
    if (line.yellow) {
      s.yellows++;
      p.yellowCount++;
      if (p.yellowCount >= 5) { p.banned = Math.max(p.banned, 1); p.yellowCount = 0; }
    }
    if (line.red) { s.reds++; p.banned = Math.max(p.banned, rng.int(1, 3)); p.lastRed = g.date; }
    if (line.injured) injure(p);
    const res = line.team === 0 ? Math.sign(hs.goals - as.goals) : Math.sign(as.goals - hs.goals);
    if (!g.draft) p.morale = Math.max(1, Math.min(20, p.morale + res * 0.8 + (line.rating >= 7.5 ? 0.6 : line.rating < 5.8 ? -0.5 : 0)));
  }
  // karantæner afsones for spillere der ikke spillede
  for (const club of [f.home, f.away]) {
    for (const p of squad(club)) {
      if (!played.has(p.id) && p.banned > 0) p.banned--;
      if (!played.has(p.id) && isHumanClub(club)) p.unhappy = Math.min(100, (p.unhappy ?? 0) + (p.attrs[42] > 13 ? 3 : 1));
      else if (played.has(p.id)) p.unhappy = Math.max(0, (p.unhappy ?? 0) - 5);
    }
  }
  // holdstatistik for ligaen (til Statistik-fanen)
  if (isLeague) {
    for (const [cid, me, opp] of [[f.home, hs, as], [f.away, as, hs]] as const) {
      const c = g.clubs[cid];
      if (!c) continue;
      const st = (c.lgStats ??= { n: 0, shots: 0, sot: 0, xg: 0, xga: 0, poss: 0, cs: 0, yel: 0, red: 0 });
      st.n++; st.shots += me.shots; st.sot += me.onTarget; st.xg += me.xg; st.xga += opp.xg; st.poss += me.possession;
      if (opp.goals === 0) st.cs++;
      st.yel += me.yellows; st.red += me.reds;
    }
  }
  // præmiepenge i Europa
  if (comp?.type === 'continental') {
    const win = comp.id === 'CL' ? 2_800_000 : 800_000;
    const draw = comp.id === 'CL' ? 900_000 : 300_000;
    for (const [cid, gf, ga] of [[f.home, hs.goals, as.goals], [f.away, as.goals, hs.goals]] as const) {
      const c = g.clubs[cid];
      const amount = gf > ga ? win : gf === ga ? draw : 0;
      c.balance += amount + (f.stage?.startsWith('G') ? 0 : win / 2);
      c.finance.prize += amount;
    }
  }
  // sponsorernes sejrsbonus
  if (isLeague && hs.goals !== as.goals) sponsorWinBonus(hs.goals > as.goals ? f.home : f.away);
  // menneskelige managere i kampen
  for (const club of [f.home, f.away]) {
    if (!isHumanClub(club) && club !== g.userClub) continue;
    asOwner(club, () => userMatchResult(f, rep));
  }
}

function userMatchResult(f: Fixture, rep: MatchReport) {
  const g = gs();
  const [hs, as] = rep.stats;
  const comp = g.comps[f.comp];
  {
    const userHome = f.home === g.userClub;
    const opp = userHome ? f.away : f.home;
    const scored = userHome ? hs.goals : as.goals;
    const conceded = userHome ? as.goals : hs.goals;
    // draft-liga: ingen bestyrelse, presse eller fans
    if (!g.draft) {
      boardAfterMatch(scored, conceded, opp, comp?.type ?? 'league');
      recordRivalry(opp, scored, conceded);
      resolvePressPromise(f.id, scored, conceded);
      invitePress(f, 'post');
      fansAfterMatch(g.userClub, scored, conceded, squadStrength(g.userClub), squadStrength(opp), isBigMatch(g.userClub, opp));
    }
    knowledgeAfterMatch(opp, rep.players.filter((l) => l.team === (userHome ? 1 : 0)).map((l) => l.id));
    g.reports[f.id] = rep;
    const key = scored > conceded ? 'match.won' : scored === conceded ? 'match.drew' : 'match.lost';
    addNews({ cat: 'match', key, params: { opp: g.clubs[opp].name, score: `${scored}-${conceded}`, comp: comp?.name ?? '' }, link: { kind: 'fixture', id: f.id } });
    for (const line of rep.players) {
      if (line.injured && g.players[line.id]?.club === g.userClub) {
        const p = g.players[line.id];
        addNews({ cat: 'injury', key: 'news.injury', params: { player: pname(p), injury: p.injury?.key ?? 'bruise', days: p.injury?.days ?? 0 }, link: { kind: 'player', id: p.id } });
      }
    }
  }
}

/** Storkamp/topopgør: to af ligaens fire største klubber med næsten samme omdømme */
export function isBigMatch(a: number, b: number): boolean {
  const g = gs();
  const A = g.clubs[a], B = g.clubs[b];
  if (!A || !B || A.league !== B.league || Math.abs(A.rep - B.rep) > 6) return false;
  const top = Object.values(g.clubs).filter((c) => c.league === A.league).sort((x, y) => y.rep - x.rep).slice(0, 4).map((c) => c.id);
  return top.includes(a) && top.includes(b);
}

function injure(p: Player) {
  const g = gs();
  const [key, lo, hi] = rng.weighted(INJURIES, (x) => x[3])!;
  let days = rng.int(lo, hi);
  // fysioterapeuter forkorter skader
  const physios = Object.values(g.staff).filter((s) => s.club === p.club && s.role === 'physio');
  const best = Math.max(5, ...physios.map((s) => s.attrs.physio));
  days = Math.max(1, Math.round(days * (1.15 - best / 40)));
  if (g.draft) { days = draftInjuryDays(days); if (!days) return; }
  p.injury = { key, days };
}

// ---------- dagsløkke ----------

export interface DayResult {
  match?: number; // brugerens kamp skal spilles
  stop?: string; // vigtig begivenhed
}

function newDay() {
  const g = gs();
  g.date = addDays(g.date, 1);
  g.dayDone = false;
  const d = g.date;
  // draft-liga: kun kondition, moral og skader – ingen økonomi, transfers, bestyrelse eller ny sæson
  if (g.draft) { draftDay(); return; }
  if (month(d) === 7 && day(d) === 1) seasonRollover();
  // daglige ting
  for (const p of Object.values(g.players)) {
    if (p.injury) {
      p.injury.days--;
      if (p.injury.days <= 0) {
        p.injury = null;
        p.condition = Math.min(p.condition, 75);
        asOwner(p.club, () => addNews({ cat: 'injury', key: 'news.recovered', params: { player: pname(p) }, link: { kind: 'player', id: p.id } }));
      }
    }
    if (p.condition < 100) p.condition = Math.min(100, p.condition + 4 + p.attrs[29] / 4);
    if (p.morale !== 13) p.morale += (13 - p.morale) * 0.02;
  }
  if (g.humans) { resolveAuctions(); resolveSignings(); resolveStaffBids(); }
  forEachHuman(windowNews);
  forEachHuman(processOffers);
  forEachHuman(processJobTalks);
  forEachHuman(() => {
    expirePress();
    // pressemøde dagen før kampen
    for (const id of fixturesOn(addDays(d, 1))) {
      const f = g.fixtures[id];
      if (f && g.userClub && (f.home === g.userClub || f.away === g.userClub)) invitePress(f, 'pre');
    }
  });
  completeProjects();
  campDaily();
  trialsDaily();
  friendliesDaily();
  forEachHuman(aiBidsForListed);
  aiPursuits();
  if (weekday(d) === 4) forEachHuman(aiLoanOptions);
  aiTransferTick();
  forEachHuman(scoutDaily);
  if (day(d) % 3 === 0) fillVacancies();
  if (weekday(d) === 1) {
    forEachHuman(weeklyRumours);
    forEachHuman(weeklyTransferDigest);
    forEachHuman(weeklySummary);
    weeklyPlayerContact();
    aiReleaseClauses();
    weeklyDevelopment();
    weeklyWages();
  }
  if (day(d) === 1) {
    monthlyIncome();
    monthlyValues();
    monthlyDevelopment();
    monthlyPersonality();
    monthlyWill();
    fansMonthly();
    if (month(d) !== 7) monthlyColumn();
    forEachHuman(boardMeeting);
    if (!(month(d) === 7)) monthlyAwards(); else snapshotMonth();
    monthlyClubReps();
    refreshShortlists();
    forEachHuman(() => {
      const { mismatches } = monthlyTrainingReport();
      const asst = Object.values(g.staff).find((s) => s.club === g.userClub && s.role === 'assistant');
      if (mismatches >= 3 && asst && month(d) % 3 === 1) addNews({ cat: 'general', key: 'news.trainingAdvice', params: { coach: `${asst.first} ${asst.last}`, n: mismatches } });
    });
    forEachHuman(boardMonthly);
    if (month(d) >= 9 || month(d) <= 4) aiSackings();
    if (month(d) === 6) summerManagerChanges();
    if (month(d) >= 1 && month(d) <= 5) aiRenewals();
    if (month(d) === 1 || month(d) === 3) forEachHuman(contractReminders);
  }
  if (month(d) >= 1 && month(d) <= 5 && weekday(d) === 3) forEachHuman(aiBosman);
  if (month(d) === 1 && day(d) === 1) januaryBudgetTopUp();
  if (month(d) === 2 && day(d) === 1) youthPreview();
  if (month(d) === 3 && day(d) === 15) youthIntake();
  // AI-trupper fyldes op i sommer- og vinterpausen
  if ((month(d) === 7 || month(d) === 8 || month(d) === 1) && weekday(d) === 2) aiFillSquads(22);
}

/** Spil dagens kampe (undtagen brugerens) */
function playDay(): DayResult {
  const g = gs();
  let userMatch: number | undefined;
  // AI-managere (botter) træffer dagens beslutninger, inden der spilles
  if (g.humans) botsDaily();
  for (const id of fixturesOn(g.date)) {
    const f = g.fixtures[id];
    if (!f || f.result) continue;
    if ((!isMultiplayer(g) || g.localMp) && g.userClub && (f.home === g.userClub || f.away === g.userClub)) {
      userMatch = f.id;
      continue;
    }
    // multiplayer: menneskenes kampe simuleres med fuld kommentar, så de kan ses bagefter
    const human = isHumanClub(f.home) || isHumanClub(f.away);
    simulateFixture(f, !human, human);
  }
  if (userMatch !== undefined) {
    g.pendingFixture = userMatch;
    return { match: userMatch };
  }
  g.dayDone = true;
  return {};
}

/**
 * En menneskelig manager har overtaget en klub i et land, der ikke simuleres (ingen liga).
 * Landet gøres aktivt: ligaerne sættes op for indeværende sæson, og de kampe, der allerede
 * skulle have været spillet, simuleres med det samme (som AI-kampe), så tabellen er realistisk.
 * Pokalturneringen starter fra næste sæson.
 */
export function activateNation(nation: number) {
  const g = gs();
  if (g.activeNations.includes(nation)) return;
  g.activeNations.push(nation);
  const byLeague = new Map<string, number[]>();
  for (const c of Object.values(g.clubs)) if (c.nation === nation) (byLeague.get(c.league) ?? byLeague.set(c.league, []).get(c.league)!).push(c.id);
  const ids: string[] = [];
  for (const [id, clubs] of byLeague) {
    const m = g.leagues[id];
    if (!m || g.comps[id] || clubs.length < 4) continue;
    setupLeague(id, m.name, m.nation, m.tier, clubs, g.season);
    ids.push(id);
  }
  // indhent de kampe, der allerede skulle være spillet – uden at de tæller for menneskelige managere
  const humans = Object.values(g.clubs).filter((c) => c.nation === nation && c.manager === -1);
  for (const c of humans) c.manager = 0;
  const userClub = g.userClub;
  g.userClub = 0;
  try {
    const past = Object.values(g.fixtures)
      .filter((f) => ids.includes(f.comp) && !f.result && (f.date < g.date || (f.date === g.date && g.dayDone)))
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const f of past) simulateFixture(f, true, false);
  } finally {
    g.userClub = userClub;
    for (const c of humans) c.manager = -1;
  }
}

/** Ligger en menneskelig managers klub i en liga uden turnering? Så startes landets ligaer */
function ensureHumanLeagues() {
  const g = gs();
  forEachHuman(() => {
    const c = g.clubs[g.userClub];
    if (c && !g.comps[c.league] && g.leagues[c.league]) activateNation(c.nation);
  });
}

/**
 * Manageren skifter klub (eller siger op) midt på en kampdag: den kamp, der ventede på ham, spilles
 * automatisk, så turneringen ikke går i stå – og den nye klub starter uden en "fremmed" kamp.
 */
export function playPendingAsAi() {
  const g = gs();
  const id = g.pendingFixture;
  g.pendingFixture = null;
  const f = id ? g.fixtures[id] : undefined;
  if (f && !f.result) simulateFixture(f, true, false);
}

/** "Fortsæt" – én dag frem */
export function continueGame(): DayResult {
  const g = gs();
  ensureHumanLeagues();
  // gamle saves: en ventende kamp, der ikke er ens egen klubs (efter et jobskifte)
  if (g.pendingFixture) {
    const f = g.fixtures[g.pendingFixture];
    if (!f || f.result || (f.home !== g.userClub && f.away !== g.userClub)) playPendingAsAi();
  }
  if (g.pendingFixture) return { match: g.pendingFixture };
  if (!g.dayDone) return playDay();
  const lastNews = g.nextId.news;
  newDay();
  const r = playDay();
  if (r.match) return r;
  const fresh = g.news.filter((n) => n.id >= lastNews);
  const important = fresh.find((n) => ['transfer.incomingBid', 'transfer.bidAccepted', 'transfer.bidCountered', 'news.jobOffer', 'job.invite', 'board.sacked', 'board.sackedSeason', 'board.warning'].includes(n.key));
  if (important) return { stop: important.key };
  return {};
}

/** Brugerens kamp er spillet (live eller simuleret) */
export function finishUserMatch(rep: MatchReport) {
  const g = gs();
  const f = g.fixtures[g.pendingFixture!];
  if (f && !f.result) applyMatchResult(f, rep);
  g.pendingFixture = null;
  g.dayDone = true;
}

/** Simulér brugerens ventende kamp uden at se den (med kommentar, så kamprapporten har den) */
export function quickPlayUserMatch(): MatchReport | null {
  const g = gs();
  const f = g.fixtures[g.pendingFixture!];
  if (!f) return null;
  const m = prepareMatch(f, false);
  const rep = new MatchSim(m.home, m.away, { commentary: true, neutral: m.neutral, needsWinner: m.needsWinner, importance: m.importance, var: m.var, weather: m.weather, subs: maxSubs(), fixtureId: f.id, aiSubs: [true, true], date: g.date }, rng).runToEnd();
  finishUserMatch(rep);
  return rep;
}

/** Spring frem til næste kamp. Kører i bidder så UI'et forbliver responsivt. */
/** Rene informationsnyheder (andre klubbers handler, trænerskifter, klummer, kåringer …) stopper ikke Fortsæt */
const INFO_KEYS = new Set([
  'transfer.done', 'transfer.freeDone', 'transfer.loanDone', 'news.managerSacked', 'news.managerHired', 'mgr.poached', 'column.month',
  'award.monthPlayer', 'award.monthManager', 'award.ballonDor', 'news.champions', 'news.cupWin', 'news.playoffWin', 'rumour.interest',
  'news.retired', 'news.youth', 'war.headline', 'war.result', 'war.staffHeadline', 'war.staffResult', 'transfer.digest', 'transfer.digestOne', 'ffp.sanction', 'news.promoted', 'news.relegated', 'news.split', 'press.report', 'press.reportPlain', 'news.recovered',
]);
export function needsAttention(n: NewsItem): boolean {
  if (!INFO_KEYS.has(n.key)) return true;
  // egne handler er vigtige
  const me = gs().clubs[gs().userClub]?.name;
  return !!me && (n.params.to === me || n.params.from === me || n.params.club === me);
}

export async function runUntil(opts: { untilDate?: string; untilMatch?: boolean; untilNews?: boolean; maxDays?: number; autoPlay?: boolean; onProgress?: (date: string) => void; shouldStop?: () => boolean }): Promise<DayResult> {
  const g = gs();
  let steps = 0;
  const firstNews = g.nextId.news;
  const startDate = g.date;
  for (;;) {
    // stop når der er kommet en ny ulæst besked (Fortsæt: kør til der sker noget)
    if (opts.untilNews && g.dayDone && g.news.some((n) => n.id >= firstNews && !n.read && needsAttention(n))) return { stop: 'news' };
    if (opts.maxDays && g.dayDone && daysBetween(startDate, g.date) >= opts.maxDays) return {};
    if (opts.shouldStop?.()) return {};
    if (opts.untilDate && g.date >= opts.untilDate && g.dayDone && !g.pendingFixture) return {};
    const r = continueGame();
    if (r.match !== undefined) {
      if (opts.autoPlay) {
        quickPlayUserMatch();
      } else return r;
    }
    if (r.stop && !opts.autoPlay) return r;
    if (!g.userClub && opts.untilMatch) {
      // arbejdsløs: stop ved jobtilbud
      if (g.jobOffers.length) return { stop: 'news.jobOffer' };
    }
    if (++steps % 3 === 0) {
      opts.onProgress?.(g.date);
      await new Promise((res) => setTimeout(res, 0));
    }
    if (steps > 800) return {};
  }
}

export function availableForSelection(p: Player) {
  return available(p);
}

// ---------- online multiplayer ----------


/**
 * Ét multiplayer-"træk": spil dage frem til og med næste dag hvor en menneskelig manager har kamp,
 * eller til en manager får noget at forholde sig til – samme regel som Fortsæt i singleplayer (højst 14 dage).
 */
export function mpAdvance(): { days: number; reason: string } {
  const g = gs();
  const startNews = g.nextId.news;
  // forrige træk stoppede på en kampdag: menneskenes kampe er spillet live (resultaterne kom som handlinger) –
  // de kampe, ingen nåede at spille, simuleres nu, og dagen gøres færdig
  if (!g.dayDone) finishMatchDay();
  // draft-liga: sæsonen er slut – næste draft begynder
  if (g.draft && draftSeasonCheck()) return { days: 0, reason: 'season' };
  for (let i = 1; i <= 14; i++) {
    newDay();
    const humanFixtures = fixturesOn(g.date).filter((id) => {
      const f = g.fixtures[id];
      return f && !f.result && ((isHumanClub(f.home) && !isBotClub(f.home)) || (isHumanClub(f.away) && !isBotClub(f.away)));
    });
    if (humanFixtures.length) {
      // kampdag: AI-kampene spilles nu, menneskenes kampe venter – hver manager spiller sin egen live
      if (g.humans) botsDaily();
      for (const id of fixturesOn(g.date)) {
        const f = g.fixtures[id];
        if (!f || f.result || humanFixtures.includes(id)) continue;
        simulateFixture(f, true, false);
      }
      for (const h of g.humans ?? []) {
        if (h.bot) continue;
        withHuman(h.pid, () => {
          const mine = humanFixtures.find((id) => g.fixtures[id].home === g.userClub || g.fixtures[id].away === g.userClub);
          g.pendingFixture = mine ?? null;
        });
      }
      return { days: i, reason: 'match' };
    }
    playDay();
    g.dayDone = true;
    g.pendingFixture = null;
    if (g.draft && draftSeasonCheck()) return { days: i, reason: 'season' };
    let important = false;
    // som i singleplayer: stop så snart en manager får noget at forholde sig til (bud, pressemøde, bestyrelse, jobtilbud …)
    for (const h of g.humans ?? []) if (!h.bot) withHuman(h.pid, () => { if (g.news.some((n) => n.id >= startNews && !n.read && needsAttention(n))) important = true; });
    if (important) return { days: i, reason: 'news' };
  }
  return { days: 14, reason: 'limit' };
}

/** Kampdagen gøres færdig: kampe uden resultat (manageren nåede ikke at spille) simuleres med assistenten */
function finishMatchDay() {
  const g = gs();
  for (const id of fixturesOn(g.date)) {
    const f = g.fixtures[id];
    if (!f || f.result) continue;
    const human = isHumanClub(f.home) || isHumanClub(f.away);
    simulateFixture(f, true, human);
  }
  for (const h of g.humans ?? []) withHuman(h.pid, () => { g.pendingFixture = null; });
  g.pendingFixture = null;
  g.dayDone = true;
}

/**
 * Manageren har spillet sin kamp (live eller hurtigt resultat). I online-spil sendes resultatet som en handling,
 * så værten lægger præcis samme resultat ind – dagen gøres først færdig i næste træk.
 */
export function submitMatchResult(fixture: number, rep: MatchReport) {
  const g = gs();
  const f = g.fixtures[fixture];
  if (!f || f.result || (f.home !== g.userClub && f.away !== g.userClub)) return;
  if (!isMultiplayer(g) || g.localMp) {
    if (g.pendingFixture === fixture) finishUserMatch(rep);
    else applyMatchResult(f, rep);
    return;
  }
  applyMatchResult(f, rep);
  if (g.pendingFixture === fixture) g.pendingFixture = null;
}

/** Hurtigt resultat for den ventende kamp – uden at se den */
export function quickReport(): MatchReport | null {
  const g = gs();
  const f = g.fixtures[g.pendingFixture!];
  if (!f) return null;
  const m = prepareMatch(f, false);
  return new MatchSim(m.home, m.away, { commentary: true, neutral: m.neutral, needsWinner: m.needsWinner, importance: m.importance, var: m.var, weather: m.weather, subs: maxSubs(), fixtureId: f.id, aiSubs: [true, true], date: g.date }, rng).runToEnd();
}

/** Mandag: ugens overblik – resultater, placering, økonomi, skader og de næste kampe */
function weeklySummary() {
  const g = gs();
  const c = g.clubs[g.userClub];
  if (!c) return;
  const since = addDays(g.date, -7);
  const mine = Object.values(g.fixtures).filter((f) => (f.home === c.id || f.away === c.id));
  const played = mine.filter((f) => f.result && f.date > since && f.date <= g.date).sort((a, b) => a.date.localeCompare(b.date));
  const results = played.map((f) => {
    const home = f.home === c.id;
    const gf = home ? f.result!.hg : f.result!.ag, ga = home ? f.result!.ag : f.result!.hg;
    const pens = f.result!.pens ? (home ? f.result!.pens[0] > f.result!.pens[1] : f.result!.pens[1] > f.result!.pens[0]) : null;
    const r = gf > ga || pens === true ? t('week.w') : gf < ga || pens === false ? t('week.l') : t('week.d');
    return `${r} ${gf}-${ga} ${g.clubs[home ? f.away : f.home]?.short ?? ''}`;
  }).join(' · ');
  const comp = g.comps[c.league];
  const pos = comp ? leagueRows(comp).findIndex((r) => r.club === c.id) + 1 : 0;
  const prev = g.manager.week;
  const move = !prev || !pos || prev.pos === pos ? t('week.posSame') : prev.pos > pos ? t('week.posUp', { n: prev.pos - pos }) : t('week.posDown', { n: pos - prev.pos });
  const balance = prev ? c.balance - prev.balance : 0;
  const injured = squad(c.id).filter((p) => p.injury).length;
  const next = mine.filter((f) => !f.result && f.date > g.date).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2)
    .map((f) => `${g.clubs[f.home === c.id ? f.away : f.home]?.short ?? ''} (${f.home === c.id ? t('week.home') : t('week.away')}, ${f.date.slice(8, 10)}/${f.date.slice(5, 7)})`).join(' · ');
  g.manager.week = { pos, balance: c.balance };
  if (!prev || !played.length) return; // første mandag (kun udgangspunktet) og uger uden kampe: ingen besked
  addNews({ cat: 'general', key: 'week.summary', params: { results: results || t('week.noGames'), pos, move, balance, injured, next: next || '–' } });
}
