/**
 * Messages between the UI and the simulation worker, and the view models the
 * worker sends back. Everything here is plain, structured-cloneable data.
 */
import type { DepthChart, TransactionType } from "../../../src/league/types";
import type { FieldPosition, Level, MinorLevel, PitchType } from "../../../src/players/types";
import type { HitterRow, PitcherRow } from "../../../src/season/season";

export type { HitterRow, PitcherRow };

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
  phase?: "regular" | "postseason" | "done";
  userTeamId?: number | null;
  minors?: boolean;
  leagues?: string[];
  divisions?: string[];
  teams?: TeamRef[];
  record?: { w: number; l: number } | null;
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
  /** Key present grades: hitters Hit/Power/Eye/Run/Field/Arm, pitchers Stuff/Control/Command/Stamina. */
  grades: [string, number][];
  status: PlayerStatus;
  /** One-line stats at his current level this season. */
  line: string;
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

export interface TeamView {
  team: TeamRef & { park: string; altitude: number; market: number; affiliates: Record<MinorLevel, string> };
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
