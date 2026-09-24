import type { Player } from "../players/types";

/**
 * The winter between one season and the next, as a sequence of phases the
 * GM steps through. Everything here is plain JSON so it saves with the league.
 */
export const OFFSEASON_PHASES = ["review", "tenders", "draft", "freeAgency", "international", "spring"] as const;
export type OffseasonPhase = (typeof OFFSEASON_PHASES)[number];

export interface DevelopmentChange {
  playerId: number;
  teamId: number | null;
  age: number;
  /** Overall grade (Now) before and after the winter. */
  before: number;
  after: number;
}

export interface Retirement {
  playerId: number;
  teamId: number | null;
  age: number;
}

/** An arbitration-eligible player awaiting a tender decision. */
export interface Tender {
  playerId: number;
  teamId: number;
  /** Projected arbitration salary, $M. */
  salary: number;
  /** Whether the club offers him a contract; the user's club decides its own. */
  tender: boolean;
}

export interface DraftPick {
  round: number;
  pick: number;
  teamId: number;
  playerId: number;
  /** Signing bonus, $M (slot value for the pick). */
  bonus?: number;
}

export interface DraftState {
  /** Team ids in first-round order (worst record first); every round repeats it. */
  order: number[];
  rounds: number;
  /** Prospects not yet taken (not in league.players until they sign; negative ids). */
  pool: Player[];
  picks: DraftPick[];
}

export interface FreeAgentAsk {
  playerId: number;
  years: number;
  /** Annual salary, $M. */
  salary: number;
}

export interface FreeAgencyState {
  week: number;
  weeks: number;
  asks: FreeAgentAsk[];
  /** The user's standing offers, resolved at the end of each week. */
  offers: FreeAgentAsk[];
  signings: { playerId: number; teamId: number; years: number; salary: number; week: number }[];
}

export interface InternationalState {
  /** Unsigned amateurs (negative ids until they sign). */
  pool: Player[];
  /** Asking bonus by pool index key (player id), $M. */
  asks: { playerId: number; bonus: number }[];
  /** Each club's remaining bonus pool, $M, indexed by team id. */
  pools: number[];
  signings: { playerId: number; teamId: number; bonus: number }[];
}

export interface OffseasonState {
  /** The season just completed. */
  year: number;
  phase: OffseasonPhase;
  development: { risers: DevelopmentChange[]; fallers: DevelopmentChange[]; retirements: Retirement[] };
  /** How far the grade scale was re-centered after development (should hover near zero). */
  shift: Record<string, number>;
  tenders: Tender[];
  /** Veterans whose contracts ran out; they become free agents at the tender deadline. */
  expiring: number[];
  draft: DraftState | null;
  freeAgency: FreeAgencyState | null;
  international: InternationalState | null;
}
