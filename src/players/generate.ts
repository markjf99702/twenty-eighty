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

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Grades are kept to one decimal (true talent); scouting reports round them to 5s. */
function tool(present: number, future: number): ToolGrade {
  const p = r1(clampGrade(present));
  return { present: p, future: r1(clampGrade(Math.max(p, future))) };
}

/**
 * Expected remaining growth (in grade points) for a player of this age. Sized
 * so that each generation of prospects replaces the one before it: tuned with
 * `npm run sim:years`, which plays many seasons and watches for drift.
 */
export const GROWTH = { perYear: 1.6, max: 11 };

export function growthRoom(age: number): number {
  return clamp((27 - age) * GROWTH.perYear, 0, GROWTH.max);
}

/** Organizational fields for a newly generated player; the league generator assigns him. */
function unassigned(rng: Rng) {
  return {
    durability: r2(clamp(rng.normal(), -2.5, 2.5)),
    teamId: null,
    level: "A" as const,
    onFortyMan: false,
    il: null,
    ilDay: null,
    injury: null,
    options: { used: 0, usedThisYear: false },
    service: 0,
    optionedDay: null,
    contract: null,
    career: [],
    awards: [],
  };
}

function randomBats(rng: Rng, throws: Hand): BatSide {
  const r = rng.next();
  if (throws === "L") return r < 0.8 ? "L" : r < 0.93 ? "R" : "S";
  return r < 0.72 ? "R" : r < 0.9 ? "L" : "S";
}

/**
 * Offensive value of a tool set, in runs per 600 PA above an all-50 hitter,
 * per z (10 grade points). Measured with `npm run grade-chart`.
 */
export const OFFENSE_WEIGHTS = { hit: 19, power: 19, eye: 6, speed: 5 } as const;

/** Run prevention per 600 batters faced per z: stuff (usage-weighted pitch grades), control, command. */
export const PITCHING_WEIGHTS = { stuff: 22, control: 4, command: 5 } as const;

export interface HitterOptions {
  id: number;
  position: FieldPosition | "DH";
  /** Target offensive value in runs per 600 PA vs. a league-average (all-50) bat. */
  value: number;
  age: number;
}

export function generateHitter(rng: Rng, opts: HitterOptions): Player {
  const tpl = POSITION_TEMPLATES[opts.position];
  const name = randomName(rng);
  const throws: Hand = RIGHTY_ONLY.has(opts.position) ? "R" : rng.chance(0.78) ? "R" : "L";
  const bats = randomBats(rng, throws);
  const m = tpl.means;

  // The shape of the bat: correlated draws around the position's typical mix.
  // Contact and discipline travel together; big power tends to come with
  // more swing-and-miss and fewer stolen bases.
  const nHit = rng.normal();
  const nEye = 0.35 * nHit + 0.94 * rng.normal();
  const nPow = -0.3 * nHit + 0.95 * rng.normal();
  const nSpd = -0.2 * nPow + 0.98 * rng.normal();
  const z = {
    hit: (m.hit - 50) / 10 + 1.25 * nHit,
    power: (m.power - 50) / 10 + 1.25 * nPow,
    eye: (m.eye - 50) / 10 + 1.0 * nEye,
    speed: (m.speed - 50) / 10 + 0.9 * nSpd,
  };
  // How good the bat is: shift the mix along the value gradient to hit the target.
  const W = OFFENSE_WEIGHTS;
  const value = W.hit * z.hit + W.power * z.power + W.eye * z.eye + W.speed * z.speed;
  const norm = W.hit ** 2 + W.power ** 2 + W.eye ** 2 + W.speed ** 2;
  const k = (opts.value - value) / norm;
  const present: Record<HitterToolName, number> = {
    hit: 50 + 10 * (z.hit + k * W.hit),
    power: 50 + 10 * (z.power + k * W.power),
    eye: 50 + 10 * (z.eye + k * W.eye),
    speed: 50 + 10 * (z.speed + k * W.speed),
    field: m.field + 7 * rng.normal(),
    arm: m.arm + 7 * rng.normal(),
  };
  const zFld = (present.field - m.field) / 7;
  present.arm += 2 * zFld;

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

  // A swing path is a hitter's style: it tracks the power he'll grow into, not his raw present power.
  const powZ = (hitting.power.future - 50) / 10;
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
      launch: r2(clamp(0.28 * powZ + 0.9 * rng.normal(), -2, 2)),
      pull: r2(clamp(0.3 * powZ + 0.95 * rng.normal(), -2, 2)),
      aggression: r2(clamp(0.4 * ((hitting.speed.present - 50) / 10) + 0.9 * rng.normal(), -2.5, 2.5)),
    },
    ...unassigned(rng),
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
  /** Target run prevention in runs per 600 batters faced vs. an all-50 pitcher. */
  value: number;
  age: number;
}

function buildArsenal(rng: Rng, role: PitcherRole): { type: PitchType; z: number; usage: number }[] {
  const count = role === "SP" ? rng.weighted([3, 4, 5], [0.25, 0.5, 0.25]) : rng.weighted([2, 3, 4], [0.3, 0.55, 0.15]);
  const primary: PitchType = rng.chance(0.68) ? "FF" : "SI";
  const types: PitchType[] = [primary];
  // Most arms pair the fastball with one breaking ball; starters add a
  // changeup or splitter to handle opposite-handed hitters.
  types.push(rng.pick(BREAKING.filter((t) => !types.includes(t))));
  const pool: PitchType[] = [...OFFSPEED, ...BREAKING, ...FASTBALLS].filter((t) => !types.includes(t));
  while (types.length < count && pool.length > 0) {
    const wantOffspeed = role === "SP" && !types.some((t) => OFFSPEED.includes(t));
    const candidates = wantOffspeed ? pool.filter((t) => OFFSPEED.includes(t)) : pool;
    const t = rng.pick(candidates);
    types.push(t);
    pool.splice(pool.indexOf(t), 1);
  }
  // One pitch is the out pitch: a half-grade better and thrown more.
  const outPitch = rng.int(1, types.length - 1);
  return types.map((type, i) => ({
    type,
    z: rng.normal(0, 0.75) + (i === outPitch ? 0.5 : 0),
    usage: i === 0 ? 1.0 : i === outPitch ? 0.6 : 0.3 + rng.next() * 0.2,
  }));
}

export function generatePitcher(rng: Rng, opts: PitcherOptions): Player {
  const name = randomName(rng);
  const throws: Hand = rng.chance(0.72) ? "R" : "L";
  const room = growthRoom(opts.age);
  const arsenal = buildArsenal(rng, opts.role);

  const nCtl = rng.normal(0, 0.8);
  const nCmd = 0.55 * nCtl + 0.66 * rng.normal();
  const usageSum = arsenal.reduce((s, p) => s + p.usage, 0);
  const stuff = arsenal.reduce((s, p) => s + p.z * p.usage, 0) / usageSum;
  const W = PITCHING_WEIGHTS;
  const value = W.stuff * stuff + W.control * nCtl + W.command * nCmd;
  const k = (opts.value - value) / (W.stuff ** 2 + W.control ** 2 + W.command ** 2);

  const pitches: Pitch[] = arsenal.map((p) => {
    const g = 50 + 10 * (p.z + k * W.stuff);
    const future = g + Math.max(0, room * 0.8 + rng.normal(0, room * 0.4));
    return { type: p.type, grade: tool(g, future), usage: p.usage };
  });
  const control = 50 + 10 * (nCtl + k * W.control);
  const command = 50 + 10 * (nCmd + k * W.command);
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
    hitting: {
      hit: weak(),
      power: weak(),
      eye: weak(),
      speed: tool(rng.normal(40, 6), 0),
      field: tool(rng.normal(50, 6), 0),
      arm: tool(rng.normal(60, 5), 0),
    },
    traits: { launch: 0, pull: 0, aggression: -2 },
    pitching: {
      pitches,
      control: tool(control, control + Math.max(0, room * 0.6 + rng.normal(0, room * 0.3))),
      command: tool(command, command + Math.max(0, room * 0.7 + rng.normal(0, room * 0.3))),
      stamina: tool(stamina, stamina + Math.max(0, room * 0.3)),
      velocity: Math.round(velocity * 10) / 10,
    },
    ...unassigned(rng),
  };
}

/** Typical big-league age for a player of a given talent tier. */
export function randomAge(rng: Rng, mean = 28.5, sd = 3.4): number {
  return Math.round(clamp(rng.normal(mean, sd), 21, 40));
}
