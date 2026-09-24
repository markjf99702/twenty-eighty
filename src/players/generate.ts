import { clampGrade } from "../core/grades";
import { clamp } from "../core/math";
import type { Rng } from "../core/rng";
import { randomName } from "./names";
import type {
  BatSide,
  FieldPosition,
  Hand,
  HitterTools,
  Pitch,
  PitchType,
  Player,
  PitcherRole,
  ToolGrade,
} from "./types";

/**
 * Player generation.
 *
 * Tools are drawn on the 20-80 scale around position-specific means (a typical
 * shortstop has a plus glove and arm; a typical first baseman has plus raw
 * power and a fringy glove). An "overall" talent draw pulls a player's
 * hitting tools up or down together so stars and scrubs look like stars and
 * scrubs rather than random bags of tools. After a league is generated the
 * hitting and pitching grades are re-centered so 50 really is MLB average.
 */

type HitterToolName = keyof HitterTools;

interface PositionTemplate {
  means: Record<HitterToolName, number>;
  /** Other positions this archetype can usually handle. */
  alsoPlays: FieldPosition[];
}

export const POSITION_TEMPLATES: Record<FieldPosition | "DH", PositionTemplate> = {
  C: { means: { hit: 46, power: 48, eye: 48, speed: 36, field: 55, arm: 55 }, alsoPlays: ["1B"] },
  "1B": { means: { hit: 50, power: 58, eye: 53, speed: 37, field: 46, arm: 45 }, alsoPlays: ["LF"] },
  "2B": { means: { hit: 52, power: 45, eye: 50, speed: 52, field: 55, arm: 50 }, alsoPlays: ["SS", "3B"] },
  "3B": { means: { hit: 49, power: 53, eye: 50, speed: 44, field: 55, arm: 60 }, alsoPlays: ["1B", "2B"] },
  SS: { means: { hit: 49, power: 46, eye: 48, speed: 55, field: 60, arm: 60 }, alsoPlays: ["2B", "3B"] },
  LF: { means: { hit: 50, power: 53, eye: 51, speed: 49, field: 47, arm: 47 }, alsoPlays: ["RF", "1B"] },
  CF: { means: { hit: 49, power: 47, eye: 49, speed: 61, field: 57, arm: 52 }, alsoPlays: ["LF", "RF"] },
  RF: { means: { hit: 49, power: 55, eye: 50, speed: 50, field: 50, arm: 59 }, alsoPlays: ["LF"] },
  DH: { means: { hit: 51, power: 60, eye: 53, speed: 34, field: 36, arm: 40 }, alsoPlays: ["1B"] },
};

/** Always-right-handed throwers at these spots. */
const RIGHTY_ONLY: ReadonlySet<string> = new Set(["C", "2B", "3B", "SS"]);

function tool(present: number, future: number): ToolGrade {
  return { present: clampGrade(present), future: clampGrade(Math.max(present, future)) };
}

/** Expected remaining growth (in grade points) for a player of this age. */
export function growthRoom(age: number): number {
  return clamp((27 - age) * 2.6, 0, 18);
}

function randomBats(rng: Rng, throws: Hand): BatSide {
  const r = rng.next();
  if (throws === "L") return r < 0.8 ? "L" : r < 0.93 ? "R" : "S";
  return r < 0.72 ? "R" : r < 0.9 ? "L" : "S";
}

export interface HitterOptions {
  id: number;
  position: FieldPosition | "DH";
  /** Talent level in z units (0 = average regular). */
  overall: number;
  age: number;
}

export function generateHitter(rng: Rng, opts: HitterOptions): Player {
  const tpl = POSITION_TEMPLATES[opts.position];
  const name = randomName(rng);
  const throws: Hand = RIGHTY_ONLY.has(opts.position) ? "R" : rng.chance(0.78) ? "R" : "L";
  const bats = randomBats(rng, throws);
  const o = opts.overall;

  // Correlated draws: contact and discipline travel together; big power
  // tends to come with more swing-and-miss and fewer stolen bases.
  const zHit = rng.normal();
  const zEye = 0.35 * zHit + 0.94 * rng.normal();
  const zPow = -0.15 * zHit + 0.99 * rng.normal();
  const zSpd = -0.2 * zPow + 0.98 * rng.normal();
  const zFld = rng.normal();
  const zArm = 0.3 * zFld + 0.95 * rng.normal();

  const m = tpl.means;
  const present: Record<HitterToolName, number> = {
    hit: m.hit + 6.5 * o + 7.5 * zHit,
    power: m.power + 5 * o + 8.5 * zPow,
    eye: m.eye + 4.5 * o + 7.5 * zEye,
    speed: m.speed + 1.5 * o + 8 * zSpd,
    field: m.field + 2 * o + 7 * zFld,
    arm: m.arm + 1 * o + 7 * zArm,
  };

  const room = growthRoom(opts.age);
  const growth = (weight: number) => Math.max(0, room * weight + rng.normal(0, room * 0.35));
  const hitting: HitterTools = {
    hit: tool(present.hit, present.hit + growth(0.8)),
    power: tool(present.power, present.power + growth(1.0)),
    eye: tool(present.eye, present.eye + growth(0.7)),
    speed: tool(present.speed, present.speed + growth(0.15)),
    field: tool(present.field, present.field + growth(0.4)),
    arm: tool(present.arm, present.arm + growth(0.3)),
  };

  const powZ = (hitting.power.present - 50) / 10;
  const positions: FieldPosition[] = opts.position === "DH" ? [] : [opts.position];
  for (const p of tpl.alsoPlays) {
    if (RIGHTY_ONLY.has(p) && throws === "L") continue;
    if (rng.chance(0.55)) positions.push(p);
  }

  return {
    id: opts.id,
    firstName: name.first,
    lastName: name.last,
    age: opts.age,
    bats,
    throws,
    position: opts.position,
    positions,
    hitting,
    traits: {
      launch: clamp(0.4 * powZ + 0.9 * rng.normal(), -2.5, 2.5),
      pull: clamp(0.3 * powZ + 0.95 * rng.normal(), -2.5, 2.5),
      aggression: clamp(0.4 * ((hitting.speed.present - 50) / 10) + 0.9 * rng.normal(), -2.5, 2.5),
    },
  };
}

// ---------------------------------------------------------------------------
// Pitchers

const FASTBALLS: readonly PitchType[] = ["FF", "SI"];
const BREAKING: readonly PitchType[] = ["SL", "ST", "CU", "FC"];
const OFFSPEED: readonly PitchType[] = ["CH", "FS"];

export interface PitcherOptions {
  id: number;
  role: PitcherRole;
  overall: number;
  age: number;
}

function buildArsenal(rng: Rng, role: PitcherRole, overall: number, room: number): Pitch[] {
  const count = role === "SP" ? rng.weighted([3, 4, 5], [0.25, 0.5, 0.25]) : rng.weighted([2, 3, 4], [0.3, 0.55, 0.15]);
  const primary: PitchType = rng.chance(0.68) ? "FF" : "SI";
  const types: PitchType[] = [primary];
  // Most arms pair the fastball with one breaking ball; starters add a
  // changeup or splitter to handle opposite-handed hitters.
  types.push(rng.pick(BREAKING.filter((t) => !types.includes(t))));
  const pool: PitchType[] = [
    ...OFFSPEED,
    ...BREAKING,
    ...FASTBALLS,
  ].filter((t) => !types.includes(t));
  while (types.length < count && pool.length > 0) {
    const wantOffspeed = role === "SP" && !types.some((t) => OFFSPEED.includes(t));
    const candidates = wantOffspeed ? pool.filter((t) => OFFSPEED.includes(t)) : pool;
    const t = rng.pick(candidates);
    types.push(t);
    pool.splice(pool.indexOf(t), 1);
  }

  const relieverBump = role === "RP" ? 3 : 0;
  const outPitch = rng.int(1, types.length - 1);
  return types.map((type, i) => {
    let g = 50 + 6 * overall + relieverBump + rng.normal(0, 7.5);
    if (i === outPitch) g += 5;
    const usage = i === 0 ? 1.0 : i === outPitch ? 0.6 : 0.3 + rng.next() * 0.2;
    const future = g + Math.max(0, room * 0.8 + rng.normal(0, room * 0.4));
    return { type, grade: tool(g, future), usage };
  });
}

export function generatePitcher(rng: Rng, opts: PitcherOptions): Player {
  const name = randomName(rng);
  const throws: Hand = rng.chance(0.72) ? "R" : "L";
  const o = opts.overall;
  const room = growthRoom(opts.age);
  const pitches = buildArsenal(rng, opts.role, o, room);

  const zCtl = rng.normal();
  const zCmd = 0.55 * zCtl + 0.83 * rng.normal();
  const control = 50 + 3.5 * o + 7.5 * zCtl - (opts.role === "RP" ? 2 : 0);
  const command = 49 + 3.5 * o + 7.5 * zCmd - (opts.role === "RP" ? 2 : 0);
  const stamina = opts.role === "SP" ? rng.normal(56, 7) : rng.normal(32, 6);
  const fb = pitches[0]!;
  const velocity = 93.8 + 1.3 * ((fb.grade.present - 50) / 10) + (opts.role === "RP" ? 1.2 : 0) + rng.normal(0, 0.8);

  // Pitchers still get (irrelevant under the universal DH) hitting tools.
  const weak = (): ToolGrade => tool(rng.normal(25, 4), 0);
  return {
    id: opts.id,
    firstName: name.first,
    lastName: name.last,
    age: opts.age,
    bats: randomBats(rng, throws),
    throws,
    position: "P",
    positions: [],
    role: opts.role,
    hitting: { hit: weak(), power: weak(), eye: weak(), speed: tool(rng.normal(40, 6), 0), field: tool(rng.normal(50, 6), 0), arm: tool(rng.normal(60, 5), 0) },
    traits: { launch: 0, pull: 0, aggression: -2 },
    pitching: {
      pitches,
      control: tool(control, control + Math.max(0, room * 0.6 + rng.normal(0, room * 0.3))),
      command: tool(command, command + Math.max(0, room * 0.7 + rng.normal(0, room * 0.3))),
      stamina: tool(stamina, stamina + Math.max(0, room * 0.3)),
      velocity: Math.round(velocity * 10) / 10,
    },
  };
}

/** Typical big-league age for a player of a given talent tier. */
export function randomAge(rng: Rng, mean = 28.5, sd = 3.4): number {
  return Math.round(clamp(rng.normal(mean, sd), 21, 40));
}
