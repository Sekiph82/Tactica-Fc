// Regler for ligaer: op/nedrykning, split-formater, playoffs og europæiske pladser.

export interface PlayoffSpec {
  /** Deltagere: [liga, placering] */
  seeds: [string, number][];
  /** 'semis' = 1v4, 2v3 tolegs + finale (enkeltkamp); 'final2' = én dobbeltkamp */
  format: 'semis' | 'final2';
  /** Hvilken liga vinderen spiller i næste sæson */
  winnerTo: string;
  loserTo?: string;
}

export interface LeagueRules {
  rounds: number; // antal gange hver modstander mødes i grundspillet (1-3)
  relegated?: number; // direkte nedrykkere til below
  below?: string;
  promoted?: number; // direkte oprykkere til above
  above?: string;
  split?: { after: number; groups: number; rounds: number; halvePoints?: boolean };
  playoff?: PlayoffSpec;
  cup?: string; // pokalturneringens navn
  wealth: number; // økonomi-faktor 0.3-2
  /** første spillerunde tidligst denne dato (MM-DD) – fx dansk start i juli */
  start?: string;
  /** vinterpause: ingen kampe fra..til (MM-DD, kan gå over nytår) */
  winterBreak?: [string, string];
}

export const LEAGUE_RULES: Record<string, LeagueRules> = {
  GB1: { rounds: 2, relegated: 3, below: 'GB2', cup: 'FA Cup', wealth: 2.0 },
  GB2: { rounds: 2, promoted: 2, above: 'GB1', wealth: 0.75, playoff: { seeds: [['GB2', 3], ['GB2', 6], ['GB2', 4], ['GB2', 5]], format: 'semis', winnerTo: 'GB1' } },
  DK1: { rounds: 2, split: { after: 22, groups: 2, rounds: 2 }, relegated: 2, below: 'DK2', cup: 'Pokalturneringen', wealth: 0.45, start: '07-18', winterBreak: ['12-09', '02-13'] },
  DK2: { rounds: 3, promoted: 2, above: 'DK1', wealth: 0.25, start: '07-25', winterBreak: ['12-02', '02-27'] },
  L1: { winterBreak: ['12-22', '01-09'], rounds: 2, relegated: 2, below: 'L2', cup: 'DFB-Pokal', wealth: 1.4, playoff: { seeds: [['L1', 16], ['L2', 3]], format: 'final2', winnerTo: 'L1', loserTo: 'L2' } },
  L2: { rounds: 2, promoted: 2, above: 'L1', wealth: 0.55, winterBreak: ['12-22', '01-16'] },
  IT1: { rounds: 2, relegated: 3, below: 'IT2', cup: 'Coppa Italia', wealth: 1.3 },
  IT2: { rounds: 2, promoted: 2, above: 'IT1', wealth: 0.45, playoff: { seeds: [['IT2', 3], ['IT2', 6], ['IT2', 4], ['IT2', 5]], format: 'semis', winnerTo: 'IT1' } },
  ES1: { rounds: 2, relegated: 3, below: 'ES2', cup: 'Copa del Rey', wealth: 1.4 },
  ES2: { rounds: 2, promoted: 2, above: 'ES1', wealth: 0.45, playoff: { seeds: [['ES2', 3], ['ES2', 6], ['ES2', 4], ['ES2', 5]], format: 'semis', winnerTo: 'ES1' } },
  FR1: { rounds: 2, relegated: 2, below: 'FR2', cup: 'Coupe de France', wealth: 1.1, playoff: { seeds: [['FR1', 16], ['FR2', 3]], format: 'final2', winnerTo: 'FR1', loserTo: 'FR2' } },
  FR2: { rounds: 2, promoted: 2, above: 'FR1', wealth: 0.4 },
  SC1: { rounds: 3, split: { after: 33, groups: 2, rounds: 1 }, cup: 'Scottish Cup', wealth: 0.5, start: '08-01', winterBreak: ['01-04', '01-17'] },
  A1: { rounds: 2, split: { after: 22, groups: 2, rounds: 2, halvePoints: true }, cup: 'ÖFB-Cup', wealth: 0.5, start: '07-25', winterBreak: ['12-15', '02-06'] },
  BE1: { rounds: 2, cup: 'Beker van België', wealth: 0.6, start: '07-25', winterBreak: ['12-28', '01-15'] },
  NL1: { rounds: 2, cup: 'KNVB Beker', wealth: 0.7, winterBreak: ['12-23', '01-10'] },
  PO1: { rounds: 2, cup: 'Taça de Portugal', wealth: 0.65 },
  TR1: { rounds: 2, cup: 'Türkiye Kupası', wealth: 0.7, winterBreak: ['12-28', '01-14'] },
  GR1: { rounds: 2, cup: 'Kypello Elladas', wealth: 0.45 },
  C1: { rounds: 2, cup: 'Schweizer Cup', wealth: 0.6, start: '07-18', winterBreak: ['12-22', '01-25'] },
  NO1: { rounds: 2, cup: 'NM Cup', wealth: 0.45 },
  SE1: { rounds: 2, cup: 'Svenska Cupen', wealth: 0.45 },
  SA1: { rounds: 2, wealth: 1.5 },
  MLS1: { rounds: 1, wealth: 0.9 },
  ARG1: { rounds: 1, wealth: 0.35 },
  BRA1: { rounds: 2, cup: 'Copa do Brasil', wealth: 0.6 },
  MEX1: { rounds: 2, wealth: 0.6 },
};

export function rulesFor(id: string, clubs: number): LeagueRules {
  const r = LEAGUE_RULES[id];
  if (r) return r;
  return { rounds: clubs > 24 ? 1 : clubs <= 10 ? 4 : 2, wealth: 0.4 };
}

/** Europæiske nationer der kan deltage i UEFA-turneringerne */
export const UEFA_NATIONS = new Set([
  'England', 'Spain', 'Italy', 'Germany', 'France', 'Netherlands', 'Portugal', 'Belgium', 'Scotland', 'Türkiye',
  'Austria', 'Switzerland', 'Greece', 'Norway', 'Sweden', 'Poland', 'Czech Republic', 'Croatia', 'Romania',
  'Serbia', 'Ukraine', 'Denmark',
]);

export type Region = 'europe' | 'northAmerica' | 'southAmerica' | 'asia' | 'africa';

const REGION_OF: Record<string, Region> = {
  Russia: 'europe', Wales: 'europe', 'Northern Ireland': 'europe', Ireland: 'europe', Finland: 'europe', Hungary: 'europe', Bulgaria: 'europe', Slovakia: 'europe', Slovenia: 'europe', Bosnia: 'europe', Israel: 'europe', Cyprus: 'europe', Iceland: 'europe',
  'United States': 'northAmerica', Mexico: 'northAmerica', Canada: 'northAmerica', 'Costa Rica': 'northAmerica', Honduras: 'northAmerica', Jamaica: 'northAmerica',
  Argentina: 'southAmerica', Brazil: 'southAmerica', Colombia: 'southAmerica', Uruguay: 'southAmerica', Chile: 'southAmerica', Peru: 'southAmerica', Ecuador: 'southAmerica', Paraguay: 'southAmerica', Venezuela: 'southAmerica', Bolivia: 'southAmerica',
  Japan: 'asia', 'Korea, South': 'asia', 'Saudi Arabia': 'asia', Australia: 'asia', China: 'asia', Qatar: 'asia', 'United Arab Emirates': 'asia', Iran: 'asia',
  Egypt: 'africa', Morocco: 'africa', 'South Africa': 'africa', Nigeria: 'africa', Tunisia: 'africa', Algeria: 'africa',
};

/** Verdensdel for en nation (bruges til jobtilbud) – ukendte lande regnes som Europa */
export function regionOf(nationName: string | undefined): Region {
  if (!nationName) return 'europe';
  return UEFA_NATIONS.has(nationName) ? 'europe' : REGION_OF[nationName] ?? 'europe';
}

/** CL-pladser pr. landerangering (index = rang) */
export const CL_SPOTS = [4, 4, 4, 4, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
export const UEFA_SPOTS = [3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
/** Conference League: mellemstore nationer får flest pladser (som i virkeligheden) */
export const CONF_SPOTS = [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1];

/** Ligger datoen i vinterpausen? */
export function inBreak(date: string, brk?: [string, string]): boolean {
  if (!brk) return false;
  const md = date.slice(5);
  return brk[0] > brk[1] ? md >= brk[0] || md <= brk[1] : md >= brk[0] && md <= brk[1];
}
