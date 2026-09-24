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

/** Where a player is assigned within an organization. */
export const LEVELS = ["MLB", "AAA", "AA", "A+", "A"] as const;
export type Level = (typeof LEVELS)[number];
export const MINOR_LEVELS = ["AAA", "AA", "A+", "A"] as const;
export type MinorLevel = (typeof MINOR_LEVELS)[number];

/** MLB injured list: 10-day for position players, 15-day for pitchers, 60-day for long stints. */
export type IlType = "IL10" | "IL15" | "IL60";

export interface Injury {
  name: string;
  /** Total expected days out, and days remaining. */
  days: number;
  daysLeft: number;
  startDay: number;
}

/** One MLB service year is 172 days on the active roster or injured list. */
export const SERVICE_DAYS_PER_YEAR = 172;
export const MAX_OPTION_YEARS = 3;

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
  /** Hidden injury proneness (z; positive = more fragile). */
  durability: number;

  // --- Organizational status -------------------------------------------------
  /** Organization (team id), or null for a free agent. */
  teamId: number | null;
  /** Assigned level; MLB players on the injured list keep "MLB". */
  level: Level;
  onFortyMan: boolean;
  /** MLB injured-list placement, if any, and the day it began. */
  il: IlType | null;
  ilDay: number | null;
  /** Current injury (day-to-day or longer), if any. */
  injury: Injury | null;
  /** Option years used (max 3) and whether this season already burned one. */
  options: { used: number; usedThisYear: boolean };
  /** MLB service time in days. */
  service: number;
  /** Day he was last optioned to the minors (enforces the minimum stay). */
  optionedDay: number | null;
}

export const playerName = (p: Player): string => `${p.firstName} ${p.lastName}`;
export const isPitcher = (p: Player): boolean => p.position === "P";
