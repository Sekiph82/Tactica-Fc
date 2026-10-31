// Enkle regler når AI ikke er tilgængelig: gæt hensigten i en fritekstbesked til en spiller.
import type { TalkKind } from '../game/personality';

const RULES: [TalkKind, RegExp][] = [
  ['future', /(fremtid|future|bygger .* om dig|building .* around you)/i],
  ['fine', /\b(bøde|boede|straf|fine|punish|penalt)/i],
  ['criticise', /\b(dårlig|darlig|skuffe|skuffende|elendig|ikke godt nok|pinlig|bad|poor|disappoint|terrible|not good enough|awful)/i],
  ['demand', /\b(mere|skal|forventer|kræver|kraever|giv alt|op i gear|more|expect|demand|step up|need you to)/i],
  ['praise', /\b(godt|flot|fantastisk|super|stærk|staerk|fremragende|tak|sej|great|well done|brilliant|excellent|proud|thank|amazing)/i],
  ['encourage', /\b(rolig|bare|tro på|tro paa|op igen|kom igen|bekymr|støtte|stoette|keep going|believe|don't worry|dont worry|head up|support)/i],
];

export function guessIntent(msg: string): TalkKind {
  for (const [kind, re] of RULES) if (re.test(msg)) return kind;
  return 'chat';
}
