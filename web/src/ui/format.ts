/** Number formatting and small lookups shared by the pages. */
import type { Level } from "../../../src/players/types";

export const LEVEL_NAMES: Record<Level, string> = {
  MLB: "Majors",
  AAA: "Triple-A",
  AA: "Double-A",
  "A+": "High-A",
  A: "Single-A",
};

export const LEVEL_SLUGS: Record<Level, string> = { MLB: "mlb", AAA: "aaa", AA: "aa", "A+": "higha", A: "a" };

export function levelFromSlug(slug: string | undefined): Level {
  const hit = (Object.entries(LEVEL_SLUGS) as [Level, string][]).find(([, s]) => s === slug);
  return hit ? hit[0] : "MLB";
}

/** ".312" style rate. */
export const rate3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3).replace(/^(-?)0\./, "$1.") : "---");
export const fixed = (x: number, d = 1) => (Number.isFinite(x) ? (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d) : "--");
export const pct = (x: number, d = 1) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)}` : "--");
export const signed = (x: number, d = 0) => (x > 0 ? `+${x.toFixed(d)}` : x.toFixed(d));
export const whole = (x: number) => (Number.isFinite(x) ? String(Math.round(x)) : "--");

export function gamesBack(gb: number): string {
  if (gb === 0) return "–";
  return Number.isInteger(gb) ? String(gb) : gb.toFixed(1);
}

export function streak(s: number): string {
  if (s === 0) return "–";
  return s > 0 ? `W${s}` : `L${-s}`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

/** Innings pitched from a decimal (e.g. 6.333 -> "6.1"). */
export function ip(x: number): string {
  const whole = Math.floor(x + 1e-9);
  const outs = Math.round((x - whole) * 3);
  return outs === 3 ? `${whole + 1}.0` : `${whole}.${outs}`;
}

/** Scouts report in 5-point steps. */
export const scout = (g: number) => Math.min(80, Math.max(20, Math.round(g / 5) * 5));

/** Color band class for a grade. */
export function band(g: number): string {
  const s = scout(g);
  if (s <= 25) return "g20";
  if (s <= 35) return "g30";
  if (s === 40) return "g40";
  if (s === 45) return "g45";
  if (s === 50) return "g50";
  if (s === 55) return "g55";
  if (s <= 65) return "g60";
  if (s <= 75) return "g70";
  return "g80";
}

const LABELS: [number, string][] = [
  [80, "Elite"],
  [70, "Plus-plus"],
  [60, "Plus"],
  [55, "Above average"],
  [50, "Average"],
  [45, "Below average"],
  [40, "Fringe"],
  [30, "Well below"],
  [20, "Poor"],
];

export function gradeWord(g: number): string {
  const s = scout(g);
  for (const [floor, label] of LABELS) if (s >= floor) return label;
  return "Poor";
}


/** One-line explanations for stat column headers (hover a header to see one). */
export const GLOSSARY: Record<string, string> = {
  G: "Games",
  GS: "Games started",
  PA: "Plate appearances",
  IP: "Innings pitched (.1 and .2 are thirds of an inning)",
  AVG: "Batting average: hits per at-bat",
  OBP: "On-base percentage: how often he reaches base",
  SLG: "Slugging percentage: total bases per at-bat",
  HR: "Home runs",
  R: "Runs scored",
  RBI: "Runs batted in",
  SB: "Stolen bases",
  SO: "Strikeouts",
  "W-L": "Wins and losses",
  W: "Wins",
  L: "Losses",
  SV: "Saves",
  ERA: "Earned run average: earned runs allowed per nine innings",
  WHIP: "Walks plus hits per inning pitched",
  "BB%": "Walks per plate appearance",
  "K%": "Strikeouts per plate appearance",
  "K-BB%": "Strikeout rate minus walk rate: a quick read on a pitcher's dominance",
  ISO: "Isolated power: slugging minus batting average",
  BABIP: "Batting average on balls in play (luck and contact quality)",
  wOBA: "Weighted on-base average: every way of reaching base, weighted by the runs it's worth",
  xwOBA: "Expected wOBA from exit velocity and launch angle: what his contact deserved",
  "wRC+": "Runs created, park-adjusted: 100 is league average, 120 is 20% better",
  WAR: "Wins above replacement: wins he's worth over a freely available fill-in",
  FIP: "Fielding-independent pitching: ERA from strikeouts, walks and homers only",
  xFIP: "FIP with a league-average home run rate on fly balls",
  SIERA: "Skill-interactive ERA: an ERA estimate from strikeouts, walks and batted-ball types",
  "ERA-": "ERA against league average, park-adjusted: 100 is average, lower is better",
  "FIP-": "FIP against league average, park-adjusted: 100 is average, lower is better",
  "HR/9": "Home runs allowed per nine innings",
  "GB%": "Ground balls per batted ball",
  EV: "Average exit velocity (mph)",
  "HardHit%": "Batted balls hit 95 mph or harder",
  "Brl%": "Barrels: the ideal combination of exit velocity and launch angle",
  "Chase%": "Swings at pitches outside the strike zone",
  "Whiff%": "Swings and misses per swing",
  "CSW%": "Called strikes plus whiffs per pitch",
  BsR: "Baserunning runs above average",
  Fld: "Fielding runs above average",
  Now: "Overall grade today on the 20-80 scouting scale (50 is an average big leaguer)",
  FV: "Future value: the overall grade your scouts project at his peak",
};
