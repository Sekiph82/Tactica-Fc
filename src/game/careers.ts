// Trænerkarrierer: AI-trænere har historik, trofæer og form. Storklubber headhunter trænere der
// overpræsterer i mindre klubber, og manageren møder gamle rivaler og tidligere klubber.
import { finalOrder } from './competitions';
import { forEachHuman, isHumanClub } from './humans';
import { gs, newsRelevant, addNews } from './state';
import { openVacancy } from './board';
import type { Staff } from './types';

const mname = (m: Staff) => `${m.first} ${m.last}`.trim();

export function careerStart(m: Staff, clubId: number) {
  const g = gs();
  (m.career ??= []).push({ club: clubId, from: g.date });
  if (m.career.length > 12) m.career.shift();
}

export function careerEnd(m: Staff, why: 'sacked' | 'poached' | 'left') {
  const g = gs();
  const cur = m.career?.[m.career.length - 1];
  if (cur && !cur.to) { cur.to = g.date; cur.why = why; }
}

/** Find en træner til en ledig stilling: storklubber headhunter overpræsterende trænere */
export function pickManager(clubId: number): Staff | undefined {
  const g = gs();
  const club = g.clubs[clubId];
  if (!club) return undefined;
  if (club.rep >= 62) {
    const hunted = Object.values(g.staff)
      .filter((s) => s.role === 'manager' && s.club && s.club !== clubId && !isHumanClub(s.club) && (s.form ?? 0) >= 3 && (g.clubs[s.club]?.rep ?? 100) <= club.rep - 8)
      .sort((a, b) => b.rep + (b.form ?? 0) * 3 + (b.trophies ?? 0) * 4 - (a.rep + (a.form ?? 0) * 3 + (a.trophies ?? 0) * 4))[0];
    if (hunted && hunted.rep >= club.rep - 30) {
      const old = g.clubs[hunted.club];
      if (old) {
        careerEnd(hunted, 'poached');
        old.manager = 0;
        old.tactic = null;
        openVacancy(old.id);
        forEachHuman(() => { if (newsRelevant(old.id, clubId)) addNews({ cat: 'job', key: 'mgr.poached', params: { manager: mname(hunted), from: old.name, to: club.name } }); });
      }
      return hunted;
    }
  }
  return Object.values(g.staff).filter((s) => s.role === 'manager' && s.club === 0).sort((a, b) => Math.abs(a.rep - club.rep) - Math.abs(b.rep - club.rep))[0];
}

/** Sæsonslut: trænernes form (placering mod forventning), trofæer og omdømme */
export function seasonCareers(expectedRank: (clubId: number) => number) {
  const g = gs();
  const trophyClubs = new Set(Object.values(g.comps).filter((c) => c.winner && c.type !== 'playoff').map((c) => c.winner!));
  for (const comp of Object.values(g.comps)) {
    if (comp.type !== 'league' || !comp.finished) continue;
    finalOrder(comp).forEach((cid, i) => {
      const club = g.clubs[cid];
      const m = club && club.manager > 0 ? g.staff[club.manager] : undefined;
      if (!m) return;
      const form = expectedRank(cid) - (i + 1);
      m.form = form;
      const won = trophyClubs.has(cid);
      if (won) m.trophies = (m.trophies ?? 0) + 1;
      m.rep = Math.max(1, Math.min(100, Math.round(m.rep + form * 0.8 + (won ? 3 : 0))));
    });
  }
}

/** Rivalisering: registrér resultatet mod en AI-træner (efter brugerens kamp) */
export function recordRivalry(oppClub: number, scored: number, conceded: number) {
  const g = gs();
  const opp = g.clubs[oppClub];
  if (!opp || opp.manager <= 0) return;
  const r = ((g.manager.rivals ??= {})[opp.manager] ??= [0, 0, 0]);
  r[scored > conceded ? 0 : scored === conceded ? 1 : 2]++;
}

/** Hvad er der af historik med modstanderen (til pressemøder og optakt)? */
export function rivalryInfo(oppClub: number): { manager?: Staff; record?: [number, number, number]; formerClub: boolean; sackedHere: boolean } {
  const g = gs();
  const opp = g.clubs[oppClub];
  const m = opp && opp.manager > 0 ? g.staff[opp.manager] : undefined;
  const record = m ? g.manager.rivals?.[m.id] : undefined;
  const formerClub = g.manager.history.some((h) => h.club === oppClub);
  const sackedHere = (g.manager.sackedBy ?? []).includes(oppClub);
  return { manager: m, record, formerClub, sackedHere };
}
