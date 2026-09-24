import type { Rng } from "../core/rng";
import { hitterQuality } from "../league/generate";
import type { League, Team } from "../league/types";
import { armZ, defenseGrade, defenseZ } from "../players/defense";
import { FIELD_POSITIONS, type FieldPosition, type LineupPosition } from "../players/types";
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

export function buildLineup(league: League, team: Team, rng: Rng, allowRest = true): LineupSlot[] {
  const players = league.players;
  const d = team.depth;
  const bench = [...d.bench];
  const slots: LineupSlot[] = [];

  const takeBench = (pick: (ids: number[]) => number | undefined): number | undefined => {
    const id = pick(bench);
    if (id !== undefined) bench.splice(bench.indexOf(id), 1);
    return id;
  };

  for (const pos of FIELD_POSITIONS) {
    let id = d.starters[pos];
    if (allowRest && rng.chance(REST_RATE[pos])) {
      const sub = takeBench((ids) =>
        [...ids].sort((a, b) => defenseGrade(players[b]!, pos) - defenseGrade(players[a]!, pos))[0],
      );
      if (sub !== undefined) id = sub;
    }
    slots.push({ id, pos });
  }
  let dh = d.dh;
  if (allowRest && rng.chance(REST_RATE.DH)) {
    const sub = takeBench((ids) => [...ids].sort((a, b) => hitterQuality(players[b]!) - hitterQuality(players[a]!))[0]);
    if (sub !== undefined) dh = sub;
  }
  slots.push({ id: dh, pos: "DH" });

  const ranked = [...slots].sort((a, b) => hitterQuality(players[b.id]!) - hitterQuality(players[a.id]!));
  const order: LineupSlot[] = new Array(9);
  ranked.forEach((slot, rank) => {
    order[ORDER_BY_RANK[rank]!] = slot;
  });
  return order;
}

/**
 * League-average defense at each position among regular starters. This is
 * the baseline "average fielder" for defensive runs and for expected stats.
 */
export function averageDefense(league: League): Defense {
  const sums = {} as Record<FieldPosition, { range: number; arm: number }>;
  for (const pos of FIELD_POSITIONS) sums[pos] = { range: 0, arm: 0 };
  for (const t of league.teams) {
    for (const pos of FIELD_POSITIONS) {
      const p = league.players[t.depth.starters[pos]]!;
      sums[pos].range += defenseZ(p, pos);
      sums[pos].arm += armZ(p);
    }
  }
  const n = league.teams.length;
  const out = { P: { range: 0, arm: 0 } } as Defense;
  for (const pos of FIELD_POSITIONS) out[pos] = { range: sums[pos].range / n, arm: sums[pos].arm / n };
  return out;
}
