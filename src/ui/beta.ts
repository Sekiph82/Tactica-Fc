// Tidlig adgang: nye funktioner kan lægges bag en dato. Supportere med beta slået til får dem straks,
// alle andre fra datoen (typisk en uge senere). Brug: if (betaFeature('2026-11-01')) …
import { betaOn } from '../online/support';

export function betaFeature(publicFrom: string): boolean {
  return betaOn() || new Date().toISOString().slice(0, 10) >= publicFrom;
}
