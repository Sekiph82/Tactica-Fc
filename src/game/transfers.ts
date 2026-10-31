// Transfers, kontrakter og AI-transfermarked (forbedring #7: behovsstyrede AI-klubber).
import { naturalRole } from './attributes';
import { addDays, ageOn, daysBetween, month, year } from './dates';
import { roundValue, wageFor } from './data/generate';
import { rulesFor } from './leagues';
import { hash01, rng } from './rng';
import { recordDevelopment } from './training';
import { merchStarSigning } from './finance';
import { addNews, gs, newsRelevant, setClub, squad } from './state';
import { clubLevel, registerAskingPrice } from './scouting';
import { clubStrategy } from './strategy';
import { SHIFT_WEEKS } from './board';
import { fansOnDeparture, fansOnRenewal, fansOnSigning } from './fans';
import { pushCareerLine, recordMove } from './season';
import { blockedMoveReaction, playerPraises, targetReaction, type RejectReason } from './will';
import type { Club, ContractClauses, Player, Role, TransferOffer } from './types';
import { ADDON_APPS, bidClauseWorth, cleanClauses, clauseWorth, defaultRelease, settleSellOn } from './clauses';
import { asOwner, forEachHuman, isHumanClub, isMultiplayer } from './humans';
import { AGENT_RULES, agentOf } from './agents';

export function windowOpen(date = gs().date): boolean {
  const m = month(date);
  // som i CM 01/02: handler hele året undtagen i slutspurten (april-maj)
  if (gs().options?.transferWindows === 'classic') return !(m === 4 || m === 5);
  // rigtige vinduer: sommer (15. juni – 31. august) og januar
  return m === 7 || m === 8 || m === 1 || (m === 6 && Number(date.slice(8, 10)) >= 15);
}

/** Hvornår åbner transfervinduet næste gang? */
export function nextWindow(date = gs().date): string {
  const y = Number(date.slice(0, 4)), m = month(date);
  if (gs().options?.transferWindows === 'classic') return `${y}-06-01`;
  return m >= 9 ? `${y + 1}-01-01` : `${y}-06-15`;
}

/** Må en AI-klub byde på en spiller hos en menneskestyret klub lige nu? (så der ikke regner bud ned) */
function canBidOnHuman(p: Player, buyer: number): boolean {
  const g = gs();
  const pending = g.offers.filter((o) => o.seller === p.club && o.status === 'pending' && !isHumanClub(o.buyer)).length;
  if (pending >= 3) return false;
  const since = addDays(g.date, -21);
  // samme klub byder ikke igen, mens dens bud er åbent – og efter et afslag kommer den kun igen via en jagt (med et højere bud)
  if (g.offers.some((o) => o.player === p.id && o.buyer === buyer && (['pending', 'countered', 'negotiating'].includes(o.status) || (o.created >= since && ['rejected', 'withdrawn'].includes(o.status))))) return false;
  if (g.pursuits?.some((x) => x.club === buyer && x.player === p.id)) return false;
  // efter et afslag venter andre klubber et par uger
  return !g.offers.some((o) => o.player === p.id && o.buyer !== buyer && o.created >= since && ['rejected', 'withdrawn', 'pending'].includes(o.status));
}

/** En AI-klub der byder på en spiller, har ham selvfølgelig på sin shortliste */
function noteInterest(clubId: number, pid: number) {
  const c = gs().clubs[clubId];
  if (!c || c.manager === -1) return;
  if (!(c.shortlist ??= []).includes(pid)) c.shortlist.push(pid);
}

function sellerName(id: number) {
  return id ? gs().clubs[id]?.name ?? '?' : '-';
}
const pname = (p: Player) => `${p.first} ${p.last}`.trim();

// ---------- værdi og krav ----------

// Cache over truppernes CA-rækkefølge (nulstilles dagligt og ved transfers)
let rankCache = new Map<number, number[]>();
let rankCacheDate = '';

export function keyPlayerRank(p: Player): number {
  if (!p.club) return 99;
  const g = gs();
  if (rankCacheDate !== g.date) { rankCache = new Map(); rankCacheDate = g.date; }
  let cas = rankCache.get(p.club);
  if (!cas) {
    cas = squad(p.club).map((x) => x.ca).sort((a, b) => b - a);
    rankCache.set(p.club, cas);
  }
  return cas.indexOf(p.ca) + 1;
}

export type Realism = { level: 0 | 1 | 2; score: number; reasons: string[] };

/**
 * Hvor realistisk er en handel for brugerens klub? (0 = realistisk, 1 = måske, 2 = urealistisk)
 * Ser på spillerens interesse, om klubben vil sælge, transfersum og lønkrav.
 */
export function transferRealism(p: Player): Realism {
  const g = gs();
  const club = g.clubs[g.userClub];
  const reasons: string[] = [];
  if (!club || p.club === club.id) return { level: 2, score: -99, reasons };
  let score = 0;
  let level: 0 | 1 | 2 = 0;
  const bump = (l: 0 | 1 | 2, key: string, s: number) => { if (l > level) level = l; reasons.push(key); score -= s; };
  const interest = playerInterest(p, club);
  if (interest === 'reputation') bump(2, 'real.reputation', 50);
  else if (interest === 'happy') bump(2, 'real.happy', 40);
  else if (interest === 'abroad') bump(2, 'real.abroad', 40);
  else if (p.rep - club.rep > 15) bump(1, 'real.repGap', 10);
  if (p.loan || p.contract?.futureClub) bump(2, 'real.unavailable', 50);
  const bosman = !!p.club && canPreContract(p);
  if (bosman) {
    // fri kontrakt fra sommer: hverken prisen eller klubbens vilje til at sælge betyder noget
    score += 6;
    reasons.push('real.bosman');
  } else if (p.club) {
    const seller = g.clubs[p.club];
    const rank = keyPlayerRank(p);
    if (rank <= 2 && seller && seller.rep >= club.rep) bump(2, 'real.notForSale', 30);
    // for dyr er højst "måske": budgettet kan flyttes, forhøjes eller spares op
    const price = askingPrice(p);
    if (price > club.transferBudget) bump(1, 'real.tooExpensive', 25 * Math.min(4, price / Math.max(1, club.transferBudget)));
    else score += 5 * (1 - price / Math.max(1, club.transferBudget));
    if (p.listed) { score += 8; reasons.push('real.listed'); }
  } else {
    score += 6;
    reasons.push('real.free');
  }
  const bill = squad(club.id).reduce((s, x) => s + (x.contract?.wage ?? 0), 0);
  // lønnen: passer den ikke i lønbudgettet, kan transferbudget omfordeles (1 uges løn = SHIFT_WEEKS kr. transferbudget)
  const missing = bill + wageDemand(p, club) - club.wageBudget;
  if (missing > 0) {
    const fee = p.club && !bosman ? askingPrice(p) : 0;
    if (fee + missing * SHIFT_WEEKS <= club.transferBudget) { reasons.push('real.wagesShift'); score -= 3; }
    else bump(1, 'real.wages', 10);
  }
  // Vil han få spilletid? Spillere langt over klubbens niveau er mere interesserede i store klubber
  score += Math.max(-10, Math.min(10, (club.rep - p.rep) / 3));
  return { level, score: Math.round(score * 10) / 10, reasons };
}

export function askingPrice(p: Player): number {
  const g = gs();
  if (p.listed && p.listPrice) return p.listPrice;
  let f = 1.15;
  const rank = keyPlayerRank(p);
  if (rank <= 3) f *= 1.5;
  else if (rank <= 11) f *= 1.2;
  else if (rank > 18) f *= 0.8;
  if (p.listed) f *= 0.8;
  const age = ageOn(p.dob, g.date);
  if (age <= 21 && p.pa - p.ca > 25) f *= 1.35;
  if (p.contract) {
    const yearsLeft = year(p.contract.expires) - year(g.date) - (month(g.date) >= 7 ? 1 : 0);
    if (yearsLeft <= 0) f *= 0.55;
    else if (yearsLeft === 1) f *= 0.8;
  }
  const club = g.clubs[p.club];
  if (club && club.balance < 0) f *= 0.85;
  return roundValue(Math.max(10_000, p.value * f));
}

/** Hvor mange gange udbudsprisen skal der til, før klubben overhovedet vil sælge (0 = spilleren er til salg) */
function notForSaleMult(p: Player, buyer: Club): number {
  const g = gs();
  const seller = g.clubs[p.club];
  if (!seller) return 0;
  const rank = keyPlayerRank(p);
  const strat = !isHumanClub(seller.id) ? clubStrategy(seller) : 'balanced';
  const age = ageOn(p.dob, g.date);
  let m = 0;
  // topklubber sælger nødigt til mindre klubber; udviklingsklubber holder på de helt unge
  if (strat === 'big' && rank <= 4 && seller.rep >= buyer.rep - 5) m = Math.max(m, 1.8);
  if (strat === 'develop' && age <= 20 && rank <= 11) m = Math.max(m, 1.4);
  if (strat !== 'seller' && rank <= 2 && seller.rep >= buyer.rep) m = Math.max(m, 1.6);
  if (strat === 'seller' && rank <= 1 && seller.rep >= buyer.rep) m = Math.max(m, 1.3);
  return m;
}

export type SellerAnswer = 'accept' | 'counter' | 'reject' | 'notforsale';

export function sellerDecision(p: Player, fee: number, buyer: Club): { answer: SellerAnswer; counter?: number } {
  const g = gs();
  const seller = g.clubs[p.club];
  const ask = askingPrice(p);
  const strat = seller && !isHumanClub(seller.id) ? clubStrategy(seller) : 'balanced';
  const age = ageOn(p.dob, g.date);
  if (fee < ask * notForSaleMult(p, buyer)) return { answer: 'notforsale' };
  // sælgerklubber og udviklingsklubber (med spillere over 22) tager imod lidt under prisen
  const accept = strat === 'seller' ? 0.9 : strat === 'develop' && age >= 23 ? 0.95 : 1;
  if (fee >= ask * accept) return { answer: 'accept' };
  if (fee >= ask * 0.72) return { answer: 'counter', counter: ask };
  return { answer: 'reject' };
}

/**
 * Skal den aktive manager have en nyhed om en handel mellem andre klubber?
 * Standard ('big'): kun store handler i ens egen liga – ellers drukner indbakken.
 */
function otherTransferNews(buyer: Club, seller: Club | undefined, fee: number, loan: boolean): boolean {
  const g = gs();
  const mode = g.options.transferNews ?? 'big';
  if (mode === 'own') return false;
  if (mode === 'all') return newsRelevant(buyer.id, seller?.id);
  const me = g.clubs[g.userClub];
  if (!me || loan || fee <= 0) return false;
  const inMyLeague = buyer.league === me.league || seller?.league === me.league;
  const big = Math.max(500_000, rulesFor(me.league, 20).wealth * 2_000_000);
  return inMyLeague && fee >= big;
}

/** Verdens højeste ugeløn (europæisk topniveau ~ 0,6-0,7 mio. €) */
const MAX_WAGE = 750_000;

export function wageDemand(p: Player, club: Club): number {
  const g = gs();
  const wealth = rulesFor(club.league, 20).wealth;
  const market = wageFor(p.value, wealth);
  const current = p.contract?.wage ?? 0;
  const amb = 1 + (p.attrs[42 /* ambition */] - 10) / 60;
  const repGap = Math.max(0, p.rep - club.rep) / 100;
  // nuværende løn tæller med, men kun op til 1,5× markedslønnen – ellers vokser lønnen eksponentielt ved hvert skifte
  const anchor = Math.min(current, market * 1.5);
  let d = Math.max(market, anchor * 1.1) * amb * (1 + repGap);
  if (!p.club) d *= 0.9;
  // agenten: en grisk agent forlanger mere, en loyal er billigere at forlænge med
  const ag = AGENT_RULES[agentOf(p).style];
  d *= ag.wage;
  if (p.club === club.id) d = Math.max(anchor * 1.04, market * 0.95) * amb * ag.renew;
  d = Math.min(d, market * 2.4, MAX_WAGE);
  void g;
  return Math.round(d / 50) * 50;
}

export function preferredYears(p: Player): number {
  const age = ageOn(p.dob, gs().date);
  if (age >= 32) return 1;
  if (age >= 29) return 2;
  if (age <= 21) return 5;
  return 3;
}

/** Vil spilleren overhovedet tale med klubben? */
export function playerInterest(p: Player, club: Club): 'yes' | 'reputation' | 'happy' | 'abroad' {
  const g = gs();
  if (p.club === club.id) return 'yes';
  const cur = p.club ? g.clubs[p.club] : undefined;
  const gap = p.rep - club.rep;
  if (gap > 28 + (p.attrs[41] - 10)) return 'reputation';
  if (cur && cur.rep > club.rep + 25 && keyPlayerRank(p) <= 11 && p.attrs[43] > 13) return 'happy';
  // agent der vil have spilleren til en større liga: ikke et skifte i samme land eller til en fattigere liga – medmindre klubben er markant større
  if (cur && agentOf(p).style === 'abroad' && club.rep < cur.rep + 10
    && (club.nation === cur.nation || rulesFor(club.league, 20).wealth < rulesFor(cur.league, 20).wealth)) return 'abroad';
  return 'yes';
}

// ---------- byttehandler ----------

/** Hvor meget er en byttespiller værd for den sælgende klub? (mere, hvis han dækker et behov) */
export function swapWorth(pid: number, sellerId: number): number {
  const g = gs();
  const p = g.players[pid];
  if (!p) return 0;
  const needs = analyzeNeeds(sellerId).slice(0, 2).map((n) => n.role);
  return Math.round(p.value * (needs.includes(naturalRole(p)) ? 0.9 : 0.7));
}

/** Egne spillere, som den sælgende klub kunne have interesse i at få med i en byttehandel */
export function swapCandidates(sellerId: number, targetId: number): Player[] {
  const g = gs();
  const seller = g.clubs[sellerId];
  if (!seller || !g.userClub) return [];
  const level = clubLevel(sellerId);
  const needs = analyzeNeeds(sellerId).slice(0, 3).map((n) => n.role);
  return squad(g.userClub)
    .filter((p) => p.id !== targetId && !p.loan && p.contract && !p.contract.futureClub && !(p.injury && p.injury.days > 30))
    // god nok til klubben – og enten på en plads, de mangler, eller klart en forstærkning
    .filter((p) => p.ca >= level - 12 && (needs.includes(naturalRole(p)) || p.ca >= level + 3))
    .filter((p) => playerInterest(p, seller) === 'yes')
    .sort((a, b) => swapWorth(b.id, sellerId) - swapWorth(a.id, sellerId))
    .slice(0, 12);
}

/** Samlet værdi af byttespillerne i et bud (kun dem, der stadig er i køberens klub) */
function offerSwapWorth(o: TransferOffer): number {
  const g = gs();
  return (o.swap ?? []).filter((id) => g.players[id]?.club === o.buyer).reduce((s, id) => s + swapWorth(id, o.seller), 0);
}

// ---------- brugerens handlinger ----------

export function makeBid(pid: number, fee: number, loan = false, extra?: { sellOn?: number; addOn?: number; swap?: number[] }): TransferOffer | string {
  const g = gs();
  const p = g.players[pid];
  const buyer = g.clubs[g.userClub];
  if (!p || !buyer) return 'error';
  if (!windowOpen()) return 'transfer.windowClosed';
  if (p.club === buyer.id) return 'error';
  if (!loan && fee > buyer.transferBudget) return 'transfer.overBudget';
  if (g.offers.some((o) => o.player === pid && o.buyer === buyer.id && ['pending', 'negotiating', 'countered'].includes(o.status))) return 'transfer.alreadyBidding';
  const humanSeller = isHumanClub(p.club);
  const o: TransferOffer = {
    id: g.nextId.offer++, player: pid, buyer: buyer.id, seller: p.club, fee: p.club ? fee : 0, loan,
    status: p.club ? 'pending' : 'negotiating', created: g.date, respondBy: addDays(g.date, !p.club ? 7 : humanSeller ? 5 : rng.int(1, 3)),
  };
  // byder en anden manager også på spilleren hos en AI-klub: lukket budrunde med fælles frist
  if (p.club && !loan && !humanSeller) startAuction(o, p);
  if (p.club && !loan && extra?.sellOn) o.sellOn = Math.max(0, Math.min(50, Math.round(extra.sellOn)));
  if (p.club && !loan && extra?.addOn) o.addOn = roundValue(Math.max(0, extra.addOn));
  if (p.club && !loan && extra?.swap?.length) {
    const ok = [...new Set(extra.swap)].filter((id) => { const x = g.players[id]; return x && x.club === buyer.id && x.id !== pid && !x.loan; }).slice(0, 3);
    if (ok.length) o.swap = ok;
  }
  g.offers.push(o);
  if (humanSeller) {
    // Bud til en anden menneskelig manager
    asOwner(p.club, () => addNews({ cat: 'transfer', key: 'transfer.incomingBid', params: { club: buyer.name, player: pname(p), fee: o.fee }, link: { kind: 'offer', id: o.id } }));
  }
  return o;
}

/** Forespørgsel: hvad vil klubben have for spilleren? Svaret gemmes, så budvinduet kan bruge det. */
export function enquire(pid: number): string {
  const g = gs();
  const p = g.players[pid];
  const buyer = g.clubs[g.userClub];
  const seller = p && g.clubs[p.club];
  if (!p || !buyer || !seller || p.club === buyer.id) return 'error';
  if (isHumanClub(seller.id)) return 'enquiry.human';
  const m = notForSaleMult(p, buyer);
  // rund op, så et bud på den nævnte pris altid er nok
  const need = askingPrice(p) * Math.max(1, m);
  let fee = roundValue(need);
  if (fee < need) fee = roundValue(need + (need < 1_000_000 ? 12_500 : need < 10_000_000 ? 50_000 : 250_000));
  const all = (g.manager.enquiries ??= {});
  for (const [id, e] of Object.entries(all)) if (daysBetween(e.date, g.date) > 90) delete all[Number(id)];
  all[pid] = { date: g.date, club: seller.id, fee, nfs: m > 0 };
  addNews({ cat: 'transfer', key: m > 0 ? 'enquiry.nfs' : p.listed ? 'enquiry.listed' : 'enquiry.price', params: { club: seller.name, player: pname(p), fee }, link: { kind: 'player', id: pid } });
  return m > 0 ? 'enquiry.nfs' : p.listed ? 'enquiry.listed' : 'enquiry.price';
}

/** Seneste svar på en forespørgsel (kun hvis spilleren stadig er i samme klub) */
export function knownEnquiry(pid: number) {
  const g = gs();
  const e = g.manager.enquiries?.[pid];
  return e && g.players[pid]?.club === e.club ? e : undefined;
}

/** Brugeren sælger: svar på et bud */
export function respondToOffer(id: number, action: 'accept' | 'reject' | 'counter', counter?: number, sellOn?: number, reason?: RejectReason): string | null | void {
  const g = gs();
  const o = g.offers.find((x) => x.id === id);
  if (!o || o.status !== 'pending' || o.seller !== g.userClub) return;
  const p = g.players[o.player];
  const buyer = g.clubs[o.buyer];
  const myName = g.clubs[g.userClub]?.name ?? '';
  if (action === 'reject') {
    o.status = 'rejected';
    if (!isHumanClub(buyer.id) && !o.loan) startPursuit(o);
    // spilleren kan blive skuffet og bede om en samtale (især ambitiøse spillere ved et skridt op)
    const reply = p ? blockedMoveReaction(p, buyer.id, o.fee, reason) : null;
    if (isHumanClub(buyer.id)) asOwner(buyer.id, () => addNews({ cat: 'transfer', key: 'transfer.bidRejected', params: { player: pname(p), club: myName }, link: { kind: 'player', id: p.id } }));
    return reply;
  }
  if (isHumanClub(buyer.id)) {
    // Menneskelig køber: modbud eller videre til kontraktforhandling
    if (action === 'counter' && counter) {
      o.status = 'countered';
      o.counter = counter;
      asOwner(buyer.id, () => addNews({ cat: 'transfer', key: 'transfer.bidCountered', params: { player: pname(p), club: myName, fee: counter }, link: { kind: 'offer', id: o.id } }));
    } else {
      o.status = 'negotiating';
      o.respondBy = addDays(g.date, 10);
      const sellerName = g.clubs[o.seller]?.name ?? '';
      asOwner(buyer.id, () => addNews({ cat: 'transfer', key: 'transfer.bidAccepted', params: { player: pname(p), club: sellerName, fee: o.fee }, link: { kind: 'offer', id: o.id } }));
    }
    return;
  }
  if (action === 'counter' && counter) {
    // Prisforhandling med AI-køberen
    const max = o.maxFee ?? Math.min(buyer.transferBudget, Math.round(o.fee * 1.25));
    // en ønsket videresalgsprocent koster køberen noget – den tæller med i deres smertegrænse
    const extra = sellOn ? bidClauseWorth(p, counter, sellOn) : 0;
    if (counter + extra <= max && counter <= buyer.transferBudget) {
      o.fee = counter;
      if (sellOn) o.sellOn = sellOn;
    } else if (sellOn && counter <= max && (o.priceRounds ?? 0) >= 1) {
      // de betaler prisen, men vil ikke give videresalg
      o.priceRounds = (o.priceRounds ?? 0) + 1;
      o.fee = counter;
      addNews({ cat: 'transfer', key: 'transfer.aiNoSellOn', params: { club: buyer.name, player: pname(p), fee: o.fee }, link: { kind: 'offer', id: o.id } });
      o.respondBy = addDays(g.date, 3);
      return;
    } else {
      o.priceRounds = (o.priceRounds ?? 0) + 1;
      // bliver modbuddet ved at være langt over det de vil betale, eller er der forhandlet længe, går de
      if (o.priceRounds >= 3 || counter > max * 1.6) {
        o.status = 'withdrawn';
        addNews({ cat: 'transfer', key: 'transfer.aiWithdrew', params: { club: buyer.name, player: pname(p) } });
        blockedMoveReaction(p, buyer.id, o.fee);
        return;
      }
      // ellers hæver de buddet et stykke mod deres smertegrænse
      const step = o.priceRounds === 1 ? 0.6 : 1;
      o.fee = roundValue(Math.min(max, o.fee + (max - o.fee) * step));
      o.respondBy = addDays(g.date, 3);
      addNews({ cat: 'transfer', key: o.fee >= max ? 'transfer.aiFinalOffer' : 'transfer.aiRaised', params: { club: buyer.name, player: pname(p), fee: o.fee }, link: { kind: 'offer', id: o.id } });
      return;
    }
  }
  // AI forhandler med spilleren
  if (playerInterest(p, buyer) !== 'yes' && !o.loan) {
    o.status = 'collapsed';
    addNews({ cat: 'transfer', key: 'transfer.playerRefusedMove', params: { club: buyer.name, player: pname(p) } });
    return;
  }
  completeTransfer(o, wageDemand(p, buyer), preferredYears(p));
}

/** Kontraktforhandling: brugeren tilbyder løn og længde */
/** Spillerens forventede plads i trupen (1 = bedst) – bruges til at vurdere bonusser */
function rankIn(p: Player, clubId: number): number {
  return 1 + squad(clubId).filter((x) => x.id !== p.id && x.ca > p.ca + 1).length;
}

/** Klausulernes værdi for spilleren i en given klub */
export function clausesWorthFor(p: Player, clubId: number, wage: number, years: number, c: ContractClauses): number {
  return clauseWorth(p, wage, years, c, rankIn(p, clubId));
}

export function negotiate(offerId: number, wage: number, years: number, clauses?: ContractClauses): 'accepted' | 'counter' | 'refused' | 'budget' | 'pending' {
  const g = gs();
  const o = g.offers.find((x) => x.id === offerId);
  if (!o) return 'refused';
  const p = g.players[o.player];
  const club = g.clubs[o.buyer];
  const interest = playerInterest(p, club);
  if (interest !== 'yes') {
    o.status = 'collapsed';
    addNews({ cat: 'transfer', key: interest === 'reputation' ? 'transfer.refuseRep' : interest === 'abroad' ? 'transfer.refuseAbroad' : 'transfer.refuseHappy', params: { player: pname(p), club: club.name } });
    return 'refused';
  }
  const demand = wageDemand(p, club);
  const want = preferredYears(p);
  o.rounds = (o.rounds ?? 0) + 1;
  const yearsOk = Math.abs(years - want) <= (want >= 3 ? 2 : 1);
  if (club.id === g.userClub && currentBill(club.id) + wage > club.wageBudget) return 'budget';
  const cl = cleanClauses(clauses);
  if (wage + clausesWorthFor(p, club.id, wage, years, cl) >= demand * AGENT_RULES[agentOf(p).style].accept && yearsOk) {
    // multiplayer: frie spillere og Bosman-aftaler kan andre også byde på – spilleren svarer i morgen
    if (isMultiplayer(g) && (o.preContract || !o.seller)) {
      o.status = 'pending';
      o.signing = { wage, years, clauses: Object.keys(cl).length ? cl : undefined };
      o.respondBy = addDays(g.date, 1);
      addNews({ cat: 'transfer', key: 'signing.pending', params: { player: pname(p) }, link: { kind: 'player', id: p.id } });
      // en anden manager har også et tilbud liggende: budkrig – begge kan hæve én gang, blindt
      const rivals = g.offers.filter((x) => x !== o && x.player === p.id && x.status === 'pending' && x.signing && x.buyer !== o.buyer && isHumanClub(x.buyer));
      if (rivals.length) {
        const all = [o, ...rivals];
        const newWar = rivals.every((x) => !x.war);
        const deadline = addDays(g.date, 2);
        for (const x of all) {
          const fresh = !x.war;
          x.war = true;
          x.respondBy = deadline;
          if (fresh || x === o) asOwner(x.buyer, () => addNews({ cat: 'transfer', key: 'war.startedWage', params: { player: pname(p), n: all.length, date: deadline, oid: x.id }, link: { kind: 'player', id: p.id } }));
        }
        if (newWar) warHeadline(p, all.map((x) => x.buyer));
      }
      return 'pending';
    }
    if (o.preContract) {
      completePreContract(o, wage, years, cl);
      return 'accepted';
    }
    completeTransfer(o, wage, years, cl);
    return 'accepted';
  }
  if (o.rounds >= 3) {
    o.status = 'collapsed';
    addNews({ cat: 'transfer', key: 'transfer.talksCollapsed', params: { player: pname(p) } });
    return 'refused';
  }
  o.demand = { wage: Math.round(demand * (1 + (o.rounds - 1) * 0.03) / 50) * 50, years: want };
  return 'counter';
}

function completePreContract(o: TransferOffer, wage: number, years: number, cl: ContractClauses) {
  const g = gs();
  const p = g.players[o.player];
  const club = g.clubs[o.buyer];
  p.contract = { ...(p.contract ?? { wage, expires: g.date }), futureClub: club.id, futureWage: wage, futureExpires: `${year(g.date) + years + (month(g.date) >= 7 ? 1 : 0)}-06-30` };
  p.futureClauses = Object.keys(cl).length ? cl : undefined;
  o.status = 'completed';
  asOwner(club.id, () => addNews({ cat: 'transfer', key: 'transfer.preContract', params: { player: pname(p), club: club.name }, link: { kind: 'player', id: p.id } }));
}

/**
 * Dagligt i multiplayer: frie spillere og Bosman-spillere vælger mellem kontrakttilbuddene.
 * Bedste tilbud i forhold til hvad han kræver hos den klub – et større omdømme trækker også.
 */
export function resolveSignings() {
  const g = gs();
  const byPlayer = new Map<number, TransferOffer[]>();
  for (const o of g.offers) if (o.signing && o.status === 'pending') byPlayer.set(o.player, [...(byPlayer.get(o.player) ?? []), o]);
  for (const [pid, list] of byPlayer) {
    if (!list.some((o) => g.date >= o.respondBy)) continue;
    const p = g.players[pid];
    const valid = list.filter((o) => p && (o.preContract ? !p.contract?.futureClub && p.club !== o.buyer : !p.club) && g.clubs[o.buyer]);
    const score = (o: TransferOffer) => o.signing!.wage / Math.max(1, wageDemand(p, g.clubs[o.buyer])) + (g.clubs[o.buyer].rep - p.rep) / 150;
    const sortedValid = valid.slice().sort((a, b) => score(b) - score(a) || a.id - b.id);
    const win = sortedValid[0];
    if (win && list.some((o) => o.war) && sortedValid.length > 1) warReveal(p, sortedValid, true);
    if (win) {
      const sg = win.signing!;
      if (win.preContract) completePreContract(win, sg.wage, sg.years, sg.clauses ?? {});
      else completeTransfer(win, sg.wage, sg.years, sg.clauses);
      if (list.length > 1 && !list.some((o) => o.war)) asOwner(win.buyer, () => addNews({ cat: 'transfer', key: 'signing.won', params: { player: pname(p), n: list.length }, link: { kind: 'player', id: p.id } }));
    }
    for (const o of list) {
      if (o === win) continue;
      o.status = 'rejected';
      o.outbid = true;
      if (!(win && o.war)) asOwner(o.buyer, () => addNews({ cat: 'transfer', key: win ? 'signing.lost' : 'signing.gone', params: { player: pname(p), club: win ? g.clubs[win.buyer]?.name ?? '' : '' }, link: { kind: 'player', id: pid } }));
    }
  }
}

function currentBill(clubId: number) {
  return squad(clubId).reduce((s, p) => s + (p.contract?.wage ?? 0), 0);
}

export function completeTransfer(o: TransferOffer, wage: number, years: number, clauses?: ContractClauses) {
  const g = gs();
  const p = g.players[o.player];
  const buyer = g.clubs[o.buyer];
  const seller = o.seller ? g.clubs[o.seller] : undefined;
  if (!p || !buyer) return;
  if (o.loan) {
    p.loan = { from: p.club, until: `${year(g.date) + (month(g.date) >= 7 ? 1 : 0)}-06-30`, ...(o.option ? { option: o.option } : {}) };
  } else {
    // en tidligere klub kan have krav på en del af fortjenesten
    if (o.fee > 0) settleSellOn(p, o.fee, seller);
    buyer.balance -= o.fee;
    buyer.transferBudget = Math.max(0, buyer.transferBudget - o.fee);
    buyer.finance.transfersOut += o.fee;
    if (seller) {
      seller.balance += o.fee;
      seller.finance.transfersIn += o.fee;
      seller.transferBudget += Math.round(o.fee * (isHumanClub(seller.id) ? 0.5 : 0.6));
    }
    const exp = `${year(g.date) + Math.max(1, years)}-06-30`;
    const rel = isHumanClub(buyer.id) ? undefined : defaultRelease(p, buyer);
    p.contract = { wage, expires: exp, ...(clauses ?? {}), ...(rel ? { release: rel } : {}) };
    p.addOn = undefined;
    if (seller && o.sellOn) p.sellOn = { club: seller.id, pct: o.sellOn, base: o.fee };
    if (seller && o.addOn) p.addOn = { club: seller.id, payer: buyer.id, fee: o.addOn, left: ADDON_APPS };
  }
  // skifte midt i sæsonen: bogfør tallene hos den gamle klub
  if (p.club && p.stats.apps + p.stats.subs > 0) pushCareerLine(p, p.club, !!p.loan);
  recordMove(p, buyer.id, o.fee, o.loan);
  // fansene reagerer på stjernesalg og -køb
  if (!o.loan && seller) fansOnDeparture(p, seller, 'sold', o.fee);
  setClub(p, buyer.id);
  if (!o.loan) merchStarSigning(buyer.id, p.rep);
  fansOnSigning(p, buyer, o.loan);
  // byttehandel: køberens spillere skifter den anden vej
  if (!o.loan && seller && o.swap?.length) {
    for (const id of o.swap) {
      const x = g.players[id];
      if (!x || x.club !== buyer.id || x.loan) continue;
      if (x.stats.apps + x.stats.subs > 0) pushCareerLine(x, x.club, false);
      fansOnDeparture(x, buyer, 'sold', swapWorth(x.id, seller.id));
      recordMove(x, seller.id, swapWorth(x.id, seller.id), false, true);
      x.contract = { wage: wageDemand(x, seller), expires: `${year(g.date) + preferredYears(x)}-06-30` };
      x.sellOn = undefined; x.addOn = undefined; x.listed = false; x.listPrice = undefined; x.renewal = undefined; x.complaint = undefined;
      setClub(x, seller.id);
      x.joined = g.date;
      asOwner(buyer.id, () => {
        if (g.tactic) g.tactic = { ...g.tactic, lineup: g.tactic.lineup.map((pid2) => (pid2 === x.id ? 0 : pid2)), bench: g.tactic.bench.filter((pid2) => pid2 !== x.id) };
      });
      asOwner(seller.id, () => { g.knowledge[x.id] = 100; });
      forEachHuman(() => { if (buyer.id === g.userClub || seller.id === g.userClub) addNews({ cat: 'transfer', key: 'transfer.swapPart', params: { player: pname(x), from: buyer.name, to: seller.name }, link: { kind: 'player', id: x.id } }); });
    }
    if (buyer.tactic) buyer.tactic = null;
  }
  rankCacheDate = '';
  p.listed = false;
  p.listPrice = undefined;
  p.wantsAway = false;
  p.promiseUntil = undefined;
  p.renewal = undefined;
  p.complaint = undefined;
  p.joined = g.date;
  p.morale = Math.min(20, p.morale + 2);
  p.form = [];
  o.status = 'completed';
  asOwner(buyer.id, () => { g.knowledge[p.id] = 100; recordDevelopment(p); });
  // fjern fra AI-taktik
  if (seller?.tactic) seller.tactic = null;
  if (seller) asOwner(seller.id, () => {
    if (g.tactic) g.tactic = { ...g.tactic, lineup: g.tactic.lineup.map((id) => (id === p.id ? 0 : id)), bench: g.tactic.bench.filter((id) => id !== p.id) };
  });
  const news = {
    cat: 'transfer' as const,
    key: o.loan ? 'transfer.loanDone' : o.seller ? 'transfer.done' : 'transfer.freeDone',
    params: { player: pname(p), from: sellerName(o.seller), to: buyer.name, fee: o.fee },
    link: { kind: 'player' as const, id: p.id },
  };
  forEachHuman(() => {
    const involved = buyer.id === g.userClub || seller?.id === g.userClub;
    if (involved) addNews(news);
    // andre klubbers handler samles i ugens transferoverblik
    else if (otherTransferNews(buyer, seller, o.fee, o.loan)) (g.transferDigest ??= []).push({ player: p.id, from: o.seller, to: buyer.id, fee: o.fee, ...(o.loan ? { loan: true } : {}) });
  });
}

export function toggleListed(pid: number) {
  const p = gs().players[pid];
  if (p) { p.listed = !p.listed; if (!p.listed) p.listPrice = undefined; }
}

/** Sæt spilleren til salg med en udbudspris (null = fjern fra salgslisten) */
export function setListPrice(pid: number, price: number | null) {
  const p = gs().players[pid];
  if (!p) return;
  if (price === null) { p.listed = false; p.listPrice = undefined; return; }
  p.listed = true;
  p.listPrice = roundValue(Math.max(10_000, price));
}

export function releasePlayer(pid: number) {
  const g = gs();
  const p = g.players[pid];
  if (!p || p.club !== g.userClub) return;
  const club = g.clubs[p.club];
  if (p.contract) {
    const weeks = Math.max(0, Math.round((new Date(p.contract.expires).getTime() - new Date(g.date).getTime()) / (7 * 86400000)));
    const pay = Math.round(weeks * p.contract.wage * 0.5);
    club.balance -= pay;
    club.finance.other += pay;
  }
  fansOnDeparture(p, club, 'released');
  setClub(p, 0);
  p.contract = null;
  p.listed = false;
  if (g.tactic) g.tactic = { ...g.tactic, lineup: g.tactic.lineup.map((id) => (id === pid ? 0 : id)), bench: g.tactic.bench.filter((id) => id !== pid) };
  addNews({ cat: 'contract', key: 'transfer.released', params: { player: pname(p) } });
}

/** Lønkrav ved forlængelse: en spiller, der har tøvet, vil have mere */
export function renewalDemand(p: Player, club: Club): number {
  const r = p.renewal;
  const f = r ? (r.wageFactor ?? (r.stance === 'hesitant' ? 1.15 : 1)) : 1;
  return Math.round(wageDemand(p, club) * f / 50) * 50;
}

/** Forlæng kontrakt for egen spiller – brugeren tilbyder løn/år */
export function renewContract(pid: number, wage: number, years: number, clauses?: ContractClauses): 'accepted' | 'counter' | 'refused' | 'budget' {
  const g = gs();
  const p = g.players[pid];
  const club = g.clubs[g.userClub];
  if (!p || !club || p.club !== club.id) return 'refused';
  if ((p.unhappy ?? 0) > 70 && p.attrs[43] < 10) return 'refused';
  // en spiller, der har sagt fra, forhandler ikke, før han er overtalt – og en tøvende vil have mere
  const r = p.renewal;
  if (r && !r.convinced && r.stance === 'refuses') return 'refused';
  const demand = renewalDemand(p, club);
  if (currentBill(club.id) - (p.contract?.wage ?? 0) + wage > club.wageBudget) return 'budget';
  const cl = cleanClauses(clauses);
  if (wage + clausesWorthFor(p, club.id, wage, years, cl) >= demand * AGENT_RULES[agentOf(p).style].accept) {
    const startYear = year(g.date) + (month(g.date) >= 7 ? 1 : 0);
    p.contract = { wage, expires: `${startYear + years - 1}-06-30`, ...cl };
    const hadDemand = !!p.demand;
    p.morale = Math.min(20, p.morale + (p.demand ? 4 : 2));
    p.demand = undefined;
    p.renewal = undefined;
    // en tilfreds spiller takker for den nye kontrakt
    if (hadDemand || wage >= demand * 1.1) playerPraises(p, 'contract');
    addNews({ cat: 'contract', key: 'contract.renewed', params: { player: pname(p), years } });
    fansOnRenewal(p, club);
    return 'accepted';
  }
  return 'counter';
}

/** Bosman: må forhandle frit når kontrakten udløber inden for 6 måneder (fra 1. januar) */
export function canPreContract(p: Player): boolean {
  const g = gs();
  if (!p.contract || p.club === g.userClub || !p.club) return false;
  if (p.contract.futureClub) return false;
  const m = month(g.date);
  const seasonEnd = `${year(g.date) + (m >= 7 ? 1 : 0)}-06-30`;
  return p.contract.expires <= seasonEnd && m >= 1 && m <= 6;
}

/** Hvorfor man (endnu) ikke kan tilbyde en Bosman-kontrakt – til forklaring i UI'et */
export function preContractBlock(p: Player): 'ok' | 'notExpiring' | 'fromJanuary' | 'taken' | null {
  const g = gs();
  if (!p.contract || !p.club || p.club === g.userClub) return null;
  if (canPreContract(p)) return 'ok';
  const m = month(g.date);
  const seasonEnd = `${year(g.date) + (m >= 7 ? 1 : 0)}-06-30`;
  if (p.contract.expires > seasonEnd) return 'notExpiring';
  if (p.contract.futureClub) return 'taken';
  return 'fromJanuary';
}

export function startPreContract(pid: number): TransferOffer | string {
  const g = gs();
  const p = g.players[pid];
  if (!p || !canPreContract(p)) return 'error';
  const o: TransferOffer = { id: g.nextId.offer++, player: pid, buyer: g.userClub, seller: p.club, fee: 0, loan: false, status: 'negotiating', created: g.date, respondBy: addDays(g.date, 7), preContract: true };
  g.offers.push(o);
  return o;
}

// ---------- daglig behandling ----------

export function processOffers() {
  const g = gs();
  const skip = (o: TransferOffer) => !!o.signing;
  // ældre saves: flere åbne bud fra samme AI-klub på samme spiller → behold kun det højeste
  const best = new Map<string, TransferOffer>();
  for (const o of g.offers) {
    if (o.status !== 'pending' || isHumanClub(o.buyer) || !isHumanClub(o.seller)) continue;
    const k = `${o.buyer}|${o.player}|${o.loan ? 1 : 0}`;
    const cur = best.get(k);
    if (!cur) best.set(k, o);
    else if (o.fee > cur.fee) { cur.status = 'withdrawn'; best.set(k, o); } else o.status = 'withdrawn';
  }
  for (const o of g.offers) {
    if (skip(o)) continue;
    if (o.status === 'pending' && o.buyer === g.userClub && isHumanClub(o.seller) && g.date > o.respondBy) {
      o.status = 'withdrawn'; // den anden manager svarede ikke
    } else if (o.status === 'pending' && o.buyer === g.userClub && !isHumanClub(o.seller) && g.date >= o.respondBy) {
      aiAnswerBid(o);
    } else if ((o.status === 'negotiating' || o.status === 'countered') && g.date > o.respondBy) {
      o.status = 'collapsed';
      // budkrigen tabt: rivalen køber spilleren
      const p = g.players[o.player];
      const rival = o.rival ? g.clubs[o.rival.club] : undefined;
      if (p && rival && o.buyer === g.userClub && p.club === o.seller && !isHumanClub(p.club) && rival.transferBudget >= o.rival!.fee) {
        const ro: TransferOffer = { id: g.nextId.offer++, player: p.id, buyer: rival.id, seller: p.club, fee: o.rival!.fee, loan: false, status: 'negotiating', created: g.date, respondBy: g.date };
        completeTransfer(ro, wageDemand(p, rival), preferredYears(p));
        addNews({ cat: 'transfer', key: 'transfer.lostBiddingWar', params: { player: pname(p), club: rival.name, fee: ro.fee }, link: { kind: 'player', id: p.id } });
      }
    } else if (o.status === 'pending' && o.seller === g.userClub && g.date > o.respondBy) {
      o.status = 'withdrawn';
    }
  }
  // ryd gamle tilbud
  if (g.offers.length > 120) g.offers = g.offers.filter((o) => ['pending', 'negotiating', 'countered'].includes(o.status) || o.created > addDays(g.date, -60));
}


/** En AI-klub svarer på brugerens bud: accept, modbud eller nej (bruges dagligt og med det samme i budvinduet) */
function aiAnswerBid(o: TransferOffer) {
  const g = gs();
  const p = g.players[o.player];
  const buyer = g.clubs[o.buyer];
  if (!p || p.club !== o.seller) { o.status = 'withdrawn'; return; }
  if (o.loan) {
    const rank = keyPlayerRank(p);
    const age = ageOn(p.dob, g.date);
    if (rank > 13 && (age <= 24 || rank > 18)) {
      o.status = 'negotiating';
      addNews({ cat: 'transfer', key: 'transfer.loanAccepted', params: { player: pname(p), club: sellerName(o.seller) }, link: { kind: 'offer', id: o.id } });
      completeTransfer(o, p.contract?.wage ?? 0, 0);
    } else {
      o.status = 'rejected';
      addNews({ cat: 'transfer', key: 'transfer.loanRejected', params: { player: pname(p), club: sellerName(o.seller) } });
    }
    return;
  }
  // frikøbsklausulen er betalt: sælgeren kan ikke sige nej
  if (p.contract?.release && o.fee >= p.contract.release) {
    o.status = 'negotiating';
    o.respondBy = addDays(g.date, 10);
    addNews({ cat: 'transfer', key: 'transfer.releaseMet', params: { player: pname(p), club: sellerName(o.seller), fee: o.fee }, link: { kind: 'offer', id: o.id } });
    return;
  }
  const worth = bidClauseWorth(p, o.fee, o.sellOn, o.addOn) + offerSwapWorth(o);
  let d = sellerDecision(p, o.fee + worth, buyer);
  if (d.answer === 'counter' && d.counter) d.counter = roundValue(Math.max(o.fee, d.counter - worth));
  o.rival = rivalBid(o, p);
  if (o.rival && d.answer !== 'notforsale' && o.fee + worth < o.rival.fee) {
    d = { answer: 'counter', counter: roundValue(o.rival.fee * 1.05) };
    addNews({ cat: 'transfer', key: 'transfer.biddingWar', params: { player: pname(p), club: sellerName(o.rival.club), fee: o.rival.fee }, link: { kind: 'offer', id: o.id } });
  }
  if (d.answer === 'accept') {
    o.status = 'negotiating';
    o.respondBy = addDays(g.date, 10);
    addNews({ cat: 'transfer', key: 'transfer.bidAccepted', params: { player: pname(p), club: sellerName(o.seller), fee: o.fee }, link: { kind: 'offer', id: o.id } });
  } else if (d.answer === 'counter') {
    o.status = 'countered';
    o.counter = d.counter;
    addNews({ cat: 'transfer', key: 'transfer.bidCountered', params: { player: pname(p), club: sellerName(o.seller), fee: d.counter ?? 0 }, link: { kind: 'offer', id: o.id } });
  } else {
    o.status = 'rejected';
    if (d.answer === 'notforsale') o.nfs = true;
    addNews({ cat: 'transfer', key: d.answer === 'notforsale' ? 'transfer.notForSale' : 'transfer.bidRejected', params: { player: pname(p), club: sellerName(o.seller) }, link: { kind: 'player', id: p.id } });
    // spilleren ville måske gerne – han kan kontakte køberen og bede om at blive sat til salg
    targetReaction(p, buyer.id);
  }
}

/** Brugeren accepterer et modbud */
export function acceptCounter(id: number) {
  const g = gs();
  const o = g.offers.find((x) => x.id === id);
  if (!o || o.status !== 'countered' || !o.counter) return 'error';
  const buyer = g.clubs[o.buyer];
  if (o.counter > buyer.transferBudget) return 'transfer.overBudget';
  o.fee = o.counter;
  o.status = 'negotiating';
  o.respondBy = addDays(g.date, 10);
  return 'ok';
}

// ---------- AI-markedet ----------

const REQUIRED: Record<Role, number> = { GK: 2, CB: 4, FB: 3, DM: 2, CM: 3, WM: 1, W: 2, AM: 1, ST: 3 };
const GROUP: Record<Role, Role> = { GK: 'GK', CB: 'CB', FB: 'FB', DM: 'DM', CM: 'CM', WM: 'W', W: 'W', AM: 'AM', ST: 'ST' };
/** Målmænd har systematisk lavere CA end markspillere på samme niveau (lavere markedsværdier) */
const GK_OFFSET = 8;
const roleOffset = (r: Role) => (r === 'GK' ? GK_OFFSET : 0);

/** Spillerens plads i klubbens rangorden på hans position (0 = bedste) */
function depthRank(p: Player): number {
  const grp = GROUP[naturalRole(p)];
  return squad(p.club).filter((x) => x.id !== p.id && !x.loan && GROUP[naturalRole(x)] === grp && x.ca > p.ca).length;
}

export function analyzeNeeds(clubId: number): { role: Role; score: number }[] {
  const sq = squad(clubId);
  const level = clubLevel(clubId);
  const groups = new Map<Role, Player[]>();
  for (const p of sq) {
    const r = GROUP[naturalRole(p)];
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(p);
  }
  const out: { role: Role; score: number }[] = [];
  const reqByGroup: Partial<Record<Role, number>> = {};
  for (const [r, n] of Object.entries(REQUIRED) as [Role, number][]) reqByGroup[GROUP[r]] = (reqByGroup[GROUP[r]] ?? 0) + n;
  for (const [r, n] of Object.entries(reqByGroup) as [Role, number][]) {
    const list = (groups.get(r) ?? []).sort((a, b) => b.ca - a.ca);
    let score = Math.max(0, n - list.length) * 2;
    const best = list[0]?.ca ?? 0;
    const lv = level - roleOffset(r);
    if (best < lv - 10) score += 1.5;
    if (list.length >= 2 && list[1].ca < lv - 18) score += 0.6;
    if (score > 0) out.push({ role: r, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

let roleIndex: Map<Role, number[]> | null = null;
let roleIndexDate = '';

function buildRoleIndex() {
  const g = gs();
  roleIndex = new Map();
  for (const p of Object.values(g.players)) {
    const r = GROUP[naturalRole(p)];
    if (!roleIndex.has(r)) roleIndex.set(r, []);
    roleIndex.get(r)!.push(p.id);
  }
  for (const arr of roleIndex.values()) arr.sort((a, b) => g.players[a].ca - g.players[b].ca);
  roleIndexDate = g.date;
}

/** Niveauet en AI-klub sigter efter: mindst lidt under ligaens nedre kvartil, så nyoprykkere og
 *  svage hold forstærker sig og ligaerne ikke polariseres (ellers 11-pointshold og 150-målsmestre) */
function leagueFloor(club: Club): number {
  const g = gs();
  const peers = g.comps[club.league]?.clubs ?? [];
  if (peers.length < 6) return 0;
  const lv = peers.map((c) => clubLevel(c)).sort((a, b) => a - b);
  return lv[Math.floor(lv.length * 0.25)] - 4;
}

function targetLevel(club: Club): number {
  return Math.max(clubLevel(club.id), leagueFloor(club));
}

/** Klubbens bedste mål til en rolle, sorteret (bruges til køb og til klubbens shortliste) */
export function rankTargets(club: Club, role: Role, watch = false): Player[] {
  const g = gs();
  if (!roleIndex || g.date > addDays(roleIndexDate, 14)) buildRoleIndex();
  const ids = roleIndex!.get(role) ?? [];
  const hasRole = squad(club.id).some((p) => GROUP[naturalRole(p)] === GROUP[role]);
  const level = targetLevel(club) - roleOffset(role);
  const lo = level - (hasRole ? 6 : 25), hi = level + 18;
  const cands: Player[] = [];
  // binær søgning på CA
  let a = 0, b = ids.length;
  while (a < b) { const m = (a + b) >> 1; if ((g.players[ids[m]]?.ca ?? 0) < lo) a = m + 1; else b = m; }
  let end = a, e2 = ids.length;
  while (end < e2) { const m = (end + e2) >> 1; if ((g.players[ids[m]]?.ca ?? 0) <= hi) end = m + 1; else e2 = m; }
  // jævnt udvalg over hele intervallet (ellers ses kun de svageste 60 kandidater)
  const step = Math.max(1, Math.floor((end - a) / (watch ? 400 : 150)));
  for (let i = a; i < end && cands.length < (watch ? 200 : 60); i += step) {
    const p = g.players[ids[i]];
    if (!p) continue;
    if (p.club === club.id || p.loan || p.contract?.futureClub) continue;
    // nyindkøbte spillere videresælges ikke samme sæson (medmindre de er sat til salg)
    if (p.club && p.joined && !p.listed && p.joined > addDays(g.date, -300)) continue;
    const age = ageOn(p.dob, g.date);
    if (age > 31) continue;
    const price = p.club ? askingPrice(p) : 0;
    if (price > club.transferBudget * (watch ? 1.6 : 1.05)) continue;
    if (playerInterest(p, club) !== 'yes') continue;
    cands.push(p);
  }
  if (!cands.length) return [];
  const budget = Math.max(1, club.transferBudget);
  const strat = clubStrategy(club);
  const priceW = strat === 'big' ? 3 : strat === 'seller' ? 10 : 6;
  const score = (p: Player) => {
    const age = ageOn(p.dob, g.date);
    let v = p.ca - level - (p.club ? askingPrice(p) / budget : 0) * priceW + (age <= 24 ? 2 : 0);
    if (strat === 'develop') v += (age <= 21 ? 6 : age >= 27 ? -6 : 0) + (p.pa - p.ca) / 8;
    if (strat === 'seller') v += (age <= 23 ? 4 : age >= 28 ? -5 : 0) + (p.pa - p.ca) / 12;
    if (strat === 'big') v += (p.ca - level) * 0.3;
    return v;
  };
  // shortliste: hvem er bedst i forhold til klubben (prisen betyder mindre, når man bare holder øje)
  // klubber scouter mest i eget land og i de ligaer der følges (aktive nationer)
  const near = (p: Player) => { const pc = g.clubs[p.club]; return !pc ? 0 : (pc.nation === club.nation ? 6 : 0) + (g.comps[pc.league] ? 3 : 0); };
  const watchScore = (p: Player) => p.ca - level + (ageOn(p.dob, g.date) <= 24 ? 3 : 0) - (p.club ? askingPrice(p) / budget : 0) * 2 + near(p);
  cands.sort(watch ? (x, y) => watchScore(y) - watchScore(x) : (x, y) => score(y) - score(x));
  return cands;
}

export function findTarget(club: Club, role: Role): Player | null {
  // spillere klubben allerede har på sin shortliste foretrækkes
  const listed = (club.shortlist ?? []).map((id) => gs().players[id]).filter((p): p is Player => !!p && p.club !== club.id && GROUP[naturalRole(p)] === GROUP[role] && !p.loan && !p.contract?.futureClub && (p.club ? askingPrice(p) : 0) <= club.transferBudget * 1.05);
  if (listed.length && rng.chance(0.7)) return rng.pick(listed);
  const cands = rankTargets(club, role);
  return cands.length ? rng.pick(cands.slice(0, 8)) : null;
}

export function aiTransferTick() {
  const g = gs();
  if (!windowOpen()) return;
  const m = month(g.date);
  const rate = m === 7 || m === 8 ? 1 / 5 : m === 1 ? 1 / 9 : m === 6 ? 1 / 12 : 1 / 60;
  const clubs = Object.values(g.clubs);
  const n = Math.max(1, Math.round(clubs.length * rate));
  for (let i = 0; i < n; i++) {
    const club = rng.pick(clubs);
    if (!club || isHumanClub(club.id)) continue;
    aiClubTurn(club);
  }
}

function aiClubTurn(club: Club) {
  const g = gs();
  const sq = squad(club.id);
  // Økonomisk krise: sæt de dyreste (ikke-nøgle)spillere til salg, og frigiv ældre storlønnede
  if (club.balance < 0) {
    const bill = sq.reduce((s, p) => s + (p.contract?.wage ?? 0), 0);
    const pricey = sq.filter((p) => p.contract && !p.loan && keyPlayerRank(p) > 3).sort((a, b) => (b.contract!.wage) - (a.contract!.wage));
    for (const p of pricey.slice(0, 3)) p.listed = true;
    const old = pricey.find((p) => ageOn(p.dob, g.date) >= 31 && p.contract!.wage > bill / Math.max(10, sq.length) * 1.5);
    if (old && sq.length > 22 && club.balance < -club.wageBudget * 20) {
      const pay = Math.round(old.contract!.wage * 10);
      club.balance -= pay;
      setClub(old, 0);
      old.contract = null;
    }
    club.transferBudget = 0;
    return;
  }
  // Sælg/frigiv overskud
  if (sq.length > 34) {
    const old = sq.filter((p) => p.contract && !p.loan).sort((a, b) => a.ca - b.ca)[0];
    if (old) { setClub(old, 0); old.contract = null; }
    return;
  }
  if (sq.length > 30) {
    const surplus = sq.sort((a, b) => a.ca - b.ca).slice(0, 3);
    for (const p of surplus) p.listed = true;
  }
  const needs = analyzeNeeds(club.id);
  // fuld trup: kun køb hvis en position helt mangler dækning
  if (sq.length >= 33 && !(needs[0]?.score >= 2)) return;
  if (!needs.length) {
    // ingen akutte behov: forsøg at forstærke en tilfældig rolle i ny og næ – oftere hvis holdet er bagud i ligaen
    const behind = clubLevel(club.id) < leagueFloor(club);
    if (!rng.chance(behind ? 0.7 : 0.25)) return;
    needs.push({ role: rng.pick(['CB', 'CM', 'ST', 'W', 'FB'] as Role[]), score: 0.5 });
  }
  const need = needs[0];
  const target = findTarget(club, need.role);
  if (!target) return;
  if (!target.club) {
    // fri agent
    const wage = wageDemand(target, club);
    target.contract = { wage, expires: `${year(g.date) + preferredYears(target)}-06-30` };
    recordMove(target, club.id, 0);
    setClub(target, club.id);
    target.joined = g.date;
    forEachHuman(() => { if (otherTransferNews(club, undefined, 0, false)) (g.transferDigest ??= []).push({ player: target.id, from: 0, to: club.id, fee: 0 }); });
    return;
  }
  const ask = askingPrice(target);
  const fee = Math.max(10_000, roundValue(ask * rng.range(0.85, 1.1)));
  if (isHumanClub(target.club)) {
    // bud til en menneskelig manager
    if (!canBidOnHuman(target, club.id)) return;
    const maxFee = roundValue(Math.min(club.transferBudget, fee * rng.range(1.05, 1.35)));
    const o: TransferOffer = { id: g.nextId.offer++, player: target.id, buyer: club.id, seller: target.club, fee, loan: false, status: 'pending', created: g.date, respondBy: addDays(g.date, 5), maxFee };
    g.offers.push(o);
    noteInterest(o.buyer, o.player);
    asOwner(target.club, () => addNews({ cat: 'transfer', key: 'transfer.incomingBid', params: { club: club.name, player: pname(target), fee }, link: { kind: 'offer', id: o.id } }));
    return;
  }
  const d = sellerDecision(target, fee, club);
  if (d.answer === 'accept' || (d.answer === 'counter' && d.counter! <= club.transferBudget && rng.chance(0.6))) {
    const o: TransferOffer = { id: g.nextId.offer++, player: target.id, buyer: club.id, seller: target.club, fee: d.answer === 'accept' ? fee : d.counter!, loan: false, status: 'negotiating', created: g.date, respondBy: g.date };
    completeTransfer(o, wageDemand(target, club), preferredYears(target));
  }
}

// ---------- jagt, budkrige og købsoptioner ----------

/** En AI-klub der har fået afslag, vender måske tilbage med et højere bud */
function startPursuit(o: TransferOffer) {
  const g = gs();
  const buyer = g.clubs[o.buyer];
  const p = g.players[o.player];
  if (!buyer || !p) return;
  const keen = clubStrategy(buyer) === 'big' ? 0.75 : 0.5;
  if (!rng.chance(keen)) return;
  const max = Math.max(o.maxFee ?? o.fee, o.fee) * rng.range(1.1, 1.35);
  const list = (g.pursuits ??= []).filter((x) => !(x.club === buyer.id && x.player === p.id));
  const prev = g.pursuits.find((x) => x.club === buyer.id && x.player === p.id);
  list.push({ club: buyer.id, player: p.id, lastFee: o.fee, maxFee: roundValue(Math.min(buyer.transferBudget, max)), tries: (prev?.tries ?? 0) + 1, next: addDays(g.date, rng.int(6, 16)) });
  g.pursuits = list.filter((x) => x.tries <= 3);
}

/** Dagligt: klubber der jagter en spiller kommer igen med forhøjet bud */
export function aiPursuits() {
  const g = gs();
  if (!g.pursuits?.length || !windowOpen()) return;
  const keep: typeof g.pursuits = [];
  for (const pu of g.pursuits) {
    const p = g.players[pu.player];
    const club = g.clubs[pu.club];
    if (!p || !club || !p.club || !isHumanClub(p.club)) continue;
    if (g.date < pu.next) { keep.push(pu); continue; }
    if (g.offers.some((o) => o.player === p.id && o.status === 'pending')) { keep.push(pu); continue; }
    const fee = roundValue(Math.min(pu.maxFee, pu.lastFee * rng.range(1.08, 1.2)));
    if (fee <= pu.lastFee) continue;
    const o: TransferOffer = { id: g.nextId.offer++, player: p.id, buyer: club.id, seller: p.club, fee, loan: false, status: 'pending', created: g.date, respondBy: addDays(g.date, 5), maxFee: pu.maxFee };
    g.offers.push(o);
    noteInterest(o.buyer, o.player);
    asOwner(p.club, () => {
      addNews({ cat: 'transfer', key: pu.tries === 0 ? 'transfer.incomingBid' : 'transfer.pursuitReturn', params: { club: club.name, player: pname(p), fee, n: pu.tries + 1 }, link: { kind: 'offer', id: o.id } });
      // en ambitiøs spiller bliver urolig, når en større klub bliver ved med at banke på
      const own = g.clubs[p.club];
      if (pu.tries >= 2 && own && club.rep >= own.rep + 8 && p.attrs[42] >= 14 && !p.wantsAway) {
        p.wantsAway = true;
        p.morale = Math.max(1, p.morale - 2);
        addNews({ cat: 'general', key: 'will.unsettled', params: { player: pname(p), club: club.name }, link: { kind: 'player', id: p.id } });
      }
    });
  }
  g.pursuits = keep;
}

/** Budkrig: når brugeren byder på en attraktiv spiller, kan en anden klub melde sig */
function rivalBid(o: TransferOffer, p: Player): TransferOffer['rival'] {
  const g = gs();
  if (o.rival !== undefined || p.value < 1_500_000 || !rng.chance(0.25)) return o.rival;
  const ask = askingPrice(p);
  const level = (c: Club) => clubLevel(c.id);
  const cands = Object.values(g.clubs).filter((c) => c.id !== o.buyer && c.id !== p.club && !isHumanClub(c.id) && c.transferBudget >= ask && Math.abs(level(c) - p.ca) <= 20 && playerInterest(p, c) === 'yes');
  if (!cands.length) return undefined;
  const club = rng.pick(cands);
  return { club: club.id, fee: roundValue(Math.min(club.transferBudget, Math.max(o.fee, ask) * rng.range(1.02, 1.15))) };
}

/** Leje med købsoption: AI-klubber vil låne brugerens unge/ubrugte spillere med mulighed for at købe */
export function aiLoanOptions() {
  const g = gs();
  if (!g.userClub || !windowOpen()) return;
  // højst ét åbent lejetilbud ad gangen (ellers fylder de indbakken)
  if (g.offers.some((o) => o.seller === g.userClub && o.loan && o.option && o.status === 'pending')) return;
  for (const p of squad(g.userClub)) {
    if (p.loan || p.listed || p.contract?.futureClub || keyPlayerRank(p) <= 14) continue;
    if (ageOn(p.dob, g.date) > 23 || !rng.chance(0.015)) continue;
    if (g.offers.some((o) => o.player === p.id && o.status === 'pending')) continue;
    const cands = Object.values(g.clubs).filter((c) => !isHumanClub(c.id) && c.id !== g.userClub && Math.abs(clubLevel(c.id) - p.ca) <= 12 && c.transferBudget >= p.value);
    if (!cands.length) continue;
    const club = rng.pick(cands);
    const option = roundValue(Math.max(p.value * rng.range(1.0, 1.3), 50_000));
    const o: TransferOffer = { id: g.nextId.offer++, player: p.id, buyer: club.id, seller: g.userClub, fee: 0, loan: true, option, status: 'pending', created: g.date, respondBy: addDays(g.date, 6) };
    g.offers.push(o);
    addNews({ cat: 'transfer', key: 'transfer.loanOptionBid', params: { club: club.name, player: pname(p), fee: option }, link: { kind: 'offer', id: o.id } });
    return;
  }
}

/** Sommer: lejeklubben aktiverer købsoptionen, hvis spilleren har gjort det godt */
export function exerciseLoanOption(p: Player): boolean {
  const g = gs();
  const loan = p.loan;
  if (!loan?.option) return false;
  const buyer = g.clubs[p.club];
  const seller = g.clubs[loan.from];
  if (!buyer || !seller) return false;
  // sæsonens statistik er arkiveret i historikken, når lejen udløber 1. juli
  const last = p.history.find((h) => h.season === g.season && h.club === p.club);
  const rating = last?.avg ?? 0;
  const played = last?.apps ?? 0;
  if (played < 10 || rating < 6.6 || buyer.transferBudget < loan.option * 0.8) return false;
  buyer.balance -= loan.option;
  buyer.transferBudget = Math.max(0, buyer.transferBudget - loan.option);
  buyer.finance.transfersOut += loan.option;
  seller.balance += loan.option;
  seller.finance.transfersIn += loan.option;
  p.loan = null;
  p.contract = { wage: wageDemand(p, buyer), expires: `${year(g.date) + preferredYears(p)}-06-30` };
  p.joined = g.date;
  asOwner(seller.id, () => addNews({ cat: 'transfer', key: 'transfer.optionExercised', params: { club: buyer.name, player: pname(p), fee: loan.option! }, link: { kind: 'player', id: p.id } }));
  return true;
}

/** AI fornyer kontrakter for spillere den vil beholde (januar-maj) */
export function aiRenewals() {
  const g = gs();
  const seasonEnd = `${year(g.date)}-06-30`;
  // hvor mange spillere har hver klub efter sommeren, hvis ingen fornyes?
  const staying = new Map<number, number>();
  for (const p of Object.values(g.players)) {
    if (!p.club || p.loan) continue;
    if (!p.contract || p.contract.expires > seasonEnd) staying.set(p.club, (staying.get(p.club) ?? 0) + 1);
  }
  const expiring = Object.values(g.players)
    .filter((p) => p.club && !isHumanClub(p.club) && p.contract && !p.loan && p.contract.expires <= seasonEnd && !p.contract.futureClub)
    .sort((a, b) => b.ca - a.ca);
  for (const p of expiring) {
    if (!rng.chance(0.35)) continue;
    const level = clubLevel(p.club);
    const age = ageOn(p.dob, g.date);
    const left = staying.get(p.club) ?? 0;
    const lv = level - roleOffset(naturalRole(p));
    const wanted = (depthRank(p) < (REQUIRED[naturalRole(p)] ?? 2) && age <= 34) || (p.ca >= lv - 15 && age <= 32) || (p.ca >= lv - 3 && age <= 38) || (age <= 23 && p.pa >= lv - 5) || (left < 22 && age <= 34 && p.ca >= lv - 30);
    if (!wanted) continue;
    const club = g.clubs[p.club];
    const rel = defaultRelease(p, club);
    p.contract = { wage: wageDemand(p, club), expires: `${year(g.date) + (age >= 33 ? 1 : preferredYears(p))}-06-30`, ...(rel ? { release: rel } : {}) };
    staying.set(p.club, left + 1);
  }
}

/**
 * Sommer/januar: AI-klubber med for små trupper henter klubløse spillere (eller rykker
 * ungdomsspillere op), så ingen klub står med for få spillere.
 */
export function aiFillSquads(minSize = 22) {
  const g = gs();
  const free = Object.values(g.players).filter((p) => !p.club && p.ca >= 30).sort((a, b) => b.ca - a.ca);
  const taken = new Set<number>();
  for (const c of Object.values(g.clubs)) {
    if (isHumanClub(c.id)) continue;
    // mindst to målmænd – ellers står en markspiller i mål
    const gks = squad(c.id).filter((p) => naturalRole(p) === 'GK').length;
    for (let i = gks; i < 2; i++) {
      const lv = clubLevel(c.id) - GK_OFFSET;
      const gk = free.find((p) => !taken.has(p.id) && naturalRole(p) === 'GK' && p.ca <= lv + 15 && p.ca >= lv - 50 && playerInterest(p, c) === 'yes');
      if (!gk) break;
      taken.add(gk.id);
      gk.contract = { wage: Math.round(wageDemand(gk, c) * 0.85 / 50) * 50, expires: `${year(g.date) + Math.max(1, preferredYears(gk) - 1)}-06-30` };
      setClub(gk, c.id);
      gk.joined = g.date;
    }
    let size = squad(c.id).length;
    if (size >= minSize) continue;
    const level = clubLevel(c.id);
    const needs = analyzeNeeds(c.id).map((n) => n.role);
    while (size < minSize) {
      // bedste ledige spiller der passer niveauet og vil komme – helst i en position klubben mangler
      const cand = free.find((p) => !taken.has(p.id) && p.ca <= level + 15 && p.ca >= level - 35 && playerInterest(p, c) === 'yes' && (needs.length === 0 || needs.includes(GROUP[naturalRole(p)])))
        ?? free.find((p) => !taken.has(p.id) && p.ca <= level + 15 && p.ca >= level - 45 && playerInterest(p, c) === 'yes');
      if (!cand) break;
      taken.add(cand.id);
      cand.contract = { wage: Math.round(wageDemand(cand, c) * 0.85 / 50) * 50, expires: `${year(g.date) + Math.max(1, preferredYears(cand) - 1)}-06-30` };
      setClub(cand, c.id);
      cand.joined = g.date;
      size++;
    }
  }
}

/** Brugerens spillere: påmindelser om udløbende kontrakter */
export function contractReminders() {
  const g = gs();
  const seasonEnd = `${year(g.date) + (month(g.date) >= 7 ? 1 : 0)}-06-30`;
  for (const p of squad(g.userClub)) {
    if (p.contract && p.contract.expires <= seasonEnd && !p.loan) {
      addNews({ cat: 'contract', key: p.contract.futureClub ? 'contract.leavingBosman' : 'contract.expiring', params: { player: pname(p), club: p.contract.futureClub ? g.clubs[p.contract.futureClub]?.name ?? '' : '' }, link: { kind: 'player', id: p.id } });
    }
  }
}

/** AI-klubber laver pre-contracts med brugerens spillere (Bosman) */
export function aiBosman() {
  const g = gs();
  for (const p of squad(g.userClub)) {
    if (!canPreContractAny(p) || p.contract!.futureClub) continue;
    // spillere, der har sagt nej til at forlænge, er meget mere åbne over for andre klubber
    if (!rng.chance(p.renewal && !p.renewal.convinced ? (p.renewal.stance === 'refuses' ? 0.1 : 0.05) : 0.02)) continue;
    const suitors = Object.values(g.clubs).filter((c) => !isHumanClub(c.id) && c.rep >= p.rep - 15 && c.rep <= p.rep + 25);
    const c = rng.pick(suitors);
    if (!c) continue;
    // fansene hører det med det samme: han forlader klubben gratis til sommer
    fansOnDeparture(p, g.clubs[g.userClub], 'free');
    p.contract!.futureClub = c.id;
    p.contract!.futureWage = wageDemand(p, c);
    p.contract!.futureExpires = `${year(g.date) + preferredYears(p)}-06-30`;
    addNews({ cat: 'contract', key: 'contract.leavingBosman', params: { player: pname(p), club: c.name }, link: { kind: 'player', id: p.id } });
  }
}

function canPreContractAny(p: Player) {
  const g = gs();
  if (!p.contract) return false;
  const m = month(g.date);
  return p.contract.expires <= `${year(g.date)}-06-30` && m >= 1 && m <= 5;
}

export interface LoanSuitor {
  club: number;
  maxShare: number; // højeste andel af lønnen klubben vil betale (0-1)
  maxFee: number; // højeste lejegebyr
}

/** Hvilke klubber vil leje spilleren – og på hvilke vilkår? */
export function loanSuitors(pid: number): LoanSuitor[] {
  const g = gs();
  const p = g.players[pid];
  const me = g.clubs[p?.club ?? 0];
  if (!p || !me || !p.contract) return [];
  const wage = Math.max(1, p.contract.wage);
  const role = naturalRole(p);
  const out: LoanSuitor[] = [];
  for (const c of Object.values(g.clubs)) {
    if (c.id === me.id || isHumanClub(c.id)) continue;
    const level = clubLevel(c.id);
    // spilleren skal kunne spille på holdet, og klubben må ikke være meget større
    if (p.ca < level - 8 || p.ca > level + 35 || c.rep > me.rep + 10) continue;
    if (playerInterest(p, c) !== 'yes') continue;
    if (squad(c.id).length >= 32) continue;
    const need = analyzeNeeds(c.id).some((n) => GROUP[role] === n.role) ? 0.15 : 0;
    // forholdet mellem spillerens løn og klubbens gennemsnitsløn
    const avgWage = c.wageBudget / Math.max(18, squad(c.id).length);
    const ratio = Math.min(1.4, avgWage / wage);
    const quality = Math.max(-0.2, Math.min(0.2, (p.ca - level) / 80));
    const mood = (hash01(c.id, p.id, 5) - 0.5) * 0.3; // hver klub vurderer lidt forskelligt
    const maxShare = Math.max(0, Math.min(1, 0.05 + ratio * 0.5 + need + quality + mood));
    if (maxShare < 0.1) continue;
    const feeRoom = Math.min(c.transferBudget * 0.1, p.value * 0.1) * (0.3 + hash01(c.id, p.id, 6) * 0.7);
    const maxFee = maxShare >= 0.6 ? roundValue(feeRoom * (maxShare - 0.5) * 2) : 0;
    out.push({ club: c.id, maxShare: Math.round(maxShare * 100) / 100, maxFee });
  }
  return out.sort((a, b) => b.maxShare - a.maxShare || g.clubs[b.club].rep - g.clubs[a.club].rep).slice(0, 25);
}

/** Udlej til en bestemt klub: share = andel af lønnen lejeklubben betaler, fee = lejegebyr */
export function loanOut(pid: number, club: number, share: number, fee: number): string {
  const g = gs();
  const p = g.players[pid];
  if (!p || p.club !== g.userClub || p.loan) return 'error';
  if (!windowOpen()) return 'transfer.windowClosed';
  const s = loanSuitors(pid).find((x) => x.club === club);
  if (!s) return 'transfer.noLoanClub';
  if (share > s.maxShare + 1e-6 || fee > s.maxFee) return 'transfer.loanTermsRejected';
  const me = g.clubs[g.userClub];
  const o: TransferOffer = { id: g.nextId.offer++, player: pid, buyer: club, seller: me.id, fee: 0, loan: true, status: 'negotiating', created: g.date, respondBy: g.date };
  g.offers.push(o);
  completeTransfer(o, p.contract?.wage ?? 0, 0);
  p.loan = { from: me.id, until: `${year(g.date) + (month(g.date) >= 7 ? 1 : 0)}-06-30`, share, fee };
  if (fee > 0) {
    const borrower = g.clubs[club];
    borrower.balance -= fee;
    borrower.finance.transfersOut += fee;
    me.balance += fee;
    me.finance.transfersIn += fee;
  }
  return 'ok';
}

/** AI-klubber byder på brugerens transferlistede spillere */
export function aiBidsForListed() {
  const g = gs();
  if (!g.userClub || !windowOpen()) return;
  const m = month(g.date);
  const chance = m === 7 || m === 8 || m === 1 ? 0.2 : 0.1;
  for (const p of squad(g.userClub)) {
    if (!p.listed || p.loan || p.contract?.futureClub) continue;
    if (g.offers.some((o) => o.player === p.id && o.status === 'pending')) continue;
    if (g.offers.filter((o) => o.seller === g.userClub && o.status === 'pending' && !isHumanClub(o.buyer)).length >= 3) break;
    const ask = askingPrice(p);
    // lav udbudspris i forhold til værdien gør spilleren ekstra attraktiv
    const attract = Math.max(0.25, Math.min(3, Math.pow(p.value / Math.max(1, ask), 1.6)));
    if (!rng.chance(Math.min(0.75, chance * attract))) continue;
    const role = GROUP[naturalRole(p)];
    const cands = Object.values(g.clubs).filter((c) => {
      if (c.id === g.userClub || isHumanClub(c.id)) return false;
      const level = clubLevel(c.id);
      if (p.ca < level - 15 || p.ca > level + 25) return false;
      if (c.transferBudget < ask * 0.55) return false;
      return playerInterest(p, c) === 'yes' && squad(c.id).length < 32;
    });
    if (!cands.length) continue;
    const club = rng.weighted(cands, (c) => (analyzeNeeds(c.id).some((n) => n.role === role) ? 3 : 1) * (1 + c.rep / 50))!;
    const cheap = ask < p.value * 0.9;
    const fee = Math.max(10_000, roundValue(Math.min(club.transferBudget, ask) * (cheap ? rng.range(0.92, 1.02) : rng.range(0.72, 0.98))));
    const maxFee = roundValue(Math.min(club.transferBudget, Math.max(fee, ask * rng.range(0.95, 1.12), p.value * rng.range(0.9, 1.2))));
    const o: TransferOffer = { id: g.nextId.offer++, player: p.id, buyer: club.id, seller: g.userClub, fee, loan: false, status: 'pending', created: g.date, respondBy: addDays(g.date, 5), maxFee };
    g.offers.push(o);
    noteInterest(o.buyer, o.player);
    addNews({ cat: 'transfer', key: 'transfer.incomingBid', params: { club: club.name, player: pname(p), fee }, link: { kind: 'offer', id: o.id } });
  }
}

registerAskingPrice(askingPrice, playerInterest, (p) => transferRealism(p).level);

// ---------- frikøbsklausuler hos menneskestyrede klubber ----------

/**
 * Ugentligt i transfervinduet: AI-klubber aktiverer billige frikøbsklausuler hos menneskestyrede klubber.
 * Spilleren bestemmer selv, om han vil skifte.
 */
export function aiReleaseClauses() {
  const g = gs();
  if (!windowOpen()) return;
  const clubs = Object.values(g.clubs).filter((c) => !isHumanClub(c.id) && c.balance > 0);
  for (const p of Object.values(g.players)) {
    const rel = p.contract?.release;
    if (!rel || !p.club || !isHumanClub(p.club) || p.loan || p.contract?.futureClub) continue;
    const cur = g.clubs[p.club];
    // jo billigere klausulen er i forhold til værdien, jo mere fristende
    const bargain = p.value / rel;
    const chance = bargain >= 1.5 ? 0.35 : bargain >= 1 ? 0.18 : bargain >= 0.7 ? 0.06 : 0.015;
    if (!rng.chance(chance)) continue;
    const buyers = clubs.filter((c) => c.transferBudget >= rel && c.rep >= cur.rep - 5 && p.ca >= clubLevel(c.id) - 8 && playerInterest(p, c) === 'yes');
    if (!buyers.length) continue;
    const buyer = buyers.sort((a, b) => b.rep - a.rep)[Math.min(buyers.length - 1, rng.int(0, 2))];
    // spilleren vælger: større klub eller utilfreds → ja
    const keen = p.wantsAway || buyer.rep > cur.rep + 3 || (p.unhappy ?? 0) > 40 || (buyer.rep >= cur.rep - 5 && p.morale < 10);
    if (!keen) {
      asOwner(cur.id, () => addNews({ cat: 'transfer', key: 'clause.releaseDeclined', params: { player: pname(p), club: buyer.name, fee: rel }, link: { kind: 'player', id: p.id } }));
      continue;
    }
    const o: TransferOffer = { id: g.nextId.offer++, player: p.id, buyer: buyer.id, seller: cur.id, fee: rel, loan: false, status: 'negotiating', created: g.date, respondBy: g.date };
    g.offers.push(o);
    asOwner(cur.id, () => addNews({ cat: 'transfer', key: 'clause.releaseTriggered', params: { player: pname(p), club: buyer.name, fee: rel }, link: { kind: 'player', id: p.id } }));
    completeTransfer(o, wageDemand(p, buyer), preferredYears(p));
  }
}

/** Mandag: ugens handler mellem andre klubber som én samlet nyhed (kun den aktive manager) */
export function weeklyTransferDigest() {
  const g = gs();
  const deals = g.transferDigest ?? [];
  g.transferDigest = [];
  if (!deals.length) return;
  deals.sort((a, b) => b.fee - a.fee);
  const top = deals[0];
  addNews({
    cat: 'transfer', key: deals.length === 1 ? 'transfer.digestOne' : 'transfer.digest',
    params: { n: deals.length, player: pname(g.players[top.player] ?? ({ first: '?', last: '' } as Player)), to: g.clubs[top.to]?.name ?? '', fee: top.fee },
    deals: deals.slice(0, 25),
  });
}

// ---------- lukkede budrunder mellem managere ----------

const AUCTION_DAYS = 3;

/** Et nyt bud møder et andet managers ventende bud på samme spiller: begge får besked og samme frist */
function startAuction(o: TransferOffer, p: Player) {
  const g = gs();
  const rivals = g.offers.filter((x) => x !== o && x.player === p.id && x.status === 'pending' && !x.loan && x.buyer !== o.buyer && isHumanClub(x.buyer));
  if (!rivals.length) return;
  const all = [o, ...rivals];
  const deadline = all.reduce((d, x) => (x.respondBy > d ? x.respondBy : d), addDays(g.date, AUCTION_DAYS));
  const newWar = rivals.every((x) => !x.auction);
  for (const x of all) {
    const fresh = !x.auction;
    x.auction = true;
    x.respondBy = deadline;
    if (fresh || x === o) asOwner(x.buyer, () => addNews({ cat: 'transfer', key: 'war.started', params: { player: pname(p), n: all.length, date: deadline, oid: x.id }, link: { kind: 'offer', id: x.id } }));
  }
  if (newWar) warHeadline(p, all.map((x) => x.buyer));
}

/** Pressen dækker budkrigen – alle managere ser overskriften */
function warHeadline(p: Player, clubs: number[]) {
  const g = gs();
  const [a, b] = clubs.map((c) => g.clubs[c]?.name ?? '');
  addNews({ cat: 'general', key: 'war.headline', params: { player: pname(p), a, b: b ?? '', n: clubs.length }, link: { kind: 'player', id: p.id } }, { all: true });
}

/** Afsløringen: alle deltagere ser begge bud – og alle managere får resultatet som overskrift */
function warReveal(p: Player, sorted: TransferOffer[], wage: boolean) {
  const g = gs();
  const [win, second] = sorted;
  const amount = (o: TransferOffer) => (wage ? o.signing?.wage ?? 0 : o.fee);
  const params = { player: pname(p), a: g.clubs[win.buyer]?.name ?? '', b: g.clubs[second.buyer]?.name ?? '', n: sorted.length, ...(wage ? { wage: amount(win), wage2: amount(second) } : { fee: amount(win), bid2: amount(second) }) };
  for (const o of sorted) asOwner(o.buyer, () => addNews({ cat: 'transfer', key: o === win ? (wage ? 'war.revealWonWage' : 'war.revealWon') : (wage ? 'war.revealLostWage' : 'war.revealLost'), params, link: { kind: 'player', id: p.id } }));
  addNews({ cat: 'general', key: 'war.result', params, link: { kind: 'player', id: p.id } }, { all: true });
}

/** Budkrig: hæv dit bud én gang – blindt, før fristen */
export function raiseBid(offerId: number, amount: number): string {
  const g = gs();
  const o = g.offers.find((x) => x.id === offerId);
  if (!o || o.buyer !== g.userClub || o.status !== 'pending' || !(o.auction || o.war) || o.raised) return 'error';
  const club = g.clubs[o.buyer];
  if (o.signing) {
    const w = Math.round(amount / 50) * 50;
    if (w <= o.signing.wage) return 'low';
    if (currentBill(club.id) + w > club.wageBudget) return 'budget';
    o.signing.wage = w;
  } else {
    const fee = roundValue(amount);
    if (fee <= o.fee) return 'low';
    if (fee > club.transferBudget) return 'transfer.overBudget';
    o.fee = fee;
  }
  o.raised = true;
  return 'ok';
}

/** Dagligt (før buddene behandles): afgør budrunder, hvor fristen er nået – højeste bud går videre */
export function resolveAuctions() {
  const g = gs();
  const byPlayer = new Map<number, TransferOffer[]>();
  for (const o of g.offers) if (o.auction && o.status === 'pending') byPlayer.set(o.player, [...(byPlayer.get(o.player) ?? []), o]);
  for (const [pid, list] of byPlayer) {
    if (!list.some((o) => g.date >= o.respondBy)) continue;
    const p = g.players[pid];
    if (!p) continue;
    if (list.length < 2) { list[0].auction = false; continue; }
    // transfersum + klausulernes værdi for sælger; ved lige bud vinder det først afgivne
    const value = (o: TransferOffer) => o.fee + bidClauseWorth(p, o.fee, o.sellOn, o.addOn);
    const sorted = list.slice().sort((a, b) => value(b) - value(a) || a.created.localeCompare(b.created) || a.id - b.id);
    const [win, ...lose] = sorted;
    win.respondBy = g.date;
    warReveal(p, sorted, false);
    asOwner(win.buyer, () => addNews({ cat: 'transfer', key: 'auction.won', params: { player: pname(p), n: list.length, club: sellerName(p.club) }, link: { kind: 'offer', id: win.id } }));
    for (const o of lose) {
      o.status = 'rejected';
      o.outbid = true;
      // taberen får besked via afsløringen (warReveal)
    }
  }
}

// ---------- klubbernes shortlister (interesse i spillere) ----------

const SHORTLIST_MAX = 8;

/** Den 1. i måneden: AI-klubber (og AI-managere) opdaterer deres shortliste ud fra behov og budget */
export function refreshShortlists() {
  const g = gs();
  for (const club of Object.values(g.clubs)) {
    if (!g.comps[club.league]) continue; // kun ligaer der spilles
    if (club.manager === -1 && !isBotClubId(club.id)) continue; // menneskers shortliste er deres egen
    const needs = analyzeNeeds(club.id);
    // de største behov + en rolle der skifter fra måned til måned (klubber scouter bredt)
    const extra = (['CB', 'CM', 'ST', 'W', 'FB', 'DM', 'AM', 'GK'] as Role[])[(club.id + month(g.date)) % 8];
    const roles = [...new Set([...needs.slice(0, 2).map((n) => n.role), extra])];
    const keep = (club.shortlist ?? []).filter((id) => { const p = g.players[id]; return p && p.club !== club.id && !p.contract?.futureClub; }).slice(0, 2);
    const picks = new Set(keep);
    // et tilfældigt udvalg blandt de 15 bedste mål – ellers ender alle klubber på de samme få spillere
    for (const role of roles) {
      const pool = rankTargets(club, role, true).slice(0, 25);
      for (let k = 0; k < 2 && pool.length && picks.size < SHORTLIST_MAX; k++) picks.add(pool.splice(rng.int(0, pool.length - 1), 1)[0].id);
    }
    // klubber der jagter en spiller efter et afslag har ham også på listen
    for (const x of g.pursuits ?? []) if (x.club === club.id && picks.size < SHORTLIST_MAX) picks.add(x.player);
    club.shortlist = [...picks];
  }
  noticeStandouts();
}

/**
 * Profilerne bliver bemærket: hver klubs bedste spillere og spillere i topform får interesse fra
 * 1-2 større klubber, der har råd og hvor spilleren passer ind (ellers ser alle kun på de samme få).
 */
function noticeStandouts() {
  const g = gs();
  const suitors = Object.values(g.clubs).filter((c) => g.comps[c.league] && (c.manager !== -1 || isBotClubId(c.id)));
  const levels = new Map(suitors.map((c) => [c.id, clubLevel(c.id)]));
  // tilfældig rækkefølge – ellers fylder de første klubbers spillere de store klubbers lister op
  const clubs = Object.values(g.clubs).filter((c) => g.comps[c.league]);
  for (let i = clubs.length - 1; i > 0; i--) { const j = rng.int(0, i); [clubs[i], clubs[j]] = [clubs[j], clubs[i]]; }
  for (const club of clubs) {
    const sq = squad(club.id).filter((p) => !p.loan && !p.contract?.futureClub && ageOn(p.dob, g.date) <= 31);
    const form = (p: Player) => (p.form.length >= 3 ? p.form.reduce((x, y) => x + y, 0) / p.form.length : 0);
    // de tre bedste + spillere i helt usædvanlig form – højst fire pr. klub
    const stars = [...new Set([...sq.sort((x, y) => y.ca - x.ca).slice(0, 3), ...sq.filter((p) => form(p) >= 7.6)])].slice(0, 4);
    for (const p of stars) {
      const price = askingPrice(p);
      // større klubber – og for de største klubber også jævnbyrdige rivaler
      const fits = suitors.filter((c) => c.id !== club.id && c.rep >= Math.min(club.rep + 5, Math.max(club.rep - 3, 75)) && c.transferBudget * 1.6 >= price
        && Math.abs((levels.get(c.id) ?? 0) - p.ca) <= 12 && (c.shortlist?.length ?? 0) < SHORTLIST_MAX + 8 && playerInterest(p, c) === 'yes');
      const n = Math.min(fits.length, rng.int(1, 3));
      for (let k = 0; k < n; k++) {
        const c = fits.splice(rng.int(0, fits.length - 1), 1)[0];
        if (!c.shortlist?.includes(p.id)) (c.shortlist ??= []).push(p.id);
      }
    }
  }
}

function isBotClubId(clubId: number): boolean {
  const g = gs();
  if (!g.humans) return false;
  if (g.userClub === clubId) return !!g.humans.find((h) => h.pid === g.active)?.bot;
  return !!g.humans.find((h) => h.pid !== g.active && h.userClub === clubId)?.bot;
}

export interface Interest { club: number; human?: string; bot?: boolean }

/** Hvilke klubber er interesserede i spilleren? (AI-klubbers shortlister + menneskers egne shortlister) */
export function interestedClubs(p: Player): Interest[] {
  const g = gs();
  const out: Interest[] = [];
  for (const c of Object.values(g.clubs)) {
    if (c.id === p.club) continue;
    if (c.shortlist?.includes(p.id)) out.push({ club: c.id, ...(isBotClubId(c.id) ? { bot: true } : {}) });
  }
  // menneskelige managere: deres egen shortliste (den aktive vises særskilt i UI'et)
  for (const h of g.humans ?? []) {
    if (h.bot || h.pid === g.active || !h.userClub || h.userClub === p.club) continue;
    if (h.shortlist.includes(p.id)) out.push({ club: h.userClub, human: h.name });
  }
  return out.sort((a, b) => (g.clubs[b.club]?.rep ?? 0) - (g.clubs[a.club]?.rep ?? 0));
}

// ---------- beskeder om transfervinduet ----------

/** Sidste dag i det vindue, der er åbent på datoen (eller null hvis lukket) */
export function windowLastDay(date = gs().date): string | null {
  if (!windowOpen(date)) return null;
  let d = date;
  for (let i = 0; i < 400 && windowOpen(addDays(d, 1)); i++) d = addDays(d, 1);
  return d;
}

/**
 * Dagligt: tydelige beskeder når vinduet åbner, en uge og 3/2/1 dage før det lukker, på deadline day
 * og når det er lukket – plus 1. januar, når Bosman-aftaler bliver mulige.
 */
export function windowNews() {
  const g = gs();
  const today = g.date, yesterday = addDays(today, -1);
  const open = windowOpen(today), wasOpen = windowOpen(yesterday);
  if (open && !wasOpen) {
    addNews({ cat: 'transfer', key: 'window.opened', params: { date: windowLastDay(today) ?? today } });
  } else if (!open && wasOpen) {
    addNews({ cat: 'transfer', key: 'window.closed', params: { date: nextWindow(today) } });
  }
  if (open) {
    const last = windowLastDay(today)!;
    const left = Math.round((Date.parse(last) - Date.parse(today)) / 86_400_000);
    if (left === 0) addNews({ cat: 'transfer', key: 'window.deadlineDay', params: {} });
    else if ([7, 3, 2, 1].includes(left)) addNews({ cat: 'transfer', key: left === 1 ? 'window.closingTomorrow' : 'window.closing', params: { n: left, date: last } });
  }
  if (today.slice(5) === '01-01') addNews({ cat: 'transfer', key: 'window.bosman', params: { season: Number(today.slice(0, 4)) } });
}

/** Live-forhandling i budvinduet: AI-klubben svarer med det samme (ikke ved menneskelige sælgere eller budrunder) */
export function bidNow(offerId: number): TransferOffer['status'] | 'error' {
  const g = gs();
  const o = g.offers.find((x) => x.id === offerId);
  if (!o || o.buyer !== g.userClub || o.status !== 'pending' || isHumanClub(o.seller) || o.auction || o.war) return 'error';
  aiAnswerBid(o);
  return o.status;
}

/** Højst så mange bud i samme forhandling, før klubben afbryder */
export const MAX_BID_ROUNDS = 4;

/** Byd igen efter et modbud eller et nej (samme forhandling – klubben svarer med det samme) */
export function rebid(offerId: number, fee: number, clauses?: { sellOn?: number; addOn?: number }): TransferOffer['status'] | string {
  const g = gs();
  const o = g.offers.find((x) => x.id === offerId);
  if (!o || o.buyer !== g.userClub || !['countered', 'rejected'].includes(o.status) || isHumanClub(o.seller)) return 'error';
  if (o.nfs) return 'transfer.notForSale';
  const buyer = g.clubs[o.buyer];
  const amount = roundValue(fee);
  if (amount > buyer.transferBudget) return 'transfer.overBudget';
  o.bidRounds = (o.bidRounds ?? 1) + 1;
  if (o.bidRounds > MAX_BID_ROUNDS) {
    o.status = 'rejected';
    o.nfs = true;
    const p = g.players[o.player];
    addNews({ cat: 'transfer', key: 'transfer.talksOver', params: { player: p ? pname(p) : '', club: sellerName(o.seller) }, link: { kind: 'player', id: o.player } });
    return 'transfer.talksOver';
  }
  o.fee = amount;
  if (clauses) { o.sellOn = clauses.sellOn || undefined; o.addOn = clauses.addOn || undefined; }
  o.counter = undefined;
  o.status = 'pending';
  aiAnswerBid(o);
  return o.status;
}

/**
 * Tre måder at møde et modbud på: alt kontant, mindre kontant + bonus efter 25 kampe, eller mindre kontant + videresalg.
 * Hver pakke er beregnet, så sælgeren vurderer den til mindst deres krav.
 */
export function counterPackages(o: TransferOffer): { kind: 'cash' | 'addOn' | 'sellOn'; fee: number; addOn?: number; sellOn?: number; worth: number; maxCost: number }[] {
  const g = gs();
  const p = g.players[o.player];
  const target = o.counter ?? o.fee;
  if (!p) return [];
  const out: ReturnType<typeof counterPackages> = [{ kind: 'cash', fee: target, worth: target, maxCost: target }];
  const feeA = roundValue(target * 0.85);
  for (let addOn = roundValue((target - feeA) * 1.4); addOn <= target; addOn = roundValue(addOn * 1.15)) {
    const worth = feeA + bidClauseWorth(p, feeA, 0, addOn);
    if (worth >= target) { out.push({ kind: 'addOn', fee: feeA, addOn, worth, maxCost: feeA + addOn }); break; }
  }
  const feeS = roundValue(target * 0.88);
  for (const sellOn of [10, 15, 20, 25, 30, 35]) {
    const worth = feeS + bidClauseWorth(p, feeS, sellOn, 0);
    if (worth >= target) { out.push({ kind: 'sellOn', fee: feeS, sellOn, worth, maxCost: feeS }); break; }
  }
  return out;
}
