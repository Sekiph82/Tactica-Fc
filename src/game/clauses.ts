// Kontraktklausuler: frikøbsklausul, lønstigning, kamp- og målbonus, lønnedgang ved nedrykning,
// samt transferklausuler (videresalgsprocent og ekstra beløb efter et antal kampe).
import { naturalRole } from './attributes';
import { ageOn } from './dates';
import { asOwner, isHumanClub } from './humans';
import { hash01 } from './rng';
import { addNews, gs } from './state';
import type { Club, ContractClauses, Player } from './types';

const pname = (p: Player) => `${p.first} ${p.last}`.trim();
const round = (v: number, to: number) => Math.round(v / to) * to;
export const roundFee = (v: number) => (v >= 10_000_000 ? round(v, 500_000) : v >= 1_000_000 ? round(v, 50_000) : round(v, 5_000));

/** Antal kampe før et betinget beløb (add-on) udløses */
export const ADDON_APPS = 25;

// ---------- spillerens syn på klausuler ----------

/** Hvor meget en spiller regner med at spille (andel af kampene) */
function expectedShare(rank: number): number {
  return rank <= 11 ? 0.8 : rank <= 16 ? 0.45 : 0.2;
}

/** Forventede kampe uden mål imod pr. sæson for spilleren (målmænd og forsvarere tæller mest) */
function cleanSheets(p: Player): number {
  const r = naturalRole(p);
  return r === 'GK' || r === 'CB' || r === 'FB' ? 11 : r === 'DM' ? 6 : 2;
}

function expectedGoals(p: Player): number {
  const r = naturalRole(p);
  return r === 'ST' ? 14 : r === 'AM' || r === 'W' ? 7 : r === 'CM' || r === 'WM' ? 3 : 1;
}

/**
 * Klausulernes værdi for spilleren omregnet til ugeløn (kan være negativ).
 * rank = spillerens forventede plads i den nye trup (1 = bedst).
 */
export function clauseWorth(p: Player, wage: number, years: number, c: ContractClauses, rank: number): number {
  let w = 0;
  const v = Math.max(50_000, p.value);
  if (c.release) {
    // spillere kan lide en frikøbsklausul – jo lavere, jo mere frihed
    const ratio = c.release / v;
    const amb = p.attrs[42] >= 14 ? 1.5 : 1;
    w += wage * (ratio <= 1.5 ? 0.08 : ratio <= 3 ? 0.04 : 0.015) * amb;
  }
  if (c.wageRise) w += wage * (c.wageRise / 100) * Math.max(0, years - 1) / 2 * 0.8;
  const share = expectedShare(rank);
  // usikre penge vægtes lavere end fast løn
  if (c.appBonus) w += (c.appBonus * 40 * share / 52) * 0.7;
  if (c.goalBonus) w += (c.goalBonus * expectedGoals(p) * share / 52) * 0.7;
  if (c.relegationCut) w -= wage * (c.relegationCut / 100) * 0.25;
  if (c.promotionRise) w += wage * (c.promotionRise / 100) * 0.12;
  if (c.cleanSheetBonus) w += (c.cleanSheetBonus * cleanSheets(p) * share / 52) * 0.7;
  return Math.round(w);
}

/** Hvad klausulerne forventes at koste klubben om ugen (vises i forhandlingen) */
export function clauseCost(p: Player, wage: number, years: number, c: ContractClauses, rank: number): number {
  const share = expectedShare(rank);
  return Math.round((c.appBonus ?? 0) * 40 * share / 52 + (c.goalBonus ?? 0) * expectedGoals(p) * share / 52 + (c.cleanSheetBonus ?? 0) * cleanSheets(p) * share / 52 + wage * ((c.wageRise ?? 0) / 100) * Math.max(0, years - 1) / 2);
}

export function cleanClauses(c?: ContractClauses): ContractClauses {
  const out: ContractClauses = {};
  if (!c) return out;
  if (c.release && c.release > 0) out.release = roundFee(c.release);
  if (c.wageRise && c.wageRise > 0) out.wageRise = Math.min(20, Math.round(c.wageRise));
  if (c.appBonus && c.appBonus > 0) out.appBonus = round(c.appBonus, 50);
  if (c.goalBonus && c.goalBonus > 0) out.goalBonus = round(c.goalBonus, 50);
  if (c.relegationCut && c.relegationCut > 0) out.relegationCut = Math.min(50, Math.round(c.relegationCut));
  if (c.promotionRise && c.promotionRise > 0) out.promotionRise = Math.min(50, Math.round(c.promotionRise));
  if (c.cleanSheetBonus && c.cleanSheetBonus > 0) out.cleanSheetBonus = round(c.cleanSheetBonus, 50);
  return out;
}

// ---------- sælgerens syn på transferklausuler ----------

/** Hvad sælgeren mener klausulerne i et bud er værd (lægges oven i transfersummen) */
export function bidClauseWorth(p: Player, fee: number, sellOn = 0, addOn = 0): number {
  const age = ageOn(p.dob, gs().date);
  // unge spillere med potentiale giver mest videresalg
  const upside = Math.max(0, (p.pa - p.ca) / 40);
  const growth = age <= 21 ? 1.2 + upside : age <= 24 ? 0.7 + upside / 2 : age <= 27 ? 0.35 : 0.1;
  const sellOnWorth = fee * (sellOn / 100) * growth * 0.6;
  // add-on: værdsat efter hvor sandsynligt det er at spilleren når kampene
  const addOnWorth = addOn * (age <= 30 ? 0.6 : 0.4);
  return Math.round(sellOnWorth + addOnWorth);
}

// ---------- betalinger ----------

function pay(from: Club | undefined, to: Club | undefined, amount: number) {
  if (amount <= 0) return;
  if (from) { from.balance -= amount; from.finance.transfersOut += amount; }
  if (to) { to.balance += amount; to.finance.transfersIn += amount; }
}

/** Ved et salg: betal videresalgsprocent til den tidligere klub. Kaldes før spilleren skifter klub. */
export function settleSellOn(p: Player, fee: number, seller: Club | undefined) {
  const g = gs();
  const so = p.sellOn;
  if (!so) return;
  p.sellOn = undefined;
  if (!seller || fee <= 0 || so.club === seller.id) return;
  const amount = Math.round(Math.max(0, fee - so.base) * so.pct / 100);
  const to = g.clubs[so.club];
  if (!amount || !to) return;
  pay(seller, to, amount);
  if (isHumanClub(to.id)) asOwner(to.id, () => addNews({ cat: 'finance', key: 'clause.sellOnPaid', params: { player: pname(p), club: seller.name, pct: so.pct, fee: amount }, link: { kind: 'player', id: p.id } }));
  if (isHumanClub(seller.id)) asOwner(seller.id, () => addNews({ cat: 'finance', key: 'clause.sellOnOwed', params: { player: pname(p), club: to.name, pct: so.pct, fee: amount }, link: { kind: 'player', id: p.id } }));
}

/** Efter hver kamp: kamp- og målbonusser (kun kontrakter med bonusser) og nedtælling af add-ons */
export function afterAppearance(p: Player, goals: number, cleanSheet = false) {
  const g = gs();
  const club = g.clubs[p.club];
  const c = p.contract;
  if (club && c && !p.loan) {
    const bonus = (c.appBonus ?? 0) + (c.goalBonus ?? 0) * goals + (cleanSheet ? c.cleanSheetBonus ?? 0 : 0);
    if (bonus > 0) { club.balance -= bonus; club.finance.wages += bonus; }
  }
  const a = p.addOn;
  if (a && a.payer === p.club && !p.loan) {
    a.left--;
    if (a.left <= 0) {
      p.addOn = undefined;
      const payer = g.clubs[a.payer], to = g.clubs[a.club];
      pay(payer, to, a.fee);
      if (payer && isHumanClub(payer.id)) asOwner(payer.id, () => addNews({ cat: 'finance', key: 'clause.addOnOwed', params: { player: pname(p), club: to?.name ?? '', fee: a.fee, n: ADDON_APPS }, link: { kind: 'player', id: p.id } }));
      if (to && isHumanClub(to.id)) asOwner(to.id, () => addNews({ cat: 'finance', key: 'clause.addOnPaid', params: { player: pname(p), club: payer?.name ?? '', fee: a.fee, n: ADDON_APPS }, link: { kind: 'player', id: p.id } }));
    }
  } else if (a && a.payer !== p.club) p.addOn = undefined; // spilleren er solgt videre – beløbet bortfalder
}

/** Ved sæsonskifte: årlige lønstigninger og lønnedgang for nedrykkede klubber */
export function seasonWageClauses(tierBefore: Map<number, number>) {
  const g = gs();
  for (const p of Object.values(g.players)) {
    const c = p.contract;
    if (!c || !p.club) continue;
    if (c.wageRise) c.wage = round(c.wage * (1 + c.wageRise / 100), 50);
    const club = g.clubs[p.club];
    const before = tierBefore.get(p.club);
    const now = club ? g.leagues[club.league]?.tier : undefined;
    if (c.relegationCut && before !== undefined && now !== undefined && now > before) {
      const old = c.wage;
      c.wage = round(c.wage * (1 - c.relegationCut / 100), 50);
      c.relegationCut = undefined;
      if (isHumanClub(p.club)) asOwner(p.club, () => addNews({ cat: 'contract', key: 'clause.relegatedWage', params: { player: pname(p), wage: c.wage, old }, link: { kind: 'player', id: p.id } }));
    }
    if (c.promotionRise && before !== undefined && now !== undefined && now < before) {
      const old = c.wage;
      c.wage = round(c.wage * (1 + c.promotionRise / 100), 50);
      c.promotionRise = undefined;
      if (isHumanClub(p.club)) asOwner(p.club, () => addNews({ cat: 'contract', key: 'clause.promotedWage', params: { player: pname(p), wage: c.wage, old }, link: { kind: 'player', id: p.id } }));
    }
  }
}

// ---------- frikøbsklausuler ----------

/** Standard-frikøbsklausul for AI-klubber: alle spanske kontrakter har én, enkelte andre */
export function defaultRelease(p: Player, club: Club | undefined): number | undefined {
  const g = gs();
  if (!club) return undefined;
  const v = Math.max(100_000, p.value);
  const r = hash01(g.seed, p.id, club.id, 77);
  if (g.nations[club.nation]?.code === 'ESP') return roundFee(v * (3 + r * 4));
  if (club.rep < 65 && r < 0.12) return roundFee(v * (2 + r * 10));
  return undefined;
}

/** Sæt standardklausuler på alle AI-kontrakter ved spilstart */
export function initReleaseClauses() {
  const g = gs();
  for (const p of Object.values(g.players)) {
    if (!p.contract || !p.club || isHumanClub(p.club)) continue;
    const rel = defaultRelease(p, g.clubs[p.club]);
    if (rel) p.contract.release = rel;
  }
}
