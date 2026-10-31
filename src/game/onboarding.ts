// Første arbejdsdag: tre korte opgaver (svageste position, spillestil, transferbehov) og et oplæg fra assistenten.
import { A, naturalRole, roleScore } from './attributes';
import { ageOn } from './dates';
import { addNews, gs, squad } from './state';
import { autoSelect, changeFormation } from './tactics';
import { askingPrice, transferRealism } from './transfers';
import type { Player, Role, TeamInstructions } from './types';

export type NeedKey = 'gk' | 'cb' | 'fb' | 'mid' | 'wide' | 'att';
export const NEED_GROUPS: { key: NeedKey; roles: Role[]; n: number }[] = [
  { key: 'gk', roles: ['GK'], n: 1 }, { key: 'cb', roles: ['CB'], n: 2 }, { key: 'fb', roles: ['FB'], n: 2 },
  { key: 'mid', roles: ['DM', 'CM'], n: 3 }, { key: 'wide', roles: ['WM', 'W', 'AM'], n: 2 }, { key: 'att', roles: ['ST'], n: 2 },
];

const best = (p: Player, roles: Role[]) => Math.max(...roles.map((r) => roleScore(p, r)));

/** Truppens positioner fra svageste til stærkeste (de bedste n spillere i hver gruppe) */
export function squadNeeds(clubId: number) {
  const sq = squad(clubId).filter((p) => !p.loan || p.loan.from !== clubId);
  const rows = NEED_GROUPS.map((gr) => {
    const cands = sq.filter((p) => gr.roles.includes(naturalRole(p))).sort((a, b) => best(b, gr.roles) - best(a, gr.roles));
    const top = cands.slice(0, gr.n);
    // mangler der folk, tæller hullet som en svag spiller
    const scores = [...top.map((p) => best(p, gr.roles)), ...new Array(Math.max(0, gr.n - top.length)).fill(6)];
    const score = scores.reduce((a, v) => a + v, 0) / gr.n;
    return { key: gr.key, score: Math.round(score * 10) / 10, players: top.map((p) => p.id), depth: cands.length };
  });
  const avg = rows.reduce((a, r) => a + r.score, 0) / rows.length;
  return rows.map((r) => ({ ...r, gap: Math.round((r.score - avg) * 10) / 10 })).sort((a, b) => a.gap - b.gap);
}

export type StyleKey = 'possession' | 'counter' | 'press' | 'solid';
export const STYLES: Record<StyleKey, { formation: string; ti: Partial<TeamInstructions>; keys: number[] }> = {
  possession: { formation: '4-3-3', ti: { mentality: 2, passing: 0, tempo: 1, width: 2, closingDown: 1, counter: false }, keys: [A.passing, A.technique, A.decisions, A.creativity] },
  counter: { formation: '4-4-2', ti: { mentality: 1, passing: 2, tempo: 2, width: 1, closingDown: 1, counter: true }, keys: [A.pace, A.acceleration, A.offTheBall, A.finishing] },
  press: { formation: '4-2-3-1', ti: { mentality: 3, passing: 1, tempo: 2, width: 1, closingDown: 2, counter: false }, keys: [A.workRate, A.stamina, A.teamwork, A.aggression] },
  solid: { formation: '5-3-2', ti: { mentality: 1, passing: 1, tempo: 1, width: 0, closingDown: 1, counter: true }, keys: [A.positioning, A.marking, A.tackling, A.strength] },
};

/** Hvor godt passer truppens 14 bedste spillere til stilen (gennemsnit af stilens nøgleattributter, 1-20) */
export function styleFit(clubId: number, style: StyleKey): number {
  const sq = squad(clubId).sort((a, b) => b.ca - a.ca).slice(0, 14);
  const k = STYLES[style].keys;
  const v = sq.reduce((a, p) => a + k.reduce((s, i) => s + p.attrs[i], 0) / k.length, 0) / Math.max(1, sq.length);
  return Math.round(v * 10) / 10;
}

export function applyStyle(style: StyleKey) {
  const g = gs();
  const st = STYLES[style];
  const base = changeFormation(g.tactic!, st.formation);
  g.tactic = autoSelect({ ...base, team: { ...base.team, ...st.ti } }, squad(g.userClub));
  (g.manager.onboard ??= {}).style = style;
}

/** To realistiske købsmål til et behov inden for budgettet (bedst egnede først) */
export function needTargets(key: NeedKey, budget: number): number[] {
  const g = gs();
  const gr = NEED_GROUPS.find((x) => x.key === key)!;
  return Object.values(g.players)
    .filter((p) => p.club !== g.userClub && gr.roles.includes(naturalRole(p)) && ageOn(p.dob, g.date) <= 31)
    .filter((p) => (p.club ? askingPrice(p) <= budget : true) && transferRealism(p).level === 0)
    .sort((a, b) => best(b, gr.roles) - best(a, gr.roles))
    .slice(0, 2)
    .map((p) => p.id);
}

/** Assistentens oplæg, når de tre opgaver er løst */
export function briefing() {
  const g = gs();
  const ob = (g.manager.onboard ??= {});
  const c = g.clubs[g.userClub];
  const needs = squadNeeds(g.userClub);
  const weakest = needs[0];
  const style = (ob.style ?? 'possession') as StyleKey;
  const fit = styleFit(g.userClub, style);
  const fits = (Object.keys(STYLES) as StyleKey[]).map((k) => [k, styleFit(g.userClub, k)] as const).sort((a, b) => b[1] - a[1]);
  const targets = Object.fromEntries((ob.needs ?? []).map((k) => [k, needTargets(k as NeedKey, c.transferBudget)]));
  ob.briefed = true;
  ob.plan = { weakest: weakest.key, style, fit, bestStyle: fits[0][0], targets };
  addNews({ cat: 'general', key: 'onb.briefing', params: { weak: weakest.key, style } });
  return ob.plan;
}
