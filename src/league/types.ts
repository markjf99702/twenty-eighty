import type { GmState, Owner, TeamFinance } from "../finance/types";
import type { OffseasonState } from "../offseason/types";
import type { GameSettings } from "./settings";
import type { ScoutingState } from "../scouting/types";
import type { FieldPosition, Level, MinorLevel, Player } from "../players/types";

export interface Park {
  name: string;
  /** Fence distances in feet: left-field line, left-center, center, right-center, right-field line. */
  dims: [number, number, number, number, number];
  /** Wall heights in feet at the same five points. */
  walls: [number, number, number, number, number];
  /** Elevation in feet; thin air carries fly balls farther. */
  altitude: number;
}

export interface DepthChart {
  /** Starter at each fielding position. */
  starters: Record<FieldPosition, number>;
  dh: number;
  /** Bench position players, in order of preference. */
  bench: number[];
  /** Five-man rotation, in order. */
  rotation: number[];
  /** Bullpen, best (closer) first. */
  bullpen: number[];
}

export interface Affiliate {
  level: MinorLevel;
  name: string;
  park: Park;
}

export interface Team {
  id: number;
  city: string;
  nickname: string;
  abbrev: string;
  league: number;
  division: number;
  park: Park;
  /** Metro population in millions; drives revenue. */
  market: number;
  /** Players assigned to each level. MLB is the 26-man active roster (injured-list players excluded). */
  rosters: Record<Level, number[]>;
  /** The 40-man reserve list: MLB actives, optioned players, and short-term injured-list players. */
  fortyMan: number[];
  /** MLB injured list. */
  injured: number[];
  /** MLB depth chart, rebuilt by the manager AI after roster moves (unless the user sets it). */
  depth: DepthChart;
  /** The user has set this club's depth chart by hand; the AI only patches holes. */
  manualDepth?: boolean;
  /** The user makes this club's roster moves; the AI stays out. */
  manualRoster?: boolean;
  affiliates: Record<MinorLevel, Affiliate>;
  /** Baseball budget in millions of dollars (payroll, dead money and front-office departments), set by the owner each winter. */
  budget: number;
  /** Money still owed to released players: this season's amount and seasons left. */
  deadMoney: { playerId: number; amount: number; years: number }[];
  owner: Owner;
  finance: TeamFinance;
}

export interface LeagueStructure {
  leagues: string[];
  divisions: string[];
}

export type TransactionType =
  | "call-up"
  | "option"
  | "promote"
  | "demote"
  | "il-place"
  | "il-activate"
  | "il-transfer"
  | "dfa"
  | "claim"
  | "outright"
  | "release"
  | "add-40"
  | "injury"
  | "sign"
  | "trade"
  | "draft"
  | "retire"
  | "non-tender"
  | "free-agent"
  | "arbitration";

export interface Transaction {
  /** Season the move belongs to; offseason moves carry the season just finished. */
  year: number;
  /** Days from that season's Opening Day (offseason moves run past the regular season). */
  day: number;
  teamId: number;
  playerId: number;
  type: TransactionType;
  text: string;
}

export interface League {
  seed: string;
  year: number;
  structure: LeagueStructure;
  teams: Team[];
  /** Indexed by player id. */
  players: Player[];
  /** Roster moves and injuries, newest last. */
  transactions: Transaction[];
  /** The club the human manages (null = all clubs run by the AI). */
  userTeamId: number | null;
  /** One record per completed season. */
  history: SeasonHistory[];
  /** Unsigned players available to any club. */
  freeAgents: number[];
  /** Winter state between the postseason and the next Opening Day. */
  offseason: OffseasonState | null;
  /** Front-office departments: how well each club sees players. */
  scouting: ScoutingState;
  /** The user's job: the owner's goals and confidence (null when no club is the user's). */
  gm: GmState | null;
  /** Trade proposals AI clubs have made to the user (recent ones, whatever became of them). */
  tradeOffers: TradeOffer[];
  /** Difficulty, stat detail and staff advice. */
  settings: GameSettings;
  /** Notes from the user's staff, newest last. */
  advice: AdviceNote[];
}

/** A note from someone on the user's staff. */
export interface AdviceNote {
  /** What it's about, so the same advice isn't repeated (e.g. "sell:2027"). */
  key: string;
  year: number;
  /** When it came, on the offer clock (season days; winter days from 1000). */
  at: number;
  from: "assistant" | "scouting" | "analytics" | "business";
  /** Urgent notes can stop the sim. */
  urgent: boolean;
  title: string;
  text: string;
  /** Where to act (a route hash). */
  href?: string;
  read: boolean;
}

/** An AI club's proposal to the user. */
export interface TradeOffer {
  id: number;
  teamId: number;
  /** The user's players they want. */
  give: number[];
  /** Their players for the user. */
  get: number[];
  /** They're buying one of the user's players, or selling one of theirs. */
  kind: "buy" | "sell";
  /** The club's pitch, in a sentence or two. */
  pitch: string;
  year: number;
  /** When it was made and the last moment it stands, on the offer clock (season days; winter days run from 1000). */
  made: number;
  expires: number;
  status: "open" | "accepted" | "declined" | "expired";
}

export interface Award {
  name: "MVP" | "Cy Young" | "Rookie of the Year";
  league: number;
  playerId: number;
  teamId: number;
  note: string;
}

export interface SeasonHistory {
  year: number;
  champion: number;
  pennants: number[];
  standings: { teamId: number; w: number; l: number; rs: number; ra: number; finish: string }[];
  awards: Award[];
  userTeamId: number | null;
}

export const teamName = (t: Team): string => `${t.city} ${t.nickname}`;
export const affiliateName = (t: Team, level: Level): string =>
  level === "MLB" ? teamName(t) : t.affiliates[level].name;
