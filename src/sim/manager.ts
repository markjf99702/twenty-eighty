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

  const takeBench = (score: (id: number) => number): number | undefined => {
    const candidates = bench.filter((id) => !used.has(id));
    if (candidates.length === 0) return undefined;
    const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a));
    used.add(best);
    return best;
  };

  // With nobody left on the bench, a hole goes to the last man in the bullpen.
  const emergency = (): number => {
    const arm = [...depth.bullpen].reverse().find((id) => !used.has(id) && !out(id)) ?? depth.bullpen.find((id) => !used.has(id));
    return arm ?? -1;
  };

  for (const pos of FIELD_POSITIONS) {
    let id = depth.starters[pos];
    // (A player listed at two spots plays the first; the second goes to the bench.)
    const sits = id < 0 || out(id) || used.has(id) || (allowRest && rng.chance(REST_RATE[pos]));
    if (sits) {
      const sub = takeBench((b) => defenseGrade(players[b]!, pos) + 3 * hitterQuality(players[b]!));
      if (sub !== undefined) id = sub;
    }
    if (id < 0 || used.has(id)) id = emergency();
    used.add(id);
    slots.push({ id, pos });
  }
  let dh = depth.dh;
  if (dh < 0 || out(dh) || used.has(dh) || (allowRest && rng.chance(REST_RATE.DH))) {
    const sub = takeBench((b) => hitterQuality(players[b]!));
    if (sub !== undefined) dh = sub;
  }
  if (dh < 0 || used.has(dh)) dh = emergency();
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
