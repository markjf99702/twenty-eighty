import type { Rng } from "../core/rng";
import { hitterQuality } from "../league/generate";
import type { DepthChart, League } from "../league/types";
import { autoDepthChart } from "../org/depth";
import { armZ, defenseGrade, defenseZ } from "../players/defense";
import { FIELD_POSITIONS, type FieldPosition, type Level, type LineupPosition } from "../players/types";
import type { Defense } from "./battedBall";
import type { LineupSlot } from "./game";

/**
 * The dugout AI: who plays today and in what order. Bullpen decisions during
 * a game live in the game engine; rest and rotation live in the season's
 * staff tracker.
 */

/** Chance a regular gets the day off. */
const REST_RATE: Record<LineupPosition, number> = {
  C: 0.15,
  "1B": 0.04,
  "2B": 0.045,
  "3B": 0.045,
  SS: 0.04,
  LF: 0.045,
  CF: 0.045,
  RF: 0.045,
  DH: 0.03,
};

/** Batting-order slots for hitters ranked best to worst (The Book: best hitters 1-2-4, then 3 and 5). */
const ORDER_BY_RANK = [1, 0, 3, 2, 4, 5, 6, 7, 8];

export interface LineupOptions {
  allowRest?: boolean;
  /** Players who can't play today (injured). */
  unavailable?: (id: number) => boolean;
}

export function buildLineup(league: League, depth: DepthChart, rng: Rng, opts: LineupOptions = {}): LineupSlot[] {
  const players = league.players;
  const out = opts.unavailable ?? (() => false);
  const allowRest = opts.allowRest ?? true;
  const bench = depth.bench.filter((id) => !out(id));
  const slots: LineupSlot[] = [];
  const used = new Set<number>();

  // The best bench player not already in the lineup (the caller marks whoever plays as used).
  const takeBench = (score: (id: number) => number): number | undefined => {
    const candidates = bench.filter((id) => !used.has(id));
    if (candidates.length === 0) return undefined;
    return candidates.reduce((a, b) => (score(b) > score(a) ? b : a));
  };

  // With nobody left on the bench, a hole goes to the last man in the bullpen.
  const emergency = (): number => {
    const arm = [...depth.bullpen].reverse().find((id) => !used.has(id) && !out(id)) ?? depth.bullpen.find((id) => !used.has(id));
    return arm ?? -1;
  };

  const missing = (id: number) => id < 0 || out(id);
  // Regulars who can't play: the bench has to cover them whatever else happens, so a
  // healthy regular gets a day off only while there's a spare bench player beyond them.
  let holes = FIELD_POSITIONS.filter((pos) => missing(depth.starters[pos])).length + (missing(depth.dh) ? 1 : 0);
  const spare = () => bench.filter((id) => !used.has(id)).length - holes;

  for (const pos of FIELD_POSITIONS) {
    let id = depth.starters[pos];
    if (missing(id)) holes--;
    // (A player listed at two spots plays the first; the second goes to the bench.)
    const forced = missing(id) || used.has(id);
    if (forced || (allowRest && rng.chance(REST_RATE[pos]) && spare() > 0)) {
      const sub = takeBench((b) => defenseGrade(players[b]!, pos) + 3 * hitterQuality(players[b]!));
      if (sub !== undefined) id = sub;
    }
    if (missing(id) || used.has(id)) id = emergency();
    used.add(id);
    slots.push({ id, pos });
  }
  let dh = depth.dh;
  if (missing(dh)) holes--;
  if (missing(dh) || used.has(dh) || (allowRest && rng.chance(REST_RATE.DH) && spare() > 0)) {
    const sub = takeBench((b) => hitterQuality(players[b]!));
    if (sub !== undefined) dh = sub;
  }
  if (missing(dh) || used.has(dh)) dh = emergency();
  used.add(dh);
  slots.push({ id: dh, pos: "DH" });

  const ranked = [...slots].sort((a, b) => hitterQuality(players[b.id]!) - hitterQuality(players[a.id]!));
  const order: LineupSlot[] = new Array(9);
  ranked.forEach((slot, rank) => {
    order[ORDER_BY_RANK[rank]!] = slot;
  });
  return order;
}

/**
 * Average defense at each position among the regular starters at a level.
 * This is the baseline "average fielder" for defensive runs and for
 * expected stats.
 */
export function averageDefense(league: League, level: Level = "MLB"): Defense {
  const sums = {} as Record<FieldPosition, { range: number; arm: number }>;
  for (const pos of FIELD_POSITIONS) sums[pos] = { range: 0, arm: 0 };
  let n = 0;
  for (const t of league.teams) {
    const depth = level === "MLB" ? t.depth : autoDepthChart(t.rosters[level].map((id) => league.players[id]!));
    for (const pos of FIELD_POSITIONS) {
      const p = league.players[depth.starters[pos]];
      if (!p) continue;
      sums[pos].range += defenseZ(p, pos);
      sums[pos].arm += armZ(p);
    }
    n++;
  }
  const out = { P: { range: 0, arm: 0 } } as Defense;
  for (const pos of FIELD_POSITIONS) out[pos] = { range: sums[pos].range / n, arm: sums[pos].arm / n };
  return out;
}
