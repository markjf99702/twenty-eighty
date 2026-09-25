import type { League } from "./types";

/**
 * How the game plays. Difficulty turns the dials that make the GM's job easy
 * or hard (how clearly the user's scouts see, how shrewd the other clubs are,
 * how much money there is, how patient the owner is); the stat view is how
 * much sabermetric detail the pages show; advice turns the staff's notes on.
 */
export type Difficulty = "easy" | "normal" | "hard";
export type StatView = "basics" | "full";

export interface GameSettings {
  difficulty: Difficulty;
  statView: StatView;
  /** The front office's staff sends notes and suggestions. */
  advice: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = { difficulty: "normal", statView: "full", advice: true };

export interface DifficultyDials {
  label: string;
  /** Multiplies the user's scouts' error (lower = reports closer to the truth). */
  userScoutError: number;
  /** Multiplies the other clubs' scouts' error. */
  rivalScoutError: number;
  /** The edge an AI club wants over fair value before it says yes. */
  tradeMargin: number;
  /** Multiplies the owner's budget for the user's club. */
  budget: number;
  /** Multiplies how forgiving the owner is of a disappointing season. */
  ownerPatience: number;
  /** Seasons the user can't be fired in, however badly they go. */
  graceSeasons: number;
  /** Added to the owner's win targets. */
  winGoal: number;
  startConfidence: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDials> = {
  easy: {
    label: "Easy",
    userScoutError: 0.35,
    rivalScoutError: 1,
    tradeMargin: 0.02,
    budget: 1.15,
    ownerPatience: 2,
    graceSeasons: 3,
    winGoal: -2,
    startConfidence: 70,
  },
  normal: {
    label: "Normal",
    userScoutError: 1,
    rivalScoutError: 1,
    tradeMargin: 0.1,
    budget: 1,
    ownerPatience: 1,
    graceSeasons: 0,
    winGoal: 0,
    startConfidence: 60,
  },
  hard: {
    label: "Hard",
    userScoutError: 1.3,
    rivalScoutError: 0.8,
    tradeMargin: 0.2,
    budget: 0.9,
    ownerPatience: 0.75,
    graceSeasons: 0,
    winGoal: 2,
    startConfidence: 55,
  },
};

export const settingsOf = (league: League): GameSettings => league.settings ?? DEFAULT_SETTINGS;
export const dials = (league: League): DifficultyDials => DIFFICULTY[settingsOf(league).difficulty];
