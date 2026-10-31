// Klubbernes transferstrategi (AI): hver klub har en profil der styrer hvem den køber og sælger.
//  big       – topklub: køber de bedste, betaler hvad det koster, sælger nødigt sine stjerner
//  develop   – udviklingsklub: køber unge talenter, sælger dem når prisen er rigtig
//  seller    – sælgerklub: lever af salg, køber billigt og sælger let
//  balanced  – alle andre
import { rulesFor } from './leagues';
import { gs } from './state';
import type { Club } from './types';

export type Strategy = 'big' | 'develop' | 'seller' | 'balanced';

/** Ligaer der traditionelt eksporterer spillere (udviklings-/sælgerklubber) */
const EXPORT_NATIONS = new Set(['Netherlands', 'Portugal', 'Belgium', 'Denmark', 'Austria', 'Switzerland', 'Norway', 'Sweden', 'Croatia', 'Serbia', 'Brazil', 'Argentina', 'Czech Republic', 'Scotland', 'Ukraine']);

export function clubStrategy(club: Club): Strategy {
  const g = gs();
  const wealth = rulesFor(club.league, 20).wealth;
  if (club.rep >= 82 || (club.rep >= 74 && wealth >= 1.8)) return 'big';
  const nation = g.nations[club.nation]?.name ?? '';
  if (EXPORT_NATIONS.has(nation)) return club.youth >= 13 || club.rep >= 62 ? 'develop' : 'seller';
  if (club.youth >= 15) return 'develop';
  if (wealth <= 0.6 && club.balance < club.wageBudget * 30) return 'seller';
  return 'balanced';
}
