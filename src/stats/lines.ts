/**
 * Counting-stat lines. Every field is a plain number so lines can be summed
 * generically (game -> season -> career). Some fields are fractional on
 * purpose: shadow-region pitches count half in the zone and half out, and
 * the x* fields accumulate expected outcomes per batted ball.
 */

export interface BattingLine {
  G: number;
  PA: number;
  AB: number;
  H: number;
  "1B": number;
  "2B": number;
  "3B": number;
  HR: number;
  R: number;
  RBI: number;
  BB: number;
  IBB: number;
  HBP: number;
  SO: number;
  SF: number;
  GIDP: number;
  ROE: number;
  SB: number;
  CS: number;
  // Plate discipline
  pitches: number;
  zonePitches: number;
  zoneSwings: number;
  zoneContact: number;
  outPitches: number;
  outSwings: number;
  outContact: number;
  // Batted balls (Statcast-style)
  BBE: number;
  GB: number;
  LD: number;
  FB: number;
  PU: number;
  evSum: number;
  laSum: number;
  hardHit: number;
  barrels: number;
  sweetSpot: number;
  x1B: number;
  x2B: number;
  x3B: number;
  xHR: number;
}

export interface PitchingLine {
  G: number;
  GS: number;
  W: number;
  L: number;
  SV: number;
  HLD: number;
  BS: number;
  outs: number;
  BF: number;
  H: number;
  "2B": number;
  "3B": number;
  HR: number;
  R: number;
  ER: number;
  BB: number;
  IBB: number;
  HBP: number;
  SO: number;
  WP: number;
  SB: number;
  CS: number;
  pitches: number;
  strikes: number;
  swings: number;
  whiffs: number;
  calledStrikes: number;
  zonePitches: number;
  outPitches: number;
  outSwings: number;
  BBE: number;
  GB: number;
  LD: number;
  FB: number;
  PU: number;
  evSum: number;
  hardHit: number;
  barrels: number;
  x1B: number;
  x2B: number;
  x3B: number;
  xHR: number;
}

/** Defensive ledger. Expected vs. actual hits on balls a fielder was responsible for. */
export interface FieldingLine {
  /** Defensive outs (innings x 3) at each position, plus DH games. */
  outsC: number;
  outs1B: number;
  outs2B: number;
  outs3B: number;
  outsSS: number;
  outsLF: number;
  outsCF: number;
  outsRF: number;
  gamesDH: number;
  chances: number;
  errors: number;
  exp1B: number;
  exp2B: number;
  exp3B: number;
  act1B: number;
  act2B: number;
  act3B: number;
  /** Catchers: called strikes on shadow takes, actual vs. expected for an average receiver. */
  framingActual: number;
  framingExpected: number;
  /** Catchers: steals allowed, actual vs. expected with an average arm. */
  sbAllowed: number;
  sbExpected: number;
  sbAttempts: number;
}

type NumericRecord = { [k: string]: number };

function zeroed<T extends NumericRecord>(keys: readonly (keyof T)[]): () => T {
  return () => {
    const o = {} as NumericRecord;
    for (const k of keys) o[k as string] = 0;
    return o as T;
  };
}

const BATTING_KEYS: (keyof BattingLine)[] = [
  "G", "PA", "AB", "H", "1B", "2B", "3B", "HR", "R", "RBI", "BB", "IBB", "HBP", "SO", "SF", "GIDP", "ROE", "SB", "CS",
  "pitches", "zonePitches", "zoneSwings", "zoneContact", "outPitches", "outSwings", "outContact",
  "BBE", "GB", "LD", "FB", "PU", "evSum", "laSum", "hardHit", "barrels", "sweetSpot", "x1B", "x2B", "x3B", "xHR",
];
const PITCHING_KEYS: (keyof PitchingLine)[] = [
  "G", "GS", "W", "L", "SV", "HLD", "BS", "outs", "BF", "H", "2B", "3B", "HR", "R", "ER", "BB", "IBB", "HBP", "SO",
  "WP", "SB", "CS", "pitches", "strikes", "swings", "whiffs", "calledStrikes", "zonePitches", "outPitches", "outSwings",
  "BBE", "GB", "LD", "FB", "PU", "evSum", "hardHit", "barrels", "x1B", "x2B", "x3B", "xHR",
];
const FIELDING_KEYS: (keyof FieldingLine)[] = [
  "outsC", "outs1B", "outs2B", "outs3B", "outsSS", "outsLF", "outsCF", "outsRF", "gamesDH", "chances", "errors",
  "exp1B", "exp2B", "exp3B", "act1B", "act2B", "act3B", "framingActual", "framingExpected", "sbAllowed", "sbExpected",
  "sbAttempts",
];

export const emptyBatting = zeroed<BattingLine & NumericRecord>(BATTING_KEYS) as () => BattingLine;
export const emptyPitching = zeroed<PitchingLine & NumericRecord>(PITCHING_KEYS) as () => PitchingLine;
export const emptyFielding = zeroed<FieldingLine & NumericRecord>(FIELDING_KEYS) as () => FieldingLine;

/** target += source, field by field. */
export function addLine<T extends object>(target: T, source: T): T {
  const t = target as unknown as NumericRecord;
  const s = source as unknown as NumericRecord;
  for (const k in s) t[k] = (t[k] ?? 0) + s[k]!;
  return target;
}

export function sumLines<T extends object>(lines: Iterable<T>, empty: () => T): T {
  const total = empty();
  for (const l of lines) addLine(total, l);
  return total;
}

/** Keyed collection of lines that creates entries on first touch. */
export class LineBook<T extends object> {
  readonly lines = new Map<number, T>();
  constructor(private readonly empty: () => T) {}

  get(id: number): T {
    let l = this.lines.get(id);
    if (!l) {
      l = this.empty();
      this.lines.set(id, l);
    }
    return l;
  }

  merge(other: LineBook<T>): void {
    for (const [id, line] of other.lines) addLine(this.get(id), line);
  }

  total(): T {
    return sumLines(this.lines.values(), this.empty);
  }
}

export const inningsPitched = (outs: number): number => Math.floor(outs / 3) + (outs % 3) / 10;
export const ipDecimal = (outs: number): number => outs / 3;
