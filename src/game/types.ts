// Central datamodel for hele spillet. Alt i GameState skal kunne serialiseres (gemmes i IndexedDB).
import type { PressConf } from './press';
import type { SeasonScore } from './rating';

export type Lang = 'da' | 'en' | 'tr';
export type Foot = 'R' | 'L' | 'B' | '';

/** Positioner som i CM 01/02 */
export const POSITIONS = ['GK', 'SW', 'D', 'DM', 'M', 'AM', 'ST', 'WB'] as const;
export type PosKey = (typeof POSITIONS)[number];
export const SIDES = ['L', 'C', 'R'] as const;
export type Side = (typeof SIDES)[number];

export type Role = 'GK' | 'CB' | 'FB' | 'DM' | 'CM' | 'WM' | 'AM' | 'W' | 'ST';

export interface Contract {
  wage: number; // ugeløn i €
  expires: string; // ISO-dato
  /** Fremtidig klub (Bosman/pre-contract) */
  futureClub?: number;
  futureWage?: number;
  futureExpires?: string;
  /** Klausuler: frikøbsklausul (€), årlig lønstigning (%), bonus pr. kamp og pr. mål (€), lønnedgang ved nedrykning (%) */
  release?: number;
  wageRise?: number;
  appBonus?: number;
  goalBonus?: number;
  relegationCut?: number;
  /** lønstigning ved oprykning (%) og bonus pr. kamp uden indkasserede mål (kun når spilleren spiller) */
  promotionRise?: number;
  cleanSheetBonus?: number;
}

/** Klausuler i et kontrakttilbud */
export interface ContractClauses {
  release?: number;
  wageRise?: number;
  appBonus?: number;
  goalBonus?: number;
  relegationCut?: number;
  /** lønstigning ved oprykning (%) og bonus pr. kamp uden indkasserede mål (kun når spilleren spiller) */
  promotionRise?: number;
  cleanSheetBonus?: number;
}

export interface SeasonStats {
  apps: number;
  subs: number;
  minutes: number;
  goals: number;
  assists: number;
  mom: number;
  yellows: number;
  reds: number;
  ratingSum: number;
  ratingCount: number;
  lgGoals: number;
  lgApps: number;
}

export interface PlayerMove {
  season: number;
  date: string;
  from: number;
  to: number;
  fee: number;
  loan?: boolean;
  /** Indgik i en byttehandel */
  swap?: boolean;
}

export interface CareerLine {
  season: number;
  club: number;
  apps: number;
  goals: number;
  assists: number;
  avg: number;
  minutes?: number;
  /** På leje i klubben */
  loan?: boolean;
}

export interface Injury {
  key: string;
  days: number;
}

export interface Player {
  id: number;
  /** Original squad shirt number when supplied by an imported database. */
  shirtNumber?: number;
  first: string;
  last: string;
  dob: string;
  nation: number;
  club: number; // 0 = klubløs
  foot: Foot;
  height: number;
  attrs: number[]; // float 1-20, se attributes.ts
  pos: number[]; // 1-20 pr. POSITIONS
  side: number[]; // 1-20 pr. SIDES
  ca: number; // 1-200
  pa: number; // 1-200
  rep: number; // 0-100
  value: number;
  contract: Contract | null;
  condition: number; // 0-100
  morale: number; // 1-20
  form: number[]; // seneste kampkarakterer
  injury: Injury | null;
  banned: number; // karantæne (kampe)
  yellowCount: number; // gule kort mod karantæne
  training: string; // træningsskema-nøgle
  listed: boolean; // transferlistet
  /** Månedlige øjebliksbilleder af attributterne (kun menneskestyrede klubbers spillere) */
  dev?: { d: string; a: number[] }[];
  /** Udbudspris sat af manageren når spilleren er til salg */
  listPrice?: number;
  /** share = andel af lønnen lejeklubben betaler (0-1, standard 1) */
  loan: { from: number; until: string; share?: number; fee?: number; option?: number } | null;
  stats: SeasonStats;
  history: CareerLine[];
  /** Klubskifter i spillet: hvorhen, hvornår og for hvad */
  moves?: PlayerMove[];
  caps: number;
  intGoals: number;
  regen?: boolean;
  notes?: string;
  joined?: string; // dato for ankomst til klub
  /** ikke-tilfredshed pga. spilletid (0-100) */
  unhappy?: number;
  /** Stjerne der vil sælges (ambitiøs spiller i en klub uden succes) */
  wantsAway?: boolean;
  /** Manageren har lovet titler – frist */
  promiseUntil?: string;
  /** Sæsonstatistik allerede bogført på en tidligere klub (ved skifte midt i sæsonen) */
  split?: { apps: number; goals: number; assists: number; minutes: number; ratingSum: number; ratingCount: number };
  /** Kontraktkrav fra spilleren/agenten efter en god periode */
  demand?: { since: string; wage: number; leaked?: boolean };
  /** Seneste uro i spillerens gruppering (dato) */
  cliqueAlert?: string;
  /** Spillerens henvendelse til manageren (klage) der venter på svar, og et løfte om spilletid */
  complaint?: { kind: 'time' | 'morale' | 'press' | 'blocked' | 'renewal'; date: string; club?: number };
  /** Sæson hvor spilleren sidst overvejede at forlænge */
  renewalChecked?: number;
  /** Spilleren vil ikke (eller tøver med at) forlænge sin kontrakt – og hvorfor */
  renewal?: { stance: 'refuses' | 'hesitant'; reason: 'ambition' | 'time' | 'money'; since: string; convinced?: boolean; wageFactor?: number; season: number };
  playPromise?: { until: string; apps: number };
  /** Seneste ros/henvendelse (for ikke at gentage sig) */
  lastContact?: string;
  /** Videresalgsprocent til en tidligere klub (af fortjenesten over base) */
  sellOn?: { club: number; pct: number; base: number };
  /** Ekstra transfersum når spilleren har spillet et antal kampe for køberen */
  addOn?: { club: number; payer: number; fee: number; left: number };
  /** Klausuler i en aftalt Bosman-kontrakt (træder i kraft ved skiftet) */
  futureClauses?: ContractClauses;
  /** Seneste samtale med manageren (cooldown) */
  lastTalk?: string;
  /** Seneste gang manageren sagde "du er fremtiden" */
  toldFuture?: string;
  /** Seneste episode (ballade) og seneste røde kort – grundlag for at straffe */
  lastIncident?: string;
  lastRed?: string;
  /** Rehabilitering af et problembarn/hidsig spiller (0-100; ved 100 falder han til ro: temperament +1) */
  reform?: number;
  /** Kortvarigt "tændt" efter kritik/ros: bonus på stabilitet til og med dato */
  fired?: string;
  /** Navngivet af en supporter (vises med en stjerne) */
  supporterNamed?: string;
  /** Dato for spillerens personlige bryllupsnyhed; optional for old saves. */
  marriedOn?: string;
}

export interface StaffAttrs {
  coaching: number;
  judgingAbility: number;
  judgingPotential: number;
  physio: number;
  motivating: number;
  discipline: number;
  tactics: number;
}

export type StaffRole = 'manager' | 'assistant' | 'coach' | 'physio' | 'scout';

export interface ScoutAssignment {
  kind: 'player' | 'nation' | 'league';
  target: number | string;
  /** Opgaven slutter (scouten vender hjem med en rapport); udeladt = indtil kaldt hjem */
  until?: string;
  since?: string;
  /** Fokus: kun unge eller etablerede spillere */
  focus?: 'any' | 'young' | 'prime';
  /** Søgekriterier: position, attributkrav (index i ATTRS + minimum) og maks. værdi */
  role?: Role;
  attr?: number;
  attrMin?: number;
  maxValue?: number;
  /** Spillere scouten har afdækket på denne tur, og dem han følger lige nu */
  found?: number[];
  queue?: number[];
}

export interface StoryItem { d: string; k: string; w: number; p: Record<string, string | number>; fixture?: number; pid?: number }
export interface SeasonStory {
  season: number; club: number; clubName: string; league: string; pos: number;
  record: [number, number, number]; gf: number; ga: number; top?: { name: string; goals: number };
  items: StoryItem[]; fanMood: number;
}

export interface TrainingCamp {
  dest: string; start: string; end: string; cost: number; status: 'planned' | 'running' | 'done';
  report?: { morale: number; cond: number; bond: number; star?: number; injured?: number; incident?: number; income: number };
}

export interface RecMatch { fixture: number; gf: number; ga: number; opp: number; date: string; comp: string }
export interface RecMove { pid: number; name: string; fee: number; club: number; date: string }
export interface ClubRecords {
  since: string;
  /** spillere, der har spillet for klubben: navn (huskes efter karrieren), kampe og mål */
  players: Record<number, { name: string; apps: number; goals: number; from: string; to?: string; legend?: boolean }>;
  bigWin?: RecMatch;
  bigLoss?: RecMatch;
  topAtt?: { att: number; opp: number; date: string };
  buy?: RecMove;
  sale?: RecMove;
  seasonGoals?: { pid: number; name: string; goals: number; season: number };
  bestFinish?: { season: number; pos: number; league: string; tier: number };
}

export interface Staff {
  id: number;
  first: string;
  last: string;
  nation: number;
  dob: string;
  club: number; // 0 = ledig
  role: StaffRole;
  attrs: StaffAttrs;
  rep: number;
  wage: number;
  expires: string;
  assignment?: ScoutAssignment | null;
  /** AI-managerens foretrukne formation */
  style?: { formation: string; mentality: number };
  /** Trænerkarriere: klubber, trofæer og seneste sæsons form (placering mod forventning) */
  career?: { club: number; from: string; to?: string; why?: 'sacked' | 'poached' | 'left' }[];
  trophies?: number;
  form?: number;
  /** tidligere spiller (evt. legende i en klub) */
  exPlayer?: { pid: number; legendOf?: number };
}

export interface ClubFinance {
  gate: number;
  tv: number;
  prize: number;
  sponsor: number;
  merch: number;
  transfersIn: number; // salg
  transfersOut: number; // køb
  wages: number;
  other: number;
}

export interface ClubSeasonHistory {
  season: number;
  league: string;
  pos: number;
  pts: number;
  /** Sæsonens økonomi og tilskuere */
  fin?: SeasonFinance;
}

export interface SeasonFinance {
  gate: number; tv: number; sponsor: number; merch: number; prize: number;
  wages: number; sales: number; buys: number; other: number;
  avgAtt: number; seats: number; homeGames: number; ticket: number; balance: number;
}

export type ProjectKind = 'stadium' | 'training' | 'youth';

export interface ClubProject {
  kind: ProjectKind;
  started: string;
  done: string;
  cost: number;
  amount: number; // nye pladser eller niveau-stigning
}

export interface ClubSeasonStats {
  n: number;
  shots: number;
  sot: number;
  xg: number;
  xga: number;
  poss: number;
  cs: number;
  yel: number;
  red: number;
}

export interface Club {
  id: number;
  name: string;
  short: string;
  nation: number;
  league: string;
  stadium: string;
  seats: number;
  rep: number; // 0-100
  /** Opsparet omdømmeændring i løbet af sæsonen (brøkdele, før de bliver til hele point) */
  repDrift?: number;
  /** Spillere klubben holder øje med (AI-klubbernes shortliste) */
  shortlist?: number[];
  /** Holdstatistik for sæsonens ligakampe (nulstilles ved sæsonstart) */
  lgStats?: ClubSeasonStats;
  balance: number;
  transferBudget: number;
  wageBudget: number; // pr. uge
  youth: number; // 1-20
  facilities: number; // 1-20
  colors: [string, string];
  manager: number; // staff-id, -1 = menneske
  tactic: Tactic | null;
  finance: ClubFinance;
  history: ClubSeasonHistory[];
  ticketPrice: number;
  boardTrust?: number;
  /** Igangværende byggeprojekter (stadion, træningsanlæg, ungdomsakademi) */
  projects?: ClubProject[];
  /** Klubrekorder (kun menneskestyrede klubber, siden spillets start) */
  records?: ClubRecords;
  /** Sæson, hvor bestyrelsen har betalt for ekstra ungdomsrekruttering (større og bedre årgang i marts) */
  youthDrive?: number;
  /** Træningslejr (planlagt, i gang eller afsluttet med rapport) og dens løft til holdkemien resten af sæsonen */
  camp?: TrainingCamp;
  campBond?: { season: number; pts: number };
  sponsor?: SponsorDeal;
  /** Merchandise-boost efter stjernekøb */
  merchBoost?: { until: string; factor: number };
  /** Financial Fair Play: resultat for seneste sæsoner og evt. straf */
  ffp?: { results: number[]; sanction?: string };
  /** Draft-liga: logo-skabelon for den fiktive klub */
  crest?: number;
  /** Fansenes humør 0-100 (kun menneskestyrede klubber) og hvad der har påvirket det */
  fanMood?: number;
  /** fanstemningen ved sidste månedsskifte (til sæsonfortællingen) */
  fanMoodPrev?: number;
  fanEvents?: { d: string; k: string; v: number }[];
  /** Modstanderen er ekstra motiveret efter managerens pressemøde (til og med dato) */
  motivatedUntil?: string;
}

export interface TeamInstructions {
  mentality: number; // 0-4 (meget defensiv..meget offensiv)
  passing: number; // 0 kort, 1 blandet, 2 lang
  tempo: number; // 0-2
  width: number; // 0-2
  closingDown: number; // 0-2
  tackling: number; // 0 forsigtig, 1 normal, 2 hård
  marking: 'zonal' | 'man';
  offside: boolean;
  counter: boolean;
}

export interface PlayerInstructions {
  runs: number; // 0 sjældent, 1 blandet, 2 ofte
  runWithBall: boolean;
  longShots: number; // 0-2
  throughBalls: boolean;
  crossing: number; // 0-2
  tightMarking: boolean;
  freeRole: boolean;
}

export interface Slot {
  pos: PosKey;
  side: Side;
  x: number; // 0 (eget mål) .. 100 (modstanderens mål)
  y: number; // 0 (venstre) .. 100 (højre)
}

export interface Tactic {
  formation: string;
  slots: Slot[]; // 11
  lineup: number[]; // spiller-id pr. slot (0 = tom)
  bench: number[];
  team: TeamInstructions;
  individual: PlayerInstructions[]; // pr. slot
  captain: number;
  penalties: number;
  freeKicks: number;
  corners: number;
  /** Instruktioner mod modstanderen – gælder kun kampen med dette id */
  opp?: OppInstructions;
}

export type OppKind = 'tight' | 'press' | 'hard' | 'weakFoot';
export interface OppInstructions {
  fixture: number;
  /** højst tre af modstanderens spillere */
  targets: { pid: number; kind: OppKind }[];
  /** angrib især denne side (0 venstre, 1 centralt, 2 højre – set fra os) */
  focusLane?: number;
}

export interface Fixture {
  id: number;
  comp: string;
  date: string;
  home: number;
  away: number;
  round: number;
  stage?: string; // 'group-A', 'R16', 'F', 'PO' ...
  leg?: number;
  tieId?: number;
  result?: MatchResultShort;
}

export interface MatchResultShort {
  hg: number;
  ag: number;
  et?: boolean;
  pens?: [number, number];
  scorers: [number, number, number][]; // [minut, team(0/1), spiller-id]
  att?: number;
  /** Hjemmeholdets billetindtægt (efter deling i pokalkampe) */
  gate?: number;
}

export interface TableRow {
  club: number;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  form: string; // fx "WWDLW"
}

export interface Tie {
  id: number;
  a: number;
  b: number;
  legs: number;
  winner?: number;
  stage: string;
  fx: number[];
}

export interface Competition {
  id: string;
  name: string;
  type: 'league' | 'cup' | 'continental' | 'playoff';
  nation: number; // -1 for kontinental
  tier: number;
  clubs: number[];
  table: TableRow[]; // ligaer
  groups?: Record<string, TableRow[]>; // gruppespil / split-faser
  ties: Tie[];
  stage: string;
  finished: boolean;
  /** antal uspillede kampe */
  pending: number;
  winner?: number;
  /** split-liga: fase 2 er genereret */
  splitDone?: boolean;
  playoffFor?: string; // playoff: hvilken liga pladsen gælder
  meta?: Record<string, unknown>;
}

export type NewsCategory = 'general' | 'transfer' | 'match' | 'injury' | 'board' | 'contract' | 'scout' | 'award' | 'finance' | 'job' | 'youth';

export interface NewsItem {
  id: number;
  date: string;
  cat: NewsCategory;
  key: string; // i18n-nøgle for overskrift/tekst
  params: Record<string, string | number>;
  read: boolean;
  /** link til spiller/klub/kamp/tilbud */
  link?: { kind: 'player' | 'club' | 'fixture' | 'offer' | 'comp' | 'awards' | 'press' | 'chat'; id: number | string };
  /** Ugentligt transferoverblik: ugens handler mellem andre klubber */
  deals?: TransferDeal[];
  /** Dæmpet kategori: markeret som læst og kun vist, når man filtrerer på kategorien */
  muted?: boolean;
}

export interface TransferDeal { player: number; from: number; to: number; fee: number; loan?: boolean }

export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'countered' | 'negotiating' | 'completed' | 'withdrawn' | 'collapsed';

export interface TransferOffer {
  id: number;
  player: number;
  buyer: number;
  seller: number; // 0 = fri agent
  fee: number;
  loan: boolean;
  status: OfferStatus;
  counter?: number;
  created: string;
  respondBy: string;
  /** For købers kontraktforhandling */
  rounds?: number;
  demand?: { wage: number; years: number };
  preContract?: boolean;
  /** Det højeste en AI-køber vil betale (bruges i prisforhandling) */
  maxFee?: number;
  /** Antal forhandlingsrunder om prisen */
  priceRounds?: number;
  /** Budkrig: en rivaliserende klubs bud på samme spiller */
  rival?: { club: number; fee: number };
  /** Leje med købsoption (pris) */
  option?: number;
  /** Klausuler i buddet: videresalgsprocent til sælger og ekstra beløb efter 25 kampe */
  sellOn?: number;
  addOn?: number;
  /** Lukket budrunde mellem managere om samme spiller */
  auction?: boolean;
  /** budkrig mellem managere: fri spiller/Bosman (auction bruges for spillere i AI-klubber) */
  war?: boolean;
  /** buddet er hævet i budkrigen (kun én gang) */
  raised?: boolean;
  /** Tabte budrunden til en anden manager */
  outbid?: boolean;
  /** Byttehandel: spillere fra køberen, der indgår i handlen */
  swap?: number[];
  /** Multiplayer: et kontrakttilbud til en fri spiller (eller Bosman), som spilleren svarer på dagen efter */
  signing?: { wage: number; years: number; clauses?: ContractClauses };
  /** live-forhandling: antal bud i samme forhandling, og om klubben har sagt 'ikke til salg' */
  bidRounds?: number;
  nfs?: boolean;
}

/** En AI-klub der jagter en spiller (vender tilbage med højere bud) */
export interface Pursuit {
  club: number;
  player: number;
  lastFee: number;
  maxFee: number;
  tries: number;
  next: string;
}

export interface JobTalk {
  stage: 'applied' | 'offer';
  /** applied: hvornår klubben svarer, og om svaret bliver ja */
  answerOn?: string;
  ok?: boolean;
  exp: string;
  expectedPos: number;
  budget: number;
  wageBudget: number;
  /** Hvad man allerede har forhandlet om */
  asked: ('budget' | 'exp')[];
}

export interface ManagerProfile {
  name: string;
  nation: number;
  rep: number; // 0-100
  /** Seneste jobtilbud (mens man er i job) – der går mindst et par måneder mellem dem */
  lastJobOffer?: string;
  history: { season: number; club: number; league: string; pos: number }[];
  trophies: { season: number; comp: string; club: number }[];
  sacked: number;
  /** Indbyrdes resultater mod AI-trænere: staff-id → [V, U, T] */
  rivals?: Record<number, [number, number, number]>;
  /** Klubber der har fyret manageren */
  sackedBy?: number[];
  /** Afviste jobtilbud: klub-id → dato (klubben spørger ikke igen foreløbig) */
  declinedJobs?: Record<number, string>;
  /** Jobsamtaler: søgte stillinger (venter på svar) og tilbud med vilkår, man kan forhandle om */
  jobTalks?: Record<number, JobTalk>;
  /** Svar på forespørgsler om spillere: spiller-id → klubbens pris (nfs = ikke til salg under prisen) */
  enquiries?: Record<number, { date: string; club: number; fee: number; nfs: boolean }>;
  /** Forholdet til pressen (0-100, start 50) og et løfte om sejr givet på et pressemøde */
  media?: number;
  pressRecent?: string[];
  pressPromise?: { fixture: number; opp: number };
  /** Manager Score pr. sæson (ranglister) og udgangspunktet for den igangværende sæson */
  scores?: SeasonScore[];
  /** Præstationer: id → dato for oplåsning, og tællere til dem */
  ach?: Record<string, string>;
  achStats?: { wins: number; streak: number; unbeaten: number; lastPromotion?: number };
  /** Sæsonfortælling: årets vendepunkter (igangværende) og tidligere sæsoners kort */
  story?: { season: number; items: StoryItem[] };
  stories?: SeasonStory[];
  /** Prøvespillere (op til tre ad gangen) og venskabskampe */
  trials?: { pid: number; start: string; end: string; startK: number }[];
  friendlies?: { opp: number; date: string; kind: 'easy' | 'big'; done?: boolean; result?: [number, number] }[];
  /** Første arbejdsdag: opgaver og assistentens oplæg */
  onboard?: { weak?: boolean; style?: string; needs?: string[]; briefed?: boolean; plan?: { weakest: string; style: string; fit: number; bestStyle: string; targets: Record<string, number[]> } };
  /** Managerprofil: motto (vises på den offentlige profil) */
  motto?: string;
  /** Til ugens overblik: placering og saldo sidste mandag */
  week?: { pos: number; balance: number };
  seasonStart?: { season: number; club: number; balance: number; sacked: number };
}

export type BoardAsk = 'lowerExp' | 'confidenceVote' | 'youthDrive';

export interface BoardState {
  /** Ungdomschefens rapport om den kommende årgang */
  youthPreview?: { season: number; verdict: 'golden' | 'good' | 'average' | 'poor'; n: number; standout?: string; wonderkid?: boolean };
  /** Årets ungdomsårgang (ungdomsdagen) */
  lastIntake?: { season: number; ids: number[]; verdict: 'golden' | 'good' | 'average' | 'poor' };
  /** Seneste holdmøde */
  lastTeamTalk?: string;
  /** Seneste rygte om interesse for ens spillere */
  lastRumour?: string;
  /** Dato for bestyrelsens seneste kampkommentar */
  lastComment?: string;
  /** Spillere bestyrelsen allerede har kommenteret som dyre bænkevarmere (spiller-id → sæson) og seneste advarsel om lønsummen */
  wasteNoted?: Record<number, number>;
  lastWageWarning?: string;
  confidence: number; // 0-100
  /** Seneste svar på budgetanmodninger (måned pr. type) og et åbent modbud */
  budgetAsked?: { transfer?: string; wage?: string };
  budgetCounter?: { kind: 'transfer' | 'wage'; pct: number; until: string };
  /** Seneste svar på de øvrige ønsker til bestyrelsen (dato pr. ønske) */
  asked?: Partial<Record<BoardAsk, string>>;
  expectation: string; // nøgle: 'title' | 'top3' | 'tophalf' | 'mid' | 'survive' | 'promotion' | 'playoffs'
  expectedPos: number;
  warnings: number;
}

export interface MatchStatsSide {
  goals: number;
  shots: number;
  onTarget: number;
  xg: number;
  possession: number;
  corners: number;
  fouls: number;
  yellows: number;
  reds: number;
  offsides: number;
  passes: number;
  passesCompleted: number;
}

export interface PlayerMatchLine {
  id: number;
  team: number;
  rating: number;
  goals: number;
  assists: number;
  minutes: number;
  yellow: number;
  red: boolean;
  injured: boolean;
  sub: boolean;
  slot: number;
  shots: number;
  tackles: number;
  passes: number;
  passesOk: number;
  cond: number;
}

export interface MatchEvent {
  m: number;
  t: number; // hold 0/1
  k: string; // 'goal' | 'yellow' | 'red' | 'sub' | 'injury' | 'pen-miss' | ...
  p?: number;
  p2?: number;
}

/** Match-engine action and its deterministic pitch-space endpoints for the visual timeline. */
export interface MatchVisualAction {
  moment: number;
  minute: number;
  team: number;
  kind: 'pass' | 'longBall' | 'throughBall' | 'cross' | 'dribble' | 'shot' | 'turnover' | 'tackle' | 'rebound' | 'keeper' | 'deflection' | 'looseBall';
  actor: number;
  target?: number;
  fromZone: number;
  toZone: number;
  fromPoss: number;
  toPoss: number;
  /** Historical actor/recipient center coordinates for this event, in 0–100 pitch space. */
  from: [number, number];
  to: [number, number];
  /** Historical ball positions in the same layout, separate from player centers. */
  ballFrom?: [number, number];
  ballTo?: [number, number];
  outcome: string;
}

export interface MatchPitchPlayer {
  id: number;
  team: number;
  num: number;
  gk: boolean;
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  name: string;
  /** Optional deterministic in-match center, in 0–100 pitch space. */
  x?: number;
  y?: number;
}

/** Read-only rendering snapshot; the UI consumes it without importing simulation internals. */
export interface MatchPitchSnapshot {
  zone: number;
  poss: number;
  holder: number;
  moment: number;
  shot: { team: number; outcome: 'goal' | 'saved' | 'off' | 'blocked' | 'offside' | 'post'; zone: number } | null;
  players: MatchPitchPlayer[];
}

export interface ShotRecord {
  m: number;
  t: number;
  zone: number;
  xg: number;
  outcome: 'goal' | 'saved' | 'off' | 'blocked' | 'offside';
  p: number;
  kind: string;
  /** skuddet kom efter et hjørnespark taget af denne spiller */
  corner?: number;
  /** hvordan chancen opstod: counter, through, cross, dribble, press */
  origin?: string;
  /** ramte stolpen/overliggeren */
  post?: boolean;
}

export interface CommentaryLine {
  m: number;
  k: string;
  a?: string;
  b?: string;
  t?: number;
  hi?: boolean;
}

export interface MatchReport {
  fixture: number;
  home: number;
  away: number;
  stats: [MatchStatsSide, MatchStatsSide];
  players: PlayerMatchLine[];
  events: MatchEvent[];
  shots: ShotRecord[];
  momentum: number[]; // pr. 5 min (+ hjemme, - ude)
  heat: [number[], number[]]; // 15 zoner pr. hold
  zoneControl: number[]; // 15 zoner: andel hjemmebesiddelse
  mom: number;
  commentary: CommentaryLine[];
  et?: boolean;
  pens?: [number, number];
  /** sparkene i straffesparkskonkurrencen, i rækkefølge (hold, skytte, målmand, udfald) */
  shootout?: ShootoutKick[];
  /** vejret under kampen (se weather.ts) */
  weather?: string;
  /** taktiske ændringer undervejs */
  changes?: TacticChange[];
  /** Match-engine action timeline for authoritative visual replay; absent in quick background simulations. */
  visualTimeline?: MatchVisualAction[];
  formations: [string, string];
}

export interface TacticChange { m: number; t: number; kind: 'formation' | 'mentality' | 'instructions'; from?: string; to?: string }

export interface ShootoutKick { t: number; p: number; gk: number; outcome: 'goal' | 'saved' | 'off' }

export interface ChallengeState {
  id: string;
  deadlineSeason: number;
  done?: 'won' | 'lost';
}

export interface Options {
  /** online: minutter pr. halvleg i kampe mellem to managere (fast tempo) */
  h2hHalfMinutes?: number;
  masking: boolean;
  autosave: boolean;
  /** Hvor ofte der gemmes automatisk (standard: efter hver ændring) */
  autosaveMode?: 'changes' | 'daily' | 'weekly' | 'monthly' | 'off';
  matchSpeed: number; // ms pr. kommentarlinje
  fullCommentary: boolean;
  /** Hvilke nyheder om andre klubber man får (standard: kun eget land) */
  newsScope?: 'league' | 'nation' | 'world';
  /** Transfernyheder om andre klubber: kun egen klub, store handler i egen liga (standard) eller alle (efter nyhedsfilteret) */
  transferNews?: 'own' | 'big' | 'all';
  /** Dæmpede nyhedskategorier (vælges i indbakken) */
  mutedNews?: NewsCategory[];
  /** Transfervinduer: rigtige (sommer + januar, standard) eller næsten hele året som i CM 01/02 */
  transferWindows?: 'real' | 'classic';
  /** Højdepunkter i 2D: kun mål, store chancer (standard) eller alt (også små chancer, offside, kort og skader) */
  highlights?: 'goals' | 'big' | 'all';
  /** Kampregler: moderne (5 udskiftninger, 9 på bænken) eller klassiske CM-regler (3 og 5). Standard: moderne – klassisk med CM 01/02-databasen */
  rules?: 'modern' | 'classic';
  /** AI-skrevne tekster (pressemøder, samtaler, artikler) – standard: til */
  ai?: boolean;
}

export type BotStyle = 'ambitious' | 'developer' | 'trader' | 'pragmatic';

export interface HumanSlot {
  pid: string;
  name: string;
  /** AI-manager der spiller som et menneske (samme handlinger) */
  bot?: { style: BotStyle; lastDay?: string };
  /** Spilleren nåede ikke at trykke Klar: assistenten styrer dette træk */
  autopilot?: boolean;
  autopilotDay?: string;
  userClub: number;
  manager: ManagerProfile;
  board: BoardState;
  tactic: Tactic | null;
  savedTactics: Tactic[];
  knowledge: Record<number, number>;
  scoutFinds?: Record<number, string>;
  shortlist: number[];
  news: NewsItem[];
  jobOffers: number[];
  challenge: ChallengeState | null;
  pendingFixture: number | null;
  press?: PressConf | null;
  matchTalk?: MatchTalk | null;
  /** Seneste læste chatbesked (id) */
  chatRead?: number;
  transferDigest?: TransferDeal[];
}

export interface GameState {
  version: number;
  id: string; // save-id
  seed: number;
  rng: number;
  date: string;
  season: number; // startår for sæsonen
  lang: Lang;
  userClub: number; // 0 = arbejdsløs
  manager: ManagerProfile;
  board: BoardState;
  options: Options;
  activeNations: number[];
  nations: { name: string; code: string }[];
  leagueOrder: string[];
  leagues: Record<string, { name: string; nation: number; tier: number }>;
  players: Record<number, Player>;
  clubs: Record<number, Club>;
  staff: Record<number, Staff>;
  comps: Record<string, Competition>;
  fixtures: Record<number, Fixture>;
  news: NewsItem[];
  knowledge: Record<number, number>;
  /** Spillere scouterne har afdækket: id → dato */
  scoutFinds?: Record<number, string>;
  shortlist: number[];
  offers: TransferOffer[];
  tactic: Tactic | null; // brugerens taktik
  savedTactics: Tactic[];
  reports: Record<number, MatchReport>;
  seasonHistory: SeasonSummary[];
  challenge: ChallengeState | null;
  names: Record<number, [string[], string[]]>;
  /** Supporternes regen-navne (hentet fra serveren) og hvilke der allerede er brugt i dette spil */
  supporterRegens?: { first: string; last: string; by: string; used?: boolean }[];
  nextId: { player: number; staff: number; news: number; fixture: number; offer: number; tie: number };
  pendingFixture: number | null; // brugerens kamp i dag (ikke spillet)
  /** Lokalt spil mod AI-managere (ingen server): værten spiller sine kampe live */
  localMp?: boolean;
  /** Beskeder mellem managere, der går gennem spillet (AI-managere og lokale spil) */
  chat?: ChatMsg[];
  /** Multiplayer: tilbud til staff, der afgøres dagen efter */
  staffBids?: { staff: number; club: number; date: string; wage?: number; war?: boolean; raised?: boolean }[];
  /** Stikpiller i pressen mellem managere */
  jabs?: { id: number; from: string; to: string; date: string; line: number; text: string; fixture?: number; resolved?: boolean }[];
  /** Prestige-væddemål om næste indbyrdes kamp */
  bets?: { id: number; from: string; to: string; fixture: number; amount: number; status: 'proposed' | 'accepted' | 'declined' | 'settled' | 'void'; date: string }[];
  chatRead?: number;
  /** Andre klubbers handler samlet til ugens transferoverblik */
  transferDigest?: TransferDeal[];
  /** Indbyrdes regnskab mellem managere (nøgle "pidA|pidB", sorteret) */
  h2h?: Record<string, H2HRecord>;
  /** Holdsnak til dagens kamp (før kampen / i pausen / efter kampen) */
  matchTalk?: MatchTalk | null;
  dayDone: boolean;
  vacancies: number[]; // klubber uden manager
  /** Hvornår hver stilling blev ledig (klub-id → dato) */
  vacancySince?: Record<number, string>;
  jobOffers: number[];
  lastMonthAward?: string;
  /** Online multiplayer: menneskelige managere og hvem der er "aktiv" lige nu */
  humans?: HumanSlot[];
  active?: string;
  /** Månedens priser i indeværende sæson */
  monthAwards?: MonthAward[];
  /** Øjebliksbillede ved månedens start til månedens priser */
  monthSnap?: { players: Record<number, [number, number, number]>; tables: Record<string, Record<number, number>> };
  /** Sidste handlings-index fra serveren der er indarbejdet i dette øjebliksbillede */
  lastActionIdx?: number;
  pursuits?: Pursuit[];
  /** Ventende pressemøde for den aktive manager */
  press?: PressConf | null;
  /** Databasen spillet er startet fra (udeladt = den moderne) og dens ligaregler */
  dbKind?: 'cm0102';
  customRules?: Record<string, import('./leagues').LeagueRules>;
  /** Kosmetiske AI-tekster (artikler, fanindlæg …) – påvirker ikke spillets regler */
  aiText?: Record<string, string>;
  /** Draft-liga: fiktive klubber draftet fra de 500 bedste spillere (ingen økonomi, transfers eller staff) */
  draft?: DraftInfo;
}

export interface DraftSettings {
  /** Antal gange hvert hold møder hinanden */
  rounds: number;
  playoff: 'none' | 'final' | 'semis';
  /** Spillere hvert hold må beholde til næste sæsons draft */
  keepers: number;
  injuries: boolean;
  /** Draftform: skiftevis (snake) eller auktion med budget */
  format?: 'snake' | 'auction';
  /** Spillerpulje: tom = hele verden, en ligas id (fx 'DK1') eller en nationalitet ('n:<nationens indeks>') */
  pool?: string;
}

export interface DraftHistoryEntry {
  season: number;
  champion: number;
  runnerUp?: number;
  playoffWinner?: number;
  topScorer?: { name: string; goals: number; club: number };
  table: { club: number; pts: number; gd: number }[];
}

export interface DraftAllTime { club: number; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number; titles: number; playoffs: number }

export interface DraftInfo {
  settings: DraftSettings;
  /** Draft-sæson (1, 2, …) */
  season: number;
  history: DraftHistoryEntry[];
  allTime: Record<number, DraftAllTime>;
  seasonOver?: boolean;
}

export interface SeasonSummary {
  season: number;
  comps: { id: string; name: string; winner: number; runnerUp?: number; topScorer?: [number, number]; best?: number; young?: number; teamOfYear?: number[]; surprise?: { club: number; expected: number; actual: number } }[];
  /** Årets spiller i verden (top 10) */
  ballonDor?: number[];
  ballonDorNames?: [string, number][];
  managerOfYear?: { name: string; club: number; comp: string };
  monthAwards?: MonthAward[];
}

export interface MonthAward {
  month: string; // YYYY-MM
  comp: string;
  player: number;
  manager: number; // klub-id
  managerName: string;
}

export type SponsorKind = 'safe' | 'bonus' | 'ambitious';

export interface SponsorDeal {
  kind: SponsorKind;
  base: number; // pr. måned
  winBonus: number; // pr. ligasejr
  trophyBonus: number; // pr. trofæ / opfyldt mål ved sæsonslut
  season: number;
}

export type TalkStage = 'pre' | 'half' | 'post';
export type TalkTone = 'noPressure' | 'motivate' | 'demand' | 'focus' | 'passionate' | 'praise' | 'calm' | 'criticise' | 'disappointed';
export type TalkReaction = 'fired' | 'focused' | 'neutral' | 'complacent' | 'nervous' | 'angry' | 'deflated';

export interface MatchTalk {
  fixture: number;
  /** Faktor pr. spiller til kampmotoren (fra seneste snak før/under kampen) */
  boosts: Record<number, number>;
  done: TalkStage[];
}

/** Besked mellem managere. Tekst fra mennesker, eller en tekstnøgle (AI-managere) så den vises på læserens sprog */
export interface ChatMsg {
  id: number;
  from: string;
  to: string;
  date: string;
  text?: string;
  key?: string;
  params?: Record<string, string | number>;
}

/** Indbyrdes regnskab mellem to managere – set fra den første (a) i nøglen */
export interface H2HRecord {
  a: string; b: string;
  w: number; d: number; l: number;
  gf: number; ga: number;
  /** Største sejr for hver: [mål for, mål imod, dato] */
  bestA?: [number, number, string];
  bestB?: [number, number, string];
  last?: { date: string; fixture: number; gf: number; ga: number; comp: string };
}
