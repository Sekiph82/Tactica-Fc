// Prøvespillere: en klubløs spiller inviteres til to ugers prøvetræning. Hver dag lærer trænerne ham bedre at kende
// (attributintervallerne snævres ind), og til sidst kommer en vurdering. Kontrakt tilbydes som normalt bagefter.
import { addDays, daysBetween } from './dates';
import { forEachHuman } from './humans';
import { scoutStars } from './scouting';
import { addNews, gs, squad } from './state';

export const TRIAL_DAYS = 14;
export const MAX_TRIALS = 3;

export function trialOf(pid: number) {
  return gs().manager.trials?.find((x) => x.pid === pid);
}

export function inviteTrial(pid: number): 'ok' | 'notFree' | 'full' | 'already' | 'error' {
  const g = gs();
  const p = g.players[pid];
  if (!p || !g.userClub) return 'error';
  if (p.club) return 'notFree';
  const list = (g.manager.trials ??= []);
  if (list.some((x) => x.pid === pid)) return 'already';
  if (list.length >= MAX_TRIALS) return 'full';
  list.push({ pid, start: g.date, end: addDays(g.date, TRIAL_DAYS), startK: g.knowledge[pid] ?? 0 });
  addNews({ cat: 'scout', key: 'trial.started', params: { player: `${p.first} ${p.last}`.trim(), days: TRIAL_DAYS }, link: { kind: 'player', id: pid } });
  return 'ok';
}

export function endTrial(pid: number) {
  const g = gs();
  g.manager.trials = (g.manager.trials ?? []).filter((x) => x.pid !== pid);
}

/** Dagligt: trænerne lærer prøvespilleren at kende; ved slutningen kommer en vurdering */
export function trialsDaily() {
  const g = gs();
  forEachHuman(() => {
    const list = g.manager.trials;
    if (!list?.length) return;
    const coaches = Object.values(g.staff).filter((s) => s.club === g.userClub && (s.role === 'coach' || s.role === 'assistant'));
    const judge = coaches.reduce((a, s) => Math.max(a, s.attrs.judgingAbility, s.attrs.judgingPotential), 8);
    for (const tr of list.slice()) {
      const p = g.players[tr.pid];
      const name = p ? `${p.first} ${p.last}`.trim() : '';
      // en anden klub skrev kontrakt med ham undervejs
      if (!p || p.club) {
        endTrial(tr.pid);
        if (p && p.club !== g.userClub) addNews({ cat: 'scout', key: 'trial.signedElsewhere', params: { player: name, club: g.clubs[p.club]?.name ?? '' }, link: { kind: 'player', id: tr.pid } });
        continue;
      }
      // fra startviden op til fuldt kendt over de 14 dage (gode bedømmere når hurtigere frem)
      const step = (100 - tr.startK) / TRIAL_DAYS * (0.8 + judge / 50);
      g.knowledge[tr.pid] = Math.min(100, (g.knowledge[tr.pid] ?? 0) + step);
      if (g.date >= tr.end) {
        g.knowledge[tr.pid] = 100;
        const st = scoutStars(p);
        const level = squad(g.userClub).map((x) => x.ca).sort((a, b) => b - a).slice(0, 14);
        const avg = level.reduce((a, v) => a + v, 0) / Math.max(1, level.length);
        const verdict = p.ca >= avg + 5 ? 'star' : p.ca >= avg - 8 ? 'good' : p.pa >= avg + 5 ? 'prospect' : 'notGood';
        addNews({ cat: 'scout', key: `trial.verdict.${verdict}`, params: { player: name, ab: (st.ability[0] + st.ability[1]) / 2, pot: (st.potential[0] + st.potential[1]) / 2, days: daysBetween(tr.start, g.date) }, link: { kind: 'player', id: tr.pid } });
        endTrial(tr.pid);
      }
    }
  });
}
