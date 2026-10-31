// Alle ændringer en manager kan lave, som serialiserbare handlinger.
// Singleplayer: anvendes direkte. Online: anvendes lokalt med det samme (optimistisk) og sendes
// til serveren, hvor den manager der simulerer næste træk, afspiller dem i rækkefølge.
import { replacePlayer } from './draft';
import { endTrial, inviteTrial } from './trials';
import { arrangeFriendly, cancelFriendly, type FriendlyKind } from './friendlies';
import { unlock } from './achievements';
import { applyStyle, briefing, type StyleKey } from './onboarding';
import { cancelCamp, planCamp, type CampDest } from './camp';
import { acceptJob, answerBudgetCounter, boardAsk, applyForJob, declineJob, negotiateJob, resignJob, requestBudget, requestProject, shiftBudget } from './board';
import { activate, emptySlot, withHuman } from './humans';
import { takeOverClub } from './newgame';
import { activateNation, playPendingAsAi, submitMatchResult } from './sim';
import { initKnowledge } from './scouting';
import { fireStaff, hireStaff, raiseStaff } from './staff';
import { interact, talkToPlayer, teamTalk, type TalkKind } from './personality';
import { chooseSponsor } from './finance';
import { applyPress } from './press';
import { answerComplaint } from './will';
import { answerBet, proposeBet, sendJab } from './rivalry';
import { removeHuman } from './humans';
import { addNews, gs, notify } from './state';
import {
  acceptCounter, bidNow, enquire, loanOut, makeBid, rebid, negotiate, raiseBid, releasePlayer, renewContract, respondToOffer, setListPrice, startPreContract, toggleListed,
} from './transfers';
import { addBot } from './bots';
import { markChatRead, sendChat } from './chat';
import type { RejectReason } from './will';
import type { BoardAsk, BotStyle, ContractClauses, MatchReport, ScoutAssignment, Tactic, TalkStage, TalkTone, TransferOffer } from './types';
import { giveTalk, matchExpectation } from './teamtalk';

export type Action =
  | { t: 'tactic'; tactic: Tactic }
  | { t: 'savedTactics'; list: Tactic[] }
  | { t: 'training'; pid: number; key: string }
  | { t: 'trainingAll'; key: string }
  | { t: 'listed'; pid: number; price?: number | null }
  | { t: 'notes'; pid: number; text: string }
  | { t: 'release'; pid: number }
  | { t: 'loanOut'; pid: number; club: number; share: number; fee: number }
  | { t: 'bid'; pid: number; fee: number; loan: boolean; sellOn?: number; addOn?: number; swap?: number[] }
  | { t: 'enquire'; pid: number }
  | { t: 'preContract'; pid: number }
  | { t: 'shortlist'; pid: number; on: boolean }
  | { t: 'scout'; staffId: number; assignment: ScoutAssignment | null }
  | { t: 'negotiate'; pid: number; wage: number; years: number; clauses?: ContractClauses }
  | { t: 'renew'; pid: number; wage: number; years: number; clauses?: ContractClauses }
  | { t: 'respond'; pid: number; buyer: number; action: 'accept' | 'reject' | 'counter'; counter?: number; sellOn?: number; reason?: RejectReason }
  | { t: 'acceptCounter'; pid: number }
  | { t: 'withdraw'; pid: number }
  | { t: 'hireStaff'; id: number; wage?: number }
  | { t: 'fireStaff'; id: number }
  | { t: 'budget'; kind: 'transfer' | 'wage'; pct?: number }
  | { t: 'budgetCounter'; accept: boolean }
  | { t: 'budgetShift'; toWage: boolean; amount: number }
  | { t: 'project'; kind: 'stadium' | 'training' | 'youth' }
  | { t: 'boardAsk'; kind: BoardAsk }
  | { t: 'camp'; dest: CampDest; start: string }
  | { t: 'campCancel' }
  | { t: 'setRules'; rules: 'modern' | 'classic' }
  | { t: 'patron' }
  | { t: 'draftReplace'; out: number; inn: number }
  | { t: 'trial'; pid: number; end?: boolean }
  | { t: 'friendly'; opp: number; date: string; kind: FriendlyKind }
  | { t: 'friendlyCancel'; date: string }
  | { t: 'onboard'; step: 'weak' | 'style' | 'needs' | 'brief' | 'skip'; style?: StyleKey; needs?: string[] }
  | { t: 'managerProfile'; name?: string; nation?: number; motto?: string }
  | { t: 'talk'; pid: number; choice: 'promise' | 'list' | 'refuse' }
  | { t: 'interact'; pid: number; kind: TalkKind }
  | { t: 'teamTalk'; kind: 'praise' | 'criticise' | 'demand' | 'calm' }
  | { t: 'matchTalk'; fixture: number; stage: TalkStage; tone: TalkTone; pids: number[]; diff: number; ratings: Record<number, number>; individual?: Record<number, TalkTone> }
  | { t: 'sponsor'; kind: 'safe' | 'bonus' | 'ambitious' }
  | { t: 'ticket'; price: number }
  | { t: 'read'; ids: number[] | 'all' }
  | { t: 'acceptJob'; club: number }
  | { t: 'applyJob'; club: number }
  | { t: 'negotiateJob'; club: number; ask: 'budget' | 'exp' }
  | { t: 'declineJob'; club: number }
  | { t: 'resign' }
  | { t: 'fixPending' }
  | { t: 'setWindows'; mode: 'real' | 'classic' }
  | { t: 'setH2hTime'; minutes: number }
  | { t: 'raiseBid'; offer: number; amount: number }
  | { t: 'bidNow'; offer: number }
  | { t: 'rebid'; offer: number; fee: number; sellOn?: number; addOn?: number }
  | { t: 'raiseStaff'; staff: number; wage: number }
  | { t: 'matchResult'; fixture: number; rep: MatchReport }
  | { t: 'join'; name: string; club: number; nation: number }
  | { t: 'addBot'; name: string; club: number; nation: number; style: BotStyle }
  | { t: 'chat'; to: string; text: string }
  | { t: 'jab'; to: string; line: number; text: string }
  | { t: 'bet'; to: string; amount: number }
  | { t: 'betAnswer'; id: number; accept: boolean }
  | { t: 'removeHuman'; pid: string }
  | { t: 'chatRead' }
  | { t: 'complaint'; pid: number; choice: 'promise' | 'fight' | 'list' | 'listen' }
  | { t: 'press'; answers: { topic: string; tone: string }[]; headline?: string; body?: string };

/** Ny klub i et land uden simulerede ligaer: start ligaen med det samme */
function startLeague() {
  const g = gs();
  const c = g.clubs[g.userClub];
  if (c && !g.comps[c.league] && g.leagues[c.league]) activateNation(c.nation);
}

const ACTIVE: TransferOffer['status'][] = ['pending', 'negotiating', 'countered'];

/** Find det aktive tilbud hvor den aktive manager er køber */
function myOffer(pid: number): TransferOffer | undefined {
  const g = gs();
  return g.offers.slice().reverse().find((o) => o.player === pid && o.buyer === g.userClub && ACTIVE.includes(o.status));
}

/** Anvend en handling for den aktive manager. Returnerer et resultat til UI'et. */
export function applyAction(a: Action): unknown {
  const g = gs();
  const club = g.clubs[g.userClub];
  switch (a.t) {
    case 'tactic': g.tactic = a.tactic; return 'ok';
    case 'savedTactics': g.savedTactics = a.list; return 'ok';
    case 'training': { const p = g.players[a.pid]; if (p?.club === g.userClub) p.training = a.key; return 'ok'; }
    case 'trainingAll': for (const p of Object.values(g.players)) if (p.club === g.userClub && g.userClub) p.training = a.key; return 'ok';
    case 'listed':
      if (g.players[a.pid]?.club !== g.userClub) return 'error';
      if (a.price === undefined) toggleListed(a.pid);
      else setListPrice(a.pid, a.price);
      return 'ok';
    case 'notes': { const p = g.players[a.pid]; if (p) p.notes = a.text; return 'ok'; }
    case 'release': releasePlayer(a.pid); return 'ok';
    case 'loanOut': return loanOut(a.pid, a.club, a.share, a.fee);
    case 'enquire': return enquire(a.pid);
    case 'bid': return makeBid(a.pid, a.fee, a.loan, { sellOn: a.sellOn, addOn: a.addOn, swap: a.swap });
    case 'preContract': return startPreContract(a.pid);
    case 'shortlist':
      g.shortlist = g.shortlist.filter((x) => x !== a.pid);
      if (a.on) g.shortlist.push(a.pid);
      return 'ok';
    case 'scout': { const s = g.staff[a.staffId]; if (s && s.club === g.userClub) s.assignment = a.assignment; return 'ok'; }
    case 'negotiate': { const o = myOffer(a.pid); return o ? negotiate(o.id, a.wage, a.years, a.clauses) : 'refused'; }
    case 'renew': return renewContract(a.pid, a.wage, a.years, a.clauses);
    case 'respond': {
      const o = g.offers.slice().reverse().find((x) => x.player === a.pid && x.buyer === a.buyer && x.seller === g.userClub && x.status === 'pending');
      const reply = o ? respondToOffer(o.id, a.action, a.counter, a.sellOn, a.reason) : null;
      return reply ?? 'ok';
    }
    case 'acceptCounter': { const o = myOffer(a.pid); return o ? acceptCounter(o.id) : 'error'; }
    case 'withdraw': { const o = myOffer(a.pid); if (o) o.status = 'withdrawn'; return 'ok'; }
    case 'hireStaff': return hireStaff(a.id, a.wage);
    case 'fireStaff': return fireStaff(a.id);
    case 'budget': return requestBudget(a.kind, a.pct);
    case 'budgetCounter': return answerBudgetCounter(a.accept);
    case 'budgetShift': return shiftBudget(a.toWage, a.amount);
    case 'project': return requestProject(a.kind);
    case 'boardAsk': return boardAsk(a.kind);
    case 'camp': return planCamp(a.dest, a.start);
    case 'campCancel': return cancelCamp() ? 'ok' : 'error';
    case 'setRules': g.options.rules = a.rules; return 'ok';
    case 'patron': unlock('patron'); return 'ok';
    case 'draftReplace': return replacePlayer(gs().userClub, a.out, a.inn);
    case 'trial': if (a.end) { endTrial(a.pid); return 'ok'; } return inviteTrial(a.pid);
    case 'friendly': return arrangeFriendly(a.opp, a.date, a.kind);
    case 'friendlyCancel': cancelFriendly(a.date); return 'ok';
    case 'onboard': {
      const ob = (g.manager.onboard ??= {});
      if (a.step === 'weak') ob.weak = true;
      else if (a.step === 'style' && a.style) applyStyle(a.style);
      else if (a.step === 'needs') ob.needs = (a.needs ?? []).slice(0, 4);
      else if (a.step === 'brief') return briefing();
      else if (a.step === 'skip') ob.briefed = true;
      return 'ok';
    }
    case 'managerProfile': {
      const name = a.name?.replace(/\s+/g, ' ').trim().slice(0, 30);
      if (name) {
        g.manager.name = name;
        const h = g.humans?.find((x) => x.pid === g.active);
        if (h) h.name = name;
      }
      if (a.nation !== undefined && g.nations[a.nation]) g.manager.nation = a.nation;
      if (a.motto !== undefined) g.manager.motto = a.motto.replace(/\s+/g, ' ').trim().slice(0, 140);
      return 'ok';
    }
    case 'talk': return talkToPlayer(a.pid, a.choice);
    case 'interact': return interact(a.pid, a.kind);
    case 'teamTalk': return teamTalk(a.kind);
    case 'matchTalk': { const ex = matchExpectation(a.fixture); return giveTalk({ stage: a.stage, fixture: a.fixture, e: ex.e, big: ex.big, diff: a.diff, ratings: a.ratings }, a.tone, a.pids, a.individual); }
    case 'sponsor': return chooseSponsor(a.kind);
    case 'ticket': if (club) club.ticketPrice = Math.max(1, Math.round(a.price * 100) / 100); return 'ok';
    case 'read':
      for (const n of g.news) if (a.ids === 'all' || a.ids.includes(n.id)) n.read = true;
      return 'ok';
    case 'acceptJob': if (g.jobOffers.includes(a.club) && g.clubs[a.club]?.manager === 0) { playPendingAsAi(); acceptJob(a.club); startLeague(); } return 'ok';
    case 'applyJob': return applyForJob(a.club);
    case 'negotiateJob': return negotiateJob(a.club, a.ask);
    case 'declineJob': declineJob(a.club); return 'ok';
    case 'resign': playPendingAsAi(); return resignJob();
    case 'fixPending': playPendingAsAi(); return 'ok';
    case 'raiseBid': return raiseBid(a.offer, a.amount);
    case 'bidNow': return bidNow(a.offer);
    case 'rebid': return rebid(a.offer, a.fee, a.sellOn !== undefined || a.addOn !== undefined ? { sellOn: a.sellOn, addOn: a.addOn } : undefined);
    case 'raiseStaff': return raiseStaff(a.staff, a.wage);
    case 'setWindows': gs().options.transferWindows = a.mode; return 'ok';
    case 'setH2hTime': gs().options.h2hHalfMinutes = Math.min(15, Math.max(1, Math.round(a.minutes))); return 'ok';
    case 'matchResult': submitMatchResult(a.fixture, a.rep); return 'ok';
    case 'join': return 'ok'; // håndteres af applyActionAs
    case 'addBot': return 'ok'; // håndteres af applyActionAs
    case 'chat': return sendChat(a.to, a.text);
    case 'jab': return gs().draft ? 'error' : sendJab(a.to, a.line, a.text);
    case 'bet': return gs().draft ? 'error' : proposeBet(a.to, a.amount);
    case 'betAnswer': return answerBet(a.id, a.accept);
    case 'chatRead': markChatRead(); return 'ok';
    case 'press': return applyPress(a.answers, a.headline, a.body);
    case 'complaint': return answerComplaint(a.pid, a.choice);
  }
}

/** Anvend en handling som en bestemt menneskelig manager (bruges når et træk afvikles) */
export function applyActionAs(pid: string, a: Action): unknown {
  const g = gs();
  if (a.t === 'join') {
    if (!g.humans || g.humans.some((h) => h.pid === pid)) return 'exists';
    const club = g.clubs[a.club];
    if (!club || club.manager === -1) return 'taken';
    g.humans.push(emptySlot(pid, a.name, a.nation));
    return withHuman(pid, () => {
      takeOverClub(club);
      initKnowledge();
      addNews({ cat: 'general', key: 'news.welcome', params: { manager: a.name, club: club.name } });
      addNews({ cat: 'general', key: 'mp.joined', params: { manager: a.name, club: club.name } }, { all: true });
      return 'ok';
    });
  }
  // fælles spilleregler: kun værten (første manager) må ændre dem
  if (a.t === 'setWindows') {
    if (g.humans && g.humans[0]?.pid !== pid) return 'host-only';
    g.options.transferWindows = a.mode;
    return 'ok';
  }
  if (a.t === 'setH2hTime') {
    if (g.humans && g.humans[0]?.pid !== pid) return 'host-only';
    g.options.h2hHalfMinutes = Math.min(15, Math.max(1, Math.round(a.minutes)));
    return 'ok';
  }
  if (a.t === 'removeHuman') {
    // kun værten (første menneskelige slot) – serveren tjekker det også
    if (g.humans?.[0]?.pid !== pid || a.pid === pid) return 'unknown';
    return removeHuman(a.pid);
  }
  if (a.t === 'addBot') {
    // kun en menneskelig manager kan invitere en AI-manager ind
    if (!g.humans?.some((h) => h.pid === pid && !h.bot)) return 'unknown';
    return addBot(a.name, a.club, a.nation, a.style);
  }
  if (!g.humans?.some((h) => h.pid === pid)) return 'unknown';
  return withHuman(pid, () => applyAction(a));
}

// ---------- dispatch fra UI ----------

type Sink = (a: Action) => void;
let sink: Sink | null = null;

/** Online-laget registrerer her, hvor handlinger skal sendes hen */
export function setActionSink(s: Sink | null) {
  sink = s;
}

/** Brug denne fra UI'et i stedet for at ændre spiltilstanden direkte */
export function act<T = unknown>(a: Action): T {
  const g = gs();
  if (g.humans && g.active) activate(g.active, g);
  const r = (a.t === 'addBot' && g.active ? applyActionAs(g.active, a) : applyAction(a)) as T;
  sink?.(a);
  notify();
  return r;
}
