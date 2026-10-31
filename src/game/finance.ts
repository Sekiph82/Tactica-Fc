// Økonomi: løn, billetindtægter, TV-penge, sponsorer og præmiepenge.
import { finalOrder } from './competitions';
import { rulesFor } from './leagues';
import { gs, squad } from './state';
import { rng } from './rng';
import type { Club, Fixture } from './types';

export function weeklyWages() {
  const g = gs();
  const staffWages = new Map<number, number>();
  for (const s of Object.values(g.staff)) if (s.club) staffWages.set(s.club, (staffWages.get(s.club) ?? 0) + s.wage);
  // Lejede spillere: lejeklubben betaler sin andel, moderklubben resten
  const parentPays = new Map<number, number>();
  for (const c of Object.values(g.clubs)) {
    let w = staffWages.get(c.id) ?? 0;
    for (const p of squad(c.id)) {
      const wage = p.contract?.wage ?? 0;
      if (p.loan) {
        const share = p.loan.share ?? 1;
        w += wage * share;
        parentPays.set(p.loan.from, (parentPays.get(p.loan.from) ?? 0) + wage * (1 - share));
      } else w += wage;
    }
    c.balance -= w;
    c.finance.wages += w;
  }
  for (const [cid, w] of parentPays) {
    const c = g.clubs[cid];
    if (!c || !w) continue;
    c.balance -= w;
    c.finance.wages += w;
  }
}

export function currentWageBill(clubId: number): number {
  const g = gs();
  let bill = squad(clubId).reduce((s, p) => s + (p.contract?.wage ?? 0) * (p.loan ? p.loan.share ?? 1 : 1), 0);
  // udlejede spillere hvor vi stadig betaler en del
  for (const p of Object.values(g.players)) if (p.loan?.from === clubId) bill += (p.contract?.wage ?? 0) * (1 - (p.loan.share ?? 1));
  return bill;
}

/** Tilskuere og billetindtægt for en hjemmekamp */
export function gateReceipts(f: Fixture): { att: number; income: number } {
  const g = gs();
  const home = g.clubs[f.home];
  const away = g.clubs[f.away];
  if (!home || !away) return { att: 0, income: 0 };
  const comp = g.comps[f.comp];
  const big = comp?.type === 'continental' ? 1.3 : comp?.type === 'cup' && f.stage === 'F' ? 1.5 : 1;
  const row = comp?.table.find((r) => r.club === home.id);
  const formBoost = row ? (row.form.split('W').length - 1) * 0.02 : 0;
  const demand = Math.min(1, ticketDemand(home, home.ticketPrice, away.rep, formBoost, big) * fanAttendance(home));
  const att = Math.round(home.seats * demand * (0.95 + rng.next() * 0.05));
  const income = att * home.ticketPrice * (comp?.type === 'continental' ? 1.5 : 1);
  home.balance += income;
  home.finance.gate += income;
  if (comp?.type === 'cup' || f.stage === 'F') {
    // pokalkampe deles
    const half = income * 0.45;
    away.balance += half;
    away.finance.gate += half;
    home.balance -= half;
    home.finance.gate -= half;
    return { att, income: income - half };
  }
  return { att, income };
}

/** En måneds faste indtægter og driftsudgifter for en klub (bruges af monthlyIncome og prognosen) */
export function monthlyFigures(c: Club) {
  const g = gs();
  const wealth = rulesFor(c.league, 20).wealth;
  const tier = g.leagues[c.league]?.tier ?? 2;
  const tv = Math.round((tier === 1 ? 1_200_000 : 250_000) * Math.pow(wealth, 2.5) * (0.6 + c.rep / 120));
  const sponsor = c.sponsor && c.sponsor.season === g.season ? c.sponsor.base : sponsorBase(c);
  const boost = c.merchBoost && c.merchBoost.until >= g.date ? 1 + c.merchBoost.factor : 1;
  const merch = Math.round(c.rep * c.rep * 25 * wealth * boost);
  // driftsomkostninger: stadion, administration, scouting-netværk m.m.
  const upkeep = Math.round(c.seats * 0.8 * Math.max(0.5, wealth) + (tv + sponsor + merch) * 0.12);
  return { wealth, tv, sponsor, merch, upkeep };
}

export function monthlyIncome() {
  const g = gs();
  for (const c of Object.values(g.clubs)) {
    const { tv, sponsor, merch, upkeep } = monthlyFigures(c);
    c.balance += tv + sponsor + merch - upkeep;
    c.finance.other += upkeep;
    // ligaer der ikke simuleres har ingen kampe – giv dem et skøn over billetindtægterne (≈2 hjemmekampe/md.)
    if (!g.comps[c.league] && g.date.slice(5, 7) !== '06' && g.date.slice(5, 7) !== '07') {
      const att = c.seats * Math.min(1, 0.3 + c.rep / 160 + 0.06);
      const gate = Math.round(att * c.ticketPrice * 2);
      c.balance += gate;
      c.finance.gate += gate;
    }
    c.finance.tv += tv;
    c.finance.sponsor += sponsor;
    c.finance.merch += merch;
  }
}

export function seasonPrizeMoney() {
  const g = gs();
  // ligaer der ikke simuleres: præmie efter omdømme-rangering
  const unsim = new Map<string, Club[]>();
  for (const c of Object.values(g.clubs)) {
    if (g.comps[c.league]) continue;
    if (!unsim.has(c.league)) unsim.set(c.league, []);
    unsim.get(c.league)!.push(c);
  }
  for (const [lg, clubs] of unsim) {
    const wealth = rulesFor(lg, clubs.length).wealth;
    const tier = g.leagues[lg]?.tier ?? 1;
    clubs.sort((a, b) => b.rep - a.rep).forEach((c, i) => {
      const prize = Math.round((clubs.length - i) * 400_000 * wealth * wealth * (tier === 1 ? 1 : 0.3));
      c.balance += prize;
      c.finance.prize += prize;
    });
  }
  for (const comp of Object.values(g.comps)) {
    if (comp.type !== 'league') continue;
    const order = finalOrder(comp);
    const wealth = rulesFor(comp.id, order.length).wealth;
    order.forEach((cid, i) => {
      const c = g.clubs[cid];
      const prize = Math.round((order.length - i) * 400_000 * wealth * wealth * (comp.tier === 1 ? 1 : 0.3));
      c.balance += prize;
      c.finance.prize += prize;
    });
  }
}

export function addPrize(c: Club, amount: number) {
  c.balance += amount;
  c.finance.prize += amount;
}

/** Nyt budget ved sæsonstart */
export function newSeasonBudgets() {
  const g = gs();
  for (const c of Object.values(g.clubs)) {
    const wealth = rulesFor(c.league, 20).wealth;
    const sv = squad(c.id).reduce((s, p) => s + p.value, 0);
    c.transferBudget = transferBudgetFor(sv, wealth, c.balance);
    if (c.ffp?.sanction) c.transferBudget = Math.round(c.transferBudget * 0.4 / 50_000) * 50_000;
    const bill = currentWageBill(c.id);
    // menneskestyrede klubber får lidt luft, så der er plads til en ny spiller uden først at sælge
    const room = c.manager === -1 ? 1.1 : 1.05;
    c.wageBudget = Math.round(Math.max(bill * room, bill + 2000) / 500) * 500;
    c.finance = { gate: 0, tv: 0, prize: 0, sponsor: 0, merch: 0, transfersIn: 0, transfersOut: 0, wages: 0, other: 0 };
    c.lgStats = undefined;
  }
}

export function fairTicketPrice(rep: number, league: string): number {
  return Math.round(10 + rep * 0.35 * Math.sqrt(Math.max(0.25, rulesFor(league, 20).wealth)));
}

/** Hvad budgettet ville blive, hvis det blev sat i dag */
function freshBudget(c: Club): number {
  const sv = squad(c.id).reduce((s, p) => s + p.value, 0);
  const b = transferBudgetFor(sv, rulesFor(c.league, 20).wealth, c.balance);
  return c.ffp?.sanction ? Math.round(b * 0.4 / 50_000) * 50_000 : b;
}

/** Januar: menneskestyrede klubber får fyldt transferbudgettet op til halvdelen af et nyt sæsonbudget */
export function januaryBudgetTopUp() {
  const g = gs();
  if (g.options.transferWindows === 'classic') return; // ingen vintervindue
  for (const c of Object.values(g.clubs)) {
    if (c.manager !== -1) continue;
    const target = Math.round(freshBudget(c) * 0.5 / 50_000) * 50_000;
    if (target <= c.transferBudget) continue;
    const add = target - c.transferBudget;
    c.transferBudget = target;
    asOwnerFinance(c.id, () => addNews({ cat: 'finance', key: 'budget.january', params: { fee: add, budget: target } }));
  }
}

/** Hvornår fornyes transferbudgettet, og hvor stort bliver det cirka? */
export function nextBudgetInfo(c: Club): { date: string; amount: number } {
  const g = gs();
  const y = Number(g.date.slice(0, 4)), m = Number(g.date.slice(5, 7));
  const fresh = freshBudget(c);
  const july = { date: `${m >= 7 ? y + 1 : y}-07-01`, amount: fresh };
  if (g.options.transferWindows === 'classic' || m < 7) return july;
  return { date: `${y + 1}-01-01`, amount: Math.max(c.transferBudget, Math.round(fresh * 0.5 / 50_000) * 50_000) };
}

export function transferBudgetFor(squadValue: number, wealth: number, balance: number): number {
  const base = squadValue * 0.08 * Math.min(1.5, wealth + 0.2) + Math.max(0, balance) * (balance > 50_000_000 ? 0.4 : 0.25);
  const cap = Math.max(0, balance) * 0.8 + 1_000_000;
  return Math.round(Math.max(50_000, Math.min(base, cap)) / 50_000) * 50_000;
}

/** Andel af stadion der fyldes (0.15-1) ved en given billetpris */
export function ticketDemand(home: Club, price: number, awayRep = 40, formBoost = 0, big = 1): number {
  const fair = fairTicketPrice(home.rep, home.league);
  // tilskuerne er mere følsomme over for dyre end for billige billetter
  const ratio = price / fair;
  const priceF = Math.max(0.15, Math.min(1.25, ratio > 1 ? 1 - (ratio - 1) * 0.95 : 1 + (1 - ratio) * 0.45));
  return Math.max(0.15, Math.min(1, (0.3 + home.rep / 160 + awayRep / 800 + formBoost) * big * priceF));
}

/** Forventet tilskuertal og indtægt pr. ligakamp ved en given pris (mod en gennemsnitlig modstander) */
export function estimateGate(club: Club, price: number): { attendance: number; income: number; fill: number } {
  const fill = ticketDemand(club, price, 45);
  const attendance = Math.round(club.seats * fill);
  return { attendance, income: attendance * price, fill };
}

/** Hvor mange vil gerne se en typisk hjemmekamp (uden at stadionet sætter loftet)? Bruges til at vurdere en udvidelse */
export function wantedAttendance(club: Club, price: number): number {
  const fair = fairTicketPrice(club.rep, club.league);
  const ratio = price / fair;
  const priceF = Math.max(0.15, Math.min(1.25, ratio > 1 ? 1 - (ratio - 1) * 0.95 : 1 + (1 - ratio) * 0.45));
  return Math.round(club.seats * Math.max(0.15, (0.3 + club.rep / 160 + 45 / 800) * priceF) * fanAttendance(club));
}

// ---------- sponsoraftaler ----------

import type { SponsorDeal, SponsorKind } from './types';
import { addNews, newsRelevant } from './state';
import { fanAttendance } from './fans';
import { asOwner as asOwnerFinance, forEachHuman } from './humans';

/** Standard sponsorindtægt pr. måned ud fra omdømme og ligaens økonomi */
export function sponsorBase(c: Club): number {
  return Math.round(Math.pow(c.rep, 2.5) * 25 * rulesFor(c.league, 20).wealth);
}

/** Tre tilbud: sikker, bonus eller ambitiøs */
export function sponsorOffers(c: Club): SponsorDeal[] {
  const g = gs();
  const b = sponsorBase(c);
  return [
    { kind: 'safe', base: Math.round(b * 1.0), winBonus: 0, trophyBonus: 0, season: g.season },
    { kind: 'bonus', base: Math.round(b * 0.75), winBonus: Math.round(b * 0.1), trophyBonus: Math.round(b * 3), season: g.season },
    { kind: 'ambitious', base: Math.round(b * 0.45), winBonus: Math.round(b * 0.16), trophyBonus: Math.round(b * 9), season: g.season },
  ];
}

export function chooseSponsor(kind: SponsorKind): string {
  const g = gs();
  const c = g.clubs[g.userClub];
  if (!c) return 'error';
  if (c.sponsor && c.sponsor.season === g.season) return 'sponsor.locked';
  const deal = sponsorOffers(c).find((d) => d.kind === kind)!;
  c.sponsor = deal;
  addNews({ cat: 'finance', key: 'sponsor.signed', params: { kind } });
  return 'ok';
}

/** Sejrsbonus fra sponsoren (ligakampe) */
export function sponsorWinBonus(clubId: number) {
  const g = gs();
  const c = g.clubs[clubId];
  if (!c?.sponsor || c.sponsor.season !== g.season || !c.sponsor.winBonus) return;
  c.balance += c.sponsor.winBonus;
  c.finance.sponsor += c.sponsor.winBonus;
}

/** Ved sæsonslut: bonus hvis målet nås (bonus: forventningen, ambitiøs: 2 pladser bedre eller trofæ) */
export function sponsorSeasonBonus(pos: number, expectedPos: number, trophy: boolean) {
  const g = gs();
  const c = g.clubs[g.userClub];
  const d = c?.sponsor;
  if (!c || !d || d.season !== g.season || d.kind === 'safe') return;
  const hit = d.kind === 'bonus' ? pos <= expectedPos || trophy : pos <= Math.max(1, expectedPos - 2) || trophy;
  if (hit) {
    c.balance += d.trophyBonus;
    c.finance.sponsor += d.trophyBonus;
  }
  addNews({ cat: 'finance', key: hit ? 'sponsor.bonusPaid' : 'sponsor.bonusMissed', params: { fee: d.trophyBonus } });
}

// ---------- merchandise ----------

/** Et stjernekøb sælger trøjer */
export function merchStarSigning(clubId: number, rep: number) {
  const g = gs();
  const c = g.clubs[clubId];
  if (!c || rep < 72) return;
  const factor = Math.min(0.8, 0.15 + (rep - 72) / 40);
  if (!c.merchBoost || c.merchBoost.until < g.date || c.merchBoost.factor < factor) c.merchBoost = { until: addDaysIso(g.date, 365), factor };
}

function addDaysIso(d: string, n: number) {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

// ---------- Financial Fair Play ----------

/** Ved sæsonslut: registrér resultat og straf klubber der taber for mange penge to år i træk */
export function ffpReview() {
  const g = gs();
  // AI-ejere geninvesterer store overskud (anlæg, akademi, lån, udbytte) i stedet for at hobe penge op
  for (const c of Object.values(g.clubs)) {
    if (c.manager === -1) continue;
    const cap = 80_000_000 * Math.max(0.3, rulesFor(c.league, 20).wealth);
    if (c.balance > cap) {
      const invest = Math.round((c.balance - cap) * 0.6);
      c.balance -= invest;
      if (c.facilities < 20 && invest > 5_000_000) c.facilities++;
      if (c.youth < 20 && invest > 15_000_000) c.youth++;
    }
  }
  for (const c of Object.values(g.clubs)) {
    const f = c.finance;
    const income = f.gate + f.tv + f.prize + f.sponsor + f.merch + f.transfersIn;
    const expense = f.wages + f.transfersOut + f.other;
    const result = income - expense;
    const ffp = (c.ffp ??= { results: [] });
    ffp.results = [...ffp.results, Math.round(result)].slice(-3);
    ffp.sanction = undefined;
    const lastTwo = ffp.results.slice(-2);
    const limit = Math.max(15_000_000, income * 0.3) * rulesFor(c.league, 20).wealth;
    if (lastTwo.length === 2 && lastTwo[0] + lastTwo[1] < -limit && g.leagues[c.league]?.tier === 1) {
      const fine = Math.round(Math.max(1_000_000, income * 0.05));
      c.balance -= fine;
      ffp.sanction = 'restricted';
      const msg = { cat: 'finance' as const, key: 'ffp.sanction', params: { club: c.name, fee: fine } };
      if (c.manager === -1 || c.rep >= 75) forEachHuman(() => { if (newsRelevant(c.id)) addNews(msg); });
    }
  }
}

export { sponsorOffers as _sponsorOffers };

// ---------- prognose ----------

/** Forventet sæsonindtægt fra en sponsoraftale ved et antal ligasejre (uden og med målbonus) */
export function sponsorSeasonValue(d: SponsorDeal, wins: number): { plain: number; withGoal: number } {
  const plain = d.base * 12 + d.winBonus * wins;
  return { plain, withGoal: plain + d.trophyBonus };
}

/**
 * Forventet saldo ved sæsonslut (30. juni): faste indtægter og driftsudgifter for de resterende måneder,
 * billetindtægter fra resterende hjemmekampe, løn til spillere og stab, aktive bud og en planlagt træningslejr.
 */
export function seasonForecast(clubId: number) {
  const g = gs();
  const c = g.clubs[clubId];
  const end = `${g.season + 1}-06-30`;
  const days = Math.max(0, (Date.parse(end) - Date.parse(g.date)) / 86_400_000);
  const months = Math.floor(days / 30.4);
  const weeks = days / 7;
  const m = monthlyFigures(c);
  const fixed = (m.tv + m.sponsor + m.merch - m.upkeep) * months;
  const homeLeft = Object.values(g.fixtures).filter((f) => f.home === clubId && !f.result && f.date <= end).length;
  const gate = Math.round(estimateGate(c, c.ticketPrice).income * homeLeft);
  const staff = Object.values(g.staff).filter((x) => x.club === clubId).reduce((a, x) => a + x.wage, 0);
  const wages = Math.round((currentWageBill(clubId) + staff) * weeks);
  const bids = g.offers.filter((o) => o.buyer === clubId && ['pending', 'negotiating', 'countered'].includes(o.status)).reduce((a, o) => a + (o.status === 'countered' ? o.counter ?? o.fee : o.fee), 0);
  const camp = c.camp && c.camp.status === 'planned' ? c.camp.cost : 0;
  const balance = Math.round(c.balance + fixed + gate - wages - bids - camp);
  return { now: c.balance, months, fixed, gate, homeLeft, wages, bids, camp, balance };
}
