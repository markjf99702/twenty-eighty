/**
 * Messages between the UI and the simulation worker, and the view models the
 * worker sends back. Everything here is plain, structured-cloneable data.
 */
import type { PriorCareer } from "../../../src/players/prior";
import type { GameSettings } from "../../../src/league/settings";
import type { DepthChart, TransactionType } from "../../../src/league/types";
import type { OffseasonPhase } from "../../../src/offseason/types";
import type { Group } from "../../../src/org/market";
import type { RoomMove } from "../../../src/org/trades";
import type { CareerLine, ContractType, FieldPosition, Level, MinorLevel, PitchType } from "../../../src/players/types";
import type { HitterRow, PitcherRow } from "../../../src/season/season";

export type { CareerLine, GameSettings, HitterRow, OffseasonPhase, PitcherRow };

export interface TeamRef {
  id: number;
  abbrev: string;
  city: string;
  nickname: string;
  league: number;
  division: number;
}

/** What a Google Drive copy says about the league inside it. */
export interface DriveMeta {
  league: string;
  club: string;
  when: string;
  /** When the league last changed, ms since 1970. */
  saved: number;
}

export interface Status {
  hasGame: boolean;
  hasSave: boolean;
  /** Which league this is across devices, and when it last changed (ms since 1970). */
  leagueId?: string;
  savedAt?: number;
  /** The user's club and where the league stands, for naming a Drive copy: "May 21, 2026". */
  club?: string;
  when?: string;
  seed?: string;
  year?: number;
  day?: number;
  totalDays?: number;
  date?: string;
  phase?: "regular" | "postseason" | "done" | "offseason";
  /** October: whether it's started, whether the user's club is still in it, and its next game ("Game 3"). */
  october?: { started: boolean; alive: boolean; next: string | null };
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
  /** Trade offers waiting on the user. */
  offers?: number;
  /** The trade deadline, while it's still ahead (or today). */
  deadline?: { date: string; daysLeft: number } | null;
  /** Why the last sim stopped early (a stop trigger), if it did. */
  stop?: StopNote;
  settings?: GameSettings;
  /** Staff notes not yet read. */
  staffUnread?: number;
}

export interface AdviceView {
  key: string;
  from: "assistant" | "scouting" | "analytics" | "business";
  /** "Dana Ruiz, Assistant GM". */
  who: string;
  when: string;
  urgent: boolean;
  title: string;
  text: string;
  href?: string;
  read: boolean;
}

/** When a running sim should stop by itself. */
export interface StopRules {
  /** Stop when the user's club has lost this many in a row (0 = never). */
  streak: number;
  /** A big leaguer of the user's goes down for injured-list time. */
  injury: boolean;
  /** A club makes the user a trade offer: only ones the staff doesn't pass on, any, or none. */
  offer: "good" | "all" | "off";
  /** Stop with deadline day still to play. */
  deadline: boolean;
  /** A staff member sends an urgent note. */
  staff: boolean;
  /** The All-Star Game has been played. */
  allStar: boolean;
  /** One of the user's players has a moment: a no-hitter, a cycle, a milestone, a record. */
  moments: boolean;
}

export interface StopNote {
  kind: "streak" | "injury" | "offer" | "deadline" | "staff" | "allstar" | "moment";
  text: string;
  /** Where to look (a route hash). */
  href?: string;
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
  /** Projected WAR over a full season in his role, by your read (null for prospects below AAA). */
  proj: number | null;
  /** Rookie-eligible: his future value (FV) is the number to know. */
  prospect: boolean;
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
  /** His big-league career before the league's first season, in total (generated). */
  prior: PriorCareer | null;
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
    /** The same reads in projected WAR a season, for players measured in wins (null for prospects below AAA). */
    war: { scouts: number; analytics: number | null; read: number } | null;
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

export interface PostGameView {
  /** Game number in the series. */
  n: number;
  date: string;
  key: string;
  hasBox: boolean;
  away: string;
  home: string;
  score: [number, number];
  innings: number;
  /** "Forge 5, Firebirds 4: a walk-off in the 10th." */
  recap: string;
  winner: string;
  /** The series after this game: "Forge lead 2-1". */
  after: string;
}

export interface SeriesView {
  round: string;
  /** "" for the World Series. */
  league: string;
  higher: { id: number; abbrev: string; name: string; seed: number | null };
  lower: { id: number; abbrev: string; name: string; seed: number | null };
  /** [higher, lower] */
  wins: [number, number];
  winner: string | null;
  /** "Forge lead 2-1", "Tied 1-1", "Game 1 to come". */
  status: string;
  games: PostGameView[];
  next: { n: number; date: string; home: string } | null;
  mvp: { playerId: number; name: string; team: string; line: string } | null;
  mine: boolean;
}

export interface StarterView {
  id: number;
  name: string;
  /** Regular season: "14-8, 3.12 ERA". */
  line: string;
}

export interface PostseasonView {
  started: boolean;
  over: boolean;
  seeds: { teamId: number; abbrev: string; name: string }[][];
  leagues: string[];
  series: SeriesView[];
  /** The round being played. */
  round: string | null;
  /** When the next games are. */
  date: string | null;
  champion: string | null;
  /** The user's October (null without a club). */
  user: {
    /** Seed, or null if the club missed the postseason. */
    seed: number | null;
    alive: boolean;
    series: SeriesView[];
    next: { n: number; round: string; date: string; home: boolean; opponent: string; starter: StarterView | null; theirStarter: StarterView | null } | null;
    plan: { roster: number; pitchers: number; rotation: { id: number; name: string }[] };
  } | null;
}

export interface PlayoffPlanView {
  /** False once the club is out. */
  editable: boolean;
  /** Everyone eligible: the 40-man roster. */
  players: PlayerSummary[];
  roster: number[];
  rotation: number[];
  limits: { roster: number; pitchers: number };
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
    awards: AwardRow[];
    executives: ExecutiveRow[];
    allStar: AllStarLine | null;
    /** This winter's Hall of Fame vote: who got in, and how many were on the ballot (null if no one was). */
    hall: { elected: { playerId: number; name: string; vote: number }[]; candidates: number } | null;
    finish: string | null;
    record: string | null;
    risers: DevRow[];
    fallers: DevRow[];
    retirements: { playerId: number; name: string; team: string; age: number }[];
    shift: Record<string, number>;
  };
  tenders?: {
    /**
     * `line` is the case he took into arbitration (last season's numbers; null
     * if he barely played), `saves` how much of the award his saves bought.
     */
    rows: { player: PlayerSummary; salary: number; war: number; tender: boolean; line: string | null; saves: number }[];
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

export interface ExtensionOptionView {
  years: number;
  /** Annual salary, $M. */
  salary: number;
  total: number;
  first: number;
  through: number;
  /** Seasons it covers that would have been pre-arbitration, arbitration and free agency. */
  covers: { preArb: number; arb: number; free: number };
  /** What the deal adds over keeping him as he is, in surplus value by your front office's read, $M. */
  gain: number;
}

export interface ExtensionView {
  /** Why he won't sign one right now (null when he will). */
  reason: string | null;
  /** "2.4 years of service · arbitration from 2028 · free agent after 2031". */
  clock: string | null;
  /** The last season before he can walk. */
  freeAfter: number | null;
  inSeason: boolean;
  options: ExtensionOptionView[];
}

export interface ExtensionCandidateView {
  player: PlayerSummary;
  clock: string | null;
  freeAfter: number | null;
  reason: string | null;
  /** The length that gains the most by your read (null if none gains). */
  best: ExtensionOptionView | null;
}

export interface TradeSide {
  team: TeamRef;
  players: (PlayerSummary & { surplus: number })[];
}

/** What the user's staff makes of a trade, by the club's own read (only as good as its departments). */
export interface TradeAdviceView {
  verdict: "take" | "consider" | "pass";
  headline: string;
  /** How sure the staff is about the players coming in. */
  confidence: Confidence;
  /** "Dana Wu, Scouting director" and what they say. */
  notes: { who: string; text: string }[];
}

export interface OfferView {
  id: number;
  team: TeamRef;
  kind: "buy" | "sell";
  pitch: string;
  /** "Through Jul 14", "Until next week". */
  expires: string;
  give: (PlayerSummary & { surplus: number })[];
  get: (PlayerSummary & { surplus: number })[];
  /** Surplus you send and receive, as your front office sees it. */
  value: { give: number; get: number };
  /** Taking it would put your 40-man this many over: designate someone in the builder. */
  over?: number;
  /** The staff's take (null with staff advice off). */
  advice: TradeAdviceView | null;
}

export type { Group, RoomMove };

/** A veteran a club out of the race is shopping, as your front office sees him. */
export interface BlockRow extends PlayerSummary {
  surplus: number;
  club: TeamRef;
  /** His club's games behind the last playoff spot (null in the winter). */
  gamesOut: number | null;
  group: Group;
  /** Wins a season he'd add over who plays there now, by your read. */
  fit: number;
}

export interface AskingView {
  ok: boolean;
  reason?: string;
  /** What they'd want from your system (empty: they'd let him go for nothing). */
  give?: number[];
  text?: string;
}

export interface TradeCheckView {
  ok: boolean;
  reason?: string;
  give: number;
  get: number;
  /** They'd say yes, but your 40-man would be this many over. */
  over?: number;
  /** Your 40-man after the deal and the room moves. */
  fortyMan?: number;
  /** Your active roster after the deal and the room moves (null in the winter, when it doesn't matter yet). */
  active?: number | null;
  activeLimit?: number;
  done?: boolean;
  /** After a trade: what became of the players moved to make room. */
  moves?: string[];
  /** After a trade: a roster problem the user needs to fix (or the assistant will). */
  warning?: string;
  /** The staff's take on the deal as it stands (null with staff advice off). */
  advice?: TradeAdviceView | null;
}

export interface HistoryView {
  seasons: {
    year: number;
    champion: string;
    runnerUp: string | null;
    mine: { record: string; finish: string } | null;
    awards: AwardRow[];
    executives: ExecutiveRow[];
    allStar: AllStarLine | null;
  }[];
}

/** A season award: `pos` for Gold Gloves and Silver Sluggers, `mine` if he played for the user's club. */
export interface AwardRow {
  name: string;
  league: string;
  pos: string | null;
  playerId: number;
  player: string;
  team: string;
  note: string;
  mine: boolean;
}

/** Executive of the Year: `mine` when it's the user. */
export interface ExecutiveRow {
  league: string;
  team: string;
  note: string;
  mine: boolean;
}

/** The All-Star Game in a line: "Continental 5, Federal 3 in Kansas City", and its MVP. */
export interface AllStarLine {
  text: string;
  mvp: { playerId: number; name: string; team: string; note: string } | null;
}

export interface AllStarBatRow {
  playerId: number;
  name: string;
  team: string;
  pos: string;
  /** In the starting lineup (the rest came off the bench). */
  starter: boolean;
  mine: boolean;
  AB: number;
  R: number;
  H: number;
  HR: number;
  RBI: number;
  BB: number;
  SO: number;
}

export interface AllStarPitchRow {
  playerId: number;
  name: string;
  team: string;
  mine: boolean;
  IP: string;
  H: number;
  R: number;
  ER: number;
  BB: number;
  SO: number;
}

/** A no-hitter, a cycle, a milestone, a record: `mine` if it's the user's club. */
export interface MomentView {
  year: number;
  date: string;
  kind: string;
  text: string;
  playerId: number;
  team: string;
  mine: boolean;
  /** The box score, while it's still kept. */
  box: string | null;
}

export interface RecordRowView {
  value: string;
  name: string;
  playerId: number | null;
  legendId: number | null;
  /** The season, or a career's span. */
  when: string;
  team: string;
  active: boolean;
  live: boolean;
  mine: boolean;
}

/** The record book: season or career records, league-wide or for one club; or the moments. */
export interface RecordsView {
  /** "League" or the club's name. */
  scope: string;
  teams: { id: number; name: string }[];
  since: number;
  categories: { stat: string; label: string; pitching: boolean; rows: RecordRowView[] }[];
  moments: MomentView[];
}

export interface HallPlaque {
  name: string;
  playerId: number | null;
  legendId: number | null;
  pos: string;
  years: string;
  team: string;
  line: string;
  inducted: number;
  vote: number;
  /** Played for the user's club (in the league's seasons), or is the club's legend. */
  mine: boolean;
}

export interface HallView {
  members: HallPlaque[];
  ballot: { year: number; entries: { playerId: number; name: string; pos: string; line: string; vote: number; ballot: number; elected: boolean; dropped: boolean }[] } | null;
}

/** This season's All-Star Game: the box score, both rosters and the user's All-Stars. */
export interface AllStarView {
  year: number;
  /** The season day it was played, and its date. */
  day: number;
  date: string;
  /** Where it was played. */
  where: string;
  /** [away, home] */
  leagues: [string, string];
  score: [number, number];
  innings: number;
  lineScore: [number[], number[]];
  mvp: AllStarLine["mvp"];
  sides: { league: string; batting: AllStarBatRow[]; pitching: AllStarPitchRow[]; unused: { playerId: number; name: string; team: string; pos: string; mine: boolean }[] }[];
  /** The user's All-Stars, by name. */
  mine: { playerId: number; name: string }[];
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
  newGame: { req: { seed: string; teamId: number; minors: boolean; settings?: GameSettings }; res: Status };
  load: { req: void; res: Status };
  importSave: { req: { text: string }; res: Status };
  /** The league as compressed text for Google Drive, if it changed after `since` (else null). */
  driveCode: { req: { since: number }; res: { code: string; meta: DriveMeta } | null };
  /** Replace the league on this device with a copy from Google Drive. */
  openCode: { req: { code: string }; res: Status };
  exportSave: { req: void; res: string };
  deleteSave: { req: void; res: Status };
  /** `msPerDay`: at least this long per simulated day, so a page can be watched as it plays (0 = as fast as possible). */
  sim: { req: { days: number | "end"; msPerDay?: number; stops?: StopRules }; res: Status };
  /** Stop a running sim after the current day. */
  stop: { req: void; res: { ok: boolean } };
  /** Change the pace of a running (or the next) sim. */
  setPace: { req: { msPerDay: number }; res: { ok: boolean } };
  setStops: { req: StopRules; res: { ok: boolean } };
  allStar: { req: void; res: AllStarView | null };
  records: { req: { kind: "season" | "career" | "moments"; teamId: number | null }; res: RecordsView };
  hall: { req: void; res: HallView };
  moments: { req: { limit: number }; res: MomentView[] };
  playoffs: { req: void; res: Status };
  /** Play October on: through the user's next game, to the end of the round, or to the end. */
  playPostseason: { req: { step: "game" | "round" | "all" }; res: { status: Status; games: { recap: string; after: string; mine: boolean }[] } };
  playoffPlan: { req: void; res: PlayoffPlanView | null };
  setPlayoffPlan: { req: { roster: number[]; rotation: number[] }; res: { ok: boolean; reason?: string } };
  dashboard: { req: void; res: DashboardView };
  standings: { req: { level: Level }; res: StandingsView };
  team: { req: { teamId: number }; res: TeamView };
  player: { req: { playerId: number }; res: PlayerView };
  stats: { req: { level: Level; kind: "hitters" | "pitchers" }; res: StatsView };
  /** The wire: everything, big-league moves (no minor league shuffles), or just the headlines. */
  transactions: { req: { teamId?: number; majorOnly?: boolean; headlines?: boolean; limit?: number }; res: TransactionItem[] };
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
  trade: { req: { partnerId: number; give: number[]; get: number[]; moves?: RoomMove[]; execute: boolean }; res: TradeCheckView };
  offers: { req: void; res: OfferView[] };
  onTheBlock: { req: void; res: BlockRow[] };
  askingPrice: { req: { partnerId: number; get: number[] }; res: AskingView };
  extension: { req: { playerId: number }; res: ExtensionView | null };
  signExtension: { req: { playerId: number; years: number }; res: { ok: boolean; reason?: string } };
  extensionCandidates: { req: void; res: ExtensionCandidateView[] };
  answerOffer: { req: { id: number; accept: boolean }; res: { ok: boolean; reason?: string; warning?: string } };
  setSettings: { req: Partial<GameSettings>; res: Status };
  advice: { req: void; res: AdviceView[] };
  readAdvice: { req: void; res: Status };
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
