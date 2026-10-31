// Præstationer (achievements): mål på tværs af karrieren, låses op én gang og vises på managerprofilen.
import { ageOn } from './dates';
import { asOwner } from './humans';
import { t } from '../i18n';
import { addNews, gs } from './state';
import type { Fixture, MatchReport } from './types';

export type AchId =
  | 'firstWin' | 'bigWin' | 'winStreak5' | 'unbeaten10' | 'century' | 'giantKiller' | 'comeback' | 'hattrick' | 'shootout'
  | 'fullHouse' | 'kidsWin' | 'europe' | 'title' | 'cup' | 'clWin' | 'promotion' | 'doublePromotion' | 'survivor' | 'loyal' | 'legend' | 'bigSale' | 'patron';

/** Rækkefølge og sværhedsgrad (bronze/sølv/guld) */
export const ACHIEVEMENTS: { id: AchId; icon: string; tier: 1 | 2 | 3 }[] = [
  { id: 'firstWin', icon: '✅', tier: 1 }, { id: 'bigWin', icon: '💥', tier: 1 }, { id: 'hattrick', icon: '🎩', tier: 1 }, { id: 'fullHouse', icon: '🏟️', tier: 1 },
  { id: 'shootout', icon: '🎯', tier: 1 }, { id: 'europe', icon: '🌍', tier: 1 }, { id: 'giantKiller', icon: '🪓', tier: 2 }, { id: 'comeback', icon: '🔄', tier: 2 },
  { id: 'winStreak5', icon: '🔥', tier: 2 }, { id: 'unbeaten10', icon: '🛡️', tier: 2 }, { id: 'kidsWin', icon: '🐣', tier: 2 }, { id: 'survivor', icon: '🧗', tier: 2 },
  { id: 'promotion', icon: '⬆️', tier: 2 }, { id: 'cup', icon: '🏆', tier: 2 }, { id: 'bigSale', icon: '💰', tier: 2 }, { id: 'loyal', icon: '🤝', tier: 2 },
  { id: 'legend', icon: '⭐', tier: 3 }, { id: 'century', icon: '💯', tier: 3 }, { id: 'title', icon: '👑', tier: 3 }, { id: 'doublePromotion', icon: '🚀', tier: 3 },
  { id: 'clWin', icon: '🌟', tier: 3 },
  { id: 'patron', icon: '💛', tier: 3 },
];

/** Lås en præstation op for den aktive manager (én gang) */
export function unlock(id: AchId) {
  const g = gs();
  // draft-liga: ingen præstationer
  if (g.draft) return;
  const a = (g.manager.ach ??= {});
  if (a[id]) return;
  a[id] = g.date;
  addNews({ cat: 'award', key: 'ach.unlocked', params: { name: t(`ach.${id}`), icon: ACHIEVEMENTS.find((x) => x.id === id)?.icon ?? '🏅' } });
}

/** Efter hver kamp for en menneskestyret klub */
export function achievementsAfterMatch(f: Fixture, rep: MatchReport, att: number) {
  const g = gs();
  for (const side of [0, 1] as const) {
    const cid = side === 0 ? f.home : f.away;
    if (g.clubs[cid]?.manager !== -1) continue;
    asOwner(cid, () => {
      const st = (g.manager.achStats ??= { wins: 0, streak: 0, unbeaten: 0 });
      const gf = rep.stats[side].goals, ga = rep.stats[1 - side].goals;
      const pensWon = !!rep.pens && rep.pens[side] > rep.pens[1 - side];
      const won = gf > ga || pensWon;
      const lost = gf < ga || (!!rep.pens && !pensWon);
      if (won) { st.wins++; st.streak++; } else st.streak = 0;
      if (lost) st.unbeaten = 0; else st.unbeaten++;
      if (gf > ga) unlock('firstWin');
      if (gf - ga >= 5) unlock('bigWin');
      if (st.streak >= 5) unlock('winStreak5');
      if (st.unbeaten >= 10) unlock('unbeaten10');
      if (st.wins >= 100) unlock('century');
      if (pensWon) unlock('shootout');
      const opp = g.clubs[side === 0 ? f.away : f.home], me = g.clubs[cid];
      if (gf > ga && opp && me && opp.rep >= me.rep + 20) unlock('giantKiller');
      if (rep.players.some((l) => l.team === side && l.goals >= 3)) unlock('hattrick');
      if (g.comps[f.comp]?.type === 'continental') unlock('europe');
      if (side === 0 && me && att >= me.seats) unlock('fullHouse');
      // comeback: bagud med to mål og vandt
      if (gf > ga) {
        let diff = 0, worst = 0;
        for (const e of rep.events.filter((x) => x.k === 'goal').sort((a, b) => a.m - b.m)) { diff += e.t === side ? 1 : -1; worst = Math.min(worst, diff); }
        if (worst <= -2) unlock('comeback');
      }
      // unge sejrherrer: startopstillingens gennemsnitsalder under 23
      if (gf > ga) {
        const xi = rep.players.filter((l) => l.team === side && !l.sub).map((l) => g.players[l.id]).filter(Boolean);
        if (xi.length >= 11 && xi.reduce((s, p) => s + ageOn(p.dob, g.date), 0) / xi.length < 23) unlock('kidsWin');
      }
    });
  }
}

/** Efter op- og nedrykning: oprykning (to i træk), overlevelse og loyalitet */
export function achievementsSeasonEnd(tierBefore: Map<number, number>) {
  const g = gs();
  for (const c of Object.values(g.clubs)) {
    if (c.manager !== -1) continue;
    asOwner(c.id, () => {
      const before = tierBefore.get(c.id) ?? 9, after = g.leagues[c.league]?.tier ?? 9;
      const st = (g.manager.achStats ??= { wins: 0, streak: 0, unbeaten: 0 });
      if (after < before) {
        unlock('promotion');
        if (st.lastPromotion === g.season - 1) unlock('doublePromotion');
        st.lastPromotion = g.season;
      }
      if (g.board.expectation === 'survive' && after <= before) unlock('survivor');
      const h = g.manager.history;
      let run = 0;
      for (let i = h.length - 1; i >= 0 && h[i].club === c.id; i--) run++;
      if (run >= 5) unlock('loyal');
    });
  }
}
