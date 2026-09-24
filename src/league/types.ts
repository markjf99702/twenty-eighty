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
  /** Metro population in millions; drives revenue once finances exist. */
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
  | "injury";

export interface Transaction {
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
}

export const teamName = (t: Team): string => `${t.city} ${t.nickname}`;
export const affiliateName = (t: Team, level: Level): string =>
  level === "MLB" ? teamName(t) : t.affiliates[level].name;
