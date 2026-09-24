import type { FieldPosition, Player } from "./types";

/**
 * How much each tool matters at each position. A shortstop leans on glove
 * and arm, a center fielder on speed, a first baseman almost entirely on hands.
 */
const WEIGHTS: Record<FieldPosition, { field: number; arm: number; speed: number }> = {
  C: { field: 0.8, arm: 0.2, speed: 0 },
  "1B": { field: 0.85, arm: 0.05, speed: 0.1 },
  "2B": { field: 0.7, arm: 0.1, speed: 0.2 },
  "3B": { field: 0.65, arm: 0.3, speed: 0.05 },
  SS: { field: 0.6, arm: 0.25, speed: 0.15 },
  LF: { field: 0.55, arm: 0.1, speed: 0.35 },
  CF: { field: 0.45, arm: 0.1, speed: 0.45 },
  RF: { field: 0.5, arm: 0.2, speed: 0.3 },
};

/** Grade penalty for playing a position he isn't trained for. */
const OUT_OF_POSITION = 12;
const NON_CATCHER_BEHIND_PLATE = 25;

/** Defensive grade (20-80) of a player at a position, including familiarity. */
export function defenseGrade(p: Player, pos: FieldPosition): number {
  const w = WEIGHTS[pos];
  const h = p.hitting;
  let g = w.field * h.field.present + w.arm * h.arm.present + w.speed * h.speed.present;
  if (!p.positions.includes(pos)) g -= pos === "C" ? NON_CATCHER_BEHIND_PLATE : OUT_OF_POSITION;
  return Math.max(20, Math.min(80, g));
}

export const defenseZ = (p: Player, pos: FieldPosition): number => (defenseGrade(p, pos) - 50) / 10;
export const armZ = (p: Player): number => (p.hitting.arm.present - 50) / 10;
