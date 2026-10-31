// AI-managere der spiller som mennesker i multiplayer.
//
// En bot har sin egen menneskelige slot (indbakke, bestyrelse, taktik …) og påvirker kun spillet
// gennem de samme handlinger (Action) som en menneskelig manager: bud, svar på bud, kontrakter,
// taktik, pressemøder, svar til spillere og jobansøgninger. Botterne handler under simuleringen,
// så i online-spil afvikles de deterministisk af den klient der simulerer trækket.
import { applyActionAs, type Action } from './actions';
import { counterPlan } from './aitactics';
import { isReserveTeam } from './competitions';
import { A, naturalRole } from './attributes';
import { ageOn, month, weekday } from './dates';
import { squadStrength } from './board';
import { tonesFor } from './press';
import { hash01, rng } from './rng';
import { fixturesOn, gs, squad } from './state';
import { autoSelect, newTactic } from './tactics';
import { analyzeNeeds, askingPrice, findTarget, keyPlayerRank, playerInterest, preferredYears, wageDemand, windowOpen } from './transfers';
import { clubLevel } from './scouting';
import { isHumanClub, withHuman } from './humans';
import { botAnnounceBid, botHello } from './chat';
import type { BotStyle, Club, HumanSlot, Player, TransferOffer } from './types';

/** Opfundne managernavne */
export const BOT_NAMES = [
  'Viktor Halberg', 'Marta Lindqvist', 'Paolo Ferrante', 'Jonas Kjærby', 'Ingrid Solberg', 'Rafael Moreno', 'Hugo Delacroix', 'Mikkel Brandstrup',
  'Elif Kaya', 'Sean Gallagher', 'Tobias Reinholt', 'Lucía Navarro', 'Karl Ekdahl', 'Nina Østergaard', 'Andrés Villalba', 'Frederik Lund',
];
export const BOT_STYLES: BotStyle[] = ['ambitious', 'developer', 'trader', 'pragmatic'];

const STYLE: Record<BotStyle, { formation: string; mentality: number; buyRate: number; sellAt: number; youth: boolean; jobHop: number }> = {
  ambitious: { formation: '4-3-3', mentality: 3, buyRate: 0.8, sellAt: 1.15, youth: false, jobHop: 6 },
  developer: { formation: '4-2-3-1', mentality: 2, buyRate: 0.45, sellAt: 1.05, youth: true, jobHop: 15 },
  trader: { formation: '4-4-2', mentality: 2, buyRate: 0.6, sellAt: 0.95, youth: true, jobHop: 10 },
  pragmatic: { formation: '4-4-2', mentality: 1, buyRate: 0.4, sellAt: 1, youth: false, jobHop: 12 },
};

/** Job i en liga der spilles, og ikke et reservehold */
const okClub = (c: Club) => !!gs().comps[c.league] && !isReserveTeam(c.id);

export const isBot = (pid: string) => !!gs().humans?.find((h) => h.pid === pid)?.bot;

/** Er klubben styret af en bot? */
export function isBotClub(clubId: number): boolean {
  const g = gs();
  if (!g.humans || !clubId) return false;
  const active = g.humans.find((h) => h.pid === g.active);
  if (active && g.userClub === clubId) return !!active.bot;
  return !!g.humans.find((h) => h.pid !== g.active && h.userClub === clubId)?.bot;
}

/** Tilføj en AI-manager (samme vej ind som en menneskelig spiller) */
export function addBot(name: string, club: number, nation: number, style: BotStyle): string {
  const g = gs();
  const pid = `bot-${(g.humans?.length ?? 0) + 1}-${club}`;
  const r = applyActionAs(pid, { t: 'join', name, club, nation });
  if (r !== 'ok') return String(r);
  const slot = g.humans!.find((h) => h.pid === pid)!;
  slot.bot = { style };
  botHello(pid);
  return 'ok';
}

/** Hver dag (før kampene): alle botter tager deres beslutninger */
export function botsDaily() {
  const g = gs();
  if (!g.humans) return;
  for (const h of g.humans) {
    // menneske på autopilot (fristen udløb): assistenten tager sig af det mest nødvendige
    if (h.autopilot && !h.bot && h.autopilotDay !== g.date) {
      h.autopilotDay = g.date;
      withHuman(h.pid, () => { answerPress(h.pid); answerComplaints(h.pid, true); });
      continue;
    }
    if (!h.bot || h.bot.lastDay === g.date) continue;
    h.bot.lastDay = g.date;
    const pid = h.pid;
    withHuman(pid, () => botDay(pid, h));
  }
}

function botDay(pid: string, h: HumanSlot) {
  const g = gs();
  const style = STYLE[h.bot!.style];
  const act = (a: Action) => applyActionAs(pid, a);
  // fyret: søg job
  if (!g.userClub) {
    const offer = g.jobOffers.find((id) => g.clubs[id] && okClub(g.clubs[id]));
    if (offer) act({ t: 'acceptJob', club: offer });
    else if (weekday(g.date) === 2) {
      const open = g.vacancies.map((id) => g.clubs[id]).filter((c): c is Club => !!c && c.manager === 0 && okClub(c) && c.rep <= g.manager.rep + 25).sort((a, b) => b.rep - a.rep);
      if (open.length) act({ t: 'applyJob', club: open[Math.min(open.length - 1, rng.int(0, 2))].id });
    }
    return;
  }
  const club = g.clubs[g.userClub];
  // bedre jobtilbud
  // kun job i ligaer der spilles (aktive nationer)
  // skifter typisk kun i sommerpausen, eller når jobbet er i fare
  const hopTime = month(g.date) >= 5 && month(g.date) <= 7 || g.board.confidence < 35;
  const better = hopTime ? g.jobOffers.map((id) => g.clubs[id]).find((c) => c && c.manager === 0 && okClub(c) && c.rep >= club.rep + style.jobHop) : undefined;
  if (better) { act({ t: 'acceptJob', club: better.id }); return; }

  answerPress(pid);
  answerComplaints(pid);
  handleIncomingBids(pid);
  handleOwnOffers(pid);
  matchDayTactic(pid, h.bot!.style);
  if (weekday(g.date) === 1 || weekday(g.date) === 4) weeklyTransfers(pid, h.bot!.style);
  if (weekday(g.date) === 1) act({ t: 'read', ids: 'all' });
  if (g.date.endsWith('-01') || g.date.endsWith('-15')) monthlySquad(pid, h.bot!.style);
}

// ---------- taktik ----------

function matchDayTactic(pid: string, style: BotStyle) {
  const g = gs();
  const fid = fixturesOn(g.date).find((id) => { const f = g.fixtures[id]; return f && !f.result && (f.home === g.userClub || f.away === g.userClub); });
  if (fid === undefined) return;
  const f = g.fixtures[fid];
  const home = f.home === g.userClub;
  const opp = home ? f.away : f.home;
  const st = STYLE[style];
  const diff = squadStrength(g.userClub) - squadStrength(opp) + (home ? 3 : -3);
  let mentality = st.mentality;
  if (diff > 12) mentality = Math.min(4, mentality + 1);
  else if (diff < -12) mentality = Math.max(0, mentality - 1);
  const plan = counterPlan(g.userClub, opp, diff, st.formation, mentality);
  const base = newTactic(plan.formation ?? st.formation, mentality);
  if (mentality <= 1) base.team.counter = true;
  base.team = { ...base.team, ...plan.team };
  applyActionAs(pid, { t: 'tactic', tactic: autoSelect(base, squad(g.userClub)) });
}

// ---------- pressemøder og spillere ----------

function answerPress(pid: string) {
  const g = gs();
  const pc = g.press;
  if (!pc) return;
  const answers = pc.topics.map((topic) => {
    const tones = tonesFor(topic.kind).filter((t) => t !== 'promise');
    const tone: string = tones[Math.floor(hash01(g.seed, topic.id.length, pc.fixture, pid.length) * tones.length)] ?? tones[0];
    return { topic: topic.id, tone };
  });
  applyActionAs(pid, { t: 'press', answers });
}

function answerComplaints(pid: string, cautious = false) {
  const g = gs();
  for (const p of squad(g.userClub)) {
    if (!p.complaint) continue;
    const rank = keyPlayerRank(p);
    // assistenten lover ikke noget på managerens vegne – den lytter bare
    const choice = cautious || p.complaint.kind !== 'time' ? 'listen' : rank <= 13 ? 'promise' : p.attrs[A.determination] >= 14 ? 'fight' : 'list';
    applyActionAs(pid, { t: 'complaint', pid: p.id, choice });
  }
}

// ---------- transfers ----------

const live = (o: TransferOffer) => ['pending', 'negotiating', 'countered'].includes(o.status);

/** Hvad en AI-manager vil have for en af sine spillere */
export function botWant(p: Player, style: BotStyle): number {
  const rank = keyPlayerRank(p);
  return Math.round(askingPrice(p) * STYLE[style].sellAt * (rank <= 3 ? 1.5 : rank <= 11 ? 1.15 : 0.9) * (p.wantsAway || p.listed ? 0.85 : 1) / 50_000) * 50_000;
}

/** Svar på bud på egne spillere – samme muligheder som en menneskelig manager */
function handleIncomingBids(pid: string) {
  const g = gs();
  const h = g.humans!.find((x) => x.pid === pid)!;
  for (const o of g.offers.filter((x) => x.seller === g.userClub && x.status === 'pending')) {
    const p = g.players[o.player];
    if (!p) continue;
    const rank = keyPlayerRank(p);
    const want = botWant(p, h.bot!.style);
    if (o.loan) { applyActionAs(pid, { t: 'respond', pid: p.id, buyer: o.buyer, action: rank > 16 ? 'accept' : 'reject' }); continue; }
    if (o.fee >= want) applyActionAs(pid, { t: 'respond', pid: p.id, buyer: o.buyer, action: 'accept' });
    else if (o.fee >= want * 0.7 && (o.priceRounds ?? 0) < 2) applyActionAs(pid, { t: 'respond', pid: p.id, buyer: o.buyer, action: 'counter', counter: Math.round(want / 50_000) * 50_000 });
    else applyActionAs(pid, { t: 'respond', pid: p.id, buyer: o.buyer, action: 'reject' });
  }
}

/** Egne bud: forhandl kontrakt, tag stilling til modbud */
function handleOwnOffers(pid: string) {
  const g = gs();
  const club = g.clubs[g.userClub];
  for (const o of g.offers.filter((x) => x.buyer === g.userClub && live(x))) {
    const p = g.players[o.player];
    if (!p) continue;
    if (o.status === 'negotiating') {
      const wage = o.demand?.wage ?? wageDemand(p, club);
      const years = o.demand?.years ?? preferredYears(p);
      const r = applyActionAs(pid, { t: 'negotiate', pid: p.id, wage, years });
      if (r === 'budget') applyActionAs(pid, { t: 'withdraw', pid: p.id });
    } else if (o.status === 'countered' && o.counter) {
      if (o.counter <= club.transferBudget && o.counter <= o.fee * 1.5) {
        if (applyActionAs(pid, { t: 'acceptCounter', pid: p.id }) !== 'ok') applyActionAs(pid, { t: 'withdraw', pid: p.id });
      } else applyActionAs(pid, { t: 'withdraw', pid: p.id });
    }
  }
}

function weeklyTransfers(pid: string, style: BotStyle) {
  const g = gs();
  if (!windowOpen()) return;
  const club = g.clubs[g.userClub];
  const st = STYLE[style];
  if (g.offers.filter((o) => o.buyer === club.id && live(o)).length >= 2) return;
  const sq = squad(club.id);
  if (sq.length >= 30 || !rng.chance(st.buyRate)) return;
  const needs = analyzeNeeds(club.id);
  const role = needs[0]?.role ?? rng.pick(['CB', 'CM', 'ST', 'W', 'FB'] as const);
  // af og til kigger de efter spillere hos de andre managere (sat til salg eller på bænken)
  const target = (rng.chance(0.35) ? rivalTarget(club, role) : null) ?? findTarget(club, role);
  if (target && g.offers.some((o) => o.player === target.id && o.buyer === club.id && live(o))) return;
  if (!target || (st.youth && ageOn(target.dob, g.date) > 28)) return;
  if (!target.club) { applyActionAs(pid, { t: 'bid', pid: target.id, fee: 0, loan: false }); return; }
  const ask = askingPrice(target);
  const rel = target.contract?.release;
  let fee = Math.round(ask * rng.range(0.85, 1.02) / 50_000) * 50_000;
  if (rel && rel <= club.transferBudget && rel <= ask * 1.3) fee = rel;
  if (fee > club.transferBudget) return;
  // handlende managere bruger videresalgsprocent for at presse prisen
  const sellOn = style === 'trader' && ageOn(target.dob, g.date) <= 23 ? 15 : undefined;
  const r = applyActionAs(pid, { t: 'bid', pid: target.id, fee, loan: false, sellOn });
  // byder de på en anden managers spiller, skriver de også en besked
  if (typeof r !== 'string' && isHumanClub(target.club)) botAnnounceBid(pid, target, fee);
}

/** En spiller hos en anden manager der passer ind: sat til salg eller uden fast plads, og til at betale */
function rivalTarget(club: Club, role: string): Player | null {
  const g = gs();
  const level = clubLevel(club.id);
  const rivals = new Set((g.humans ?? []).map((h) => (h.pid === g.active ? g.userClub : h.userClub)).filter((id) => id && id !== club.id));
  const cands = Object.values(g.players).filter((p) => {
    if (!rivals.has(p.club) || p.loan || p.contract?.futureClub) return false;
    if (naturalRole(p) !== role && !p.listed) return false;
    if (p.ca < level - 6 || ageOn(p.dob, g.date) > 30) return false;
    if (!p.listed && keyPlayerRank(p) <= 11) return false;
    return askingPrice(p) <= club.transferBudget && playerInterest(p, club) === 'yes';
  });
  if (!cands.length) return null;
  cands.sort((a, b) => b.ca - a.ca);
  return cands[0];
}

/** To gange om måneden: kontraktforlængelser og salgsliste */
function monthlySquad(pid: string, style: BotStyle) {
  const g = gs();
  const club = g.clubs[g.userClub];
  const sq = squad(club.id);
  const m = month(g.date);
  const seasonEnd = `${Number(g.date.slice(0, 4)) + (m >= 7 ? 1 : 0)}-06-30`;
  for (const p of sq) {
    if (p.loan || !p.contract || p.contract.futureClub) continue;
    const rank = keyPlayerRank(p);
    const age = ageOn(p.dob, g.date);
    const valuable = rank <= 14 || (STYLE[style].youth && age <= 21 && p.pa - p.ca >= 20);
    if (p.contract.expires <= seasonEnd && valuable && age <= 32) {
      applyActionAs(pid, { t: 'renew', pid: p.id, wage: wageDemand(p, club), years: preferredYears(p) });
    }
    // utilfredse og overflødige spillere sættes til salg
    const surplus = sq.length > 26 && rank > 22;
    if ((p.wantsAway || surplus) && !p.listed) applyActionAs(pid, { t: 'listed', pid: p.id });
  }
}

export type BotScope = 'league' | 'nation' | 'world';

/** Find en ledig klub til en ny AI-manager: på niveau med værtens klub, i samme liga/land eller hele verden */
export function pickBotClub(scope: BotScope, salt: number): Club | null {
  const g = gs();
  const me = g.clubs[g.userClub];
  const taken = new Set((g.humans ?? []).map((h) => h.userClub));
  if (g.userClub) taken.add(g.userClub);
  const active = new Set(g.activeNations);
  const cands = Object.values(g.clubs).filter((c) => {
    if (taken.has(c.id) || c.manager === -1 || !active.has(c.nation) || !g.comps[c.league] || isReserveTeam(c.id)) return false;
    if ((g.leagues[c.league]?.tier ?? 9) > 2) return false;
    if (!me) return true;
    return scope === 'league' ? c.league === me.league : scope === 'nation' ? c.nation === me.nation : true;
  });
  if (!cands.length) return null;
  const rep = me?.rep ?? 60;
  cands.sort((a, b) => Math.abs(a.rep - rep) + hash01(g.seed, a.id, salt) * 12 - (Math.abs(b.rep - rep) + hash01(g.seed, b.id, salt) * 12));
  return cands[0];
}

/** Næste ledige botnavn og stil */
export function nextBot(): { name: string; style: BotStyle } {
  const g = gs();
  const used = new Set((g.humans ?? []).map((h) => h.name));
  const n = (g.humans ?? []).filter((h) => h.bot).length;
  const offset = Math.floor(hash01(g.seed, 99) * BOT_NAMES.length);
  const name = BOT_NAMES.map((_, i) => BOT_NAMES[(offset + i) % BOT_NAMES.length]).find((x) => !used.has(x)) ?? `AI ${n + 1}`;
  return { name, style: BOT_STYLES[(n + offset) % BOT_STYLES.length] };
}

/** Opret flere AI-managere ved spilstart */
export function setupBots(count: number, scope: BotScope) {
  const g = gs();
  for (let i = 0; i < count; i++) {
    const c = pickBotClub(scope, i + 1) ?? pickBotClub('world', i + 1);
    if (!c) break;
    const b = nextBot();
    addBot(b.name, c.id, c.nation, b.style);
  }
  void g;
}
