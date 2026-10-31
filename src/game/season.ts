// Sæsonskifte: priser, historik, op/nedrykning, kontrakter, pensioneringer, regens.
import { recordsAfterMove, recordsSeasonEnd, retireIntoStaff } from './records';
import { achievementsSeasonEnd, unlock } from './achievements';
import { storyAdd, storySeasonEnd } from './story';
import { finalOrder, promotionOrder, leagueRows } from './competitions';
import { ageOn } from './dates';
import { emptyStats, makePlayer, randomDob, randomName, randomSub, type SubPos } from './data/generate';
import { LEAGUE_RULES } from './leagues';
import { Rng, hash, hash01, rng } from './rng';
import { addNews, addPlayer, newsRelevant, gs, rebuildIndexes, removePlayer, setClub, squad } from './state';
import { fansOnDeparture } from './fans';
import { boardSeasonEnd, setBoardExpectation, strengthRank } from './board';
import { seasonCareers } from './careers';
import { computeSeasonScore, recordSeasonScore, startScoreSeason } from './rating';
import { ffpReview, newSeasonBudgets, seasonPrizeMoney, sponsorSeasonBonus } from './finance';
import { fillSquad, setupSeasonComps } from './newgame';
import { aiFillSquads, exerciseLoanOption } from './transfers';
import { seasonWageClauses } from './clauses';
import { clubLevel } from './scouting';
import { CHALLENGES } from './challenges';
import { monthlyAwards, seasonGala, surpriseOfSeason, teamOfYear } from './awards';
import { initKnowledge } from './scouting';
import type { Club, Player, SeasonFinance, SeasonSummary } from './types';
import { asOwner, forEachHuman, isHumanClub } from './humans';

const pname = (p: Player) => `${p.first} ${p.last}`.trim();

export function avgRating(p: Player) {
  return p.stats.ratingCount ? p.stats.ratingSum / p.stats.ratingCount : 0;
}

/** Tilskuere til hver klubs hjemmekampe i ligaen denne sæson */
export function homeAttendance(): Map<number, { sum: number; n: number }> {
  const g = gs();
  const map = new Map<number, { sum: number; n: number }>();
  for (const f of Object.values(g.fixtures)) {
    if (!f.result?.att || g.comps[f.comp]?.type !== 'league') continue;
    const e = map.get(f.home) ?? { sum: 0, n: 0 };
    e.sum += f.result.att;
    e.n++;
    map.set(f.home, e);
  }
  return map;
}

/** Sæsonens priser og historik pr. turnering */
function seasonAwards(): SeasonSummary {
  const g = gs();
  const sum: SeasonSummary = { season: g.season, comps: [] };
  const att = homeAttendance();
  for (const comp of Object.values(g.comps)) {
    if (!comp.winner) continue;
    const entry: SeasonSummary['comps'][number] = { id: comp.id, name: comp.name, winner: comp.winner };
    if (comp.type === 'league') {
      const order = finalOrder(comp);
      entry.runnerUp = order[1];
      const players = order.flatMap((cid) => squad(cid));
      const top = players.slice().sort((a, b) => b.stats.lgGoals - a.stats.lgGoals)[0];
      if (top) entry.topScorer = [top.id, top.stats.lgGoals];
      const eligible = players.filter((p) => p.stats.lgApps >= Math.max(8, comp.table[0]?.p * 0.5));
      const best = eligible.slice().sort((a, b) => avgRating(b) + b.stats.lgGoals * 0.02 - (avgRating(a) + a.stats.lgGoals * 0.02))[0];
      if (best) entry.best = best.id;
      const young = eligible.filter((p) => ageOn(p.dob, g.date) <= 21).sort((a, b) => avgRating(b) - avgRating(a))[0];
      if (young) entry.young = young.id;
      entry.teamOfYear = teamOfYear(comp);
      entry.surprise = surpriseOfSeason(comp);
      // klubhistorik (med sæsonens økonomi og tilskuere)
      order.forEach((cid, i) => {
        const row = comp.table.find((r) => r.club === cid);
        const c = g.clubs[cid];
        const f = c.finance;
        const a = att.get(cid);
        const fin: SeasonFinance = {
          gate: Math.round(f.gate), tv: Math.round(f.tv), sponsor: Math.round(f.sponsor), merch: Math.round(f.merch), prize: Math.round(f.prize),
          wages: Math.round(f.wages), sales: Math.round(f.transfersIn), buys: Math.round(f.transfersOut), other: Math.round(f.other),
          avgAtt: a ? Math.round(a.sum / a.n) : 0, seats: c.seats, homeGames: a?.n ?? 0, ticket: c.ticketPrice, balance: Math.round(c.balance),
        };
        c.history.push({ season: g.season, league: comp.id, pos: i + 1, pts: row?.pts ?? 0, fin });
      });
      forEachHuman(() => {
        if (!g.userClub || !order.includes(g.userClub)) return;
        if (best) addNews({ cat: 'award', key: 'award.playerOfYear', params: { player: pname(best), comp: comp.name }, link: { kind: 'player', id: best.id } });
        if (top) addNews({ cat: 'award', key: 'award.topScorer', params: { player: pname(top), goals: top.stats.lgGoals, comp: comp.name }, link: { kind: 'player', id: top.id } });
      });
    } else {
      entry.runnerUp = comp.meta?.runnerUp as number | undefined;
    }
    forEachHuman(() => {
      if (g.userClub && comp.winner === g.userClub && comp.type !== 'playoff') {
        g.manager.trophies.push({ season: g.season, comp: comp.name, club: g.userClub });
        storyAdd({ k: 'trophy', w: comp.type === 'league' || comp.type === 'continental' ? 12 : 9, p: { comp: comp.name } });
        unlock(comp.type === 'league' && comp.tier === 1 ? 'title' : comp.type === 'cup' ? 'cup' : comp.id === 'CL' ? 'clWin' : comp.type === 'league' ? 'promotion' : 'europe');
      }
    });
    sum.comps.push(entry);
  }
  return sum;
}

/** Op- og nedrykning. Returnerer nye ligatilhørsforhold */
function promotionRelegation() {
  const g = gs();
  const moves = new Map<number, string>();
  for (const [upper, rules] of Object.entries(LEAGUE_RULES)) {
    if (!rules.below) continue;
    const U = g.comps[upper];
    const L = g.comps[rules.below];
    if (!U?.finished || !L?.finished) continue;
    const uOrder = finalOrder(U);
    const lOrder = promotionOrder(L);
    const lRules = LEAGUE_RULES[rules.below];
    const down = uOrder.slice(uOrder.length - (rules.relegated ?? 0));
    const up = lOrder.slice(0, lRules?.promoted ?? 0);
    // playoff i nederste liga (fx Championship)
    const poLower = g.comps[`PO-${rules.below}`];
    if (poLower?.winner && poLower.playoffFor === upper) {
      up.push(poLower.winner);
    }
    // relegationsplayoff (fx 16. i Bundesliga mod 3. i 2. Bundesliga)
    const poUpper = g.comps[`PO-${upper}`];
    if (poUpper?.winner && lOrder.includes(poUpper.winner)) {
      up.push(poUpper.winner);
      const loser = (poUpper.clubs.find((c) => uOrder.includes(c)));
      if (loser) down.push(loser);
    }
    // ligastørrelserne skal bevares: lige så mange op som ned
    for (const c of uOrder.slice().reverse()) { if (up.length <= down.length) break; if (!down.includes(c)) down.push(c); }
    for (const c of lOrder) { if (down.length <= up.length) break; if (!up.includes(c)) up.push(c); }
    for (const c of down) moves.set(c, rules.below);
    for (const c of up) moves.set(c, upper);
  }
  for (const [cid, league] of moves) {
    const club = g.clubs[cid];
    const wasUp = (g.leagues[league]?.tier ?? 1) < (g.leagues[club.league]?.tier ?? 1);
    const oldLeague = club.league;
    club.league = league;
    // nedrykkede AI-klubber må sælge stjernerne (nedrykningsklausuler, lønninger) – ellers vinder de næste liga med 110+ point
    if (!wasUp && !isHumanClub(cid)) {
      for (const p of squad(cid).filter((x) => !x.loan && x.contract).sort((a, b) => b.ca - a.ca).slice(0, 8)) {
        p.listed = true;
        p.listPrice = Math.max(10_000, Math.round(p.value * 0.65 / 50_000) * 50_000);
      }
    }
    forEachHuman(() => {
      // kun op-/nedrykninger, der berører ens egen liga (eller ens land/verden, hvis man har valgt det)
      const me = g.clubs[g.userClub];
      const scope = g.options.newsScope ?? 'league';
      const relevant = cid === g.userClub || scope === 'world'
        || (scope === 'nation' ? g.leagues[league]?.nation === me?.nation : !!me && (league === me.league || oldLeague === me.league));
      if (relevant) {
        addNews({ cat: 'general', key: wasUp ? 'news.promoted' : 'news.relegated', params: { club: club.name, comp: g.leagues[league]?.name ?? league } });
      }
    });
  }
}

function contractsAndLoans() {
  const g = gs();
  const today = g.date; // 1. juli
  for (const p of Object.values(g.players)) {
    if (p.loan && p.loan.until < today && !exerciseLoanOption(p)) {
      setClub(p, p.loan.from);
      p.loan = null;
    }
    if (p.contract && p.contract.expires < today) {
      if (p.contract.futureClub && g.clubs[p.contract.futureClub]) {
        const to = p.contract.futureClub;
        const fromName = g.clubs[p.club]?.name ?? '-';
        const fromClub = p.club;
        p.contract = { wage: p.contract.futureWage ?? p.contract.wage, expires: p.contract.futureExpires ?? `${g.season + 3}-06-30`, ...(p.futureClauses ?? {}) };
        p.futureClauses = undefined;
        p.sellOn = undefined;
        p.addOn = undefined;
        recordMove(p, to, 0);
        setClub(p, to);
        p.joined = today;
        const msg = { cat: 'transfer' as const, key: 'transfer.bosmanDone', params: { player: pname(p), from: fromName, to: g.clubs[to].name } };
        asOwner(to, () => { g.knowledge[p.id] = 100; addNews(msg); });
        if (fromClub !== to) asOwner(fromClub, () => addNews(msg));
      } else {
        asOwner(p.club, () => addNews({ cat: 'contract', key: 'contract.left', params: { player: pname(p) } }));
        if (g.clubs[p.club]) fansOnDeparture(p, g.clubs[p.club], 'free');
        setClub(p, 0);
        p.contract = null;
      }
    }
  }
}

function retirements() {
  const g = gs();
  for (const p of Object.values(g.players)) {
    const age = ageOn(p.dob, g.date);
    let prob = 0;
    const keeper = p.pos[0] >= 15;
    if (age >= (keeper ? 42 : 40)) prob = 1;
    else if (age >= 35) prob = (age - 34) * 0.16 + (p.ca < 100 ? 0.12 : 0) - (keeper ? 0.12 : 0);
    else if (age === 34) prob = p.ca < 90 ? 0.15 : 0.05;
    else if (!p.club && age >= 32) prob = 0.4;
    else if (!p.club && p.ca < 55 && age >= 24) prob = 0.5;
    if (prob > 0 && rng.chance(prob)) {
      const msg = { cat: 'general' as const, key: 'news.retired', params: { player: pname(p), age } };
      if (p.rep >= 75) forEachHuman(() => { if (newsRelevant(p.club)) addNews(msg); });
      else if (isHumanClub(p.club)) asOwner(p.club, () => addNews(msg));
      retireIntoStaff(p);
      removePlayer(p);
    }
  }
}

const PA_BASE = 30, PA_Q = 55, PA_SD = 22;

/** Datoen for årets ungdomsdag (15. marts) */
export function intakeDate(): string {
  const g = gs();
  return `${g.season + 1}-03-15`;
}

interface IntakeSpec { first: string; last: string; nation: number; dob: string; sub: SubPos; foot: 'L' | 'R'; ca: number; pa: number }

/** Årets ungdomsårgang for en klub – deterministisk, så den kan forudsiges i en rapport inden ungdomsdagen */
export function planIntake(c: Club): IntakeSpec[] {
  const g = gs();
  const date = intakeDate();
  const r = new Rng(hash(g.seed, c.id, g.season, 31));
  // ekstra ungdomsrekruttering (bestyrelsesønske): én spiller mere og en bedre årgang
  const drive = c.youthDrive === g.season;
  const n = r.int(3, 4) + (drive ? 1 : 0);
  const out: IntakeSpec[] = [];
  for (let i = 0; i < n; i++) {
    const nation = r.chance(0.88) ? c.nation : r.pick(Object.keys(g.names).map(Number));
    const [first, last] = randomName(g.names, nation, r);
    const age = r.int(15, 17);
    const sub: SubPos = randomSub(r);
    const quality = (c.youth / 20) * 0.6 + (c.rep / 100) * 0.4 + (drive ? 0.12 : 0);
    const ca = Math.round(28 + quality * 45 + r.normal(0, 8));
    // kalibreret (scripts/player-pool.ts): nok talenter til at erstatte dem der stopper, uden at oversvømme toppen
    let pa = Math.round(ca + PA_BASE + quality * PA_Q + r.normal(0, PA_SD));
    if (r.chance(0.006 + quality * 0.01)) pa = r.int(160, 195); // wonderkid
    const dob = randomDob(age, date, r);
    const foot = r.chance(0.25) ? 'L' : 'R';
    out.push({ first, last, nation, dob, sub, foot, ca, pa: Math.min(200, Math.max(ca + 5, pa)) });
  }
  return out;
}

export type IntakeVerdict = 'golden' | 'good' | 'average' | 'poor';

/** Hvor god er årgangen i forhold til klubbens niveau? */
export function intakeVerdict(specs: { pa: number }[], level: number): IntakeVerdict {
  const best = Math.max(0, ...specs.map((s) => s.pa));
  const strong = specs.filter((s) => s.pa >= level).length;
  if (best >= level + 15 || strong >= 2) return 'golden';
  if (best >= level - 5) return 'good';
  if (best >= level - 25) return 'average';
  return 'poor';
}

const VERDICTS: IntakeVerdict[] = ['poor', 'average', 'good', 'golden'];

/** 1. februar: ungdomschefens rapport om den kommende årgang (kun menneskestyrede klubber) */
export function youthPreview() {
  const g = gs();
  forEachHuman(() => {
    const c = g.clubs[g.userClub];
    if (!c) return;
    const specs = planIntake(c);
    const level = clubLevel(c.id);
    // rapporten kommer fra den bedste talentbedømmer i staben – en svag bedømmer kan tage fejl
    const staff = Object.values(g.staff).filter((s) => s.club === c.id && (s.role === 'assistant' || s.role === 'coach'));
    const judge = staff.sort((a, b) => b.attrs.judgingPotential - a.attrs.judgingPotential)[0];
    const skill = judge?.attrs.judgingPotential ?? 8;
    let idx = VERDICTS.indexOf(intakeVerdict(specs, level));
    const miss = hash01(g.seed, c.id, g.season, 41);
    if (miss < (20 - skill) / 40) idx = Math.max(0, Math.min(3, idx + (hash01(g.seed, c.id, g.season, 42) < 0.5 ? -1 : 1)));
    const verdict = VERDICTS[idx];
    const best = specs.slice().sort((a, b) => b.pa - a.pa)[0];
    const standout = best && best.pa >= level - 5 ? best.sub : undefined;
    g.board.youthPreview = { season: g.season, verdict, n: specs.length, standout, wonderkid: !!best && best.pa >= 160 && skill >= 12 };
    addNews({
      cat: 'youth', key: `youth.preview.${verdict}`,
      params: { coach: judge ? `${judge.first} ${judge.last}` : '', n: specs.length, pos: standout ?? '' },
    });
  });
}

/** Ungdomsårgang – kaldes i marts */
export function youthIntake() {
  const g = gs();
  const active = new Set(g.activeNations);
  for (const c of Object.values(g.clubs)) {
    if (!active.has(c.nation) && rng.chance(0.3)) continue; // inaktive nationer får lidt færre
    const specs = planIntake(c);
    const human = isHumanClub(c.id);
    const added: [Player, SubPos][] = [];
    for (const sp of specs) {
      // supporternes navne: et af årets talenter i en spillet nation kan få et navn fra en supporter
      const sr = active.has(c.nation) && rng.chance(0.04) ? g.supporterRegens?.find((x) => !x.used) : undefined;
      if (sr) { sr.used = true; sp.first = sr.first; sp.last = sr.last; }
      const p = makePlayer({
        id: g.nextId.player++, first: sp.first, last: sp.last, dob: sp.dob, nation: sp.nation, club: c.id, sub: sp.sub,
        foot: sp.foot, height: 0, ca: sp.ca, pa: sp.pa, date: g.date, seed: g.seed, regen: true,
        contractEnd: `${g.season + 3}-06-30`,
      });
      p.value = Math.max(10_000, p.value);
      if (p.contract) p.contract.wage = Math.max(150, Math.round(p.contract.wage * 0.3 / 50) * 50);
      if (sr) p.supporterNamed = sr.by;
      addPlayer(p);
      added.push([p, sp.sub]);
      if (human) asOwner(c.id, () => {
        g.knowledge[p.id] = 100;
        addNews({ cat: 'youth', key: 'news.youth', params: { player: pname(p), pos: sp.sub }, link: { kind: 'player', id: p.id } });
      });
    }
    if (human && added.length) {
      const [best, pos] = added.slice().sort((a, b) => b[0].pa - a[0].pa)[0];
      asOwner(c.id, () => {
        addNews({ cat: 'youth', key: 'youth.intakeDay', params: { n: added.length, player: pname(best), pos }, link: { kind: 'player', id: best.id } });
        // pressemeddelelsen: tonen afhænger af, hvor god årgangen er i forhold til klubbens niveau
        const verdict = intakeVerdict(added.map(([p]) => p), clubLevel(c.id));
        g.board.lastIntake = { season: g.season, ids: added.map(([p]) => p.id), verdict };
        addNews({ cat: 'youth', key: `youth.press.${verdict}`, params: { club: c.name, n: added.length, player: pname(best), pos } });
      });
    }
  }
}

/** Bogfør sæsonens tal siden sidste skifte på en klub i karrieren */
/** Bogfør et klubskifte (til karriereoversigten) – kaldes før spilleren skifter */
export function recordMove(p: Player, to: number, fee: number, loan = false, swap = false) {
  const g = gs();
  recordsAfterMove(p, to, fee, loan);
  (p.moves ??= []).push({ season: g.season, date: g.date, from: p.club, to, fee, ...(loan ? { loan: true } : {}), ...(swap ? { swap: true } : {}) });
  if (p.moves.length > 20) p.moves.shift();
}

export function pushCareerLine(p: Player, club: number, loan: boolean) {
  const g = gs();
  const b = p.split ?? { apps: 0, goals: 0, assists: 0, minutes: 0, ratingSum: 0, ratingCount: 0 };
  const apps = p.stats.apps + p.stats.subs - b.apps;
  if (apps <= 0) return;
  const rc = p.stats.ratingCount - b.ratingCount;
  p.history.push({
    season: g.season, club, apps, goals: p.stats.goals - b.goals, assists: p.stats.assists - b.assists, minutes: p.stats.minutes - b.minutes,
    avg: rc > 0 ? Math.round(((p.stats.ratingSum - b.ratingSum) / rc) * 100) / 100 : 0, ...(loan ? { loan: true } : {}),
  });
  if (p.history.length > 30) p.history.shift();
  p.split = { apps: p.stats.apps + p.stats.subs, goals: p.stats.goals, assists: p.stats.assists, minutes: p.stats.minutes, ratingSum: p.stats.ratingSum, ratingCount: p.stats.ratingCount };
}

function archiveStats() {
  const g = gs();
  for (const p of Object.values(g.players)) {
    // sæsonens tal for den nuværende klub (minus det der er bogført på en tidligere klub)
    if (p.stats.apps + p.stats.subs > 0) pushCareerLine(p, p.club, !!p.loan);
    p.split = undefined;
    p.stats = emptyStats();
    p.yellowCount = 0;
    p.banned = 0;
    p.form = [];
  }
}

/**
 * Det omdømme en placering "er værd" i ligaen: omdømmet hos den klub der normalt ligger der
 * (ligaens omdømmer sorteret). Mesteren får lidt ekstra.
 */
export function repTargets(clubIds: number[]): number[] {
  const g = gs();
  const reps = clubIds.map((id) => g.clubs[id]?.rep ?? 0).sort((a, b) => b - a);
  return reps.map((r, i) => r + (i === 0 ? 3 : 0));
}

/** Flyt omdømmet en brøkdel mod målet; brøkdele opspares, så små ændringer ikke forsvinder i afrunding */
function driftRep(cid: number, target: number, rate: number) {
  const c = gs().clubs[cid];
  if (!c) return;
  c.repDrift = (c.repDrift ?? 0) + (target - c.rep) * rate;
  const whole = Math.trunc(c.repDrift);
  if (whole !== 0) {
    c.rep = Math.max(3, Math.min(99, c.rep + whole));
    c.repDrift -= whole;
  }
}

/** Den 1. i måneden: omdømmet følger den aktuelle tabelplacering (når der er spillet nok kampe) */
export function monthlyClubReps() {
  const g = gs();
  for (const comp of Object.values(g.comps)) {
    if (comp.type !== 'league' || comp.finished) continue;
    const rows = leagueRows(comp);
    if ((rows[0]?.p ?? 0) < 6) continue;
    const targets = repTargets(comp.clubs);
    rows.forEach((r, i) => driftRep(r.club, targets[i], 0.06));
  }
}

/** Hvilken vej går klubbens omdømme lige nu? (til visning) */
export function repTrend(cid: number): -1 | 0 | 1 {
  const g = gs();
  const c = g.clubs[cid];
  const comp = c ? g.comps[c.league] : undefined;
  if (!c || !comp || comp.type !== 'league') return 0;
  const rows = leagueRows(comp);
  if ((rows[0]?.p ?? 0) < 3) return 0;
  const target = repTargets(comp.clubs)[rows.findIndex((r) => r.club === cid)] ?? c.rep;
  return target >= c.rep + 3 ? 1 : target <= c.rep - 3 ? -1 : 0;
}

function updateClubReps() {
  const g = gs();
  // sæsonslut: et større skridt mod det omdømme slutplaceringen er værd (løbende ændringer er sket hver måned)
  for (const comp of Object.values(g.comps)) {
    if (comp.type !== 'league') continue;
    const order = finalOrder(comp);
    const targets = repTargets(comp.clubs);
    order.forEach((cid, i) => {
      driftRep(cid, targets[i], 0.4);
      if (i === 0) driftRep(cid, g.clubs[cid].rep + 2, 1);
    });
  }
  const bump = (cid: number | undefined, d: number) => { const c = cid ? g.clubs[cid] : undefined; if (c) c.rep = Math.max(3, Math.min(99, c.rep + d)); };
  // pokaltitler
  for (const comp of Object.values(g.comps)) if (comp.type === 'cup' && comp.finished) bump(comp.winner, 1);
  // Europa: jo længere, jo mere omdømme (kvartfinale +1, semifinale +2, finale +3, CL-sejr +5 / UEFA-sejr +3)
  for (const [id, win] of [['CL', 5], ['UEFA', 3], ['UECL', 2]] as const) {
    const comp = g.comps[id];
    if (!comp) continue;
    const reached = new Map<number, number>();
    for (const t of comp.ties) {
      const lvl = t.stage === 'QF' ? 1 : t.stage === 'SF' ? 2 : t.stage === 'F' ? 3 : 0;
      for (const c of [t.a, t.b]) reached.set(c, Math.max(reached.get(c) ?? 0, lvl));
    }
    for (const [cid, lvl] of reached) bump(cid, cid === comp.winner ? win : id === 'UECL' ? Math.max(0, lvl - 1) : lvl);
  }
}

function prune() {
  const g = gs();
  // fri agenter med lav værdi forsvinder
  const free = Object.values(g.players).filter((p) => !p.club);
  for (const p of free) {
    const age = ageOn(p.dob, g.date);
    // klubløse der ikke er gode nok, eller er for gamle til at få kontrakt, forsvinder ud af fodbolden
    if ((p.ca < 85 && age >= 25) || (age >= 33 && p.ca < 100) || age >= 38 || (p.ca < 45 && age >= 21)) removePlayer(p);
  }
  // gamle kampe og rapporter
  g.fixtures = {};
  const reportIds = Object.keys(g.reports).map(Number).sort((a, b) => b - a);
  for (const id of reportIds.slice(40)) delete g.reports[id];
}

/** Kaldes 1. juli */
export function seasonRollover() {
  const g = gs();
  seasonPrizeMoney();
  monthlyAwards(); // juni-kåringer inden arkivering
  const summary = seasonAwards();
  seasonGala(summary);
  g.seasonHistory.push(summary);
  // Udfordringer og bestyrelsens dom – pr. menneskelig manager
  const challengeResults = new Map<string | undefined, 'won' | 'lost'>();
  ffpReview();
  forEachHuman(() => {
    const club = g.clubs[g.userClub];
    if (club) {
      const comp = g.comps[club.league];
      const pos = comp ? finalOrder(comp).indexOf(club.id) + 1 : 99;
      const trophy = Object.values(g.comps).some((c) => c.winner === club.id && c.type !== 'playoff');
      sponsorSeasonBonus(pos, g.board.expectedPos, trophy);
    }
    if (g.challenge && !g.challenge.done) {
      const ch = CHALLENGES.find((c) => c.id === g.challenge!.id);
      if (ch?.check(g)) challengeResults.set(g.active, 'won');
      else if (g.season >= g.challenge.deadlineSeason) challengeResults.set(g.active, 'lost');
    }
    // Manager Score beregnes før bestyrelsens dom (en fyring ved sæsonslut trækker fra)
    const score = computeSeasonScore(false);
    const verdict = boardSeasonEnd();
    recordSeasonScore(score, verdict === 'sacked');
  });
  seasonCareers((cid) => strengthRank(g.clubs[cid]).rank);
  updateClubReps();
  const prevTables: Record<string, number[]> = {};
  for (const comp of Object.values(g.comps)) if (comp.type === 'league' && comp.finished) prevTables[comp.id] = finalOrder(comp);
  // pokalvindere (pr. nation) får en europæisk plads
  const cupWinners: Record<number, number> = {};
  for (const comp of Object.values(g.comps)) if (comp.type === 'cup' && comp.winner && comp.nation >= 0) cupWinners[comp.nation] = comp.winner;
  // rekordbogen: før op/nedrykning (placeringen i den liga, klubben spillede i) og før statistikken nulstilles
  recordsSeasonEnd((c) => (prevTables[c.league] ?? []).indexOf(c.id) + 1);
  const tierBefore = new Map(Object.values(g.clubs).map((c) => [c.id, g.leagues[c.league]?.tier ?? 9]));
  promotionRelegation();
  seasonWageClauses(tierBefore);
  achievementsSeasonEnd(tierBefore);
  storySeasonEnd(tierBefore);
  // ligaer kan have skiftet klubber → opdater prevTables så europæiske pladser kun gives til tier-1
  for (const [lg, order] of Object.entries(prevTables)) prevTables[lg] = order.filter((cid) => g.clubs[cid].league === lg);
  archiveStats();
  contractsAndLoans();
  retirements();
  prune();
  g.comps = {};
  g.season += 1;
  rebuildIndexes();
  // ingen klub må starte sæsonen med for få spillere
  aiFillSquads(20);
  for (const c of Object.values(g.clubs)) {
    const sq = squad(c.id);
    if (c.manager === -1) {
      // menneskestyret klub: reserveholdet sørger for at der er nok spillere til at stille hold
      if (sq.length < 16) {
        const before = sq.length;
        fillSquad(c, sq, clubLevel(c.id) - 15, g.date, hash(g.seed, g.season, c.id), 16);
        asOwner(c.id, () => addNews({ cat: 'youth', key: 'news.reservesPromoted', params: { n: squad(c.id).length - before } }));
      }
      continue;
    }
    if (sq.length < 18) fillSquad(c, sq, clubLevel(c.id) - 6, g.date, hash(g.seed, g.season, c.id), 20);
  }
  newSeasonBudgets();
  setupSeasonComps(g.season, prevTables, cupWinners);
  for (const c of Object.values(g.clubs)) if (c.manager !== -1) c.tactic = null;
  forEachHuman(() => {
    if (g.userClub) { setBoardExpectation(); addNews({ cat: 'finance', key: 'sponsor.offers', params: {} }); }
    startScoreSeason();
    initKnowledgeKeep();
    const result = challengeResults.get(g.active);
    if (result && g.challenge) {
      g.challenge.done = result;
      addNews({ cat: 'general', key: result === 'won' ? 'challenge.won' : 'challenge.lost', params: { id: g.challenge.id } });
    }
  });
  addNews({ cat: 'general', key: 'news.newSeason', params: { season: `${g.season}/${String(g.season + 1).slice(2)}` } }, { all: true });
}

function initKnowledgeKeep() {
  const g = gs();
  const old = g.knowledge;
  initKnowledge();
  for (const [k, v] of Object.entries(old)) g.knowledge[Number(k)] = Math.max(g.knowledge[Number(k)] ?? 0, v * 0.85);
}
