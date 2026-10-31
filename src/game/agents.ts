// Spillernes agenter: hver spiller har en fast (opfundet) agent med en personlighed, der påvirker
// lønkrav, hvor hårdt der forhandles, og hvor spilleren vil hen.
import { hash01 } from './rng';
import type { Player } from './types';

export type AgentStyle = 'greedy' | 'tough' | 'friendly' | 'loyal' | 'abroad';

/** Opfundne agenter (ingen rigtige personer) */
const NAMES = ['Marco Vellini', 'Sara Holm', 'Duarte Fonseca', 'Lars Møller', 'Nadia Okafor', 'Victor Brandt', 'Elena Rossi-Kahn', 'Tomás Ibarra', 'Jonas Lindqvist', 'Amira Haddad', 'Pieter de Wolf', 'Chiara Bellandi'];

/** wage: faktor på lønkravet · accept: hvor tæt på kravet et tilbud skal være · renew: faktor ved forlængelse i egen klub */
export const AGENT_RULES: Record<AgentStyle, { wage: number; accept: number; renew: number }> = {
  greedy: { wage: 1.15, accept: 0.98, renew: 1.1 },
  tough: { wage: 1.05, accept: 1.0, renew: 1.03 },
  friendly: { wage: 1.0, accept: 0.93, renew: 0.97 },
  loyal: { wage: 1.0, accept: 0.95, renew: 0.9 },
  abroad: { wage: 1.03, accept: 0.97, renew: 1.05 },
};

export function agentOf(p: Player): { name: string; style: AgentStyle } {
  const r = hash01(p.id, 7731, 3);
  const style: AgentStyle = r < 0.22 ? 'greedy' : r < 0.44 ? 'tough' : r < 0.66 ? 'friendly' : r < 0.83 ? 'loyal' : 'abroad';
  return { name: NAMES[Math.floor(hash01(p.id, 913, 5) * NAMES.length)], style };
}
