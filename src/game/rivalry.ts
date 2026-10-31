// Rivalisering mellem managere i samme spil: stikpiller i pressen og prestige-væddemål om næste
// indbyrdes kamp. Alt går gennem spiltilstanden som handlinger, så det virker både lokalt og online.
import { withHuman } from './humans';
import { bumpFans } from './fans';
import { hash01 } from './rng';
import { addDays, daysBetween } from './dates';
import { addNews, gs } from './state';
import { botSay, clubOf, managerName } from './chat';
import { squadStrength } from './board';
import type { Fixture, HumanSlot } from './types';

export const JAB_LINES = 6;

function slot(pid: string): HumanSlot | undefined {
  return gs().humans?.find((h) => h.pid === pid);
}

/** Næste kamp mellem to klubber (inden for to måneder) */
export function nextMeeting(a: number, b: number): Fixture | undefined {
  const g = gs();
  const limit = addDays(g.date, 60);
  return Object.values(g.fixtures)
    .filter((f) => !f.result && f.date >= g.date && f.date <= limit && ((f.home === a && f.away === b) || (f.home === b && f.away === a)))
    .sort((x, y) => x.date.localeCompare(y.date))[0];
}

/** Nyhed til en bestemt manager (menneske), uanset hvem der er aktiv */
function tell(pid: string, n: Parameters<typeof addNews>[0]) {
  const s = slot(pid);
  if (!s || s.bot) return;
  withHuman(pid, () => addNews(n));
}

// ---------- stikpiller i pressen ----------

/** Den aktive manager langer ud efter en anden manager i pressen */
export function sendJab(to: string, line: number, lineText: string): string {
  const g = gs();
  const me = g.active;
  const target = slot(to);
  if (!me || !target || to === me || line < 0 || line >= JAB_LINES) return 'error';
  const myClub = g.userClub, theirClub = clubOf(to);
  if (!myClub || !theirClub) return 'error';
  const last = (g.jabs ?? []).filter((j) => j.from === me && j.to === to).at(-1);
  if (last && daysBetween(last.date, g.date) < 14) return 'jab.tooSoon';
  const f = nextMeeting(myClub, theirClub);
  // modstanderen bliver tændt til næste indbyrdes kamp
  const opp = g.clubs[theirClub];
  opp.motivatedUntil = f?.date ?? addDays(g.date, 14);
  g.manager.media = Math.min(100, (g.manager.media ?? 50) + 2);
  (g.jabs ??= []).push({ id: (g.jabs.at(-1)?.id ?? 0) + 1, from: me, to, date: g.date, line, text: lineText.slice(0, 200), fixture: f?.id });
  if (g.jabs.length > 100) g.jabs.splice(0, g.jabs.length - 100);
  const params = { from: managerName(me), to: managerName(to), fromClub: g.clubs[myClub].name, toClub: opp.name, line: lineText };
  addNews({ cat: 'general', key: 'jab.sent', params });
  tell(to, { cat: 'general', key: 'jab.received', params, link: { kind: 'chat', id: me } });
  // de øvrige menneskelige managere læser det også i avisen
  for (const h of g.humans ?? []) if (!h.bot && h.pid !== me && h.pid !== to) tell(h.pid, { cat: 'general', key: 'jab.news', params });
  // AI-managere svarer igen – i chatten og nogle gange i pressen
  if (target.bot) {
    botSay(to, me, 'chat.bot.jabReply', { club: g.clubs[myClub].short });
    if (hash01(g.seed, g.jabs.length, 77) < 0.5) addNews({ cat: 'general', key: `jab.botBack.${1 + Math.floor(hash01(g.seed, g.jabs.length, 78) * 3)}`, params });
  }
  return f ? 'jab.ok' : 'jab.okNoMatch';
}

// ---------- prestige-væddemål ----------

export function proposeBet(to: string, amount: number): string {
  const g = gs();
  const me = g.active;
  const target = slot(to);
  if (!me || !target || to === me) return 'error';
  const myClub = g.userClub, theirClub = clubOf(to);
  if (!myClub || !theirClub) return 'error';
  const f = nextMeeting(myClub, theirClub);
  if (!f) return 'bet.noMatch';
  amount = Math.round(amount / 50_000) * 50_000;
  if (amount <= 0 || amount > g.clubs[myClub].balance) return 'bet.noMoney';
  if ((g.bets ?? []).some((b) => b.fixture === f.id && ['proposed', 'accepted'].includes(b.status) && (b.from === me || b.to === me) && (b.from === to || b.to === to))) return 'bet.exists';
  const bet: NonNullable<typeof g.bets>[number] = { id: (g.bets?.at(-1)?.id ?? 0) + 1, from: me, to, fixture: f.id, amount, status: 'proposed', date: g.date };
  (g.bets ??= []).push(bet);
  if (g.bets.length > 100) g.bets.splice(0, g.bets.length - 100);
  const params = { from: managerName(me), to: managerName(to), fee: amount, opp: g.clubs[theirClub].name, date: f.date };
  if (target.bot) {
    // AI-manageren tager imod, hvis den tror på sit hold (og har råd)
    const conf = squadStrength(theirClub) - squadStrength(myClub) + (f.home === theirClub ? 3 : -3) + (hash01(g.seed, bet.id, 91) - 0.5) * 10;
    const ok = conf > -2 && g.clubs[theirClub].balance >= amount;
    bet.status = ok ? 'accepted' : 'declined';
    botSay(to, me, ok ? 'chat.bot.betYes' : 'chat.bot.betNo', { fee: amount });
    addNews({ cat: 'finance', key: ok ? 'bet.acceptedByThem' : 'bet.declinedByThem', params: { ...params, name: managerName(to) } });
    return ok ? 'bet.accepted' : 'bet.declined';
  }
  tell(to, { cat: 'finance', key: 'bet.proposed', params, link: { kind: 'chat', id: me } });
  return 'bet.sent';
}

export function answerBet(id: number, accept: boolean): string {
  const g = gs();
  const bet = g.bets?.find((b) => b.id === id);
  if (!bet || bet.to !== g.active || bet.status !== 'proposed') return 'error';
  const f = g.fixtures[bet.fixture];
  if (!f || f.result) { bet.status = 'void'; return 'error'; }
  if (accept && g.clubs[g.userClub].balance < bet.amount) return 'bet.noMoney';
  bet.status = accept ? 'accepted' : 'declined';
  const params = { name: managerName(bet.to), fee: bet.amount };
  tell(bet.from, { cat: 'finance', key: accept ? 'bet.acceptedByThem' : 'bet.declinedByThem', params, link: { kind: 'chat', id: bet.to } });
  return accept ? 'bet.accepted' : 'bet.declined';
}

// ---------- efter en indbyrdes kamp ----------

export function rivalryAfterMatch(f: Fixture) {
  const g = gs();
  if (!g.humans || !f.result) return;
  const goals = (club: number) => (club === f.home ? f.result!.hg - f.result!.ag : f.result!.ag - f.result!.hg);
  // stikpiller: fik han ret?
  for (const j of g.jabs ?? []) {
    if (j.fixture !== f.id || j.resolved) continue;
    j.resolved = true;
    const club = clubOf(j.from);
    if (club !== f.home && club !== f.away) continue;
    const d = goals(club);
    const key = d > 0 ? 'jab.right' : d < 0 ? 'jab.backfired' : 'jab.draw';
    const params = { from: managerName(j.from), to: managerName(j.to), line: j.text };
    if (d !== 0) bumpFans(club, d > 0 ? 4 : -4, d > 0 ? 'jabRight' : 'jabBackfired');
    withHuman(j.from, () => { g.manager.media = Math.max(0, Math.min(100, (g.manager.media ?? 50) + (d > 0 ? 3 : d < 0 ? -4 : 0))); });
    for (const h of g.humans) if (!h.bot) tell(h.pid, { cat: 'general', key, params });
  }
  // væddemål: pengene skifter ejer
  for (const b of g.bets ?? []) {
    if (b.fixture !== f.id) continue;
    if (b.status === 'proposed') { b.status = 'void'; continue; }
    if (b.status !== 'accepted') continue;
    b.status = 'settled';
    const a = clubOf(b.from), c = clubOf(b.to);
    const d = goals(a);
    if (d === 0) { for (const pid of [b.from, b.to]) tell(pid, { cat: 'finance', key: 'bet.void', params: { fee: b.amount } }); continue; }
    const [win, lose] = d > 0 ? [b.from, b.to] : [b.to, b.from];
    const wc = g.clubs[d > 0 ? a : c], lc = g.clubs[d > 0 ? c : a];
    if (!wc || !lc) continue;
    wc.balance += b.amount; wc.finance.other -= b.amount;
    lc.balance -= b.amount; lc.finance.other += b.amount;
    tell(win, { cat: 'finance', key: 'bet.won', params: { name: managerName(lose), fee: b.amount } });
    tell(lose, { cat: 'finance', key: 'bet.lost', params: { name: managerName(win), fee: b.amount } });
  }
}
