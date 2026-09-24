import type { FieldPosition, Player } from "../players/types";

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
  /** 26-man active roster (player ids). */
  active: number[];
  /** Farm system / organizational depth not on the active roster. */
  reserves: number[];
  depth: DepthChart;
}

export interface LeagueStructure {
  leagues: string[];
  divisions: string[];
}

export interface League {
  seed: string;
  year: number;
  structure: LeagueStructure;
  teams: Team[];
  /** Indexed by player id. */
  players: Player[];
}

export const teamName = (t: Team): string => `${t.city} ${t.nickname}`;
