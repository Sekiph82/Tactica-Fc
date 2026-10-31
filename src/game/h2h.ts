// Indbyrdes regnskab mellem managere i multiplayer (mennesker og AI-managere).
// Gemmes pr. manager (ikke pr. klub), så rivaliseringen følger med, når en manager skifter job.
import { gs } from './state';
import type { Fixture, H2HRecord } from './types';

/** Hvilken manager (slot) styrer klubben? */
function managerOf(clubId: number): string | null {
  const g = gs();
  if (!g.humans || !clubId) return null;
  if (g.userClub === clubId && g.active) return g.active;
  return g.humans.find((h) => h.pid !== g.active && h.userClub === clubId)?.pid ?? null;
}

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Efter en kamp: opdatér regnskabet, hvis begge hold styres af managere */
export function recordH2H(f: Fixture) {
  const g = gs();
  if (!g.humans || !f.result) return;
  const home = managerOf(f.home), away = managerOf(f.away);
  if (!home || !away || home === away) return;
  const k = key(home, away);
  const rec: H2HRecord = ((g.h2h ??= {})[k] ??= { a: k.split('|')[0], b: k.split('|')[1], w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  // mål set fra a's side
  const aHome = rec.a === home;
  const gf = aHome ? f.result.hg : f.result.ag;
  const ga = aHome ? f.result.ag : f.result.hg;
  // straffesparkskonkurrence afgør en pokalkamp, men tæller som uafgjort i regnskabet
  if (gf > ga) rec.w++; else if (gf < ga) rec.l++; else rec.d++;
  rec.gf += gf;
  rec.ga += ga;
  const diff = gf - ga;
  if (diff > 0 && (!rec.bestA || diff > rec.bestA[0] - rec.bestA[1] || (diff === rec.bestA[0] - rec.bestA[1] && gf > rec.bestA[0]))) rec.bestA = [gf, ga, f.date];
  if (diff < 0 && (!rec.bestB || -diff > rec.bestB[0] - rec.bestB[1] || (-diff === rec.bestB[0] - rec.bestB[1] && ga > rec.bestB[0]))) rec.bestB = [ga, gf, f.date];
  rec.last = { date: f.date, fixture: f.id, gf, ga, comp: g.comps[f.comp]?.name ?? '' };
}

export interface H2HView { w: number; d: number; l: number; gf: number; ga: number; best?: [number, number, string]; worst?: [number, number, string]; last?: { date: string; gf: number; ga: number; comp: string }; games: number }

/** Regnskabet set fra én managers side */
export function h2hFor(me: string, other: string): H2HView | null {
  const rec = gs().h2h?.[key(me, other)];
  if (!rec) return null;
  const mine = rec.a === me;
  return mine
    ? { w: rec.w, d: rec.d, l: rec.l, gf: rec.gf, ga: rec.ga, best: rec.bestA, worst: rec.bestB, last: rec.last, games: rec.w + rec.d + rec.l }
    : { w: rec.l, d: rec.d, l: rec.w, gf: rec.ga, ga: rec.gf, best: rec.bestB, worst: rec.bestA, last: rec.last && { ...rec.last, gf: rec.last.ga, ga: rec.last.gf }, games: rec.w + rec.d + rec.l };
}
