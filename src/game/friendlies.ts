// Venskabskampe: en nem modstander (selvtillid) eller en storklub (billetindtægter og en hård test).
// Spilles på en dag uden andre kampe (mindst to dage fra en konkurrencekamp) og tæller ikke i nogen turnering.
import { addDays } from './dates';
import { quickMatch } from './engine/match';
import { forEachHuman } from './humans';
import { rng } from './rng';
import { aiTactic, engineTeam, userTactic } from './sim';
import { addNews, gs, squad } from './state';
import type { Club } from './types';

export type FriendlyKind = 'easy' | 'big';
export const MAX_FRIENDLIES = 4;

/** Ledige datoer de næste 60 dage: ingen egne kampe to dage før eller efter */
export function friendlyDates(): string[] {
  const g = gs();
  const c = g.userClub;
  const busy = new Set(Object.values(g.fixtures).filter((f) => f.home === c || f.away === c).map((f) => f.date));
  for (const fr of g.manager.friendlies ?? []) if (!fr.done) busy.add(fr.date);
  const out: string[] = [];
  for (let i = 3; i <= 60 && out.length < 8; i++) {
    const d = addDays(g.date, i);
    if ([-2, -1, 0, 1, 2].some((o) => busy.has(addDays(d, o)))) continue;
    out.push(d);
    i += 2;
  }
  return out;
}

/** Tre forslag til modstandere: nemme (lavere omdømme, samme land) eller storklubber */
export function friendlyOpponents(kind: FriendlyKind): Club[] {
  const g = gs();
  const me = g.clubs[g.userClub];
  if (!me) return [];
  const others = Object.values(g.clubs).filter((c) => c.id !== me.id && c.manager !== -1);
  let pool: Club[];
  if (kind === 'easy') {
    // nemme: klart lavere omdømme – helst fra eget land, ellers udlandet
    pool = others.filter((c) => c.nation === me.nation && c.rep <= me.rep - 12).sort((a, b) => b.rep - a.rep);
    if (pool.length < 3) pool = [...pool, ...others.filter((c) => c.nation !== me.nation && c.rep <= me.rep - 12).sort((a, b) => b.rep - a.rep)];
  } else {
    // storklubber: verdens største klubber med mindst samme omdømme (en topklub møder de andre topklubber)
    pool = others.filter((c) => c.rep >= Math.min(me.rep + 8, 86) || c.rep >= me.rep - 3).sort((a, b) => b.rep - a.rep);
    if (pool.length < 3) pool = others.slice().sort((a, b) => b.rep - a.rep);
  }
  return pool.slice(0, 12).sort(() => rng.next() - 0.5).slice(0, 3);
}

/** Forventet billetindtægt hjemme mod modstanderen (storklubber trækker fuldt hus) */
export function friendlyGate(opp: Club): number {
  const me = gs().clubs[gs().userClub];
  const fill = Math.min(1, 0.35 + Math.max(0, opp.rep - me.rep) / 60 + opp.rep / 300);
  return Math.round(me.seats * fill * me.ticketPrice * 0.8);
}

export function arrangeFriendly(opp: number, date: string, kind: FriendlyKind): 'ok' | 'date' | 'full' {
  const g = gs();
  if (!friendlyDates().includes(date)) return 'date';
  const list = (g.manager.friendlies ??= []);
  if (list.filter((x) => !x.done).length >= MAX_FRIENDLIES) return 'full';
  list.push({ opp, date, kind });
  addNews({ cat: 'match', key: 'friendly.arranged', params: { opp: g.clubs[opp]?.name ?? '', date } });
  return 'ok';
}

export function cancelFriendly(date: string) {
  const g = gs();
  g.manager.friendlies = (g.manager.friendlies ?? []).filter((x) => x.done || x.date !== date);
}

/** Dagligt: spil dagens venskabskamp */
export function friendliesDaily() {
  const g = gs();
  forEachHuman(() => {
    const fr = g.manager.friendlies?.find((x) => !x.done && x.date === g.date);
    if (!fr) return;
    const me = g.clubs[g.userClub], opp = g.clubs[fr.opp];
    if (!me || !opp) { fr.done = true; return; }
    const rep = quickMatch(engineTeam(me.id, userTactic(true)), engineTeam(opp.id, aiTactic(opp.id, me.id, false)), { neutral: false, aiSubs: [true, true], subs: 9, date: g.date }, rng);
    const gf = rep.stats[0].goals, ga = rep.stats[1].goals;
    const gate = friendlyGate(opp);
    me.balance += gate;
    me.finance.gate += gate;
    // selvtillid: sejr mod en nem modstander løfter, et nederlag til en storklub koster næsten intet
    const won = gf > ga, lost = gf < ga;
    const morale = fr.kind === 'easy' ? (won ? 1.2 : lost ? -1.2 : 0.2) : won ? 2 : lost ? -0.3 : 0.8;
    const played = new Set(rep.players.filter((l) => l.team === 0 && l.minutes > 0).map((l) => l.id));
    for (const p of squad(me.id)) {
      if (!played.has(p.id)) continue;
      p.morale = Math.max(1, Math.min(20, p.morale + morale));
      // kampform: spillerne kommer i form, men bliver trætte (en hård test tærer mere)
      const line = rep.players.find((l) => l.id === p.id)!;
      p.condition = Math.max(55, Math.min(100, line.cond + (fr.kind === 'big' ? 0 : 4)));
      if (line.injured && rng.chance(0.5)) p.injury = { key: 'bruise', days: rng.int(3, 10) };
    }
    fr.done = true;
    fr.result = [gf, ga];
    const scorers = rep.events.filter((e) => e.k === 'goal' && e.t === 0).map((e) => g.players[e.p ?? 0]?.last).filter(Boolean).join(', ');
    addNews({ cat: 'match', key: `friendly.result.${won ? 'win' : lost ? 'loss' : 'draw'}`, params: { opp: opp.name, score: `${gf}-${ga}`, fee: gate, scorers: scorers || '–', morale: morale >= 0 ? `+${morale}` : String(morale) } });
  });
}
