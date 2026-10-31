// Beskeder mellem managere i samme spil.
//
// Beskeder til og fra AI-managere går gennem spiltilstanden (g.chat) og er deterministiske, så de
// fungerer både lokalt og online (online afspilles de som handlinger). AI-managere svarer med det
// samme og handler på det, man skriver: spørger man til en af deres spillere, nævner de en pris;
// tilbyder man en spiller, kan de lægge et bud. Beskeder mellem mennesker online går via serveren.
import { applyActionAs } from './actions';
import { naturalRole } from './attributes';
import { botWant } from './bots';
import { withHuman } from './humans';
import { hash01 } from './rng';
import { clubLevel } from './scouting';
import { addNews, gs, squad } from './state';
import { analyzeNeeds, askingPrice, keyPlayerRank, playerInterest, windowOpen } from './transfers';
import type { ChatMsg, Fixture, HumanSlot, Player } from './types';

const MAX = 400;
const pname = (p: Player) => `${p.first} ${p.last}`.trim();

function slot(pid: string): HumanSlot | undefined {
  return gs().humans?.find((h) => h.pid === pid);
}

/** Klubben en manager styrer lige nu (den aktive managers felter ligger i GameState) */
export function clubOf(pid: string): number {
  const g = gs();
  return pid === g.active ? g.userClub : slot(pid)?.userClub ?? 0;
}

export function managerName(pid: string): string {
  const g = gs();
  return pid === g.active ? g.manager.name : slot(pid)?.name ?? '?';
}

function push(m: Omit<ChatMsg, 'id' | 'date'>): ChatMsg {
  const g = gs();
  g.chat ??= [];
  const msg: ChatMsg = { id: (g.chat.at(-1)?.id ?? 0) + 1, date: g.date, ...m };
  g.chat.push(msg);
  if (g.chat.length > MAX) g.chat.splice(0, g.chat.length - MAX);
  return msg;
}

/** En AI-manager skriver til en menneskelig manager (vises også i indbakken) */
export function botSay(from: string, to: string, key: string, params: Record<string, string | number> = {}) {
  const g = gs();
  const target = slot(to);
  if (!target || target.bot) return;
  const msg = push({ from, to, key, params: { ...params, v: 1 + Math.floor(hash01(g.seed, (g.chat?.length ?? 0) + 1, from.length) * 3) } });
  withHuman(to, () => addNews({ cat: 'general', key: 'chat.news', params: { name: managerName(from) }, link: { kind: 'chat', id: from } }));
  return msg;
}

/** Ulæste beskeder til den aktive manager i spiltilstanden */
export function unreadChat(): number {
  const g = gs();
  const me = g.active;
  if (!me || !g.chat) return 0;
  return g.chat.filter((m) => m.to === me && m.from !== me && m.id > (g.chatRead ?? 0)).length;
}

// ---------- handlingen: send en besked ----------

/** Den aktive manager sender en besked til en anden manager i spillet (AI-managere svarer med det samme) */
export function sendChat(to: string, text: string): string {
  const g = gs();
  const me = g.active;
  const target = slot(to);
  const clean = text.trim().slice(0, 500);
  if (!me || !target || to === me || !clean) return 'error';
  push({ from: me, to, text: clean });
  if (target.bot) {
    const reply = botReply(to, me, clean);
    push({ from: to, to: me, ...reply });
  }
  return 'ok';
}

export function markChatRead() {
  const g = gs();
  g.chatRead = g.chat?.at(-1)?.id ?? 0;
}

// ---------- AI-managerens svar ----------

const has = (s: string, re: RegExp) => re.test(s);
const RE = {
  price: /(sælg|sælge|købe|køb|pris|koster|hvad skal du have|hvad vil du have|sell|buy|price|cost|how much|fee)/,
  offer: /(interesse|interesseret|vil du have|tilbyd|kunne du bruge|mangler du|interested|want|offer|could you use|need)/,
  loan: /(leje|lån|udlån|loan)/,
  hello: /(^|\b)(hej|hejsa|goddag|hallo|hi|hello|hey|yo)(\b|$)/,
  congrats: /(tillykke|flot|godt gået|imponerende|congrat|well done|great job|impressive)/,
  thanks: /(tak|thanks|thank you|cheers)/,
  luck: /(held og lykke|good luck|lykke til)/,
  banter: /(slå|knuse|smadre|tabe|taber|svag|ydmyge|beat|smash|crush|lose|loser|weak|easy)/,
  insult: /(svin|grim|idiot|klovn|fjols|nar|kedelig|lort|amatør|noob|tosse|ugly|clown|stupid|fool|boring|rubbish|trash|amateur)/,
};

/**
 * Find en spiller i en trup, som beskeden nævner. Fulde navne genkendes altid; et efternavn alene
 * kun når beskeden handler om at købe, sælge, leje eller tilbyde (ellers bliver "held og lykke" til spilleren Lykke).
 */
function mentioned(clubId: number, text: string): Player | undefined {
  const lc = text.toLowerCase();
  const word = (w: string) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(lc);
  const ps = squad(clubId).filter((p) => p.last.length >= 3);
  const full = ps.filter((p) => word(pname(p).toLowerCase())).sort((a, b) => b.ca - a.ca)[0];
  if (full) return full;
  if (!(RE.price.test(lc) || RE.offer.test(lc) || RE.loan.test(lc))) return undefined;
  return ps.filter((p) => word(p.last.toLowerCase())).sort((a, b) => b.ca - a.ca)[0];
}

function botReply(bot: string, human: string, text: string): Pick<ChatMsg, 'key' | 'params'> {
  const g = gs();
  const s = slot(bot)!;
  const lc = text.toLowerCase();
  const v = 1 + Math.floor(hash01(g.seed, (g.chat?.length ?? 0), text.length) * 3);
  const say = (key: string, params: Record<string, string | number> = {}) => ({ key, params: { ...params, v } });
  const botClub = clubOf(bot);
  const humanClub = clubOf(human);
  if (!botClub) return say('chat.r.unemployed');
  const theirs = mentioned(botClub, text);
  const mine = humanClub ? mentioned(humanClub, text) : undefined;

  // spørgsmål om en af AI-managerens spillere
  if (theirs && (!mine || has(lc, RE.price) || has(lc, RE.loan))) {
    const rank = keyPlayerRank(theirs);
    if (has(lc, RE.loan)) return say(rank > 16 ? 'chat.r.loanOk' : 'chat.r.loanNo', { player: pname(theirs) });
    if (rank <= 2 && !theirs.listed && !theirs.wantsAway) return say('chat.r.notForSale', { player: pname(theirs) });
    return say(theirs.listed || theirs.wantsAway ? 'chat.r.priceListed' : 'chat.r.price', { player: pname(theirs), fee: withHuman(bot, () => botWant(theirs, s.bot!.style)) });
  }
  // tilbud om en af ens egne spillere
  if (mine) {
    return withHuman(bot, () => {
      const club = g.clubs[botClub];
      const fits = analyzeNeeds(botClub).slice(0, 2).some((n) => n.role === naturalRole(mine)) || mine.ca >= clubLevel(botClub) + 3;
      const fee = Math.round(askingPrice(mine) * 0.9 / 50_000) * 50_000;
      // samme forsigtighed som et menneske: højst to åbne bud, og budgettet skal kunne dække dem alle
      const open = g.offers.filter((o) => o.buyer === botClub && ['pending', 'negotiating', 'countered'].includes(o.status));
      const committed = open.reduce((sum, o) => sum + (o.counter ?? o.fee), 0);
      if (!fits || mine.ca < clubLevel(botClub) - 10) return say('chat.r.notNeeded', { player: pname(mine) });
      if (playerInterest(mine, club) !== 'yes') return say('chat.r.wontCome', { player: pname(mine) });
      if (open.length >= 2) return say('chat.r.busy', { player: pname(mine) });
      if (committed + fee > club.transferBudget) return say('chat.r.tooExpensive', { player: pname(mine) });
      if (!windowOpen()) return say('chat.r.windowClosed', { player: pname(mine) });
      // de lægger et rigtigt bud – præcis som et menneske ville gøre det
      const r = applyActionAs(bot, { t: 'bid', pid: mine.id, fee, loan: false });
      return typeof r === 'string' ? say('chat.r.notNeeded', { player: pname(mine) }) : say('chat.r.bidSent', { player: pname(mine), fee });
    });
  }
  if (has(lc, RE.congrats)) return say('chat.r.thanks');
  if (has(lc, RE.luck)) return say('chat.r.luck');
  if (has(lc, RE.insult)) return say('chat.r.insult', { club: g.clubs[humanClub]?.short ?? '', mine: g.clubs[botClub]?.short ?? '' });
  if (has(lc, RE.banter)) return say('chat.r.banter', { club: g.clubs[humanClub]?.short ?? '' });
  if (has(lc, RE.hello)) return say('chat.r.hello', { club: g.clubs[botClub]?.name ?? '' });
  if (has(lc, RE.thanks)) return say('chat.r.welcome');
  if (has(lc, RE.offer) || has(lc, RE.price)) return say('chat.r.askName');
  return say('chat.r.generic');
}

// ---------- AI-managere der selv tager kontakt ----------

/** Efter en kamp mellem en AI-manager og et menneske: drillerier eller sportslig respekt */
export function botsAfterMatch(f: Fixture) {
  const g = gs();
  if (!g.humans || !f.result) return;
  const sides = [f.home, f.away].map((c) => {
    const h = g.humans!.find((x) => clubOf(x.pid) === c);
    return h ? { pid: h.pid, bot: !!h.bot } : null;
  });
  const [hs, as] = sides;
  if (!hs || !as || hs.bot === as.bot) return;
  const bot = hs.bot ? hs : as;
  const human = hs.bot ? as : hs;
  if (hash01(g.seed, f.id, 404) > 0.65) return;
  const botHome = bot === hs;
  const diff = (f.result.hg - f.result.ag) * (botHome ? 1 : -1);
  const score = botHome ? `${f.result.hg}-${f.result.ag}` : `${f.result.ag}-${f.result.hg}`;
  const key = diff > 1 ? 'chat.bot.bigWin' : diff > 0 ? 'chat.bot.won' : diff === 0 ? 'chat.bot.draw' : 'chat.bot.lost';
  botSay(bot.pid, human.pid, key, { score, club: g.clubs[clubOf(human.pid)]?.short ?? '' });
}

/** En AI-manager fortæller selv om sit bud på ens spiller */
export function botAnnounceBid(bot: string, p: Player, fee: number) {
  const owner = gs().humans?.find((h) => !h.bot && clubOf(h.pid) === p.club);
  if (owner) botSay(bot, owner.pid, 'chat.bot.bid', { player: pname(p), fee });
}

/** Velkomst når en AI-manager kommer ind i spillet */
export function botHello(bot: string) {
  const g = gs();
  for (const h of g.humans ?? []) if (!h.bot) botSay(bot, h.pid, 'chat.bot.hello', { club: g.clubs[clubOf(bot)]?.name ?? '' });
}

