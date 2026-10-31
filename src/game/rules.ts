// Turneringsregler: moderne (5 udskiftninger, 9 på bænken) eller klassiske CM 01/02-regler (3 og 5).
import { gs, hasGame } from './state';

export function classicRules(): boolean {
  return hasGame() && gs().options.rules === 'classic';
}
export const maxSubs = () => (classicRules() ? 3 : 5);
export const benchSize = () => (classicRules() ? 5 : 9);
