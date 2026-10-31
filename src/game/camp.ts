// Træningslejr: planlægges i en periode med mindst 14 dage uden kampe, godkendes af bestyrelsen,
// og når holdet kommer hjem, kommer der en rapport om, hvordan det gik og hvad det betød.
import { A } from './attributes';
import { addDays, daysBetween } from './dates';
import { asOwner, forEachHuman } from './humans';
import { Rng, hash } from './rng';
import { addNews, gs, squad } from './state';
import { traits } from './personality';
import type { Club, TrainingCamp } from './types';

export type CampDest = 'sun' | 'alps' | 'home' | 'tour';

/** Hvad hver destination koster (× ugens lønbudget) og giver */
export const CAMP_DESTS: Record<CampDest, { cost: number; morale: number; cond: number; bond: number; phys: number; income: number; summerOnly?: boolean }> = {
  sun: { cost: 3, morale: 2, cond: 6, bond: 4, phys: 0, income: 0 },
  alps: { cost: 4, morale: 1, cond: 10, bond: 3, phys: 0.35, income: 0 },
  home: { cost: 1, morale: 1, cond: 4, bond: 5, phys: 0, income: 0 },
  tour: { cost: 2, morale: 1, cond: -4, bond: 2, phys: 0, income: 9, summerOnly: true },
};

const CAMP_DAYS = 7;

export function campCost(c: Club, dest: CampDest): number {
  return Math.max(30_000, Math.round((c.wageBudget * CAMP_DESTS[dest].cost) / 10_000) * 10_000);
}

/** Perioder de næste ~5 måneder med mindst 14 dage uden kampe – lejren lægges midt i dem */
export function campWindows(): { start: string; end: string; gap: number }[] {
  const g = gs();
  const c = g.clubs[g.userClub];
  if (!c) return [];
  const until = addDays(g.date, 150);
  const dates = [...new Set(Object.values(g.fixtures).filter((f) => !f.result && (f.home === c.id || f.away === c.id) && f.date > g.date && f.date <= until).map((f) => f.date))].sort();
  const out: { start: string; end: string; gap: number }[] = [];
  let prev = g.date;
  for (const d of [...dates, until]) {
    const gap = daysBetween(prev, d);
    if (gap >= 14) {
      // afrejse to dage efter forrige kamp (eller i morgen), hjem senest fem dage før næste
      const start = addDays(prev, prev === g.date ? 1 : 2);
      const end = addDays(start, CAMP_DAYS);
      if (daysBetween(end, d) >= 3) out.push({ start, end, gap });
    }
    prev = d;
  }
  return out.slice(0, 4);
}

/** Planlæg lejren: bestyrelsen godkender, hvis der er råd og tillid nok */
export function planCamp(dest: CampDest, start: string): 'ok' | 'busy' | 'money' | 'confidence' | 'window' | 'season' {
  const g = gs();
  const c = g.clubs[g.userClub];
  if (!c) return 'window';
  if (c.camp && c.camp.status !== 'done') return 'busy';
  if (c.camp && c.camp.status === 'done' && daysBetween(c.camp.end, g.date) < 90) return 'season';
  const w = campWindows().find((x) => x.start === start);
  if (!w) return 'window';
  const m = Number(start.slice(5, 7));
  if (CAMP_DESTS[dest].summerOnly && !(m === 6 || m === 7 || m === 1)) return 'window';
  const cost = campCost(c, dest);
  if (c.balance < cost) { addNews({ cat: 'board', key: 'camp.noMoney', params: { cost } }); return 'money'; }
  if (g.board.confidence < 30) { addNews({ cat: 'board', key: 'camp.noConfidence', params: {} }); return 'confidence'; }
  c.camp = { dest, start, end: w.end, cost, status: 'planned' };
  addNews({ cat: 'board', key: 'camp.approved', params: { dest: dest, date: start, cost } });
  return 'ok';
}

export function cancelCamp(): boolean {
  const g = gs();
  const c = g.clubs[g.userClub];
  if (!c?.camp || c.camp.status !== 'planned') return false;
  c.camp = undefined;
  return true;
}

/** Dagligt: afrejse og hjemkomst (med rapport) for menneskestyrede klubber */
export function campDaily() {
  const g = gs();
  forEachHuman(() => {
    const c = g.clubs[g.userClub];
    const camp = c?.camp;
    if (!c || !camp) return;
    if (camp.status === 'planned' && g.date >= camp.start) {
      camp.status = 'running';
      c.balance -= camp.cost;
      c.finance.other += camp.cost;
      addNews({ cat: 'general', key: 'camp.departed', params: { dest: camp.dest, date: camp.end } });
    } else if (camp.status === 'running' && g.date >= camp.end) {
      finishCamp(c, camp);
    }
  });
}

/** Lejren er slut: virkningerne lægges ind, og rapporten skrives */
function finishCamp(c: Club, camp: TrainingCamp) {
  const g = gs();
  const d = CAMP_DESTS[camp.dest as CampDest];
  const r = new Rng(hash(g.seed, c.id, camp.start.length, Number(camp.start.replace(/-/g, ''))));
  const sq = squad(c.id).filter((p) => !p.loan || p.loan.from !== c.id);
  // stemningen: et godt (eller dårligt) ophold
  const vibe = r.normal(0, 0.6);
  const morale = Math.round((d.morale + vibe) * 10) / 10;
  for (const p of sq) {
    p.morale = Math.max(1, Math.min(20, p.morale + morale));
    p.condition = Math.max(40, Math.min(100, p.condition + d.cond));
    if (d.phys) for (const k of [A.stamina, A.naturalFitness] as number[]) p.attrs[k] = Math.min(20, p.attrs[k] + d.phys * (p.pa > p.ca ? 1 : 0.5));
  }
  // en spiller imponerer: et ungt talent tager et skridt
  const young = sq.filter((p) => p.pa - p.ca >= 10).sort((a, b) => (b.pa - b.ca) * (0.5 + r.next()) - (a.pa - a.ca) * (0.5 + r.next()))[0];
  if (young) { young.ca = Math.min(young.pa, young.ca + 2); young.morale = Math.min(20, young.morale + 2); }
  // skader og episoder
  const hurt = r.chance(camp.dest === 'alps' ? 0.35 : 0.2) ? r.pick(sq) : undefined;
  if (hurt && !hurt.injury) hurt.injury = { key: 'hamstring', days: r.int(5, 14) };
  const trouble = sq.filter((p) => traits(p).includes('troublemaker'));
  const incident = camp.dest === 'sun' && trouble.length && r.chance(0.4) ? r.pick(trouble) : undefined;
  if (incident) { incident.morale = Math.max(1, incident.morale - 2); incident.lastIncident = g.date; }
  // holdkemi: tid sammen giver et løft resten af sæsonen
  const bond = Math.max(1, Math.round(d.bond + vibe * 2 - (incident ? 2 : 0)));
  c.campBond = { season: g.season, pts: Math.min(8, (c.campBond?.season === g.season ? c.campBond.pts : 0) + bond) };
  // turné: indtægter og fans
  const income = d.income ? Math.round((c.wageBudget * d.income) / 10_000) * 10_000 : 0;
  if (income) { c.balance += income; c.finance.other -= income; c.fanMood = Math.min(100, (c.fanMood ?? 60) + 3); }
  camp.status = 'done';
  camp.report = { morale, cond: d.cond, bond, star: young?.id, injured: hurt?.id, incident: incident?.id, income };
  const name = (id?: number) => (id && g.players[id] ? `${g.players[id].first} ${g.players[id].last}`.trim() : '');
  asOwner(c.id, () => addNews({
    cat: 'general', key: 'camp.report',
    params: {
      dest: camp.dest, mood: morale >= d.morale ? 'good' : morale > 0 ? 'ok' : 'bad', morale: (morale >= 0 ? '+' : '') + morale, cond: (d.cond >= 0 ? '+' : '') + d.cond, bond,
      star: name(young?.id) || '–', injured: name(hurt?.id) || '–', incident: name(incident?.id) || '–', phys: d.phys ? '+' + d.phys : '0', fee: income,
    },
    ...(young ? { link: { kind: 'player' as const, id: young.id } } : {}),
  }));
}
