// Spillerpersonligheder, holdkemi og stjerner der vil sælges (forslag #8).
import { A } from './attributes';
import { ageOn, addDays, daysBetween } from './dates';
import { finalOrder, leagueRows } from './competitions';
import { asOwner, isHumanClub } from './humans';
import { rng } from './rng';
import { clubLevel } from './scouting';
import { coachingInfo } from './training';
import { addNews, gs, hasGame, squad } from './state';
import type { Player, Tactic } from './types';

export type Trait = 'leader' | 'professional' | 'troublemaker' | 'ambitious' | 'loyal' | 'mercenary' | 'bigGame' | 'lazy' | 'temperamental';

/** Personlighed afledt af de skjulte attributter (højst tre træk) */
export function traits(p: Player): Trait[] {
  const a = p.attrs;
  const out: [Trait, number][] = [];
  if (a[A.influence] >= 15 && a[A.determination] >= 13) out.push(['leader', a[A.influence]]);
  if (a[A.professionalism] >= 16) out.push(['professional', a[A.professionalism]]);
  if (a[A.temperament] <= 6 || (a[A.sportsmanship] <= 5 && a[A.aggression] >= 14)) out.push(['troublemaker', 20 - a[A.temperament]]);
  else if (a[A.temperament] <= 8) out.push(['temperamental', 18 - a[A.temperament]]);
  if (a[A.ambition] >= 16) out.push(['ambitious', a[A.ambition]]);
  if (a[A.loyalty] >= 16) out.push(['loyal', a[A.loyalty]]);
  else if (a[A.loyalty] <= 5 && a[A.ambition] >= 13) out.push(['mercenary', 20 - a[A.loyalty]]);
  if (a[A.importantMatches] >= 16) out.push(['bigGame', a[A.importantMatches]]);
  if (a[A.professionalism] <= 6 && a[A.workRate] <= 9) out.push(['lazy', 20 - a[A.professionalism]]);
  return out.sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t]) => t);
}

export const GOOD_TRAITS = new Set<Trait>(['leader', 'professional', 'loyal', 'bigGame']);

/** Har spilleren været i klubben længe? (ingen ankomstdato = var der ved spilstart) */
function tenureYears(p: Player): number {
  const g = gs();
  if (!p.joined) return 2 + (ageOn(p.dob, g.date) > 24 ? 1 : 0);
  return Math.max(0, daysBetween(p.joined, g.date) / 365);
}

export interface Chemistry {
  score: number; // 0-100
  parts: { key: string; value: number; params?: Record<string, string | number> }[];
}

/** Holdkemi for en startopstilling */
export function chemistry(players: Player[], captainId?: number): Chemistry {
  const xi = players.filter(Boolean);
  // draft-liga: ingen kemi (nationalitet, tid sammen osv.) – alle hold er lige
  if (!xi.length || (hasGame() && gs().draft)) return { score: 50, parts: [] };
  const parts: Chemistry['parts'] = [];
  // fælles nationalitet: par af spillere fra samme land
  const byNation = new Map<number, number>();
  for (const p of xi) byNation.set(p.nation, (byNation.get(p.nation) ?? 0) + 1);
  let pairs = 0;
  for (const n of byNation.values()) pairs += (n * (n - 1)) / 2;
  const nat = Math.min(14, pairs * 0.7);
  parts.push({ key: 'chem.nation', value: Math.round(nat), params: { n: Math.max(...byNation.values()) } });
  // tid sammen i klubben
  const tenure = xi.reduce((s, p) => s + Math.min(4, tenureYears(p)), 0) / xi.length;
  const ten = Math.round(Math.min(18, tenure * 6) - 6);
  parts.push({ key: 'chem.tenure', value: ten, params: { years: tenure.toFixed(1) } });
  // nye spillere skal lige falde til
  const newcomers = xi.filter((p) => tenureYears(p) < 0.25).length;
  if (newcomers) parts.push({ key: 'chem.newcomers', value: -newcomers * 2.5, params: { n: newcomers } });
  // ledere og problembørn
  const all = xi.map(traits);
  const leaders = all.filter((t) => t.includes('leader')).length;
  if (leaders) parts.push({ key: 'chem.leaders', value: Math.min(10, leaders * 4), params: { n: leaders } });
  const captain = xi.find((p) => p.id === captainId);
  if (captain && traits(captain).includes('leader')) parts.push({ key: 'chem.captain', value: 4 });
  const trouble = all.filter((t) => t.includes('troublemaker')).length;
  if (trouble) parts.push({ key: 'chem.trouble', value: -trouble * 5, params: { n: trouble } });
  const away = xi.filter((p) => p.wantsAway).length;
  if (away) parts.push({ key: 'chem.wantsAway', value: -away * 4, params: { n: away } });
  const pros = all.filter((t) => t.includes('professional')).length;
  if (pros >= 3) parts.push({ key: 'chem.pros', value: 4 });
  // træningslejr i denne sæson: tid sammen giver et løft
  const club = gs().clubs[xi[0]?.club ?? 0];
  if (club?.campBond && club.campBond.season === gs().season) parts.push({ key: 'chem.camp', value: club.campBond.pts });
  const score = Math.max(0, Math.min(100, Math.round(50 + parts.reduce((s, x) => s + x.value, 0))));
  return { score, parts };
}

/** Kemi → moral-bonus i matchmotoren (-1..1, ca. ±3 % på evnerne) */
export function chemistryMorale(tactic: Tactic): number {
  const g = gs();
  const xi = tactic.lineup.map((id) => g.players[id]).filter(Boolean);
  return (chemistry(xi, tactic.captain).score - 50) / 50;
}

// ---------- stjerner der vil sælges og problembørn ----------

/** Månedligt for menneskestyrede klubber */
export function monthlyPersonality() {
  const g = gs();
  for (const c of Object.values(g.clubs)) {
    if (!isHumanClub(c.id)) continue;
    const comp = g.comps[c.league];
    const pos = comp ? leagueRows(comp).findIndex((r) => r.club === c.id) + 1 : 99;
    const level = clubLevel(c.id);
    const won = c.history.slice(-2).some((h) => h.pos === 1);
    for (const p of squad(c.id)) {
      const t = traits(p);
      // løfter der ikke blev holdt
      if (p.promiseUntil && g.date >= p.promiseUntil) {
        p.promiseUntil = undefined;
        if (pos > 3 && !won) {
          p.wantsAway = true;
          p.morale = Math.max(1, p.morale - 6);
          asOwner(c.id, () => addNews({ cat: 'contract', key: 'pers.brokenPromise', params: { player: `${p.first} ${p.last}` }, link: { kind: 'player', id: p.id } }));
          continue;
        }
      }
      // ambitiøse stjerner vil videre hvis klubben ikke vinder
      const star = p.ca >= level + 8 && (t.includes('ambitious') || t.includes('mercenary'));
      if (star && !p.wantsAway && !p.promiseUntil && !p.listed && pos > 2 && !won && g.date.slice(5, 7) !== '07' && rng.chance(t.includes('mercenary') ? 0.12 : 0.06)) {
        p.wantsAway = true;
        p.morale = Math.max(1, p.morale - 4);
        asOwner(c.id, () => addNews({ cat: 'contract', key: 'pers.wantsAway', params: { player: `${p.first} ${p.last}` }, link: { kind: 'player', id: p.id } }));
      }
      if (p.wantsAway) p.morale = Math.min(p.morale, 8);
      // problembørn og hidsige spillere kan falde til ro over tid
      if (t.includes('troublemaker') || t.includes('temperamental')) reformStep(p, c.id);
      // problembørn laver ballade – sjældnere, jo længere rehabiliteringen er nået
      if (traits(p).includes('troublemaker') && rng.chance(0.12 * (1 - (p.reform ?? 0) / 160))) {
        const incident = rng.pick(['late', 'fight', 'nightclub', 'media']);
        p.lastIncident = g.date;
        p.morale = Math.max(1, p.morale - 2);
        for (const mate of squad(c.id)) if (mate !== p) mate.morale = Math.max(1, mate.morale - 0.3);
        asOwner(c.id, () => addNews({ cat: 'general', key: `pers.incident.${incident}`, params: { player: `${p.first} ${p.last}` }, link: { kind: 'player', id: p.id } }));
      }
      // ledere løfter omklædningsrummet
      if (t.includes('leader') && p.form.length && p.form[p.form.length - 1] >= 7) {
        for (const mate of squad(c.id)) mate.morale = Math.min(20, mate.morale + 0.15);
      }
    }
  }
}

export interface ReformFactor { key: string; value: number }

/**
 * Hvad der lige nu hjælper eller trækker ned i en hidsig spillers rehabilitering (point pr. måned).
 * Ledere i truppen, trænere med disciplin, spilletid, god moral og ro på (ingen episoder) hjælper;
 * nye episoder og høj alder trækker ned.
 */
export function reformFactors(p: Player, clubId: number): ReformFactor[] {
  const g = gs();
  const out: ReformFactor[] = [{ key: 'reform.f.base', value: 3 }];
  const mates = squad(clubId).filter((x) => x.id !== p.id);
  const leaders = mates.filter((x) => traits(x).includes('leader')).length;
  if (leaders) out.push({ key: 'reform.f.leaders', value: Math.min(8, leaders * 4) });
  const tac = clubId === g.userClub ? g.tactic : undefined;
  const captain = tac ? g.players[tac.captain] : undefined;
  if (captain && captain.id !== p.id && traits(captain).includes('leader')) out.push({ key: 'reform.f.captain', value: 3 });
  const ci = coachingInfo(clubId);
  out.push({ key: 'reform.f.discipline', value: Math.round((ci.discipline - 0.5) * 16) });
  if (tac?.lineup.includes(p.id)) out.push({ key: 'reform.f.plays', value: 4 });
  if (p.morale >= 14) out.push({ key: 'reform.f.happy', value: 3 });
  else if (p.morale <= 8) out.push({ key: 'reform.f.unhappy', value: -4 });
  if (p.attrs[A.professionalism] >= 13) out.push({ key: 'reform.f.pro', value: 3 });
  const age = ageOn(p.dob, g.date);
  if (age <= 23) out.push({ key: 'reform.f.young', value: 3 });
  else if (age >= 30) out.push({ key: 'reform.f.old', value: -3 });
  if (p.lastIncident && daysBetween(p.lastIncident, g.date) <= 30) out.push({ key: 'reform.f.incident', value: -10 });
  if (p.wantsAway) out.push({ key: 'reform.f.wantsAway', value: -5 });
  return out.filter((f) => f.value !== 0);
}

/** Én måneds rehabilitering. Ved 100 falder spilleren til ro: temperamentet (og evt. sportsånden) stiger. */
function reformStep(p: Player, clubId: number) {
  const gain = reformFactors(p, clubId).reduce((s, f) => s + f.value, 0);
  p.reform = Math.max(0, Math.min(100, (p.reform ?? 0) + gain));
  if (p.reform < 100) return;
  p.reform = 0;
  const wasTrouble = traits(p).includes('troublemaker');
  p.attrs[A.temperament] = Math.min(20, p.attrs[A.temperament] + 1);
  if (p.attrs[A.sportsmanship] <= 5) p.attrs[A.sportsmanship] += 1;
  const now = traits(p);
  const key = wasTrouble && !now.includes('troublemaker') ? 'reform.news.noLongerTrouble'
    : !now.includes('troublemaker') && !now.includes('temperamental') ? 'reform.news.calm' : 'reform.news.progress';
  asOwner(clubId, () => addNews({ cat: 'general', key, params: { player: `${p.first} ${p.last}` }, link: { kind: 'player', id: p.id } }));
}

/** Rehabiliteringen påvirkes af, hvordan manageren håndterer spilleren */
function reformNudge(p: Player, d: number) {
  const t = traits(p);
  if (t.includes('troublemaker') || t.includes('temperamental')) p.reform = Math.max(0, Math.min(99, (p.reform ?? 0) + d));
}

/** Manageren taler med en utilfreds stjerne */
export function talkToPlayer(pid: number, choice: 'promise' | 'list' | 'refuse'): string {
  const g = gs();
  const p = g.players[pid];
  if (!p || p.club !== g.userClub || !p.wantsAway) return 'error';
  if (choice === 'promise') {
    if (p.promiseUntil) return 'pers.talk.noMorePromises';
    p.wantsAway = false;
    p.promiseUntil = addDays(g.date, 240);
    p.morale = Math.min(20, p.morale + 4);
    return 'pers.talk.promised';
  }
  if (choice === 'list') {
    p.listed = true;
    p.wantsAway = false;
    p.morale = Math.min(20, p.morale + 3);
    return 'pers.talk.listed';
  }
  // nægt: risiko for at han bliver endnu mere sur, men han kan også acceptere
  if (traits(p).includes('loyal') || rng.chance(0.3)) {
    p.wantsAway = false;
    p.morale = Math.min(20, p.morale + 1);
    return 'pers.talk.accepted';
  }
  p.morale = Math.max(1, p.morale - 4);
  for (const mate of squad(g.userClub)) if (mate !== p) mate.morale = Math.max(1, mate.morale - 0.5);
  return 'pers.talk.furious';
}

export { finalOrder };

// ---------- samtaler med spillerne ----------

export type TalkKind = 'praise' | 'criticise' | 'encourage' | 'fine' | 'fineHeavy' | 'drop' | 'demand' | 'chat' | 'future';

function recentForm(p: Player): number {
  const f = p.form.slice(-3);
  return f.length ? f.reduce((s, x) => s + x, 0) / f.length : 6.6;
}

/** Ros, kritik, opmuntring eller straf. Reaktionen afhænger af form, personlighed og om det er fortjent. */
export function interact(pid: number, kind: TalkKind): { key: string; mood: 'good' | 'bad' | 'neutral' } {
  const g = gs();
  const p = g.players[pid];
  const club = g.clubs[g.userClub];
  if (!p || !club || p.club !== club.id) return { key: 'talk.r.error', mood: 'neutral' };
  if (p.lastTalk && daysBetween(p.lastTalk, g.date) < 10) return { key: 'talk.r.tooSoon', mood: 'neutral' };
  p.lastTalk = g.date;
  const t = traits(p);
  const form = recentForm(p);
  const played = p.form.length > 0;
  const det = p.attrs[A.determination];
  const hot = t.includes('troublemaker') || t.includes('temperamental');
  const bump = (d: number) => { p.morale = Math.max(1, Math.min(20, p.morale + d)); };
  const fire = (days: number) => { p.fired = addDays(g.date, days); };
  const misbehaved = (p.lastIncident && daysBetween(p.lastIncident, g.date) <= 45) || (p.lastRed && daysBetween(p.lastRed, g.date) <= 30);

  switch (kind) {
    case 'praise':
      if (!played) { bump(0.5); return { key: 'talk.r.praiseNoGames', mood: 'neutral' }; }
      if (form >= 7) { bump(2.5); fire(14); return { key: 'talk.r.praiseDeserved', mood: 'good' }; }
      if (form >= 6.6) { bump(1.2); return { key: 'talk.r.praiseOk', mood: 'good' }; }
      // ufortjent ros
      if (t.includes('professional')) { bump(-0.5); return { key: 'talk.r.praiseSeeThrough', mood: 'bad' }; }
      bump(0.8);
      return { key: 'talk.r.praiseUndeserved', mood: 'neutral' };
    case 'criticise':
      if (played && form >= 7) { bump(-3); if (hot) p.unhappy = Math.min(100, (p.unhappy ?? 0) + 25); return { key: 'talk.r.critUnfair', mood: 'bad' }; }
      if (hot) { bump(-4); reformNudge(p, -8); p.unhappy = Math.min(100, (p.unhappy ?? 0) + 30); return { key: 'talk.r.critExplodes', mood: 'bad' }; }
      if (det >= 14 || t.includes('professional') || t.includes('leader')) { bump(1); fire(21); return { key: 'talk.r.critFiredUp', mood: 'good' }; }
      if (det <= 8) { bump(-2.5); return { key: 'talk.r.critSulks', mood: 'bad' }; }
      bump(-1); fire(10);
      return { key: 'talk.r.critAccepts', mood: 'neutral' };
    case 'encourage':
      if (p.morale <= 10 || (played && form < 6.4)) { bump(2); reformNudge(p, 4); return { key: 'talk.r.encourageHelps', mood: 'good' }; }
      reformNudge(p, 2);
      bump(0.5);
      return { key: 'talk.r.encourageFine', mood: 'neutral' };
    case 'fine':
    case 'fineHeavy': {
      const weeks = kind === 'fine' ? 1 : 2;
      const amount = Math.round((p.contract?.wage ?? 0) * weeks);
      if (misbehaved) {
        club.balance += amount;
        club.finance.other -= amount;
        bump(kind === 'fine' ? -1.5 : -3);
        p.lastIncident = undefined;
        p.lastRed = undefined;
        // konsekvent, fair straf er den bedste vej ud af dårlige vaner
        reformNudge(p, kind === 'fine' ? 12 : 8);
        // truppen respekterer konsekvent ledelse
        for (const mate of squad(club.id)) if (mate !== p) mate.morale = Math.min(20, mate.morale + 0.3);
        if (hot && kind === 'fineHeavy' && rng.chance(0.4)) { p.wantsAway = true; return { key: 'talk.r.fineWantsAway', mood: 'bad' }; }
        return { key: 'talk.r.fineAccepted', mood: 'neutral' };
      }
      // straf uden grund
      bump(-5);
      reformNudge(p, -15);
      p.unhappy = Math.min(100, (p.unhappy ?? 0) + 40);
      for (const mate of squad(club.id)) if (mate !== p) mate.morale = Math.max(1, mate.morale - 0.4);
      if (!t.includes('loyal') && rng.chance(0.5)) p.wantsAway = true;
      return { key: 'talk.r.fineUnjust', mood: 'bad' };
    }
    case 'demand':
      // krav om mere – virker på de målrettede, provokerer de hidsige
      if (hot) { bump(-1.5); reformNudge(p, -4); p.unhappy = Math.min(100, (p.unhappy ?? 0) + 10); return { key: 'talk.r.demandAngry', mood: 'bad' }; }
      if (det >= 12 || t.includes('professional') || t.includes('leader')) { bump(0.5); fire(14); return { key: 'talk.r.demandAccepted', mood: 'good' }; }
      bump(-0.3);
      return { key: 'talk.r.demandOk', mood: 'neutral' };
    case 'chat':
      bump(p.morale < 10 ? 0.8 : 0.3);
      reformNudge(p, 3);
      return { key: 'talk.r.chat', mood: 'neutral' };
    case 'future': {
      // "du er fremtiden": et talent med potentiale til at blive en af de bedste vokser af det
      const age = ageOn(p.dob, g.date);
      const level = squad(club.id).map((x) => x.ca).sort((a, b) => b - a).slice(0, 11).reduce((s, v, _, arr) => s + v / arr.length, 0);
      const again = p.toldFuture && daysBetween(p.toldFuture, g.date) < 120;
      p.toldFuture = g.date;
      if (age > 23) { bump(-0.3); return { key: 'talk.r.futureTooOld', mood: 'neutral' }; }
      if (again) { bump(0.3); return { key: 'talk.r.futureAgain', mood: 'neutral' }; }
      if (p.pa >= level + 5) {
        bump(2.5); fire(21);
        p.unhappy = Math.max(0, (p.unhappy ?? 0) - 20);
        if (p.wantsAway && t.includes('loyal')) p.wantsAway = false;
        return { key: 'talk.r.futureBelieves', mood: 'good' };
      }
      if (p.pa >= level - 10) { bump(1.2); return { key: 'talk.r.futureHopeful', mood: 'good' }; }
      bump(0.3);
      return { key: 'talk.r.futureDoubt', mood: 'neutral' };
    }
    case 'drop':
      // sat af holdet som straf
      if (g.tactic) g.tactic = { ...g.tactic, lineup: g.tactic.lineup.map((id) => (id === pid ? 0 : id)), bench: g.tactic.bench.filter((id) => id !== pid) };
      if (misbehaved) { bump(-1.5); reformNudge(p, 6); for (const mate of squad(club.id)) if (mate !== p) mate.morale = Math.min(20, mate.morale + 0.2); return { key: 'talk.r.dropDeserved', mood: 'neutral' }; }
      bump(-3.5);
      p.unhappy = Math.min(100, (p.unhappy ?? 0) + 25);
      return { key: 'talk.r.dropUnjust', mood: 'bad' };
  }
}

export type TeamTalkKind = 'praise' | 'criticise' | 'demand' | 'calm';

/** Holdmøde: påvirker hele truppen ud fra de seneste resultater */
export function teamTalk(kind: TeamTalkKind): { key: string; mood: 'good' | 'bad' | 'neutral' } {
  const g = gs();
  const club = g.clubs[g.userClub];
  if (!club) return { key: 'talk.r.error', mood: 'neutral' };
  if (g.board.lastTeamTalk && daysBetween(g.board.lastTeamTalk, g.date) < 14) return { key: 'team.r.tooSoon', mood: 'neutral' };
  g.board.lastTeamTalk = g.date;
  const form = g.comps[club.league]?.table.find((r) => r.club === club.id)?.form ?? '';
  const recent = form.slice(-5);
  const wins = (recent.match(/W/g) ?? []).length;
  const losses = (recent.match(/L/g) ?? []).length;
  const players = squad(club.id);
  const all = (d: (p: Player) => number) => { for (const p of players) p.morale = Math.max(1, Math.min(20, p.morale + d(p))); };
  switch (kind) {
    case 'praise':
      if (wins >= 3) { all(() => 1.5); return { key: 'team.r.praiseDeserved', mood: 'good' }; }
      if (losses >= 3) { all((p) => (traits(p).includes('professional') ? -0.5 : 0.3)); return { key: 'team.r.praiseOdd', mood: 'neutral' }; }
      all(() => 0.6);
      return { key: 'team.r.praiseOk', mood: 'good' };
    case 'criticise':
      if (wins >= 3) { all(() => -1.5); return { key: 'team.r.critUnfair', mood: 'bad' }; }
      all((p) => (p.attrs[A.determination] >= 14 ? 0.8 : traits(p).some((x) => x === 'troublemaker' || x === 'temperamental') ? -1.5 : -0.4));
      for (const p of players) if (p.attrs[A.determination] >= 14) p.fired = addDays(g.date, 14);
      return { key: 'team.r.critReaction', mood: 'neutral' };
    case 'demand':
      all((p) => (p.morale >= 12 ? 0.6 : -0.6));
      for (const p of players) if (p.morale >= 12) p.fired = addDays(g.date, 10);
      return { key: 'team.r.demand', mood: 'neutral' };
    case 'calm':
      if (losses >= 2) { all(() => 1); return { key: 'team.r.calmHelps', mood: 'good' }; }
      all(() => 0.3);
      return { key: 'team.r.calmFine', mood: 'neutral' };
  }
}
