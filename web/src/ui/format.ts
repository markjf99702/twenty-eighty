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
export const fixed = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "--");
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

