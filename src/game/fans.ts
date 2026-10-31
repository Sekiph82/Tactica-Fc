// Fanstemning og bestyrelsesmøder. Fansenes humør (0-100) påvirker tilskuertallet og
// bestyrelsens tillid; det reagerer på resultater, billetpriser, stjernesalg og pressemøder.
import { A } from './attributes';
import { ageOn, daysBetween } from './dates';
import { fairTicketPrice } from './finance';
import { asOwner, isHumanClub } from './humans';
import { addNews, gs, squad } from './state';
import { storyAdd } from './story';
import type { Club, Player } from './types';

export const fanMood = (c: Club | undefined) => c?.fanMood ?? 60;

export function bumpFans(clubId: number, d: number, why?: string) {
  const g = gs();
  const c = g.clubs[clubId];
  if (!c || !isHumanClub(clubId)) return;
  c.fanMood = Math.max(0, Math.min(100, fanMood(c) + d));
  if (why) (c.fanEvents ??= []).push({ d: g.date, k: why, v: Math.round(d) });
  if (c.fanEvents && c.fanEvents.length > 12) c.fanEvents.splice(0, c.fanEvents.length - 12);
}

/**
 * Hvor stort et navn er en ny spiller for klubben? 0 = ingen særlig, 1 = god forstærkning, 2 = stjernekøb, 3 = sensation.
 * Kaldes efter at spilleren er skiftet til klubben.
 */
export function signingHype(p: Player, club: Club): 0 | 1 | 2 | 3 {
  const gap = p.rep - club.rep;
  const rank = squad(club.id).filter((x) => x.id !== p.id && x.ca > p.ca).length + 1; // nr. i truppen efter evne
  // et kendt navn tæller kun, hvis han også bliver en af de bedste i truppen
  let h: 0 | 1 | 2 | 3 = rank <= 2 && gap >= 20 ? 3 : (rank <= 3 && gap >= 8) || (rank <= 5 && gap >= 15) ? 2 : rank <= 6 && gap >= -3 ? 1 : 0;
  // veteraner på vej ned begejstrer mindre
  if (h > 0 && ageOn(p.dob, gs().date) >= 33) h = (h - 1) as 0 | 1 | 2;
  return h;
}

const HYPE_FANS = [0, 2.5, 6, 10];
const HYPE_BOARD = [0, 0.5, 2.5, 5];

/** Fans og bestyrelse reagerer på et nyt køb til en menneskestyret klub */
export function fansOnSigning(p: Player, club: Club, loan: boolean) {
  if (!isHumanClub(club.id)) return;
  let hype: number = signingHype(p, club);
  if (loan) hype = Math.max(0, hype - 1); // et lejemål er ikke helt det samme
  if (!hype) return;
  bumpFans(club.id, HYPE_FANS[hype], hype >= 2 ? 'starSigned' : 'goodSigning');
  if (hype >= 2 && !loan) asOwner(club.id, () => storyAdd({ k: 'signing', w: 3 + hype, pid: p.id, p: { player: `${p.first} ${p.last}`.trim() } }));
  asOwner(club.id, () => {
    const g = gs();
    g.board.confidence = Math.min(100, g.board.confidence + HYPE_BOARD[hype]);
    if (hype >= 2) addNews({ cat: 'general', key: `fans.signing${hype}`, params: { player: `${p.first} ${p.last}`.trim(), club: club.name }, link: { kind: 'player', id: p.id } });
  });
}

/**
 * Hvor meget holder fansene af en spiller i truppen? 0 = ingen særlig, 1 = fast mand, 2 = profil, 3 = stjerne/klubikon.
 * Ud fra hans plads i truppen, hans navn i forhold til klubben og hvor længe han har været der.
 */
export function fanStanding(p: Player, club: Club): 0 | 1 | 2 | 3 {
  const rank = squad(club.id).filter((x) => x.id !== p.id && !x.loan && x.ca > p.ca).length + 1;
  let h = rank <= 2 ? (p.rep >= club.rep - 5 ? 3 : 2) : rank <= 5 ? 2 : rank <= 11 ? 1 : 0;
  // klubikon: mange år i klubben
  if (h >= 1 && p.joined && ageOn(p.joined, gs().date) >= 5) h++;
  return Math.min(3, h) as 0 | 1 | 2 | 3;
}

const RENEW_FANS = [0, 1, 3, 5.5];
const SOLD_FANS = [0, -1, -3, -7];
const FREE_FANS = [0, -1.5, -4, -9];

/** Fansene jubler, når en profil forlænger */
export function fansOnRenewal(p: Player, club: Club) {
  if (!isHumanClub(club.id)) return;
  const h = fanStanding(p, club);
  if (!h) return;
  bumpFans(club.id, RENEW_FANS[h], h >= 2 ? 'starRenewed' : 'renewed');
  if (h >= 2) asOwner(club.id, () => addNews({ cat: 'general', key: `fans.renew${h}`, params: { player: `${p.first} ${p.last}`.trim(), club: club.name }, link: { kind: 'player', id: p.id } }));
}

/**
 * Fansene er kede af, at en spiller forlader klubben. Kaldes før han skifter.
 * how: 'sold' (en stor transfersum lindrer), 'free' (udløbet eller Bosman), 'released' (fritstillet af manageren)
 */
export function fansOnDeparture(p: Player, club: Club, how: 'sold' | 'free' | 'released', fee = 0) {
  if (!isHumanClub(club.id) || p.loan) return;
  const h = fanStanding(p, club);
  if (!h) return;
  let d = (how === 'sold' ? SOLD_FANS : FREE_FANS)[h];
  if (how === 'sold' && fee >= p.value * 1.5) d *= 0.6;
  bumpFans(club.id, d, how === 'sold' ? (h >= 2 ? 'starSold' : 'sold') : 'leftFree');
  if (h >= 2) asOwner(club.id, () => addNews({ cat: 'general', key: `fans.leave.${how}${h}`, params: { player: `${p.first} ${p.last}`.trim(), club: club.name }, link: { kind: 'player', id: p.id } }));
}

/** Tilskuerfaktor: glade fans fylder stadion, sure fans bliver hjemme (0,92-1,06) */
export function fanAttendance(c: Club): number {
  return isHumanClub(c.id) ? 0.92 + (fanMood(c) / 100) * 0.14 : 1;
}

/** Efter en kamp for en menneskestyret klub */
export function fansAfterMatch(clubId: number, scored: number, conceded: number, myStrength: number, oppStrength: number, derby: boolean) {
  const diff = scored - conceded;
  const favourite = myStrength - oppStrength;
  let d = diff > 0 ? 2.5 + (favourite < -8 ? 2 : 0) : diff === 0 ? (favourite > 8 ? -1.5 : 0.5) : -2.5 - (favourite > 8 ? 2 : 0);
  if (diff <= -3) d -= 2;
  if (diff >= 3) d += 1;
  if (derby) d *= 1.8;
  bumpFans(clubId, d, diff > 0 ? (derby ? 'derbyWin' : 'win') : diff < 0 ? (derby ? 'derbyLoss' : diff <= -3 ? 'thrashed' : 'loss') : 'draw');
}

/** Månedligt: billetpriser og langsom tilbagevenden mod normalen */
export function fansMonthly() {
  const g = gs();
  for (const c of Object.values(g.clubs)) {
    if (!isHumanClub(c.id)) continue;
    const ratio = c.ticketPrice / fairTicketPrice(c.rep, c.league);
    if (ratio > 1.25) bumpFans(c.id, -2.5, 'tickets');
    else if (ratio < 0.9) bumpFans(c.id, 1, 'cheapTickets');
    c.fanMood = fanMood(c) + (60 - fanMood(c)) * 0.06;
    // store udsving i stemningen (måned til måned) bliver en del af sæsonfortællingen
    const prev = c.fanMoodPrev ?? fanMood(c);
    const d = fanMood(c) - prev;
    if (Math.abs(d) >= 10) asOwner(c.id, () => storyAdd({ k: d > 0 ? 'fansUp' : 'fansDown', w: 2, p: { mood: Math.round(fanMood(c)) } }));
    c.fanMoodPrev = fanMood(c);
  }
}

/** Bestyrelsesmøde hvert kvartal (sep, dec, mar) – teksten skrives af AI når man åbner beskeden */
export function boardMeeting() {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (!club) return;
  const m = Number(g.date.slice(5, 7));
  if (![9, 12, 3].includes(m)) return;
  const comp = g.comps[club.league];
  const row = comp?.table.slice().sort((a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga)).findIndex((r) => r.club === club.id);
  addNews({ cat: 'board', key: 'board.meeting', params: { conf: Math.round(g.board.confidence), pos: row !== undefined && row >= 0 ? row + 1 : '-', expected: g.board.expectedPos, fans: Math.round(fanMood(club)), balance: Math.round(club.balance) } });
}

/** Hvor længe siden fans sidst reagerede på noget bestemt (til fanforum) */
export function recentFanEvents(c: Club, days = 45) {
  const g = gs();
  return (c.fanEvents ?? []).filter((e) => daysBetween(e.d, g.date) <= days);
}

// ---------- trofæer: hele klubben fejrer ----------

/**
 * Manageren har vundet et trofæ: bestyrelse, fans, anføreren og pressen hylder ham.
 * kind: 'league' (mesterskab), 'cup' (national pokal), 'europe' (europæisk turnering)
 */
export function celebrateTrophy(clubId: number, compName: string, kind: 'league' | 'cup' | 'europe') {
  const g = gs();
  const club = g.clubs[clubId];
  if (!club || !isHumanClub(clubId)) return;
  const big = kind === 'league' || kind === 'europe';
  bumpFans(clubId, big ? 14 : 9, 'trophy');
  asOwner(clubId, () => {
    const gg = gs();
    gg.board.confidence = Math.min(100, gg.board.confidence + (big ? 15 : 8));
    gg.manager.rep = Math.min(100, gg.manager.rep + (kind === 'europe' ? 5 : big ? 3 : 2));
    // holdet svæver
    for (const p of squad(clubId)) p.morale = Math.min(20, p.morale + 2);
    // hvor mange gange har manageren vundet netop denne turnering?
    const n = gg.manager.trophies.filter((x) => x.comp === compName).length + 1;
    const params = { club: club.name, comp: compName, manager: gg.manager.name, n };
    const lineup = gg.tactic?.lineup ?? [];
    const cap = gg.players[lineup[gg.tactic?.captain ?? 0] ?? 0] ?? squad(clubId).sort((a, b) => b.attrs[A.influence] - a.attrs[A.influence])[0];
    // nyeste øverst i indbakken: bestyrelsen først, så fans, anfører og presse
    addNews({ cat: 'general', key: `trophy.press.${kind}`, params });
    if (cap) addNews({ cat: 'contract', key: `trophy.captain.${kind}`, params: { ...params, player: `${cap.first} ${cap.last}`.trim() }, link: { kind: 'player', id: cap.id } });
    addNews({ cat: 'general', key: `trophy.fans.${kind}`, params });
    addNews({ cat: 'board', key: `trophy.board.${kind}${n > 1 ? 'Again' : ''}`, params });
  });
}
