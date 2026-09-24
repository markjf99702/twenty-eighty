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

// Literal factories keep every line on one hidden class, which matters when
// a season creates hundreds of thousands of them.
export const emptyBatting = (): BattingLine => ({
  G: 0, PA: 0, AB: 0, H: 0, "1B": 0, "2B": 0, "3B": 0, HR: 0, R: 0, RBI: 0, BB: 0, IBB: 0, HBP: 0, SO: 0,
  SF: 0, GIDP: 0, ROE: 0, SB: 0, CS: 0, pitches: 0, zonePitches: 0, zoneSwings: 0, zoneContact: 0,
  outPitches: 0, outSwings: 0, outContact: 0, BBE: 0, GB: 0, LD: 0, FB: 0, PU: 0, evSum: 0, laSum: 0,
  hardHit: 0, barrels: 0, sweetSpot: 0, x1B: 0, x2B: 0, x3B: 0, xHR: 0,
});
export const emptyPitching = (): PitchingLine => ({
  G: 0, GS: 0, W: 0, L: 0, SV: 0, HLD: 0, BS: 0, outs: 0, BF: 0, H: 0, "2B": 0, "3B": 0, HR: 0, R: 0,
  ER: 0, BB: 0, IBB: 0, HBP: 0, SO: 0, WP: 0, SB: 0, CS: 0, pitches: 0, strikes: 0, swings: 0, whiffs: 0,
  calledStrikes: 0, zonePitches: 0, outPitches: 0, outSwings: 0, BBE: 0, GB: 0, LD: 0, FB: 0, PU: 0,
  evSum: 0, hardHit: 0, barrels: 0, x1B: 0, x2B: 0, x3B: 0, xHR: 0,
});
export const emptyFielding = (): FieldingLine => ({
  outsC: 0, outs1B: 0, outs2B: 0, outs3B: 0, outsSS: 0, outsLF: 0, outsCF: 0, outsRF: 0, gamesDH: 0,
  chances: 0, errors: 0, exp1B: 0, exp2B: 0, exp3B: 0, act1B: 0, act2B: 0, act3B: 0, framingActual: 0,
  framingExpected: 0, sbAllowed: 0, sbExpected: 0, sbAttempts: 0,
});

// Explicit adders (plain property access) are several times faster than a
// loop over key names in the season's hottest path.
export function addBatting(t: BattingLine, s: BattingLine): BattingLine {
  t.G += s.G;
  t.PA += s.PA;
  t.AB += s.AB;
  t.H += s.H;
  t["1B"] += s["1B"];
  t["2B"] += s["2B"];
  t["3B"] += s["3B"];
  t.HR += s.HR;
  t.R += s.R;
  t.RBI += s.RBI;
  t.BB += s.BB;
  t.IBB += s.IBB;
  t.HBP += s.HBP;
  t.SO += s.SO;
  t.SF += s.SF;
  t.GIDP += s.GIDP;
  t.ROE += s.ROE;
  t.SB += s.SB;
  t.CS += s.CS;
  t.pitches += s.pitches;
  t.zonePitches += s.zonePitches;
  t.zoneSwings += s.zoneSwings;
  t.zoneContact += s.zoneContact;
  t.outPitches += s.outPitches;
  t.outSwings += s.outSwings;
  t.outContact += s.outContact;
  t.BBE += s.BBE;
  t.GB += s.GB;
  t.LD += s.LD;
  t.FB += s.FB;
  t.PU += s.PU;
  t.evSum += s.evSum;
  t.laSum += s.laSum;
  t.hardHit += s.hardHit;
  t.barrels += s.barrels;
  t.sweetSpot += s.sweetSpot;
  t.x1B += s.x1B;
  t.x2B += s.x2B;
  t.x3B += s.x3B;
  t.xHR += s.xHR;
  return t;
}

export function addPitching(t: PitchingLine, s: PitchingLine): PitchingLine {
  t.G += s.G;
  t.GS += s.GS;
  t.W += s.W;
  t.L += s.L;
  t.SV += s.SV;
  t.HLD += s.HLD;
  t.BS += s.BS;
  t.outs += s.outs;
  t.BF += s.BF;
  t.H += s.H;
  t["2B"] += s["2B"];
  t["3B"] += s["3B"];
  t.HR += s.HR;
  t.R += s.R;
  t.ER += s.ER;
  t.BB += s.BB;
  t.IBB += s.IBB;
  t.HBP += s.HBP;
  t.SO += s.SO;
  t.WP += s.WP;
  t.SB += s.SB;
  t.CS += s.CS;
  t.pitches += s.pitches;
  t.strikes += s.strikes;
  t.swings += s.swings;
  t.whiffs += s.whiffs;
  t.calledStrikes += s.calledStrikes;
  t.zonePitches += s.zonePitches;
  t.outPitches += s.outPitches;
  t.outSwings += s.outSwings;
  t.BBE += s.BBE;
  t.GB += s.GB;
  t.LD += s.LD;
  t.FB += s.FB;
  t.PU += s.PU;
  t.evSum += s.evSum;
  t.hardHit += s.hardHit;
  t.barrels += s.barrels;
  t.x1B += s.x1B;
  t.x2B += s.x2B;
  t.x3B += s.x3B;
  t.xHR += s.xHR;
  return t;
}

export function addFielding(t: FieldingLine, s: FieldingLine): FieldingLine {
  t.outsC += s.outsC;
  t.outs1B += s.outs1B;
  t.outs2B += s.outs2B;
  t.outs3B += s.outs3B;
  t.outsSS += s.outsSS;
  t.outsLF += s.outsLF;
  t.outsCF += s.outsCF;
  t.outsRF += s.outsRF;
  t.gamesDH += s.gamesDH;
  t.chances += s.chances;
  t.errors += s.errors;
  t.exp1B += s.exp1B;
  t.exp2B += s.exp2B;
  t.exp3B += s.exp3B;
  t.act1B += s.act1B;
  t.act2B += s.act2B;
  t.act3B += s.act3B;
  t.framingActual += s.framingActual;
  t.framingExpected += s.framingExpected;
  t.sbAllowed += s.sbAllowed;
  t.sbExpected += s.sbExpected;
  t.sbAttempts += s.sbAttempts;
  return t;
}

/** target += source, field by field (generic; prefer the typed adders in hot paths). */
export function addLine<T extends object>(target: T, source: T): T {
  const t = target as unknown as NumericRecord;
  const s = source as unknown as NumericRecord;
  for (const k in s) t[k] = (t[k] ?? 0) + s[k]!;
  return target;
}

export function sumLines<T extends object>(lines: Iterable<T>, empty: () => T, add: (t: T, s: T) => T = addLine): T {
  const total = empty();
  for (const l of lines) add(total, l);
  return total;
}

/**
 * Keyed collection of lines that creates entries on first touch. With
 * `running: true` it also keeps a league total as other books are merged in
 * (season books), so totals are free to read.
 */
export class LineBook<T extends object> {
  readonly lines = new Map<number, T>();
  private sum: T | null;

  private readonly add: (target: T, source: T) => T;

  constructor(
    private readonly empty: () => T,
    opts: { running?: boolean; add?: (target: T, source: T) => T } = {},
  ) {
    this.sum = opts.running ? empty() : null;
    this.add = opts.add ?? addLine;
  }

  get(id: number): T {
    let l = this.lines.get(id);
    if (!l) {
      l = this.empty();
      this.lines.set(id, l);
    }
    return l;
  }

  merge(other: LineBook<T>): void {
    for (const [id, line] of other.lines) {
      this.add(this.get(id), line);
      if (this.sum) this.add(this.sum, line);
    }
  }

  total(): T {
    if (this.sum) return this.add(this.empty(), this.sum);
    return sumLines(this.lines.values(), this.empty, this.add);
  }

  toJSON(): [number, T][] {
    return [...this.lines];
  }

  load(entries: [number, T][]): void {
    this.lines.clear();
    for (const [id, line] of entries) this.lines.set(id, this.add(this.empty(), line));
    if (this.sum) this.sum = sumLines(this.lines.values(), this.empty, this.add);
  }
}

export const inningsPitched = (outs: number): number => Math.floor(outs / 3) + (outs % 3) / 10;
export const ipDecimal = (outs: number): number => outs / 3;
