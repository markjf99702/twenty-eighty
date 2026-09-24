/**
 * Messages between the UI and the simulation worker, and the view models the
 * worker sends back. Everything here is plain, structured-cloneable data.
 */
import type { DepthChart, TransactionType } from "../../../src/league/types";
import type { OffseasonPhase } from "../../../src/offseason/types";
import type { CareerLine, ContractType, FieldPosition, Level, MinorLevel, PitchType } from "../../../src/players/types";
import type { HitterRow, PitcherRow } from "../../../src/season/season";

export type { CareerLine, HitterRow, OffseasonPhase, PitcherRow };

export interface TeamRef {
  id: number;
  abbrev: string;
  city: string;
  nickname: string;
  league: number;
  division: number;
}

export interface Status {
  hasGame: boolean;
  hasSave: boolean;
  seed?: string;
  year?: number;
  day?: number;
  totalDays?: number;
  date?: string;
  phase?: "regular" | "postseason" | "done" | "offseason";
  /** Where the winter stands, during the offseason. */
  winter?: { phase: OffseasonPhase; label: string; action: string; week?: number; weeks?: number; userOnClock?: boolean };
  /** Whether the user can trade right now (no trades after the deadline until the season ends). */
  canTrade?: boolean;
  tradeNote?: string;
  userTeamId?: number | null;
  minors?: boolean;
  leagues?: string[];
  divisions?: string[];
  teams?: TeamRef[];
  record?: { w: number; l: number } | null;
  /** The owner's view of the user, when the user runs a club. */
  owner?: { confidence: number; mood: string; fired: boolean } | null;
}

export interface NewGameTeam extends TeamRef {
  park: string;
  altitude: number;
  market: number;
  /** Projected MLB strength (average overall grade of the top 26). */
  strength: number;
  farm: number;
}

export interface StandingRow {
  teamId: number;
  name: string;
  abbrev: string;
  w: number;
  l: number;
  pct: number;
  gb: number;
  rs: number;
  ra: number;
  streak: number;
  last10: string;
  home: string;
  away: string;
}

export interface StandingsView {
  level: Level;
  leagues: string[];
  divisions: string[];
  /** [league][division] -> rows */
  table: StandingRow[][][];
  /** Wild-card race per league: non-division-leaders by record. */
  wildCard: { teamId: number; name: string; abbrev: string; w: number; l: number; gb: number }[][];
}

export interface PlayerStatus {
  fortyMan: boolean;
  optionsLeft: number;
  optionedThisYear: boolean;
  canBeOptioned: boolean;
  service: string;
  il: string | null;
  injury: { name: string; daysLeft: number } | null;
}

export type Confidence = "high" | "medium" | "low";

export interface ContractView {
  type: ContractType;
  salary: number;
  years: number;
  /** Last season covered. */
  through: number;
  /** "$22.5M through 2029", "Pre-arb $0.84M", "Arbitration $6.1M", "Minor league deal". */
  label: string;
}

/** A compact season line for roster tables. Rates are fractions; null means not tracked at that level. */
export interface HitterSnapshot {
  G: number;
  PA: number;
  AVG: number | null;
  OBP: number | null;
  SLG: number | null;
  HR: number;
  SB: number;
  BBpct: number | null;
  Kpct: number | null;
  wRCplus: number | null;
  xwOBA: number | null;
  def: number | null;
  /** Null for recent-form lines (WAR is a season stat). */
  WAR: number | null;
}

export interface PitcherSnapshot {
  G: number;
  GS: number;
  IP: number;
  W: number;
  L: number;
  SV: number;
  ERA: number;
  FIP: number;
  /** Park-adjusted ERA, 100 = league average. */
  ERAminus: number | null;
  Kpct: number | null;
  BBpct: number | null;
  WHIP: number | null;
  WAR: number | null;
}

export interface StatSnapshot {
  year: number;
  level: Level;
  /** For recent form: games he appeared in out of the club's last 15. */
  recent?: boolean;
  bat?: HitterSnapshot;
  pit?: PitcherSnapshot;
}

export interface PlayerSummary {
  id: number;
  name: string;
  pos: string;
  age: number;
  bats: string;
  throws: string;
  level: Level;
  teamId: number | null;
  ovr: number;
  fv: number;
  pitcher: boolean;
  /** Key present grades as your scouts see them: hitters Hit/Power/Eye/Run/Field/Arm, pitchers Stuff/Control/Command/Stamina. */
  grades: [string, number][];
  /**
   * Your front office's read: the scouts' overall grade, the analytics
   * department's (null without a sample), and how sure the scouts are.
   */
  read: { scouts: number; analytics: number | null; confidence: Confidence };
  status: PlayerStatus;
  /** One-line stats at his current level this season. */
  line: string;
  /** This season at his current level, last season (his big-league line if he had one), and his club's last 15 games. */
  stats: StatSnapshot | null;
  last: StatSnapshot | null;
  recent: StatSnapshot | null;
  contract: ContractView | null;
  /** Roster moves available to the user's club right now, with the reason when blocked. */
  actions?: RosterActionOption[];
}

export type RosterActionKind =
  | "callUp"
  | "option"
  | "dfa"
  | "placeIl"
  | "activate"
  | "activateToMinors"
  | "assign"
  | "add40"
  | "release";

export interface RosterActionOption {
  kind: RosterActionKind;
  label: string;
  level?: MinorLevel;
  ok: boolean;
  reason?: string;
}

export interface RosterAction {
  kind: RosterActionKind;
  playerId: number;
  level?: MinorLevel;
}

export interface PayrollView {
  payroll: number;
  budget: number;
  /** Scouting and analytics departments, $M a year. */
  staff: number;
  deadMoney: number;
  /** Guaranteed money already committed for each of the next five seasons. */
  commitments: { year: number; amount: number }[];
  /** Every player with a big-league contract, priciest first. */
  contracts: (PlayerSummary & { surplus: number })[];
}

export interface TeamView {
  team: TeamRef & { park: string; altitude: number; market: number; affiliates: Record<MinorLevel, string> };
  payroll: PayrollView;
  isUser: boolean;
  manualRoster: boolean;
  manualDepth: boolean;
  record: { w: number; l: number; rs: number; ra: number } | null;
  counts: { active: number; activeLimit: number; pitchers: number; pitcherLimit: number; fortyMan: number };
  problems: string[];
  depth: DepthChart;
  /** MLB active roster, injured list, and each affiliate. */
  active: PlayerSummary[];
  injured: PlayerSummary[];
  minors: Record<MinorLevel, PlayerSummary[]>;
}

export interface StatLine {
  level: Level;
  team: string;
  hitting?: HitterRow;
  pitching?: PitcherRow;
}

export interface PlayerView {
  summary: PlayerSummary;
  team: TeamRef | null;
  born: string;
  tools: { label: string; present: number; future: number; note?: string }[];
  pitches: { type: PitchType; name: string; present: number; future: number; usage: number }[];
  velocity: number | null;
  defense: { pos: FieldPosition; grade: number; natural: boolean }[];
  traits: string[];
  stats: StatLine[];
  transactions: { date: string; text: string }[];
  career: CareerLine[];
  careerTeams: Record<number, string>;
  awards: string[];
  draft: string | null;
  /** Trade value: surplus over the years of control, $M (null for free agents). */
  surplus: number | null;
  retired: number | null;
  /** How your front office sees him. */
  scouting: {
    /** Typical error in your scouts' grades, in grade points. */
    sigma: number;
    confidence: Confidence;
    familiarity: string;
    looks: number;
    looksLeft: number;
    canLook: boolean;
    scoutsGrade: number;
    analytics: { grade: number; reliability: number; sample: number; basis: string; weight: number } | null;
    blendGrade: number;
  };
}

export interface ScoutingView {
  editable: boolean;
  scouting: { tier: number; label: string; cost: number };
  analytics: { tier: number; label: string; cost: number; basis: string };
  tiers: {
    scouting: { tier: number; label: string; cost: number; sigma: number }[];
    analytics: { tier: number; label: string; cost: number; trust: number; basis: string }[];
  };
  /** Typical error of your scouts' grades by kind of player, at your current level. */
  accuracy: { label: string; sigma: number }[];
  looksLeft: number;
  looksPerWindow: number;
  scouted: { playerId: number; name: string; team: string; pos: string; looks: number }[];
  budget: { budget: number; payroll: number; staff: number };
}

export interface StatsView {
  level: Level;
  kind: "hitters" | "pitchers";
  qualifyingPA: number;
  qualifyingIP: number;
  hitters?: HitterRow[];
  pitchers?: PitcherRow[];
  context: { runsPerGame: number; lgAvg: number; lgObp: number; lgSlg: number; lgEra: number; lgWoba: number; fipConstant: number; runsPerWin: number; weights: Record<string, number>; wobaScale: number };
}

export interface TransactionItem {
  date: string;
  year: number;
  teamId: number;
  abbrev: string;
  playerId: number;
  type: TransactionType;
  text: string;
}

export interface GameItem {
  key: string;
  day: number;
  awayId: number;
  homeId: number;
  away: string;
  home: string;
  score: [number, number];
  innings: number;
  hasBox: boolean;
  wp: string | null;
  lp: string | null;
  sv: string | null;
}

export interface ScoresView {
  day: number;
  date: string;
  firstDay: number;
  lastDay: number;
  games: GameItem[];
}

export interface BoxBatter {
  id: number;
  name: string;
  pos: string;
  sub?: string;
  ab: number;
  r: number;
  h: number;
  rbi: number;
  bb: number;
  so: number;
  hr: number;
  avgEv: number | null;
}

export interface BoxPitcher {
  id: number;
  name: string;
  note: string;
  ip: string;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
  pitches: number;
}

export interface BoxScoreView {
  key: string;
  date: string;
  park: string;
  teams: [TeamRef, TeamRef];
  lineScore: [number[], number[]];
  totals: [{ r: number; h: number; e: number }, { r: number; h: number; e: number }];
  batting: [BoxBatter[], BoxBatter[]];
  pitching: [BoxPitcher[], BoxPitcher[]];
  notes: string[];
  attendance?: number;
}

export interface DashboardView {
  status: Status;
  team: TeamRef;
  record: { w: number; l: number; rs: number; ra: number; streak: number; last10: string; divRank: number; gb: number };
  division: StandingRow[];
  recent: GameItem[];
  leaders: { label: string; name: string; playerId: number; value: string }[];
  injured: PlayerSummary[];
  prospects: PlayerSummary[];
  news: TransactionItem[];
  userNews: TransactionItem[];
}

export interface PostseasonView {
  seeds: { teamId: number; abbrev: string; name: string }[][];
  series: { round: string; league: string; higher: string; lower: string; winner: string; wins: [number, number]; games: string[] }[];
  champion: string | null;
}

// ---------------------------------------------------------------------------
// The offseason

export interface DevRow {
  player: PlayerSummary;
  team: string;
  before: number;
  after: number;
}

export interface DraftProspect extends PlayerSummary {
  school: "High school" | "College";
}

export interface FreeAgentRow {
  player: PlayerSummary;
  war: number;
  askYears: number;
  askSalary: number;
  /** The lowest annual salary he'd take this week for his asked-for years. */
  floor: number;
}

export interface OffseasonView {
  phase: OffseasonPhase;
  year: number;
  review?: {
    champion: string | null;
    awards: { name: string; league: string; playerId: number; player: string; team: string; note: string }[];
    finish: string | null;
    record: string | null;
    risers: DevRow[];
    fallers: DevRow[];
    retirements: { playerId: number; name: string; team: string; age: number }[];
    shift: Record<string, number>;
  };
  tenders?: {
    rows: { player: PlayerSummary; salary: number; war: number; tender: boolean }[];
    expiring: PlayerSummary[];
  };
  draft?: {
    onClock: { round: number; pick: number; team: string; mine: boolean } | null;
    myPicks: number[];
    board: DraftProspect[];
    picks: { pick: number; round: number; team: string; playerId: number; name: string; pos: string; fv: number; mine: boolean }[];
  };
  freeAgency?: {
    week: number;
    weeks: number;
    agents: FreeAgentRow[];
    offers: { playerId: number; years: number; salary: number }[];
    signings: { playerId: number; name: string; team: string; years: number; salary: number; week: number }[];
  };
  international?: {
    pool: number;
    signed: number;
    maxSignings: number;
    prospects: (PlayerSummary & { bonus: number })[];
    signings: { playerId: number; name: string; team: string; bonus: number }[];
  };
  payroll: { payroll: number; staff: number; budget: number; fortyMan: number };
}

export interface TradeSide {
  team: TeamRef;
  players: (PlayerSummary & { surplus: number })[];
}

export interface TradeCheckView {
  ok: boolean;
  reason?: string;
  give: number;
  get: number;
  done?: boolean;
}

export interface HistoryView {
  seasons: {
    year: number;
    champion: string;
    runnerUp: string | null;
    mine: { record: string; finish: string } | null;
    awards: { name: string; league: string; playerId: number; player: string; team: string; note: string }[];
  }[];
}

// ---------------------------------------------------------------------------
// The business side

export interface LedgerView {
  year: number;
  revenue: { gate: number; concessions: number; media: number; sponsorship: number; national: number; postseason: number; total: number };
  expenses: { payroll: number; deadMoney: number; staff: number; operations: number; bonuses: number; total: number };
  profit: number;
  homeGames: number;
  attendance: number;
  perGame: number;
}

export interface FinanceYearView extends LedgerView {
  wins: number;
  losses: number;
  budget: number;
  interest: number;
  distribution: number;
  cash: number;
}

export interface OwnerCard {
  name: string;
  style: string;
  styleLabel: string;
  pitch: string;
}

export interface FinanceView {
  team: TeamRef;
  mine: boolean;
  owner: OwnerCard;
  market: number;
  capacity: number;
  interest: number;
  cash: number;
  budget: number;
  /** Current annual commitments. */
  payroll: number;
  staff: number;
  /** "This season so far", or next season's books during the winter. */
  current: LedgerView;
  /** Fraction of the regular season played (0 in the winter). */
  played: number;
  /** A full season's revenue at today's interest and price (no postseason). */
  projectedRevenue: number;
  operations: number;
  ticket: {
    price: number;
    auto: boolean;
    reference: number;
    /** What the business office would charge. */
    best: number;
    /** Above this price, fans start to resent it. */
    gouge: number;
    /** Expected fans per game and a full season's gate plus concessions at each price. */
    curve: { price: number; perGame: number; money: number }[];
    editable: boolean;
  };
  history: FinanceYearView[];
  league: {
    team: TeamRef;
    market: number;
    perGame: number;
    revenue: number;
    payroll: number;
    budget: number;
    interest: number;
    mine: boolean;
  }[];
}

export type GoalStatus = "met" | "missed" | "on track" | "behind" | "not started";

export interface GoalView {
  kind: string;
  label: string;
  weight: number;
  status: GoalStatus;
  /** "84 wins (pace 91)", "1.62M so far". */
  progress: string;
}

export interface ReviewView {
  year: number;
  wins: number;
  expectedWins: number | null;
  goals: { label: string; met: boolean; delta: number; actual: string }[];
  notes: { text: string; delta: number }[];
  before: number;
  after: number;
}

export interface OwnerView {
  team: TeamRef;
  owner: OwnerCard;
  patience: string;
  confidence: number;
  mood: string;
  hired: number;
  seasons: number;
  expectedWins: number | null;
  goalYear: number;
  goals: GoalView[];
  messages: { date: string; tone: "good" | "bad" | "neutral"; text: string }[];
  reviews: ReviewView[];
  fired: boolean;
  offers: { team: TeamRef; record: string; market: number; budget: number; owner: OwnerCard; farm: number }[];
}

/** Request -> response map. */
export interface Api {
  status: { req: void; res: Status };
  newGameTeams: { req: { seed: string }; res: NewGameTeam[] };
  newGame: { req: { seed: string; teamId: number; minors: boolean }; res: Status };
  load: { req: void; res: Status };
  importSave: { req: { text: string }; res: Status };
  exportSave: { req: void; res: string };
  deleteSave: { req: void; res: Status };
  sim: { req: { days: number | "end" }; res: Status };
  /** Stop a running sim after the current day. */
  stop: { req: void; res: { ok: boolean } };
  playoffs: { req: void; res: Status };
  dashboard: { req: void; res: DashboardView };
  standings: { req: { level: Level }; res: StandingsView };
  team: { req: { teamId: number }; res: TeamView };
  player: { req: { playerId: number }; res: PlayerView };
  stats: { req: { level: Level; kind: "hitters" | "pitchers" }; res: StatsView };
  transactions: { req: { teamId?: number; majorOnly?: boolean; limit?: number }; res: TransactionItem[] };
  scores: { req: { day?: number }; res: ScoresView };
  boxScore: { req: { key: string }; res: BoxScoreView | null };
  rosterAction: { req: RosterAction; res: { ok: boolean; reason?: string } };
  setDepth: { req: { depth: DepthChart }; res: { ok: boolean; reason?: string } };
  setFlags: { req: { manualRoster?: boolean; manualDepth?: boolean }; res: { ok: boolean } };
  postseason: { req: void; res: PostseasonView | null };
  beginOffseason: { req: void; res: Status };
  advance: { req: void; res: Status };
  winterWeek: { req: void; res: Status };
  offseason: { req: void; res: OffseasonView | null };
  setTender: { req: { playerId: number; tender: boolean }; res: { ok: boolean; reason?: string } };
  draftPick: { req: { playerId: number }; res: { ok: boolean; reason?: string } };
  draftToMe: { req: void; res: Status };
  faOffer: { req: { playerId: number; years: number; salary: number }; res: { ok: boolean; reason?: string } };
  faWithdraw: { req: { playerId: number }; res: { ok: boolean } };
  intlSign: { req: { playerId: number }; res: { ok: boolean; reason?: string } };
  tradeSides: { req: { partnerId: number }; res: { mine: TradeSide; theirs: TradeSide } };
  trade: { req: { partnerId: number; give: number[]; get: number[]; execute: boolean }; res: TradeCheckView };
  history: { req: void; res: HistoryView };
  scouting: { req: void; res: ScoutingView };
  setDepartments: { req: { scouting: number; analytics: number }; res: { ok: boolean; reason?: string } };
  scoutPlayer: { req: { playerId: number }; res: { ok: boolean; reason?: string } };
  finances: { req: { teamId?: number }; res: FinanceView };
  setTicketPrice: { req: { price: number | "auto" }; res: { ok: boolean; reason?: string } };
  owner: { req: void; res: OwnerView | null };
  acceptJob: { req: { teamId: number }; res: Status };
}

export type ApiName = keyof Api;

export interface RequestMessage {
  id: number;
  name: ApiName;
  payload: unknown;
}

export type ResponseMessage =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: { day: number; total: number } };
