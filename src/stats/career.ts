import type { Player } from "../players/types";
import type { BattingLine, PitchingLine } from "./lines";

/**
 * A player's big-league career in one line: his generated prior career, every
 * season on his record, and (while a season is being played) this season so
 * far. The record book, milestones and the Hall of Fame all count from here.
 */

export interface CareerBat {
  G: number;
  PA: number;
  AB: number;
  H: number;
  D: number;
  T: number;
  HR: number;
  RBI: number;
  BB: number;
  SB: number;
  WAR: number;
}

export interface CareerPit {
  G: number;
  GS: number;
  W: number;
  L: number;
  SV: number;
  outs: number;
  ER: number;
  SO: number;
  BB: number;
  WAR: number;
}

export interface CareerTotals {
  /** Big-league seasons (a partial one counts). */
  seasons: number;
  first: number | null;
  last: number | null;
  bat: CareerBat | null;
  pit: CareerPit | null;
}

/** This season so far, for a season not yet on his record (WAR from the season's stats, if known). */
export interface LiveLines {
  year: number;
  bat?: BattingLine;
  pit?: PitchingLine;
  batWar?: number;
  pitWar?: number;
}

export const emptyBat = (): CareerBat => ({ G: 0, PA: 0, AB: 0, H: 0, D: 0, T: 0, HR: 0, RBI: 0, BB: 0, SB: 0, WAR: 0 });
export const emptyPit = (): CareerPit => ({ G: 0, GS: 0, W: 0, L: 0, SV: 0, outs: 0, ER: 0, SO: 0, BB: 0, WAR: 0 });

export function addBat(t: CareerBat, b: CareerBat): void {
  t.G += b.G;
  t.PA += b.PA;
  t.AB += b.AB;
  t.H += b.H;
  t.D += b.D;
  t.T += b.T;
  t.HR += b.HR;
  t.RBI += b.RBI;
  t.BB += b.BB;
  t.SB += b.SB;
  t.WAR = Math.round((t.WAR + b.WAR) * 10) / 10;
}

export function addPit(t: CareerPit, q: CareerPit): void {
  t.G += q.G;
  t.GS += q.GS;
  t.W += q.W;
  t.L += q.L;
  t.SV += q.SV;
  t.outs += q.outs;
  t.ER += q.ER;
  t.SO += q.SO;
  t.BB += q.BB;
  t.WAR = Math.round((t.WAR + q.WAR) * 10) / 10;
}

export const batFromLine = (b: BattingLine, war = 0): CareerBat => ({
  G: b.G,
  PA: b.PA,
  AB: b.AB,
  H: b.H,
  D: b["2B"],
  T: b["3B"],
  HR: b.HR,
  RBI: b.RBI,
  BB: b.BB,
  SB: b.SB,
  WAR: war,
});

export const pitFromLine = (q: PitchingLine, war = 0): CareerPit => ({
  G: q.G,
  GS: q.GS,
  W: q.W,
  L: q.L,
  SV: q.SV,
  outs: q.outs,
  ER: q.ER,
  SO: q.SO,
  BB: q.BB,
  WAR: war,
});

/** His big-league career, optionally only his seasons with one club (prior careers have no club, so they're left out). */
export function careerTotals(p: Player, live?: LiveLines, teamId?: number): CareerTotals {
  let bat: CareerBat | null = null;
  let pit: CareerPit | null = null;
  let seasons = 0;
  let first: number | null = null;
  let last: number | null = null;
  const span = (from: number, to: number) => {
    first = first === null ? from : Math.min(first, from);
    last = last === null ? to : Math.max(last, to);
  };
  if (teamId === undefined && p.prior) {
    seasons += p.prior.seasons;
    span(p.prior.from, p.prior.from + p.prior.seasons - 1);
    if (p.prior.bat) addBat((bat ??= emptyBat()), p.prior.bat);
    if (p.prior.pit) addPit((pit ??= emptyPit()), p.prior.pit);
  }
  const years = new Set<number>();
  for (const c of p.career) {
    if (c.level !== "MLB" || (teamId !== undefined && c.teamId !== teamId)) continue;
    years.add(c.year);
    span(c.year, c.year);
    if (c.bat) addBat((bat ??= emptyBat()), { G: c.bat.G, PA: c.bat.PA, AB: c.bat.AB, H: c.bat.H, D: c.bat.D, T: c.bat.T, HR: c.bat.HR, RBI: c.bat.RBI, BB: c.bat.BB, SB: c.bat.SB, WAR: c.bat.WAR });
    if (c.pit) addPit((pit ??= emptyPit()), { G: c.pit.G, GS: c.pit.GS, W: c.pit.W, L: c.pit.L, SV: c.pit.SV, outs: c.pit.outs, ER: c.pit.ER, SO: c.pit.SO, BB: c.pit.BB, WAR: c.pit.WAR });
  }
  if (live && !years.has(live.year) && (live.bat || live.pit) && (teamId === undefined || p.teamId === teamId)) {
    years.add(live.year);
    span(live.year, live.year);
    if (live.bat && live.bat.PA > 0) addBat((bat ??= emptyBat()), batFromLine(live.bat, live.batWar ?? 0));
    if (live.pit && live.pit.BF > 0) addPit((pit ??= emptyPit()), pitFromLine(live.pit, live.pitWar ?? 0));
  }
  seasons += years.size;
  return { seasons, first, last, bat, pit };
}

export const avgOf = (b: CareerBat) => (b.AB > 0 ? b.H / b.AB : 0);
export const eraOf = (q: CareerPit) => (q.outs > 0 ? (q.ER * 27) / q.outs : 0);
/** Innings as baseball writes them: 212.1 is 212 and a third. */
export const ipText = (outs: number) => `${Math.floor(outs / 3)}${outs % 3 ? `.${outs % 3}` : ""}`;
