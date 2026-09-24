import { gradeToZ } from "../core/grades";
import { OFFENSE_WEIGHTS, PITCHING_WEIGHTS } from "../players/generate";
import { defenseZ } from "../players/defense";
import type { FieldPosition, Player } from "../players/types";
import { FIELD_POSITIONS } from "../players/types";

/**
 * How the front-office AI values players, in runs. These use the player's
 * true grades for now; once scouting reports carry uncertainty, the AI will
 * value what its scouts believe instead.
 */

/**
 * Runs per season of defense per z of positional defense grade, measured
 * from the engine (fielding runs regressed on defense grade).
 */
export const DEFENSE_RUNS_PER_Z: Record<FieldPosition, number> = {
  C: 10,
  SS: 13,
  "2B": 13,
  CF: 12,
  "3B": 8,
  RF: 8,
  LF: 7,
  "1B": 5,
};

/** Positional adjustment in runs per 600 PA (FanGraphs scale). */
export const POSITION_RUNS: Record<FieldPosition | "DH", number> = {
  C: 11,
  SS: 6.5,
  CF: 2.2,
  "2B": 2.2,
  "3B": 2.2,
  RF: -6.5,
  LF: -6.5,
  "1B": -11,
  DH: -15,
};

/** Offensive runs per 600 PA vs. an all-50 hitter, from present (or future) grades. */
export function offenseValue(p: Player, future = false): number {
  const h = p.hitting;
  const g = (t: { present: number; future: number }) => gradeToZ(future ? t.future : t.present);
  const W = OFFENSE_WEIGHTS;
  return W.hit * g(h.hit) + W.power * g(h.power) + W.eye * g(h.eye) + W.speed * g(h.speed);
}

/** Total value of a hitter playing a position, runs per 600 PA. */
export function valueAt(p: Player, pos: FieldPosition | "DH"): number {
  if (pos === "DH") return offenseValue(p) + POSITION_RUNS.DH;
  return offenseValue(p) + DEFENSE_RUNS_PER_Z[pos] * defenseZ(p, pos) + POSITION_RUNS[pos];
}

/** Best position and value for a hitter. */
export function bestPosition(p: Player): { pos: FieldPosition | "DH"; value: number } {
  let best: { pos: FieldPosition | "DH"; value: number } = { pos: "DH", value: valueAt(p, "DH") };
  for (const pos of FIELD_POSITIONS) {
    const v = valueAt(p, pos);
    if (v > best.value) best = { pos, value: v };
  }
  return best;
}

/** Runs saved per 600 batters faced vs. an all-50 pitcher. */
export function pitchingValue(p: Player, future = false): number {
  const pit = p.pitching;
  if (!pit) return -60;
  const pick = (t: { present: number; future: number }) => gradeToZ(future ? t.future : t.present);
  let usage = 0;
  let stuff = 0;
  for (const x of pit.pitches) {
    usage += x.usage;
    stuff += x.usage * pick(x.grade);
  }
  const W = PITCHING_WEIGHTS;
  return W.stuff * (stuff / usage) + W.control * pick(pit.control) + W.command * pick(pit.command);
}

/** Can he handle a starter's workload? */
export const canStart = (p: Player): boolean => (p.pitching?.stamina.present ?? 0) >= 45;

/**
 * A rough seasonal value in runs above an average regular, comparable across
 * hitters and pitchers. Starters face ~750 batters, relievers ~260.
 */
export function playerValue(p: Player, future = false): number {
  if (p.pitching) {
    const v = pitchingValue(p, future);
    return canStart(p) ? v * 1.25 : v * 0.45;
  }
  if (future) return offenseValue(p, true) + 0.5 * Math.max(0, bestPosition(p).value - offenseValue(p));
  return bestPosition(p).value;
}
