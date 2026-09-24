import { maxAssignment } from "../core/assignment";
import type { DepthChart } from "../league/types";
import { defenseZ } from "../players/defense";
import type { FieldPosition, Player } from "../players/types";
import { canStart, DEFENSE_RUNS_PER_Z, offenseValue, pitchingValue } from "./value";

/**
 * The manager's depth chart: who starts where, the bench, the rotation and
 * the bullpen, built from whoever is on a roster. Used for every AI club at
 * every level, and for the user's club unless the user sets it by hand.
 */

const SLOTS: (FieldPosition | "DH")[] = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];

/** What a hitter adds in a lineup slot: his bat plays anywhere; his glove only in the field. */
function slotValue(p: Player, slot: FieldPosition | "DH"): number {
  if (slot === "DH") return offenseValue(p);
  return offenseValue(p) + DEFENSE_RUNS_PER_Z[slot] * defenseZ(p, slot);
}

export function autoDepthChart(roster: Player[]): DepthChart {
  const hitters = roster.filter((p) => !p.pitching);
  const pitchers = roster.filter((p) => p.pitching);

  // Choose the nine starters and their positions together (max-weight
  // assignment), with extra columns for the bench.
  const n = Math.max(hitters.length, SLOTS.length);
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const p = hitters[i];
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      if (!p) row.push(j < SLOTS.length ? -1000 : 0);
      else row.push(j < SLOTS.length ? slotValue(p, SLOTS[j]!) : 0);
    }
    matrix.push(row);
  }
  const assignment = maxAssignment(matrix);
  const starters = {} as Record<FieldPosition, number>;
  let dhPlayer: Player | undefined;
  const remaining = new Set(hitters);
  assignment.forEach((col, i) => {
    const p = hitters[i];
    if (!p || col >= SLOTS.length) return;
    const slot = SLOTS[col]!;
    if (slot === "DH") dhPlayer = p;
    else starters[slot] = p.id;
    remaining.delete(p);
  });
  for (const pos of SLOTS) if (pos !== "DH" && starters[pos] === undefined) starters[pos] = -1;

  const byBat = [...remaining].sort((a, b) => offenseValue(b) - offenseValue(a));
  const dh = dhPlayer;
  // Keep a backup catcher at the top of the bench if there is one.
  const catcherIdx = byBat.findIndex((p) => p.position === "C" || p.positions.includes("C"));
  if (catcherIdx > 0) byBat.unshift(...byBat.splice(catcherIdx, 1));

  const byArm = [...pitchers].sort((a, b) => pitchingValue(b) - pitchingValue(a));
  const starterPool = byArm.filter(canStart);
  const rotation = starterPool.slice(0, 5);
  if (rotation.length < 5) {
    // Not enough real starters: stretch out the relievers with the most stamina.
    const extra = byArm
      .filter((p) => !rotation.includes(p))
      .sort((a, b) => (b.pitching!.stamina.present - a.pitching!.stamina.present))
      .slice(0, 5 - rotation.length);
    rotation.push(...extra);
  }
  const bullpen = byArm.filter((p) => !rotation.includes(p));

  return {
    starters,
    dh: dh?.id ?? -1,
    bench: byBat.map((p) => p.id),
    rotation: rotation.map((p) => p.id),
    bullpen: bullpen.map((p) => p.id),
  };
}

/** True when every lineup and rotation slot is filled by a real player. */
export function depthChartComplete(d: DepthChart): boolean {
  return Object.values(d.starters).every((id) => id >= 0) && d.dh >= 0 && d.rotation.length >= 4;
}
