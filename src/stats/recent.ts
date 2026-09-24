import type { BattingLine, PitchingLine } from "./lines";

/**
 * A rolling log of each player's most recent game lines at one level, kept
 * as compact rows so "last 15 games" views don't need full box scores.
 */

export const RECENT_GAMES = 15;

/** Row layouts: the day of the game, then counting stats. */
export const BAT_ROW = { day: 0, PA: 1, AB: 2, H: 3, D: 4, T: 5, HR: 6, BB: 7, HBP: 8, SO: 9, SF: 10, SB: 11, R: 12, RBI: 13 } as const;
export const PIT_ROW = { day: 0, outs: 1, BF: 2, H: 3, HR: 4, BB: 5, HBP: 6, SO: 7, ER: 8, R: 9, GS: 10, W: 11, L: 12, SV: 13 } as const;

export const batRow = (day: number, b: BattingLine): number[] => [
  day,
  b.PA,
  b.AB,
  b.H,
  b["2B"],
  b["3B"],
  b.HR,
  b.BB,
  b.HBP,
  b.SO,
  b.SF,
  b.SB,
  b.R,
  b.RBI,
];

export const pitRow = (day: number, x: PitchingLine): number[] => [
  day,
  x.outs,
  x.BF,
  x.H,
  x.HR,
  x.BB,
  x.HBP,
  x.SO,
  x.ER,
  x.R,
  x.GS,
  x.W,
  x.L,
  x.SV,
];

export class RecentLog {
  readonly rows = new Map<number, number[][]>();

  push(id: number, row: number[]): void {
    let list = this.rows.get(id);
    if (!list) {
      list = [];
      this.rows.set(id, list);
    }
    list.push(row);
    if (list.length > RECENT_GAMES) list.shift();
  }

  /** His game rows on or after `day`. */
  since(id: number, day: number): number[][] {
    return (this.rows.get(id) ?? []).filter((r) => r[0]! >= day);
  }

  toJSON(): [number, number[][]][] {
    return [...this.rows];
  }

  load(entries: [number, number[][]][]): void {
    this.rows.clear();
    for (const [id, rows] of entries) this.rows.set(id, rows);
  }
}

/** Column-wise totals of a set of rows (the day column is meaningless and left as 0). */
export function sumRows(rows: number[][], width: number): number[] {
  const out = new Array<number>(width).fill(0);
  for (const r of rows) for (let i = 1; i < width; i++) out[i]! += r[i] ?? 0;
  return out;
}
