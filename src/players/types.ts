export type Hand = "L" | "R";
export type BatSide = "L" | "R" | "S";

export const FIELD_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
export type FieldPosition = (typeof FIELD_POSITIONS)[number];
export type LineupPosition = FieldPosition | "DH";

/**
 * A single tool on the 20-80 scale. `present` is what the player is today;
 * `future` is the scout's projection of his peak. These are the player's TRUE
 * (hidden) grades - scouting reports shown to the GM will add noise later.
 */
export interface ToolGrade {
  present: number;
  future: number;
}

export interface HitterTools {
  /** Hit: bat-to-ball skill. Drives whiff rate and how often contact is squared up. */
  hit: ToolGrade;
  /** Raw power: exit velocity when the ball is squared up. */
  power: ToolGrade;
  /** Plate discipline / approach: chase rate and pitch selection. */
  eye: ToolGrade;
  /** Run: sprint speed (infield hits, extra bases, steals, range in the OF). */
  speed: ToolGrade;
  /** Glove: range and hands. For catchers this is receiving/framing and blocking. */
  field: ToolGrade;
  /** Arm strength and accuracy. */
  arm: ToolGrade;
}

/** Batted-ball tendencies. Not graded tools, just z-scores describing a swing. */
export interface HitterTraits {
  /** Swing path: negative = ground-ball hitter, positive = fly-ball / lift. */
  launch: number;
  /** Negative = uses the whole field, positive = pull-heavy. */
  pull: number;
  /** Willingness to run on the bases (steal attempts, taking extra bases). */
  aggression: number;
}

export const PITCH_TYPES = ["FF", "SI", "FC", "SL", "ST", "CU", "CH", "FS"] as const;
export type PitchType = (typeof PITCH_TYPES)[number];

export const PITCH_NAMES: Record<PitchType, string> = {
  FF: "Four-seam fastball",
  SI: "Sinker",
  FC: "Cutter",
  SL: "Slider",
  ST: "Sweeper",
  CU: "Curveball",
  CH: "Changeup",
  FS: "Splitter",
};

export interface Pitch {
  type: PitchType;
  grade: ToolGrade;
  /** Relative usage weight in a neutral count. */
  usage: number;
}

export interface PitcherTools {
  pitches: Pitch[];
  /** Control: ability to throw strikes (walk avoidance). */
  control: ToolGrade;
  /** Command: ability to hit spots within the zone (mistake avoidance). */
  command: ToolGrade;
  /** Stamina: how deep he can work before fatigue sets in. */
  stamina: ToolGrade;
  /** Typical fastball velocity (display only; the grade already encodes it). */
  velocity: number;
}

export type PitcherRole = "SP" | "RP";

export interface Player {
  id: number;
  firstName: string;
  lastName: string;
  age: number;
  bats: BatSide;
  throws: Hand;
  /** Primary position; pitchers are "P". */
  position: FieldPosition | "DH" | "P";
  /** Positions he can play without an out-of-position penalty. */
  positions: FieldPosition[];
  hitting: HitterTools;
  traits: HitterTraits;
  pitching?: PitcherTools;
  role?: PitcherRole;
}

export const playerName = (p: Player): string => `${p.firstName} ${p.lastName}`;
export const isPitcher = (p: Player): boolean => p.position === "P";
