import type { Rng } from "../core/rng";
import type { Injury, Player } from "./types";

/**
 * Injuries. Each game a player appears in carries a small risk (pitchers'
 * risk scales with pitches thrown), nudged by age and a hidden durability
 * trait. Durations are drawn from a triangular distribution per injury type.
 *
 * Rates are tuned toward recent MLB, where clubs make 20-plus injured-list
 * placements a season and most starting pitchers miss time.
 */

interface InjuryType {
  name: string;
  weight: number;
  /** Days out: [min, most likely, max]. */
  days: [number, number, number];
}

const HITTER_INJURIES: InjuryType[] = [
  { name: "Bruised hand", weight: 12, days: [1, 2, 5] },
  { name: "Sore back", weight: 8, days: [2, 5, 12] },
  { name: "Tight hamstring", weight: 8, days: [1, 3, 7] },
  { name: "Hamstring strain", weight: 12, days: [8, 18, 40] },
  { name: "Oblique strain", weight: 8, days: [14, 25, 50] },
  { name: "Ankle sprain", weight: 7, days: [5, 14, 35] },
  { name: "Wrist sprain", weight: 5, days: [7, 15, 40] },
  { name: "Calf strain", weight: 5, days: [10, 18, 35] },
  { name: "Shoulder strain", weight: 4, days: [10, 20, 45] },
  { name: "Knee sprain", weight: 4, days: [10, 21, 60] },
  { name: "Concussion", weight: 3, days: [7, 10, 25] },
  { name: "Fractured hand", weight: 3, days: [28, 45, 70] },
  { name: "Torn ACL", weight: 0.4, days: [180, 270, 365] },
];

const PITCHER_INJURIES: InjuryType[] = [
  { name: "Arm fatigue", weight: 10, days: [1, 3, 6] },
  { name: "Back spasms", weight: 6, days: [2, 7, 15] },
  { name: "Blister", weight: 8, days: [3, 10, 18] },
  { name: "Shoulder inflammation", weight: 9, days: [12, 25, 60] },
  { name: "Elbow inflammation", weight: 8, days: [12, 22, 50] },
  { name: "Forearm strain", weight: 7, days: [15, 30, 70] },
  { name: "Oblique strain", weight: 5, days: [14, 25, 45] },
  { name: "Lat strain", weight: 4, days: [20, 40, 70] },
  { name: "Rotator cuff strain", weight: 3, days: [30, 60, 120] },
  { name: "Torn UCL (Tommy John surgery)", weight: 2.5, days: [300, 400, 480] },
];

export const INJURY_RATES = {
  /** Per game played by a position player. */
  hitterPerGame: 0.0085,
  catcherMult: 1.3,
  /** Pitchers: per appearance and per pitch. */
  pitcherPerAppearance: 0.008,
  pitcherPerPitch: 0.00022,
  /** Log-multiplier per z of durability (positive = fragile). */
  durability: 0.35,
  /** Extra risk per year of age past 30. */
  agePerYear: 0.03,
};

function triangular(rng: Rng, [a, c, b]: [number, number, number]): number {
  const u = rng.next();
  const f = (c - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

function riskMultiplier(p: Player): number {
  const R = INJURY_RATES;
  return Math.exp(R.durability * p.durability) * (1 + R.agePerYear * Math.max(0, p.age - 30));
}

/** Chance of an injury from one game, given what he did in it. */
export function injuryChance(p: Player, pitches: number): number {
  const R = INJURY_RATES;
  if (p.pitching) return (R.pitcherPerAppearance + R.pitcherPerPitch * pitches) * riskMultiplier(p);
  return R.hitterPerGame * (p.position === "C" ? R.catcherMult : 1) * riskMultiplier(p);
}

export function rollInjury(p: Player, day: number, rng: Rng): Injury {
  const table = p.pitching ? PITCHER_INJURIES : HITTER_INJURIES;
  const type = table[rng.weightedIndex(table.map((t) => t.weight))]!;
  const days = Math.max(1, Math.round(triangular(rng, type.days)));
  return { name: type.name, days, daysLeft: days, startDay: day };
}

/** "Hamstring strain" -> "hamstring strain", but "Torn UCL (...)" keeps its acronym. */
export function injuryPhrase(name: string): string {
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  return /^[aeiou]/i.test(lower) ? `an ${lower}` : `a ${lower}`;
}

/** Days out beyond which a big leaguer goes on the injured list rather than playing short. */
export const IL_THRESHOLD_DAYS = 7;
