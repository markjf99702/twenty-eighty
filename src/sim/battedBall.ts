import { DEG, clamp, normalCdf, sigmoid } from "../core/math";
import type { Park } from "../league/types";
import type { FieldPosition } from "../players/types";

/**
 * Batted-ball physics-lite.
 *
 * A ball in play is (exit velocity, launch angle, spray angle). From that we
 * estimate where it lands and how long it hangs, check it against the fences
 * and the nine fielders, and race the batter against the relay throw. The
 * result is a probability for each outcome rather than a single roll, so the
 * same function also yields expected stats (xwOBA) and defensive credit
 * (fielder vs. an average fielder on the same ball).
 *
 * Spray angle: 0 is straightaway center, negative toward left field
 * (-45 = the left-field line), positive toward right.
 */

export type BattedBallType = "GB" | "LD" | "FB" | "PU";
export type Fielder = FieldPosition | "P";

export interface BattedBall {
  ev: number;
  la: number;
  spray: number;
}

export interface FielderSkill {
  /** Range z at this position. */
  range: number;
  /** Arm z. */
  arm: number;
}

export type Defense = Record<Fielder, FielderSkill>;

export interface BipOdds {
  type: BattedBallType;
  out: number;
  single: number;
  double: number;
  triple: number;
  hr: number;
  /** Fielder responsible for the play (makes the catch, or the ball gets by him). */
  fielder: Fielder;
  /** Landing distance (air) or approximate depth reached (ground), feet. */
  distance: number;
  hangTime: number;
}

export const FIELD = {
  ground: {
    /** Angular reach (degrees) of an average infielder on an average-speed grounder. */
    reach: 14.5,
    rangePerZ: 0.09,
    /** Reach scales with (speedRef - ev) / speedScale: harder grounders are harder to reach. */
    speedRef: 120,
    speedScale: 32,
    softness: 1.7,
    pitcherReach: 3.5,
    /** Infield-hit log-odds once a grounder is fielded. */
    ifhBase: -2.75,
    ifhSpeed: 0.28,
    ifhSlow: 0.8,
    ifhEdge: 0.7,
    ifhLongThrow: 0.35,
    ifhShortThrow: -0.55,
    ifhPitcher: -1.4,
    /** Hard grounders down the line become doubles. */
    lineAngle: 30,
    lineEV: 85,
    lineDouble: 0.7,
    /** Very hard grounders through a hole occasionally skip past the outfielder. */
    gapEV: 97,
    gapDouble: 0.15,
  },
  air: {
    /** Carry at the optimal launch angle: ref + slope * (ev - 100) - curve * (ev - 100)^2. */
    carryRef: 374,
    carrySlope: 6.0,
    carryCurve: 0.03,
    optimalLA: 28,
    /** Below the optimal angle carry follows (sin 2θ / sin 2θ*)^lowExponent. */
    lowExponent: 0.5,
    highPenalty: 0.0005,
    minDistance: 15,
    altitudePerFt: 0.0000095,
    /** Hang time = no-drag flight time x a multiplier that grows from liners to fly balls. */
    hangMultLow: 0.95,
    hangMultHigh: 1.05,
    hangMax: 7.0,
    hrSigma: 9,
    /** Extra carry needed per foot of wall above 8 feet. */
    wallFt: 1.0,
    /** Top running speeds (ft/s), acceleration (ft/s^2) and read/reaction time (s). */
    ofSpeed: 28,
    ifSpeed: 25,
    speedPerZ: 1.2,
    ofAccel: 15,
    ifAccel: 16,
    ofReact: 0.45,
    ifReact: 0.3,
    catchSoftness: 7,
    /** Catch margin lost for balls reaching the warning track. */
    wallPenalty: 25,
    linerMaxHeight: 12,
    linerReach: 9.5,
    linerReachPerZ: 1.2,
    linerSoftness: 2,
    contactHeight: 3,
  },
  race: {
    home2second: 8.2,
    perZ2: 0.18,
    home2third: 11.9,
    perZ3: 0.28,
    sigma: 0.55,
    transfer: 1.1,
    armSpeed: 115,
    armPerZ: 8,
    /** Chasing speed of an outfielder / infielder running down a ball that fell in (ft/s). */
    chaseSpeed: 23,
    infieldChaseSpeed: 22,
    /** Extra time for throws long enough to need a cutoff man. */
    relayDistance: 200,
    relayTime: 0.4,
    /** After landing the ball rolls on at this share of its horizontal speed (liners skip, flies die). */
    rollShareLow: 0.65,
    rollShareHigh: 0.35,
    rollDecel: 10,
    pickup: 1.0,
    wallCarom: 0.8,
  },
};

/** Fielder starting spots: [spray angle (deg), depth (ft)]. No shifts - banned since 2023. */
export const FIELDER_SPOTS: Record<Fielder, [number, number]> = {
  P: [0, 55],
  C: [0, 3],
  "1B": [38, 108],
  "2B": [14, 150],
  SS: [-14, 148],
  "3B": [-37, 112],
  LF: [-28, 300],
  CF: [0, 322],
  RF: [28, 300],
};

const FIELDERS: readonly Fielder[] = ["P", "C", "1B", "2B", "SS", "3B", "LF", "CF", "RF"];
const RETRIEVERS: readonly Fielder[] = ["1B", "2B", "SS", "3B", "LF", "CF", "RF"];
const OUTFIELD: ReadonlySet<Fielder> = new Set(["LF", "CF", "RF"]);
const GROUND_FIELDERS: readonly Fielder[] = ["3B", "SS", "2B", "1B"];

const SECOND_BASE: [number, number] = [0, 127.3];
const THIRD_BASE: [number, number] = [-63.6, 63.6];

export function battedBallType(la: number): BattedBallType {
  if (la < 10) return "GB";
  if (la < 25) return "LD";
  if (la < 50) return "FB";
  return "PU";
}

const SIN_OPT = Math.sin(2 * FIELD.air.optimalLA * DEG);

export function carryDistance(ev: number, la: number, altitude = 0): number {
  const A = FIELD.air;
  const dev = ev - 100;
  const base = A.carryRef + A.carrySlope * dev - A.carryCurve * dev * dev;
  let factor: number;
  if (la < A.optimalLA) {
    factor = Math.pow(Math.max(0, Math.sin(2 * Math.max(0, la) * DEG)) / SIN_OPT, A.lowExponent);
  } else {
    const off = la - A.optimalLA;
    factor = 1 - A.highPenalty * off * off;
  }
  return Math.max(A.minDistance, base * Math.max(0.08, factor) * (1 + A.altitudePerFt * altitude));
}

/** Ground a fielder can cover in `t` seconds: react, accelerate, then run at top speed. */
export function coverage(t: number, speed: number, accel: number, react: number): number {
  const tt = t - react;
  if (tt <= 0) return 0;
  const tAcc = speed / accel;
  return tt < tAcc ? 0.5 * accel * tt * tt : speed * (tt - tAcc) + 0.5 * speed * tAcc;
}

export function hangTime(ev: number, la: number): number {
  const A = FIELD.air;
  const vy = ev * 1.467 * Math.sin(Math.max(0, la) * DEG);
  const mult = A.hangMultLow + (A.hangMultHigh - A.hangMultLow) * clamp((la - 10) / 20, 0, 1);
  return Math.min(A.hangMax, ((2 * vy) / 32.2) * mult);
}

/**
 * When an uncaught ball lands, it keeps rolling away from the plate along its
 * spray line. Find when the quickest outfielder can intercept it.
 */
function retrievalTime(
  x: number,
  y: number,
  spray: number,
  t: number,
  horizSpeed: number,
  fenceDist: number,
  def: Defense,
): { time: number; fielder: Fielder; ball: [number, number]; wall: boolean } {
  const R = FIELD.race;
  const A = FIELD.air;
  const dx = Math.sin(spray * DEG);
  const dy = Math.cos(spray * DEG);
  const d0 = Math.hypot(x, y);
  const v0 = horizSpeed;
  const stopTime = v0 / R.rollDecel;
  const maxRoll = Math.max(0, Math.min(v0 * stopTime - 0.5 * R.rollDecel * stopTime * stopTime, fenceDist - d0));
  let best = { time: Infinity, fielder: "CF" as Fielder, ball: [x, y] as [number, number], wall: false };
  for (const f of RETRIEVERS) {
    const [ang, depth] = FIELDER_SPOTS[f];
    const fx = depth * Math.sin(ang * DEG);
    const fy = depth * Math.cos(ang * DEG);
    const speed = (OUTFIELD.has(f) ? R.chaseSpeed : R.infieldChaseSpeed) + A.speedPerZ * def[f].range;
    for (let tau = 0; tau <= 8; tau += 0.1) {
      const tr = Math.min(tau, stopTime);
      const roll = Math.min(maxRoll, v0 * tr - 0.5 * R.rollDecel * tr * tr);
      const bx = x + dx * roll;
      const by = y + dy * roll;
      const arrive = A.ofReact + Math.hypot(bx - fx, by - fy) / speed;
      if (arrive <= t + tau) {
        if (t + tau < best.time) best = { time: t + tau, fielder: f, ball: [bx, by], wall: roll >= maxRoll - 1 && maxRoll < v0 * stopTime };
        break;
      }
    }
  }
  best.time += R.pickup + (best.wall ? R.wallCarom : 0);
  return best;
}

/** Linear interpolation of a park's five reference values by spray angle. */
function atAngle(values: readonly number[], spray: number): number {
  const pos = (clamp(spray, -45, 45) + 45) / 22.5;
  const i = Math.min(3, Math.floor(pos));
  const f = pos - i;
  return values[i]! * (1 - f) + values[i + 1]! * f;
}

export const fenceDistance = (park: Park, spray: number) => atAngle(park.dims, spray);
export const wallHeight = (park: Park, spray: number) => atAngle(park.walls, spray);

function extraBaseOdds(
  x: number,
  y: number,
  retrieve: number,
  armZ: number,
  runnerSpeedZ: number,
): { double: number; triple: number } {
  const R = FIELD.race;
  const armSpeed = R.armSpeed + R.armPerZ * armZ;
  const throwTime = (dist: number) => dist / armSpeed + R.transfer + (dist > R.relayDistance ? R.relayTime : 0);
  const throw2 = throwTime(Math.hypot(x - SECOND_BASE[0], y - SECOND_BASE[1]));
  const throw3 = throwTime(Math.hypot(x - THIRD_BASE[0], y - THIRD_BASE[1]));
  const t2 = R.home2second - R.perZ2 * runnerSpeedZ;
  const t3 = R.home2third - R.perZ3 * runnerSpeedZ;
  const double = normalCdf((retrieve + throw2 - t2) / R.sigma);
  const triple = Math.min(double, normalCdf((retrieve + throw3 - t3) / R.sigma));
  return { double, triple };
}

function groundBallOdds(bb: BattedBall, def: Defense, speedZ: number): BipOdds {
  const G = FIELD.ground;
  const timeFactor = clamp((G.speedRef - bb.ev) / G.speedScale, 0.35, 1.6);
  let best: Fielder = "SS";
  let bestMargin = -Infinity;
  for (const f of GROUND_FIELDERS) {
    const reach = G.reach * (1 + G.rangePerZ * def[f].range) * timeFactor;
    const margin = reach - Math.abs(bb.spray - FIELDER_SPOTS[f][0]);
    if (margin > bestMargin) {
      bestMargin = margin;
      best = f;
    }
  }
  if (bb.ev < 95) {
    const margin = G.pitcherReach * timeFactor - Math.abs(bb.spray);
    if (margin > bestMargin) {
      bestMargin = margin;
      best = "P";
    }
  }

  const pField = sigmoid(bestMargin / G.softness);
  const slow = bb.ev < 80 ? (80 - bb.ev) / 10 : 0;
  const edge = bestMargin < 3 ? clamp((3 - bestMargin) / 3, 0, 1.5) : 0;
  const throwAdj = best === "P" ? G.ifhPitcher : best === "SS" || best === "3B" ? G.ifhLongThrow : G.ifhShortThrow;
  const pIfh = sigmoid(G.ifhBase + G.ifhSpeed * speedZ + G.ifhSlow * slow + G.ifhEdge * edge + throwAdj);

  const downLine = Math.abs(bb.spray) > G.lineAngle && bb.ev > G.lineEV;
  const pThrough = 1 - pField;
  const pDouble = pThrough * (downLine ? G.lineDouble : bb.ev > G.gapEV ? G.gapDouble : 0);
  const single = pField * pIfh + pThrough - pDouble;
  return {
    type: "GB",
    out: pField * (1 - pIfh),
    single,
    double: pDouble,
    triple: 0,
    hr: 0,
    fielder: best,
    distance: 120 + Math.max(0, bb.ev - 60) * 2,
    hangTime: 0,
  };
}

export function battedBallOdds(bb: BattedBall, park: Park, def: Defense, speedZ: number): BipOdds {
  const type = battedBallType(bb.la);
  if (type === "GB") return groundBallOdds(bb, def, speedZ);

  const A = FIELD.air;
  const R = FIELD.race;
  const d = carryDistance(bb.ev, bb.la, park.altitude);
  const t = hangTime(bb.ev, bb.la);
  const x = d * Math.sin(bb.spray * DEG);
  const y = d * Math.cos(bb.spray * DEG);

  const needed = fenceDistance(park, bb.spray) + A.wallFt * (wallHeight(park, bb.spray) - 8);
  const pHr = bb.la >= 15 ? normalCdf((d - needed) / A.hrSigma) : 0;
  const nearWall = d > needed - 12;

  let p1 = 0;
  let p2 = 0;
  let f1: Fielder = "CF";
  let nearestOf: Fielder = "CF";
  let nearestOfDist = Infinity;

  for (const f of FIELDERS) {
    // The catcher only plays pop-ups near the plate.
    if (f === "C" && (type !== "PU" || d > 90)) continue;
    const [ang, depth] = FIELDER_SPOTS[f];
    const fx = depth * Math.sin(ang * DEG);
    const fy = depth * Math.cos(ang * DEG);
    const dist = Math.hypot(x - fx, y - fy);
    const isOf = OUTFIELD.has(f);
    const speed = (isOf ? A.ofSpeed : A.ifSpeed) + A.speedPerZ * def[f].range;
    let p: number;
    if (!isOf && type === "LD" && d > depth) {
      // A liner that reaches this infielder's depth: catchable only if it's
      // low enough to snag and close enough laterally.
      const vx = bb.ev * 1.467 * Math.cos(bb.la * DEG);
      const tt = depth / vx;
      const h = A.contactHeight + depth * Math.tan(bb.la * DEG) - 16.1 * tt * tt;
      if (h > A.linerMaxHeight || h < 0) {
        p = 0;
      } else {
        const lateral = depth * Math.abs(Math.sin((bb.spray - ang) * DEG));
        p = sigmoid((A.linerReach + A.linerReachPerZ * def[f].range - lateral) / A.linerSoftness);
      }
    } else {
      let margin = (isOf ? coverage(t, speed, A.ofAccel, A.ofReact) : coverage(t, speed, A.ifAccel, A.ifReact)) - dist;
      if (nearWall) margin -= A.wallPenalty;
      p = sigmoid(margin / A.catchSoftness);
    }
    if (p > p1) {
      p2 = p1;
      p1 = p;
      f1 = f;
    } else if (p > p2) {
      p2 = p;
    }
    if (isOf && dist < nearestOfDist) {
      nearestOfDist = dist;
      nearestOf = f;
    }
  }

  const pCatch = 1 - (1 - p1) * (1 - p2);
  const inPlay = 1 - pHr;
  const pHit = inPlay * (1 - pCatch);

  let double = 0;
  let triple = 0;
  if (pHit > 0.001 && d > 140) {
    const share = R.rollShareLow + (R.rollShareHigh - R.rollShareLow) * clamp((bb.la - 15) / 20, 0, 1);
    const horiz = bb.ev * 1.467 * Math.cos(bb.la * DEG) * 0.7 * share;
    const r = retrievalTime(x, y, bb.spray, t, horiz, fenceDistance(park, bb.spray), def);
    const xb = extraBaseOdds(r.ball[0], r.ball[1], r.time, def[r.fielder].arm, speedZ);
    double = pHit * (xb.double - xb.triple);
    triple = pHit * xb.triple;
  }

  return {
    type,
    out: inPlay * pCatch,
    single: pHit - double - triple,
    double,
    triple,
    hr: pHr,
    fielder: pCatch > 0.05 ? f1 : nearestOf,
    distance: d,
    hangTime: t,
  };
}

/** Statcast barrel: 98+ mph with a launch-angle window that widens with exit velocity. */
export function isBarrel(ev: number, la: number): boolean {
  if (ev < 98) return false;
  const lo = Math.max(8, 26 - (ev - 98));
  const hi = Math.min(50, 30 + (ev - 98) * 1.2);
  return la >= lo && la <= hi;
}
