// Udfordringer / scenarier (forbedring #10)
import { finalOrder } from './competitions';
import type { GameState } from './types';

export interface Challenge {
  id: string;
  club: number;
  nations: string[]; // aktive nationer (navne)
  seasons: number;
  /** i18n-nøgler: challenge.<id>.title / .desc */
  setup?: (g: GameState) => void;
  /** Kaldes ved sæsonafslutning. true = vundet */
  check: (g: GameState) => boolean;
}

const leaguePos = (g: GameState, club: number): number => {
  const c = g.clubs[club];
  const comp = c ? g.comps[c.league] : undefined;
  return comp ? finalOrder(comp).indexOf(club) + 1 : 99;
};

const tierOf = (g: GameState, club: number) => g.leagues[g.clubs[club]?.league]?.tier ?? 9;

export const CHALLENGES: Challenge[] = [
  {
    id: 'lyngby-up', club: 369, nations: ['Denmark'], seasons: 1,
    check: (g) => tierOf(g, 369) === 1,
  },
  {
    id: 'brondby-title', club: 206, nations: ['Denmark'], seasons: 2,
    check: (g) => g.comps.DK1?.winner === 206,
  },
  {
    id: 'fck-europe', club: 190, nations: ['Denmark', 'England', 'Spain', 'Germany', 'Italy'], seasons: 5,
    check: (g) => g.comps.CL?.winner === 190,
  },
  {
    id: 'fredericia-survive', club: 5776, nations: ['Denmark'], seasons: 1,
    setup: (g) => { g.clubs[5776].transferBudget = Math.min(g.clubs[5776].transferBudget, 300_000); },
    check: (g) => tierOf(g, 5776) === 1,
  },
  {
    id: 'wrexham-dream', club: 1112, nations: ['England'], seasons: 3,
    check: (g) => tierOf(g, 1112) === 1,
  },
  {
    id: 'schalke-return', club: 33, nations: ['Germany'], seasons: 2,
    check: (g) => tierOf(g, 33) === 1,
  },
  {
    id: 'united-broke', club: 985, nations: ['England'], seasons: 1,
    setup: (g) => { g.clubs[985].transferBudget = 0; },
    check: (g) => leaguePos(g, 985) <= 4,
  },
  {
    id: 'aab-double', club: 1053, nations: ['Denmark'], seasons: 3,
    check: (g) => g.comps.DK1?.winner === 1053,
  },
];

export function challengeById(id: string) {
  return CHALLENGES.find((c) => c.id === id);
}
