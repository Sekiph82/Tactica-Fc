// Bestyrelse, forventninger, fyringer og jobmarked.
import { finalOrder, leagueRows } from './competitions';
import { rng } from './rng';
import { addDays, daysBetween } from './dates';
import { rulesFor, regionOf, type Region } from './leagues';

function rulesForLeague(league: string) {
  return rulesFor(league, 20).wealth;
}
import { addNews, gs, newsRelevant, squad } from './state';
import { careerEnd, careerStart, pickManager } from './careers';
import type { BoardAsk, Club, JobTalk } from './types';
import { takeOverClub } from './newgame';
import { forEachHuman, removeHooks } from './humans';

export function squadStrength(clubId: number): number {
  const ps = squad(clubId).map((p) => p.ca).sort((a, b) => b - a).slice(0, 16);
  return ps.length ? ps.reduce((s, v) => s + v, 0) / ps.length : 0;
}

/** Placering i ligaen efter truppens styrke (1 = bedst) */
export function strengthRank(club: Club): { rank: number; size: number } {
  const g = gs();
  const rivals = Object.values(g.clubs).filter((c) => c.league === club.league);
  const sorted = rivals.map((c) => [c.id, squadStrength(c.id) + c.rep * 0.15] as const).sort((a, b) => b[1] - a[1]);
  return { rank: sorted.findIndex((x) => x[0] === club.id) + 1, size: rivals.length };
}

/** Bestyrelsens forventning til en klub ud fra truppens styrke i ligaen (shift > 0 = lavere forventning) */
export function expectationFor(club: Club, shift = 0): { exp: string; pos: number } {
  const g = gs();
  const { size } = strengthRank(club);
  let { rank } = strengthRank(club);
  const tier = g.leagues[club.league]?.tier ?? 1;
  const at = (r: number): { exp: string; pos: number } => {
    if (tier === 2) {
      if (r <= 2) return { exp: 'promotion', pos: 2 };
      if (r <= 6) return { exp: 'playoffs', pos: 6 };
      if (r <= size - 5) return { exp: 'mid', pos: Math.ceil(size * 0.6) };
      return { exp: 'survive', pos: size - 3 };
    }
    if (r === 1) return { exp: 'title', pos: 1 };
    if (r <= 3) return { exp: 'top3', pos: 3 };
    if (r <= Math.floor(size / 2)) return { exp: 'tophalf', pos: Math.floor(size / 2) };
    if (r <= size - 4) return { exp: 'mid', pos: size - 4 };
    return { exp: 'survive', pos: size - 3 };
  };
  let e = at(rank);
  // hvert trin ned: find næste lavere forventning
  for (let i = 0; i < shift; i++) {
    const cur = e.exp;
    while (rank < size && at(rank).exp === cur) rank++;
    e = at(rank);
  }
  return e;
}

export function setBoardExpectation() {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (!club) return;
  const { exp, pos } = expectationFor(club);
  g.board.expectation = exp;
  g.board.expectedPos = pos;
  addNews({ cat: 'board', key: `board.exp.${exp}`, params: { club: club.name } });
}

/** Efter hver kamp for brugerens hold */
export function boardAfterMatch(scored: number, conceded: number, oppClub: number, compType: string) {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (!club) return;
  const diff = (squadStrength(club.id) - squadStrength(oppClub)) / 12;
  // forventede point mod netop den modstander (kalibreret mod motoren, se scripts/ppgcalib.ts):
  // selv et klart bedre hold tager kun ~1,8 point i snit, så uafgjort mod et svagere hold er ikke en katastrofe
  const expected = 1.37 + 1.05 * Math.tanh(diff * 0.45);
  const pts = scored > conceded ? 3 : scored === conceded ? 1 : 0;
  const weight = compType === 'league' ? 1.6 : compType === 'continental' ? 1.2 : 0.8;
  g.board.confidence = clamp(g.board.confidence + (pts - expected) * weight, 0, 100);
  boardMatchComment(scored, conceded, oppClub, compType, diff);
}

/** Af og til siger bestyrelsen sin mening om en bestemt kamp */
function boardMatchComment(scored: number, conceded: number, oppClub: number, compType: string, diff: number) {
  const g = gs();
  const opp = g.clubs[oppClub];
  if (!opp) return;
  // højst én kommentar hver 10. dag
  if (g.board.lastComment && g.board.lastComment > addDays(g.date, -10)) return;
  const margin = scored - conceded;
  const strongerOpp = diff < -0.6; // modstanderen er klart bedre
  const weakerOpp = diff > 0.6;
  let key: string | null = null;
  let p = 0;
  if (margin > 0 && strongerOpp) { key = 'board.c.upsetWin'; p = 0.8; }
  else if (margin >= 4) { key = 'board.c.thrashing'; p = 0.6; }
  else if (margin > 0 && compType === 'continental') { key = 'board.c.europeWin'; p = 0.45; }
  else if (margin < 0 && weakerOpp && compType === 'cup') { key = 'board.c.cupShock'; p = 0.85; }
  else if (margin <= -4) { key = 'board.c.humiliation'; p = 0.75; }
  else if (margin < 0 && weakerOpp) { key = 'board.c.badLoss'; p = 0.5; }
  else if (margin === 0 && weakerOpp && compType === 'league') { key = 'board.c.dropped'; p = 0.15; }
  else if (margin > 0 && compType === 'league' && g.board.expectation === 'survive') { key = 'board.c.survivalWin'; p = 0.15; }
  else if (margin >= 2 && !weakerOpp) { key = 'board.c.goodWin'; p = 0.3; }
  // rækker i ligaen
  if (!key && compType === 'league') {
    const form = g.comps[g.clubs[g.userClub]?.league]?.table.find((r) => r.club === g.userClub)?.form ?? '';
    if (form.length >= 5 && /^W{5}$/.test(form.slice(-5))) { key = 'board.c.winStreak'; p = 0.7; }
    else if (form.length >= 4 && /^L{4}$/.test(form.slice(-4))) { key = 'board.c.lossStreak'; p = 0.8; }
    else if (form.length >= 5 && !form.slice(-5).includes('W') && g.board.expectation !== 'survive') { key = 'board.c.noWins'; p = 0.6; }
  }
  if (!key || !rng.chance(p)) return;
  g.board.lastComment = g.date;
  addNews({ cat: 'board', key, params: { opp: opp.name, score: `${scored}-${conceded}` } });
}

/** Månedlig vurdering */
export function boardMonthly() {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (!club) return;
  const comp = g.comps[club.league];
  if (!comp) return;
  const played = comp.table.find((r) => r.club === club.id)?.p ?? 0;
  if (played < 6) return;
  const pos = leagueRows(comp).findIndex((r) => r.club === club.id) + 1;
  const delta = (g.board.expectedPos - pos) * 0.8;
  g.board.confidence = clamp(g.board.confidence + delta, 0, 100);
  if (club.balance < -5_000_000) g.board.confidence = clamp(g.board.confidence - 3, 0, 100);
  badContracts(club, played);
  // bestyrelsen lytter til fansene
  g.board.confidence = clamp(g.board.confidence + ((club.fanMood ?? 60) - 60) / 40, 0, 100);
  if (g.challenge) return; // udfordringer: ingen fyring undervejs
  // ligger holdet på (eller tæt på) målet, fyrer bestyrelsen ikke midt i sæsonen – og den falder til ro igen når det går bedre
  const onTarget = pos <= g.board.expectedPos + 1;
  if (g.board.confidence >= 35 && g.board.warnings > 0) g.board.warnings--;
  else if (g.board.confidence < 25 && g.board.warnings < 2 && !onTarget) {
    g.board.warnings++;
    addNews({ cat: 'board', key: 'board.warning', params: { club: club.name } });
  } else if (g.board.confidence < 12 && g.board.warnings >= 2 && played >= 10 && !onTarget) {
    sackUser('board.sacked');
  }
}

/**
 * Dårlige kontrakter: bestyrelsen kommenterer dyre spillere, der ikke spiller, og en lønsum over budget.
 * Hver spiller nævnes højst én gang pr. sæson; lønsummen højst hver tredje måned.
 */
function badContracts(club: Club, played: number) {
  const g = gs();
  const sq = squad(club.id).filter((p) => p.contract && !(p.loan && p.loan.from === club.id));
  const wages = sq.map((p) => p.contract!.wage).sort((a, b) => b - a);
  const top = wages[Math.min(wages.length - 1, Math.floor(wages.length / 3))] ?? 0;
  const noted = (g.board.wasteNoted ??= {});
  const bench = sq
    .filter((p) => p.contract!.wage >= top && p.contract!.wage > 0 && noted[p.id] !== g.season)
    .filter((p) => !(p.injury && p.injury.days > 21) && p.stats.minutes < played * 90 * 0.25 && (p.joined ? daysBetween(p.joined, g.date) > 60 : true))
    .sort((a, b) => b.contract!.wage - a.contract!.wage)[0];
  if (bench) {
    noted[bench.id] = g.season;
    g.board.confidence = clamp(g.board.confidence - 1, 0, 100);
    addNews({ cat: 'board', key: 'board.wasteWage', params: { player: `${bench.first} ${bench.last}`.trim(), wage: bench.contract!.wage, minutes: bench.stats.minutes }, link: { kind: 'player', id: bench.id } });
  }
  const bill = wages.reduce((a, b) => a + b, 0);
  if (bill > club.wageBudget * 1.05 && (!g.board.lastWageWarning || daysBetween(g.board.lastWageWarning, g.date) >= 85)) {
    g.board.lastWageWarning = g.date;
    g.board.confidence = clamp(g.board.confidence - 2, 0, 100);
    addNews({ cat: 'board', key: 'board.overWage', params: { wage: bill, budget: club.wageBudget } });
  }
}

export function sackUser(key: string) {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (!club) return;
  addNews({ cat: 'job', key, params: { club: club.name } });
  g.manager.sacked++;
  g.manager.sackedBy = [...(g.manager.sackedBy ?? []), club.id].slice(-10);
  g.manager.rep = clamp(g.manager.rep - 8, 1, 100);
  club.manager = 0;
  openVacancy(club.id);
  g.userClub = 0;
  g.tactic = null;
  g.pendingFixture = null;
}

/** Manageren siger op. Stillingen bliver ledig; at gå midt i sæsonen koster lidt omdømme. */
export function resignJob(): string {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (!club) return 'error';
  const m = Number(g.date.slice(5, 7));
  const midSeason = m >= 8 || m <= 4;
  if (midSeason) g.manager.rep = clamp(g.manager.rep - 3, 1, 100);
  g.manager.declinedJobs = { ...(g.manager.declinedJobs ?? {}), [club.id]: g.date }; // de ringer ikke lige foreløbig
  addNews({ cat: 'job', key: midSeason ? 'job.resignedMid' : 'job.resigned', params: { club: club.name } });
  club.manager = 0;
  club.tactic = null;
  openVacancy(club.id);
  g.userClub = 0;
  g.tactic = null;
  g.pendingFixture = null;
  g.jobOffers = [];
  return 'ok';
}

/** Sæsonafslutning: bestyrelsens dom */
export function boardSeasonEnd(): 'sacked' | 'ok' | 'great' {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (!club) return 'ok';
  const comp = g.comps[club.league];
  const order = comp ? finalOrder(comp) : [];
  const pos = order.indexOf(club.id) + 1;
  const diff = g.board.expectedPos - pos;
  g.manager.history.push({ season: g.season, club: club.id, league: club.league, pos });
  g.manager.rep = clamp(g.manager.rep + diff * 1.5 + (pos === 1 ? 8 : 0), 1, 100);
  if (!g.challenge && diff <= -6 && g.board.confidence < 40) {
    sackUser('board.sackedSeason');
    return 'sacked';
  }
  g.board.warnings = 0;
  g.board.confidence = clamp(55 + diff * 4, 20, 95);
  if (diff >= 3) {
    club.transferBudget = Math.round(club.transferBudget * 1.25);
    addNews({ cat: 'board', key: 'board.delighted', params: { club: club.name } });
    return 'great';
  }
  addNews({ cat: 'board', key: diff >= 0 ? 'board.satisfied' : 'board.disappointed', params: { club: club.name } });
  return 'ok';
}

export type BudgetKind = 'transfer' | 'wage';

/**
 * Hvor meget vil bestyrelsen give? Bestemt af tillid, økonomi, resultater og fansenes humør –
 * ikke af tilfældigheder. Returnerer maks. stigning (andel af nuværende budget) og begrundelser.
 */
export function budgetLimits(kind: BudgetKind): { max: number; reasons: string[] } {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (!club) return { max: 0, reasons: [] };
  const reasons: string[] = [];
  const conf = g.board.confidence;
  let max = kind === 'wage'
    ? (conf >= 80 ? 0.22 : conf >= 65 ? 0.15 : conf >= 50 ? 0.09 : conf >= 35 ? 0.04 : 0)
    : (conf >= 80 ? 0.6 : conf >= 65 ? 0.4 : conf >= 50 ? 0.22 : conf >= 35 ? 0.1 : 0);
  if (conf >= 65) reasons.push('budget.r.trust'); else if (conf < 50) reasons.push('budget.r.lowTrust');
  // resultater i forhold til forventningen
  const comp = g.comps[club.league];
  const played = comp?.table.find((r) => r.club === club.id)?.p ?? 0;
  if (comp && played >= 5) {
    const pos = leagueRows(comp).findIndex((r) => r.club === club.id) + 1;
    const diff = g.board.expectedPos - pos;
    if (diff >= 2) { max *= 1.25; reasons.push('budget.r.results'); }
    else if (diff <= -3) { max *= 0.6; reasons.push('budget.r.poorResults'); }
  }
  if ((club.fanMood ?? 60) >= 72) { max *= 1.1; reasons.push('budget.r.fans'); }
  // økonomien: kan klubben bære det?
  if (club.balance < 0) { max = 0; reasons.push('budget.r.debt'); }
  else if (kind === 'wage') {
    // en lønstigning skal kunne betales i mindst to sæsoner af den nuværende formue
    const affordable = club.balance / Math.max(1, club.wageBudget * 52 * 2);
    if (affordable < max) { max = Math.max(0, affordable); reasons.push('budget.r.finances'); }
  } else {
    const affordable = (club.balance * 0.7 - club.transferBudget) / Math.max(1, club.transferBudget);
    if (affordable < max) { max = Math.max(0, affordable); reasons.push('budget.r.finances'); }
  }
  if (club.ffp?.sanction) { max = Math.min(max, 0.03); reasons.push('budget.r.ffp'); }
  return { max: Math.floor(Math.min(kind === 'wage' ? 0.3 : 0.8, max) * 100) / 100, reasons };
}

/** Bestyrelsens humør over for en anmodning (vises før man spørger – uden at afsløre tallet) */
export function boardMood(kind: BudgetKind): 'open' | 'cautious' | 'closed' {
  const m = budgetLimits(kind).max;
  return m >= (kind === 'wage' ? 0.1 : 0.25) ? 'open' : m >= 0.03 ? 'cautious' : 'closed';
}

function grant(kind: BudgetKind, pct: number) {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (kind === 'transfer') club.transferBudget = Math.round((club.transferBudget * (1 + pct)) / 50_000) * 50_000;
  else club.wageBudget = Math.round((club.wageBudget * (1 + pct)) / 100) * 100;
  // store ønsker koster lidt tillid – bestyrelsen forventer resultater til gengæld
  g.board.confidence = clamp(g.board.confidence - pct * (kind === 'wage' ? 20 : 8), 0, 100);
}

/** Spørg bestyrelsen om en stigning på pct (fx 0.1 = +10 %). Svar: ja, modbud eller nej. */
export function requestBudget(kind: BudgetKind, pct = 0.1): { result: 'ok' | 'counter' | 'no' | 'tooSoon'; pct?: number; reasons?: string[] } {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (!club) return { result: 'no' };
  const month = g.date.slice(0, 7);
  if (g.board.budgetAsked?.[kind] === month) return { result: 'tooSoon' };
  pct = Math.max(0.01, Math.min(1, pct));
  const { max, reasons } = budgetLimits(kind);
  const params = { kind, pct: Math.round(pct * 100) };
  if (pct <= max + 1e-9) {
    grant(kind, pct);
    (g.board.budgetAsked ??= {})[kind] = month;
    g.board.budgetCounter = undefined;
    addNews({ cat: 'board', key: 'board.requestOk', params });
    return { result: 'ok', pct, reasons };
  }
  if (max >= 0.02) {
    g.board.budgetCounter = { kind, pct: max, until: addDays(g.date, 3) };
    return { result: 'counter', pct: max, reasons };
  }
  (g.board.budgetAsked ??= {})[kind] = month;
  addNews({ cat: 'board', key: 'board.requestNo', params });
  return { result: 'no', reasons };
}

/** Svar på bestyrelsens modbud */
export function answerBudgetCounter(accept: boolean): 'ok' | 'expired' {
  const g = gs();
  const c = g.board.budgetCounter;
  if (!c || g.date > c.until) { g.board.budgetCounter = undefined; return 'expired'; }
  g.board.budgetCounter = undefined;
  (g.board.budgetAsked ??= {})[c.kind] = g.date.slice(0, 7);
  if (accept) {
    grant(c.kind, c.pct);
    addNews({ cat: 'board', key: 'board.requestOk', params: { kind: c.kind, pct: Math.round(c.pct * 100) } });
  }
  return 'ok';
}

/** Flyt penge fra transferbudgettet til lønbudgettet (eller omvendt) – altid tilladt.
 *  1 kr. om ugen i løn svarer til 104 kr. i transferbudget (to sæsoner). */
export const SHIFT_WEEKS = 104;
export function shiftBudget(toWage: boolean, amount: number): 'ok' | 'error' {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (!club || !(amount > 0)) return 'error';
  if (toWage) {
    const a = Math.min(amount, club.transferBudget);
    club.transferBudget -= a;
    club.wageBudget += Math.round(a / SHIFT_WEEKS);
  } else {
    const weekly = Math.min(amount, club.wageBudget);
    club.wageBudget -= weekly;
    club.transferBudget += weekly * SHIFT_WEEKS;
  }
  return 'ok';
}

// ---------- AI-managere og jobmarked ----------

export function aiSackings() {
  const g = gs();
  for (const comp of Object.values(g.comps)) {
    if (comp.type !== 'league') continue;
    const sorted = leagueRows(comp);
    sorted.forEach((row, i) => {
      if (row.p < 8) return;
      const club = g.clubs[row.club];
      if (!club || club.manager <= 0 || club.id === g.userClub) return;
      const { rank } = strengthRank(club);
      const under = i + 1 - rank;
      // realistisk ~20-30 % trænerskifter pr. sæson: klart under forventning, nedrykningsfare eller sort stime
      const inDrop = i >= sorted.length - 3 && under >= 2;
      const p = (under >= 4 ? 0.05 + under * 0.015 : 0) + (inDrop ? 0.07 : 0) + (row.form === 'LLLLL' ? 0.1 : 0);
      if (p > 0 && rng.chance(p)) {
        const m = g.staff[club.manager];
        if (m) { careerEnd(m, 'sacked'); m.club = 0; }
        club.manager = 0;
        openVacancy(club.id);
        forEachHuman(() => { if (newsRelevant(club.id)) addNews({ cat: 'job', key: 'news.managerSacked', params: { club: club.name, manager: m ? `${m.first} ${m.last}` : '?' }, link: { kind: 'club', id: club.id } }); });
      }
    });
  }
  // ligaer der ikke simuleres har ingen tabel – her skifter trænerne tilfældigt (~15-20 % pr. sæson),
  // så jobmarkedet også findes i resten af Europa
  for (const club of Object.values(g.clubs)) {
    if (g.comps[club.league] || club.manager <= 0 || !rng.chance(0.02)) continue;
    const m = g.staff[club.manager];
    if (m) { careerEnd(m, 'sacked'); m.club = 0; }
    club.manager = 0;
    openVacancy(club.id);
    forEachHuman(() => { if (newsRelevant(club.id)) addNews({ cat: 'job', key: 'news.managerSacked', params: { club: club.name, manager: m ? `${m.first} ${m.last}` : '?' }, link: { kind: 'club', id: club.id } }); });
  }
}

/** Sæsonslut (1. juni): mange trænerskifter sker i sommerpausen – flest hos dem der skuffede */
export function summerManagerChanges() {
  const g = gs();
  for (const club of Object.values(g.clubs)) {
    if (club.manager <= 0) continue;
    const comp = g.comps[club.league];
    let p = 0.04;
    if (comp?.type === 'league') {
      const pos = leagueRows(comp).findIndex((r) => r.club === club.id) + 1;
      const under = pos - strengthRank(club).rank;
      p = under >= 5 ? 0.22 : under >= 3 ? 0.1 : under <= -3 ? 0.02 : 0.04;
    }
    if (!rng.chance(p)) continue;
    const m = g.staff[club.manager];
    if (m) { careerEnd(m, 'left'); m.club = 0; }
    club.manager = 0;
    openVacancy(club.id);
    forEachHuman(() => { if (newsRelevant(club.id)) addNews({ cat: 'job', key: 'news.managerSacked', params: { club: club.name, manager: m ? `${m.first} ${m.last}` : '?' }, link: { kind: 'club', id: club.id } }); });
  }
}

/** Den aktive managers område: nuværende klub, ellers seneste klub, ellers nationalitet */
export function managerRegion(): Region {
  const g = gs();
  const club = g.clubs[g.userClub] ?? g.clubs[g.manager.history[g.manager.history.length - 1]?.club ?? -1];
  return regionOf(g.nations[club ? club.nation : g.manager.nation]?.name);
}

/** En stilling bliver ledig */
export function openVacancy(clubId: number) {
  const g = gs();
  if (!g.vacancies.includes(clubId)) g.vacancies.push(clubId);
  (g.vacancySince ??= {})[clubId] = g.date;
}

/** Fyld ledige stillinger (efter nogle dage) og send jobtilbud til brugeren */
export function fillVacancies() {
  const g = gs();
  // Jobtilbud til de menneskelige managere
  const offered = new Set<number>();
  forEachHuman(() => {
    // stillinger man er i samtaler med, holdes åbne
    for (const id of Object.keys(g.manager.jobTalks ?? {})) offered.add(Number(id));
    // gamle tilbud fra klubber der ikke er større end ens nuværende fjernes (ikke dem man selv har søgt)
    const cur = g.clubs[g.userClub];
    if (cur) g.jobOffers = g.jobOffers.filter((id) => { const c = g.clubs[id]; return !!c && (!!g.manager.jobTalks?.[id] || c.rep >= cur.rep + 4 || (g.leagues[c.league]?.tier ?? 9) < (g.leagues[cur.league]?.tier ?? 9)); });
    for (const cid of g.vacancies) {
      const club = g.clubs[cid];
      if (!club || club.manager !== 0) continue;
      // arbejdsløs: klubber op til lidt over ens omdømme. I job: klubber på samme niveau eller lidt over –
      // jo mere tilfreds ens nuværende bestyrelse er, jo mere attraktiv er man
      const my = g.clubs[g.userClub];
      // kun jobtilbud fra samme verdensdel som ens klub (eller seneste klub/nationalitet, hvis arbejdsløs)
      if (regionOf(g.nations[club.nation]?.name) !== managerRegion()) continue;
      // ingen tilbud fra klubber der har fyret en, eller som man for nylig har sagt nej til
      if ((g.manager.sackedBy ?? []).includes(cid)) continue;
      const declined = g.manager.declinedJobs?.[cid];
      if (declined && daysBetween(declined, g.date) < 365) continue;
      // i job: kun klubber der er tydeligt større end ens nuværende (omdømme, eller en højere liga),
      // og højst ét tilbud pr. ~3 måneder
      const tier = (c: typeof club) => g.leagues[c.league]?.tier ?? 9;
      const better = !!my && club.id !== my.id && (club.rep >= my.rep + 4 || (tier(club) < tier(my) && club.rep >= my.rep - 2));
      const rested = !g.manager.lastJobOffer || daysBetween(g.manager.lastJobOffer, g.date) >= 90;
      const eligible = !my
        ? g.manager.rep + 12 >= club.rep
        : better && rested && club.rep <= Math.max(g.manager.rep, my.rep) + 12;
      const chance = !my ? 0.35 : Math.max(0.005, 0.025 + (g.board.confidence - 50) / 1500);
      if (eligible && !g.jobOffers.includes(cid) && rng.chance(chance)) {
        g.jobOffers.push(cid);
        if (my) g.manager.lastJobOffer = g.date;
        offered.add(cid);
        addNews({ cat: 'job', key: 'news.jobOffer', params: { club: club.name }, link: { kind: 'club', id: cid } });
      }
    }
  });
  const still: number[] = [];
  for (const cid of g.vacancies) {
    const club = g.clubs[cid];
    if (!club || club.manager !== 0) continue;
    if (offered.has(cid)) { still.push(cid); continue; }
    // stillinger står typisk åbne i 1-4 uger, så man kan nå at søge dem
    const open = g.vacancySince?.[cid] ? daysBetween(g.vacancySince[cid], g.date) : 30;
    if (rng.chance(open < 7 ? 0 : open < 21 ? 0.12 : 0.3)) {
      const m = pickManager(cid);
      if (m) {
        m.club = cid;
        careerStart(m, cid);
        club.manager = m.id;
        club.tactic = null;
        if (g.vacancySince) delete g.vacancySince[cid];
        forEachHuman(() => { if (newsRelevant(cid)) addNews({ cat: 'job', key: 'news.managerHired', params: { club: club.name, manager: `${m.first} ${m.last}` } }); });
        forEachHuman(() => { g.jobOffers = g.jobOffers.filter((x) => x !== cid); });
        continue;
      }
    }
    still.push(cid);
  }
  g.vacancies = still;
}

export function declineJob(cid: number) {
  const g = gs();
  g.jobOffers = g.jobOffers.filter((x) => x !== cid);
  if (g.manager.jobTalks) delete g.manager.jobTalks[cid];
  (g.manager.declinedJobs ??= {})[cid] = g.date;
}

/** Klubbens vilkår: forventning og budgetter (som de står nu) */
export function jobTerms(cid: number): JobTalk {
  const g = gs();
  const club = g.clubs[cid];
  const talk = g.manager.jobTalks?.[cid];
  if (talk && talk.stage === 'offer') return talk;
  const { exp, pos } = expectationFor(club);
  return { stage: 'offer', exp, expectedPos: pos, budget: club.transferBudget, wageBudget: club.wageBudget, asked: [] };
}

/** Søg et job: klubben svarer efter et par dage (afslag eller et tilbud med vilkår) */
export function applyForJob(cid: number): 'sent' | 'offer' | 'error' {
  const g = gs();
  const club = g.clubs[cid];
  if (!club || club.manager !== 0) return 'error';
  if (g.jobOffers.includes(cid)) return 'offer';
  if (g.manager.jobTalks?.[cid]) return 'sent';
  const ok = g.manager.rep + 10 >= club.rep || rng.chance(Math.max(0.05, 0.5 - (club.rep - g.manager.rep) / 40));
  (g.manager.jobTalks ??= {})[cid] = { stage: 'applied', answerOn: addDays(g.date, rng.int(2, 4)), ok, exp: '', expectedPos: 0, budget: 0, wageBudget: 0, asked: [] };
  addNews({ cat: 'job', key: 'job.applied', params: { club: club.name }, link: { kind: 'club', id: cid } });
  return 'sent';
}

/** Dagligt: klubber man har søgt, svarer */
export function processJobTalks() {
  const g = gs();
  const talks = g.manager.jobTalks;
  if (!talks) return;
  for (const [id, talk] of Object.entries(talks)) {
    const cid = Number(id);
    const club = g.clubs[cid];
    if (!club || club.manager !== 0) {
      // stillingen er besat
      if (talk.stage === 'applied' && club) addNews({ cat: 'job', key: 'job.filled', params: { club: club.name } });
      delete talks[cid];
      g.jobOffers = g.jobOffers.filter((x) => x !== cid);
      continue;
    }
    if (talk.stage !== 'applied' || g.date < (talk.answerOn ?? '')) continue;
    if (!talk.ok) {
      delete talks[cid];
      addNews({ cat: 'job', key: 'news.applyRejected', params: { club: club.name } });
      continue;
    }
    const { exp, pos } = expectationFor(club);
    talks[cid] = { stage: 'offer', exp, expectedPos: pos, budget: club.transferBudget, wageBudget: club.wageBudget, asked: [] };
    if (!g.jobOffers.includes(cid)) g.jobOffers.push(cid);
    addNews({ cat: 'job', key: 'job.invite', params: { club: club.name }, link: { kind: 'club', id: cid } });
  }
}

/** Forhandl om et jobtilbud: mere transferbudget eller lavere forventninger (hver én gang) */
export function negotiateJob(cid: number, ask: 'budget' | 'exp'): 'yes' | 'no' | 'withdrawn' | 'already' | 'error' {
  const g = gs();
  const club = g.clubs[cid];
  if (!club || club.manager !== 0 || !g.jobOffers.includes(cid)) return 'error';
  const talk = jobTerms(cid);
  if (talk.asked.includes(ask)) return 'already';
  talk.asked.push(ask);
  (g.manager.jobTalks ??= {})[cid] = talk;
  // en anerkendt manager har mere at forhandle med; at bede om lavere forventninger er sværere
  const p = clamp(0.55 + (g.manager.rep - club.rep) / 40 - (ask === 'exp' ? 0.1 : 0), 0.15, 0.9);
  if (rng.chance(p)) {
    if (ask === 'budget') talk.budget = Math.round(Math.max(talk.budget * 1.3, talk.budget + 1_000_000) / 100_000) * 100_000;
    else { const e = expectationFor(club, 1); talk.exp = e.exp; talk.expectedPos = e.pos; }
    return 'yes';
  }
  if (rng.chance(clamp(0.3 - (g.manager.rep - club.rep) / 60, 0.1, 0.45))) {
    delete g.manager.jobTalks![cid];
    g.jobOffers = g.jobOffers.filter((x) => x !== cid);
    addNews({ cat: 'job', key: 'job.withdrawn', params: { club: club.name } });
    return 'withdrawn';
  }
  return 'no';
}

export function acceptJob(cid: number) {
  const g = gs();
  const club = g.clubs[cid];
  const terms = jobTerms(cid);
  if (g.userClub && g.clubs[g.userClub]) {
    const oldClub = g.clubs[g.userClub];
    oldClub.manager = 0;
    openVacancy(oldClub.id);
  }
  g.vacancies = g.vacancies.filter((x) => x !== cid);
  if (g.vacancySince) delete g.vacancySince[cid];
  forEachHuman(() => { g.jobOffers = g.jobOffers.filter((x) => x !== cid); });
  g.jobOffers = [];
  g.manager.jobTalks = {};
  takeOverClub(club);
  // de aftalte vilkår gælder
  club.transferBudget = Math.max(club.transferBudget, terms.budget);
  if (terms.exp && terms.exp !== g.board.expectation) {
    g.board.expectation = terms.exp;
    g.board.expectedPos = terms.expectedPos;
    const n = g.news.find((x) => x.key.startsWith('board.exp.'));
    if (n) n.key = `board.exp.${terms.exp}`;
  }
  addNews({ cat: 'job', key: 'news.newJob', params: { club: club.name } });
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------- byggeprojekter ----------

import type { ProjectKind } from './types';

export interface ProjectOffer {
  kind: ProjectKind;
  cost: number;
  months: number;
  amount: number;
}

/** Hvad vil et projekt koste og give? */
export function projectOffer(kind: ProjectKind): ProjectOffer | null {
  const g = gs();
  const c = g.clubs[g.userClub];
  if (!c) return null;
  const wealth = Math.max(0.3, rulesForLeague(c.league));
  if (kind === 'stadium') {
    const amount = Math.max(1000, Math.round((c.seats * 0.15) / 500) * 500);
    return { kind, amount, months: 10, cost: Math.round((amount * 2200 * Math.sqrt(wealth)) / 100_000) * 100_000 };
  }
  const level = kind === 'training' ? c.facilities : c.youth;
  if (level >= 20) return null;
  const amount = level >= 17 ? 1 : 2;
  return { kind, amount, months: kind === 'training' ? 6 : 8, cost: Math.round((Math.pow(level + 1, 2) * 45_000 * Math.sqrt(wealth)) / 50_000) * 50_000 };
}

/** Anmod bestyrelsen om et byggeprojekt */
export function requestProject(kind: ProjectKind): 'ok' | 'busy' | 'money' | 'confidence' | 'max' {
  const g = gs();
  const c = g.clubs[g.userClub];
  const offer = projectOffer(kind);
  if (!c || !offer) return 'max';
  if ((c.projects ?? []).some((p) => p.kind === kind)) return 'busy';
  if (g.board.confidence < 45) {
    addNews({ cat: 'board', key: 'board.project.noConfidence', params: { kind } });
    return 'confidence';
  }
  if (c.balance < offer.cost) {
    addNews({ cat: 'board', key: 'board.project.noMoney', params: { kind, cost: offer.cost } });
    return 'money';
  }
  c.balance -= offer.cost;
  c.finance.other += offer.cost;
  const done = addDays(g.date, offer.months * 30);
  (c.projects ??= []).push({ kind, started: g.date, done, cost: offer.cost, amount: offer.amount });
  g.board.confidence = clamp(g.board.confidence - 3, 0, 100);
  addNews({ cat: 'board', key: 'board.project.approved', params: { kind, cost: offer.cost, done } });
  return 'ok';
}

/** Dagligt: færdiggør projekter */
export function completeProjects() {
  const g = gs();
  for (const c of Object.values(g.clubs)) {
    if (!c.projects?.length) continue;
    const finished = c.projects.filter((p) => p.done <= g.date);
    if (!finished.length) continue;
    c.projects = c.projects.filter((p) => p.done > g.date);
    for (const p of finished) {
      if (p.kind === 'stadium') c.seats += p.amount;
      else if (p.kind === 'training') c.facilities = Math.min(20, c.facilities + p.amount);
      else c.youth = Math.min(20, c.youth + p.amount);
      forEachHuman(() => {
        if (g.userClub === c.id) addNews({ cat: 'board', key: 'board.project.done', params: { kind: p.kind, amount: p.amount, seats: c.seats } });
      });
    }
  }
}

// en fjernet manager (multiplayer): klubben får straks en AI-manager
removeHooks.onRemoved = (clubId) => {
  const g = gs();
  const club = g.clubs[clubId];
  const m = pickManager(clubId);
  if (m && club) { m.club = clubId; careerStart(m, clubId); club.manager = m.id; }
  else openVacancy(clubId);
};
removeHooks.news = (name, club) => addNews({ cat: 'general', key: 'mp.removed', params: { manager: name, club } });

// ---------- øvrige ønsker til bestyrelsen ----------

export interface BoardAskInfo {
  /** kan ønsket stilles nu? ellers en nøgle med begrundelsen */
  blocked?: string;
  /** pris (for ønsker, der koster penge) */
  cost?: number;
  /** bestyrelsens sandsynlige svar, ud fra de samme regler som afgør det */
  likely: 'yes' | 'maybe' | 'no';
  /** hvad der taler for og imod (i18n-nøgler) */
  pros: string[];
  cons: string[];
}

const LEAGUE_PLAYED = () => {
  const g = gs();
  const c = g.clubs[g.userClub];
  return g.comps[c?.league ?? '']?.table.find((r) => r.club === g.userClub)?.p ?? 0;
};
const leaguePos = () => {
  const g = gs();
  const c = g.clubs[g.userClub];
  const comp = c ? g.comps[c.league] : undefined;
  return comp ? leagueRows(comp).findIndex((r) => r.club === c!.id) + 1 : 99;
};
/** Er ønsket allerede stillet i denne sæson (eller inden for days dage)? */
function askedRecently(kind: BoardAsk, days: number): boolean {
  const g = gs();
  const d = g.board.asked?.[kind];
  return !!d && daysBetween(d, g.date) < days;
}

export function boardAskInfo(kind: BoardAsk): BoardAskInfo {
  const g = gs();
  const c = g.clubs[g.userClub];
  if (!c) return { blocked: 'ba.blocked.noClub', likely: 'no', pros: [], cons: [] };
  const pros: string[] = [], cons: string[] = [];
  const conf = g.board.confidence;
  switch (kind) {
    case 'lowerExp': {
      const played = LEAGUE_PLAYED();
      if (askedRecently(kind, 300)) return { blocked: 'ba.blocked.season', likely: 'no', pros, cons };
      if (played >= 8) return { blocked: 'ba.blocked.tooLate', likely: 'no', pros, cons };
      const lower = expectationFor(c, 1);
      if (lower.pos <= g.board.expectedPos) return { blocked: 'ba.blocked.alreadyLow', likely: 'no', pros, cons };
      const { rank } = strengthRank(c);
      const overrated = rank > g.board.expectedPos;
      if (overrated) pros.push('ba.pro.overrated'); else cons.push('ba.con.fairExp');
      if (conf >= 65) pros.push('ba.pro.trust'); else if (conf < 45) cons.push('ba.con.lowTrust');
      return { likely: overrated || conf >= 65 ? 'yes' : conf >= 50 ? 'maybe' : 'no', pros, cons };
    }
    case 'confidenceVote': {
      if (askedRecently(kind, 300)) return { blocked: 'ba.blocked.season', likely: 'no', pros, cons };
      if (conf >= 55) return { blocked: 'ba.blocked.notNeeded', likely: 'no', pros, cons };
      const fans = c.fanMood ?? 60;
      const near = leaguePos() <= g.board.expectedPos + 2;
      if (fans >= 50) pros.push('ba.pro.fans'); else cons.push('ba.con.fans');
      if (near) pros.push('ba.pro.nearTarget'); else cons.push('ba.con.farFromTarget');
      return { likely: fans >= 50 && near ? 'yes' : fans >= 50 || near ? 'maybe' : 'no', pros, cons };
    }
    case 'youthDrive': {
      const cost = Math.max(100_000, Math.round(c.wageBudget * 6 / 10_000) * 10_000);
      if (c.youthDrive === g.season) return { blocked: 'ba.blocked.youthDone', cost, likely: 'no', pros, cons };
      const m = Number(g.date.slice(5, 7));
      if (m === 3 && Number(g.date.slice(8, 10)) >= 15 || m === 4 || m === 5) return { blocked: 'ba.blocked.afterIntake', cost, likely: 'no', pros, cons };
      if (c.balance >= cost * 3) pros.push('ba.pro.money'); else if (c.balance < cost) cons.push('ba.con.money');
      if (conf >= 45) pros.push('ba.pro.trustOk'); else cons.push('ba.con.lowTrust');
      return { cost, likely: c.balance >= cost && conf >= 45 ? 'yes' : 'no', pros, cons };
    }
  }
}

/** Stil et ønske til bestyrelsen. Svaret følger reglerne i boardAskInfo (et "måske" afgøres af tilliden). */
export function boardAsk(kind: BoardAsk): 'yes' | 'no' | 'blocked' {
  const g = gs();
  const c = g.clubs[g.userClub];
  const info = boardAskInfo(kind);
  if (!c || info.blocked) return 'blocked';
  (g.board.asked ??= {})[kind] = g.date;
  const yes = info.likely === 'yes' || (info.likely === 'maybe' && g.board.confidence + (c.fanMood ?? 60) / 4 >= 60);
  if (!yes) {
    if (kind === 'confidenceVote') { g.board.confidence = clamp(g.board.confidence - 6, 0, 100); g.board.warnings = Math.min(2, g.board.warnings + 1); }
    else if (kind === 'lowerExp') g.board.confidence = clamp(g.board.confidence - 3, 0, 100);
    addNews({ cat: 'board', key: `ba.no.${kind}`, params: { club: c.name } });
    return 'no';
  }
  switch (kind) {
    case 'lowerExp': {
      const e = expectationFor(c, 1);
      g.board.expectation = e.exp;
      g.board.expectedPos = e.pos;
      g.board.confidence = clamp(g.board.confidence - 4, 0, 100);
      addNews({ cat: 'board', key: 'ba.yes.lowerExp', params: { exp: e.exp, pos: e.pos } });
      break;
    }
    case 'confidenceVote':
      g.board.warnings = 0;
      g.board.confidence = clamp(g.board.confidence + 10, 0, 100);
      addNews({ cat: 'board', key: 'ba.yes.confidenceVote', params: { club: c.name } });
      break;
    case 'youthDrive':
      c.balance -= info.cost!;
      c.finance.other += info.cost!;
      c.youthDrive = g.season;
      addNews({ cat: 'board', key: 'ba.yes.youthDrive', params: { cost: info.cost! } });
      break;
  }
  return 'yes';
}
