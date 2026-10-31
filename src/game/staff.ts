// Staff: ansæt, fyr og køb fri fra andre klubber
import { addNews, gs } from './state';
import { addDays } from './dates';
import { isMultiplayer, ownerOf, withHuman } from './humans';
import { hash01 } from './rng';
import type { Staff, StaffRole } from './types';

export const STAFF_LIMITS: Record<StaffRole, number> = { manager: 0, assistant: 1, coach: 7, physio: 3, scout: 6 };

export function staffCount(role: StaffRole): number {
  const g = gs();
  return Object.values(g.staff).filter((s) => s.club === g.userClub && s.role === role).length;
}

/** Kompensation for at købe en ansat fri: ca. et halvt års løn, mere for gode folk */
export function poachFee(s: Staff): number {
  return Math.round((s.wage * 26 * (1 + s.rep / 100)) / 1000) * 1000;
}

export type HireResult = 'ok' | 'limit' | 'refused' | 'money' | 'pending' | 'already' | 'lowWage';

/** Hvad den ansatte forlanger i ugeløn (lidt mere for at forlade en anden klub) */
export function staffDemand(s: Staff): number {
  return Math.round((s.wage * (s.club > 0 ? 1.1 : 1)) / 50) * 50;
}

/** Vil den ansatte skifte? Folk forlader sjældent en klub med højere omdømme */
export function willJoin(s: Staff): boolean {
  const g = gs();
  const mine = g.clubs[g.userClub];
  const theirs = g.clubs[s.club];
  if (!mine) return false;
  if (!theirs) return true;
  return theirs.rep <= mine.rep + 5;
}

export function hireStaff(id: number, wage?: number): HireResult {
  const g = gs();
  const s = g.staff[id];
  const club = g.clubs[g.userClub];
  if (!s || !club || s.club === club.id) return 'refused';
  if (staffCount(s.role) >= STAFF_LIMITS[s.role]) return 'limit';
  if (s.club > 0 && !willJoin(s)) return 'refused';
  if (s.club > 0 && club.balance < poachFee(s)) return 'money';
  const offer = Math.round((wage ?? staffDemand(s)) / 50) * 50;
  if (offer < staffDemand(s) * 0.95) return 'lowWage';
  // multiplayer: alle kan give et tilbud – den ansatte vælger det bedste i morgen
  if (isMultiplayer(g)) {
    g.staffBids ??= [];
    const mine = g.staffBids.find((b) => b.staff === id && b.club === club.id);
    if (mine) { if (!mine.war) mine.wage = offer; return 'pending'; }
    g.staffBids.push({ staff: id, club: club.id, date: g.date, wage: offer });
    addNews({ cat: 'general', key: 'staff.bidSent', params: { name: `${s.first} ${s.last}`, wage: offer } });
    // en anden manager byder også: budkrig – begge kan hæve én gang, blindt, og svaret kommer en dag senere
    const all = g.staffBids.filter((b) => b.staff === id);
    if (all.length > 1) {
      const newWar = all.every((b) => !b.war);
      const deadline = addDays(g.date, 1);
      for (const b of all) {
        const fresh = !b.war;
        b.war = true;
        b.date = deadline;
        const owner = ownerOf(b.club);
        if (owner && (fresh || b.club === club.id)) withHuman(owner, () => addNews({ cat: 'general', key: 'war.staffStarted', params: { name: `${s.first} ${s.last}`, n: all.length, sid: id } }));
      }
      if (newWar) {
        const [a, b] = all.map((x) => g.clubs[x.club]?.name ?? '');
        addNews({ cat: 'general', key: 'war.staffHeadline', params: { name: `${s.first} ${s.last}`, a, b } }, { all: true });
      }
    }
    return 'pending';
  }
  return doHire(s.id, offer);
}

/** Selve ansættelsen for den aktive manager */
function doHire(id: number, wage?: number): HireResult {
  const g = gs();
  const s = g.staff[id];
  const club = g.clubs[g.userClub];
  if (!s || !club || s.club === club.id) return 'refused';
  if (staffCount(s.role) >= STAFF_LIMITS[s.role]) return 'limit';
  const poached = s.club > 0;
  if (poached) {
    if (!willJoin(s)) return 'refused';
    const fee = poachFee(s);
    if (club.balance < fee) return 'money';
    club.balance -= fee;
    club.finance.other += fee;
    const old = g.clubs[s.club];
    if (old) { old.balance += fee; old.finance.other -= fee; }
    addNews({ cat: 'general', key: 'staff.poached', params: { name: `${s.first} ${s.last}`, club: old?.name ?? '', fee } });
  } else {
    addNews({ cat: 'general', key: 'staff.hired', params: { name: `${s.first} ${s.last}`, role: s.role } });
  }
  s.club = club.id;
  s.assignment = null;
  s.wage = wage ?? Math.round(s.wage * (poached ? 1.1 : 1));
  s.expires = `${Number(g.date.slice(0, 4)) + 2}-06-30`;
  return 'ok';
}

/** Fyr: kompensation = 12 ugers løn */
export function fireStaff(id: number): number {
  const g = gs();
  const s = g.staff[id];
  const club = g.clubs[g.userClub];
  if (!s || !club || s.club !== club.id) return 0;
  const pay = s.wage * 12;
  club.balance -= pay;
  club.finance.other += pay;
  s.club = 0;
  s.assignment = null;
  return pay;
}

/** Dagligt i multiplayer: de ansatte, der har fået tilbud, vælger klub (den med størst omdømme vinder) */
export function resolveStaffBids() {
  const g = gs();
  if (!g.staffBids?.length) return;
  const due = g.staffBids.filter((b) => b.date < g.date);
  if (!due.length) return;
  g.staffBids = g.staffBids.filter((b) => b.date >= g.date);
  const byStaff = new Map<number, typeof due>();
  for (const b of due) byStaff.set(b.staff, [...(byStaff.get(b.staff) ?? []), b]);
  for (const [sid, bids] of byStaff) {
    const s = g.staff[sid];
    if (!s) continue;
    const name = `${s.first} ${s.last}`;
    // bedste kontrakt vinder; klubbens omdømme vejer lidt (5 omdømmepoint ≈ 2,5 % i løn)
    const demand = Math.max(1, staffDemand(s));
    const score = (b: (typeof bids)[number]) => (b.wage ?? demand) / demand + (g.clubs[b.club]?.rep ?? 0) / 200 + hash01(g.seed, sid, b.club) * 0.005;
    const order = bids.slice().sort((a, b) => score(b) - score(a));
    let winner = 0;
    // budkrig: afsløring af de to bedste tilbud
    if (bids.some((b) => b.war) && order.length > 1) {
      const params = { name, a: g.clubs[order[0].club]?.name ?? '', b: g.clubs[order[1].club]?.name ?? '', wage: order[0].wage ?? demand, wage2: order[1].wage ?? demand };
      for (const b of bids) { const owner = ownerOf(b.club); if (owner) withHuman(owner, () => addNews({ cat: 'general', key: b === order[0] ? 'war.staffWon' : 'war.staffLost', params })); }
      addNews({ cat: 'general', key: 'war.staffResult', params }, { all: true });
    }
    for (const b of order) {
      const owner = ownerOf(b.club);
      if (!owner) continue;
      const r = withHuman(owner, () => doHire(sid, b.wage));
      if (r === 'ok') { winner = b.club; break; }
    }
    const war = bids.some((b) => b.war) && order.length > 1;
    for (const b of bids) {
      const owner = ownerOf(b.club);
      if (!owner || b.club === winner || (war && winner)) continue;
      withHuman(owner, () => addNews({ cat: 'general', key: winner ? 'staff.bidLost' : 'staff.bidFailed', params: { name, club: g.clubs[winner]?.name ?? '' } }));
    }
    if (winner && bids.length > 1 && !war) { const owner = ownerOf(winner); if (owner) withHuman(owner, () => addNews({ cat: 'general', key: 'staff.bidWon', params: { name, n: bids.length } })); }
  }
}

/** Budkrig om en ansat: hæv dit lønbud én gang – blindt, før svaret */
export function raiseStaff(id: number, wage: number): string {
  const g = gs();
  const mine = g.staffBids?.find((b) => b.staff === id && b.club === g.userClub);
  if (!mine || !mine.war || mine.raised) return 'error';
  const w = Math.round(wage / 50) * 50;
  if (w <= (mine.wage ?? 0)) return 'low';
  mine.wage = Math.min(w, (mine.wage ?? w) * 2);
  mine.raised = true;
  return 'ok';
}
