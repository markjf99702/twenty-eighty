import { gradeToZ } from "../core/grades";
import type { BatSide, Hand, PitchType, Player } from "../players/types";

/**
 * Engine-facing snapshots of players: grades converted to z-scores once per
 * game so the per-pitch loop does no lookups.
 */

export interface BatterProfile {
  id: number;
  bats: BatSide;
  contact: number;
  power: number;
  eye: number;
  speed: number;
  launch: number;
  pull: number;
  aggression: number;
}

export interface PitchProfile {
  type: PitchType;
  z: number;
  usage: number;
  fastball: boolean;
}

export interface PitcherProfile {
  id: number;
  throws: Hand;
  pitches: PitchProfile[];
  control: number;
  command: number;
  stamina: number;
}

const FASTBALLS: ReadonlySet<PitchType> = new Set(["FF", "SI", "FC"]);

export function batterProfile(p: Player): BatterProfile {
  const h = p.hitting;
  return {
    id: p.id,
    bats: p.bats,
    contact: gradeToZ(h.hit.present),
    power: gradeToZ(h.power.present),
    eye: gradeToZ(h.eye.present),
    speed: gradeToZ(h.speed.present),
    launch: p.traits.launch,
    pull: p.traits.pull,
    aggression: p.traits.aggression,
  };
}

export function pitcherProfile(p: Player): PitcherProfile {
  const pit = p.pitching;
  if (!pit) throw new Error(`${p.firstName} ${p.lastName} is not a pitcher`);
  return {
    id: p.id,
    throws: p.throws,
    pitches: pit.pitches.map((x) => ({
      type: x.type,
      z: gradeToZ(x.grade.present),
      usage: x.usage,
      fastball: FASTBALLS.has(x.type),
    })),
    control: gradeToZ(pit.control.present),
    command: gradeToZ(pit.command.present),
    stamina: pit.stamina.present,
  };
}

/** Side of the plate a batter hits from against this pitcher. */
export function battingSide(bats: BatSide, pitcherThrows: Hand): "L" | "R" {
  if (bats === "S") return pitcherThrows === "R" ? "L" : "R";
  return bats;
}

const LIMIT_TABLE: ReadonlyArray<[number, number]> = [
  [20, 15], [25, 20], [30, 25], [35, 31], [40, 40], [45, 55], [50, 75],
  [55, 90], [60, 97], [65, 104], [70, 110], [75, 116], [80, 121],
];

/** Typical pitch-count ceiling for a stamina grade. */
export function pitchLimit(stamina: number): number {
  if (stamina <= LIMIT_TABLE[0]![0]) return LIMIT_TABLE[0]![1];
  for (let i = 1; i < LIMIT_TABLE.length; i++) {
    const [g1, l1] = LIMIT_TABLE[i]!;
    const [g0, l0] = LIMIT_TABLE[i - 1]!;
    if (stamina <= g1) return l0 + ((stamina - g0) / (g1 - g0)) * (l1 - l0);
  }
  return LIMIT_TABLE[LIMIT_TABLE.length - 1]![1];
}
