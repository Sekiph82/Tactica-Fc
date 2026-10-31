// Medierne: rygter om interesse for manageres spillere (der kan blive til rigtige bud) og
// månedens klumme om ligaen. Selve teksterne kan skrives af AI, når beskeden åbnes.
import { addDays, daysBetween } from './dates';
import { roundValue } from './data/generate';
import { forEachHuman, isHumanClub } from './humans';
import { rng } from './rng';
import { clubLevel } from './scouting';
import { addNews, gs, squad } from './state';
import { leagueRows } from './competitions';
import type { Player, Club } from './types';

const pname = (p: Player) => `${p.first} ${p.last}`.trim();
const avgForm = (p: Player) => (p.form.length ? p.form.reduce((s, x) => s + x, 0) / p.form.length : 0);

/** Ugentligt: rygter om større klubbers interesse for brugerens bedste/formstærke spillere */
export function weeklyRumours() {
  const g = gs();
  const me = g.clubs[g.userClub];
  if (!me) return;
  const m = Number(g.date.slice(5, 7));
  // højst ét rygte hver tredje uge
  if (g.board.lastRumour && daysBetween(g.board.lastRumour, g.date) < 21) return;
  if (!rng.chance(m >= 5 && m <= 8 || m === 12 || m === 1 ? 0.22 : 0.07)) return;
  // rygterne bygger på klubbernes rigtige shortlister, når der er nogen
  const interested = Object.values(g.clubs).filter((c) => c.id !== me.id && !isHumanClub(c.id) && c.shortlist?.some((id) => g.players[id]?.club === me.id));
  let p: Player | undefined;
  let club: Club | undefined;
  if (interested.length) {
    club = rng.pick(interested);
    const ids: number[] = club.shortlist!.filter((id) => g.players[id]?.club === me.id);
    p = g.players[rng.pick(ids)!];
  } else {
    const cands = squad(me.id).filter((x) => !x.loan && x.contract && (avgForm(x) >= 7 || x.ca >= clubLevel(me.id) + 6) && !x.contract.futureClub);
    p = rng.pick(cands);
    if (!p) return;
    const pp = p;
    club = rng.pick(Object.values(g.clubs).filter((c) => c.id !== me.id && !isHumanClub(c.id) && c.rep >= me.rep + 4 && c.transferBudget >= pp.value * 0.8 && Math.abs(clubLevel(c.id) - pp.ca) <= 18));
  }
  if (!p) return;
  if (!club) return;
  // halvdelen af rygterne er sande: klubben byder senere
  const real = rng.chance(0.5);
  if (real) {
    const list = (g.pursuits ??= []).filter((x) => !(x.club === club.id && x.player === p.id));
    list.push({ club: club.id, player: p.id, lastFee: roundValue(p.value * 0.85), maxFee: roundValue(Math.min(club.transferBudget, p.value * rng.range(1.1, 1.5))), tries: 0, next: addDays(g.date, rng.int(10, 30)) });
    g.pursuits = list;
  }
  g.board.lastRumour = g.date;
  addNews({ cat: 'transfer', key: 'rumour.interest', params: { player: pname(p), club: club.name, outlet: rng.pick(['tabloid', 'paper', 'insider']) }, link: { kind: 'player', id: p.id } });
}

/** Den 1. i måneden: klumme om brugerens liga */
export function monthlyColumn() {
  forEachHuman(() => {
    const g = gs();
    const me = g.clubs[g.userClub];
    const comp = me ? g.comps[me.league] : undefined;
    if (!comp || comp.type !== 'league') return;
    const rows = leagueRows(comp);
    if ((rows[0]?.p ?? 0) < 4) return;
    const leader = rows[0], second = rows[1];
    const myPos = rows.findIndex((r) => r.club === me!.id) + 1;
    addNews({ cat: 'general', key: 'column.month', params: { comp: comp.name, leader: g.clubs[leader.club]?.name ?? '', gap: leader.pts - (second?.pts ?? 0), pos: myPos, club: me!.name } });
  });
}
