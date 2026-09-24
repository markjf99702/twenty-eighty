import { clampGrade } from "../core/grades";
import { clamp } from "../core/math";
import type { Rng } from "../core/rng";
import type { Player, ToolGrade } from "./types";

/**
 * Player development and aging, applied once each winter.
 *
 * A young player's present grades close part of the gap to his future grades
 * every year, so he arrives at his projection around his peak age, while the
 * projection itself drifts: some prospects break out, more of them stall.
 * After a plateau, tools decline, each on its own clock (speed goes first,
 * plate discipline and command last). Every year also carries noise, plus a
 * shared good-year/bad-year shock to a player's core skills.
 *
 * `projectPlayer` applies the same model without the noise, which is what the
 * front offices use to value players over the years of a contract.
 */

export type ToolKind = "hit" | "power" | "eye" | "speed" | "field" | "arm" | "stuff" | "control" | "command" | "stamina";

interface Curve {
  /** Age at which the tool reaches its projection. */
  peak: number;
  /** Years it holds there before declining. */
  plateau: number;
  /** Mean grade points lost per year after the plateau, and from `lateAge` on. */
  early: number;
  late: number;
  lateAge: number;
}

export const AGING: Record<ToolKind, Curve> = {
  hit: { peak: 27, plateau: 3, early: 1.4, late: 2.2, lateAge: 34 },
  power: { peak: 27, plateau: 3, early: 1.4, late: 2.0, lateAge: 34 },
  eye: { peak: 29, plateau: 4, early: 0.8, late: 1.4, lateAge: 35 },
  speed: { peak: 24, plateau: 1, early: 0.9, late: 1.4, lateAge: 30 },
  field: { peak: 26, plateau: 3, early: 1.0, late: 1.6, lateAge: 33 },
  arm: { peak: 27, plateau: 4, early: 0.9, late: 1.5, lateAge: 34 },
  stuff: { peak: 26, plateau: 3, early: 1.3, late: 2.0, lateAge: 33 },
  control: { peak: 28, plateau: 5, early: 0.6, late: 1.0, lateAge: 36 },
  command: { peak: 28, plateau: 5, early: 0.6, late: 1.0, lateAge: 36 },
  stamina: { peak: 27, plateau: 5, early: 1.0, late: 1.6, lateAge: 35 },
};

export const DEVELOPMENT = {
  /**
   * Mean yearly drift of a still-growing player's projection (grade points):
   * slightly down on average, and more so for extreme projections, which are
   * more often overestimates (regression toward a typical 55).
   */
  futureDrift: (future: number) => -0.6 - 0.06 * (future - 55),
  /** Spread of that drift by age: breakouts and busts are a young player's game. */
  futureSd: (age: number) => (age <= 21 ? 2.6 : age <= 24 ? 2.0 : 1.2),
  /** Year-to-year noise in each tool, and a shared shock to a player's core skills. */
  toolSd: 0.8,
  shockSd: 0.7,
  /** Slowest and fastest share of the remaining gap closed in a year. */
  minRate: 0.12,
};

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Mean change in one tool over the year a player spends at `age`. */
function step(t: ToolGrade, kind: ToolKind, age: number, noise: number, futureNoise: number): void {
  const c = AGING[kind];
  const next = age + 1;
  let present = t.present;
  let future = t.future;
  if (next <= c.peak) {
    const rate = clamp(1 / (c.peak - age), DEVELOPMENT.minRate, 1);
    present += rate * (future - present) + noise;
    future += DEVELOPMENT.futureDrift(future) + futureNoise;
  } else if (next <= c.peak + c.plateau) {
    present = Math.max(present, future) + noise;
    future = present;
  } else {
    present -= (next >= c.lateAge ? c.late : c.early) - noise;
    future = present;
  }
  t.present = r1(clampGrade(present));
  t.future = r1(clampGrade(Math.max(t.present, future)));
}

/** Every graded tool with its aging curve. Pitchers' hitting tools don't matter and are left alone. */
function tools(p: Player): { t: ToolGrade; kind: ToolKind; core: boolean }[] {
  if (p.pitching) {
    const pit = p.pitching;
    return [
      ...pit.pitches.map((x) => ({ t: x.grade, kind: "stuff" as const, core: true })),
      { t: pit.control, kind: "control", core: true },
      { t: pit.command, kind: "command", core: true },
      { t: pit.stamina, kind: "stamina", core: false },
    ];
  }
  const h = p.hitting;
  return [
    { t: h.hit, kind: "hit", core: true },
    { t: h.power, kind: "power", core: true },
    { t: h.eye, kind: "eye", core: true },
    { t: h.speed, kind: "speed", core: false },
    { t: h.field, kind: "field", core: false },
    { t: h.arm, kind: "arm", core: false },
  ];
}

/** One winter of development and aging (the player also turns a year older). */
export function developPlayer(p: Player, rng: Rng): void {
  const shock = rng.normal(0, DEVELOPMENT.shockSd);
  const sdFuture = DEVELOPMENT.futureSd(p.age);
  const fastball = p.pitching?.pitches[0]?.grade.present ?? 0;
  for (const { t, kind, core } of tools(p)) {
    const noise = rng.normal(0, DEVELOPMENT.toolSd) + (core ? shock : 0);
    step(t, kind, p.age, noise, rng.normal(0, sdFuture));
  }
  if (p.pitching) {
    // Velocity follows the fastball grade (about 1.3 mph per 10 points).
    const change = p.pitching.pitches[0]!.grade.present - fastball;
    p.pitching.velocity = Math.round((p.pitching.velocity + 0.13 * change) * 10) / 10;
  }
  p.age += 1;
}

function cloneTools(p: Player): Player {
  return {
    ...p,
    hitting: {
      hit: { ...p.hitting.hit },
      power: { ...p.hitting.power },
      eye: { ...p.hitting.eye },
      speed: { ...p.hitting.speed },
      field: { ...p.hitting.field },
      arm: { ...p.hitting.arm },
    },
    pitching: p.pitching
      ? {
          ...p.pitching,
          pitches: p.pitching.pitches.map((x) => ({ ...x, grade: { ...x.grade } })),
          control: { ...p.pitching.control },
          command: { ...p.pitching.command },
          stamina: { ...p.pitching.stamina },
        }
      : undefined,
  };
}

/** The expected player `years` winters from now (no noise). */
export function projectPlayer(p: Player, years: number): Player {
  const q = cloneTools(p);
  for (let y = 0; y < years; y++) {
    for (const { t, kind } of tools(q)) step(t, kind, q.age, 0, 0);
    q.age += 1;
  }
  return q;
}

/** How many winters until his last still-growing tool peaks (0 for veterans). */
export function yearsToPeak(p: Player): number {
  const peaks = tools(p).map(({ kind }) => AGING[kind].peak);
  return Math.max(0, Math.max(...peaks) - p.age);
}
