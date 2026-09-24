import { Rng } from "../core/rng";
import type { League, Park } from "../league/types";
import type { Player } from "../players/types";
import { battedBallOdds, type Defense } from "../sim/battedBall";
import { ENGINE } from "../sim/constants";
import { simulatePitch, type PitchContext } from "../sim/pitch";
import { batterProfile, battingSide, pitcherProfile, type BatterProfile, type PitcherProfile } from "../sim/profiles";

/**
 * "What does a 60 mean?" - simulate plate appearances for a synthetic player
 * against the league's real pitchers (or hitters) and report rate stats.
 * This is how the game translates grades into the stat lines scouts quote,
 * and it's the tightest loop for calibrating per-tool effect sizes.
 */

export interface RateLine {
  PA: number;
  AVG: number;
  OBP: number;
  SLG: number;
  ISO: number;
  Kpct: number;
  BBpct: number;
  HRper600: number;
  BABIP: number;
  /** Runs above average per 600 PA using simple linear weights. */
  runsPer600: number;
}

const LW = { BB: 0.69, HBP: 0.72, "1B": 0.88, "2B": 1.25, "3B": 1.58, HR: 2.03, out: 0 };

interface Tally {
  pa: number;
  ab: number;
  h: number;
  b1: number;
  b2: number;
  b3: number;
  hr: number;
  bb: number;
  hbp: number;
  k: number;
}

function simulatePA(ctx: PitchContext, park: Park, def: Defense, rng: Rng, t: Tally): void {
  let balls = 0;
  let strikes = 0;
  t.pa++;
  for (;;) {
    const o = simulatePitch(ctx, balls, strikes, rng);
    if (o.kind === "ball") {
      if (++balls === 4) {
        t.bb++;
        return;
      }
    } else if (o.kind === "called" || o.kind === "whiff") {
      if (++strikes === 3) {
        t.k++;
        t.ab++;
        return;
      }
    } else if (o.kind === "foul") {
      if (strikes < 2) strikes++;
    } else if (o.kind === "hbp") {
      t.hbp++;
      return;
    } else if (o.kind === "foulOut") {
      t.ab++;
      return;
    } else {
      t.ab++;
      const odds = battedBallOdds(o.ball!, park, def, ctx.batter.speed);
      const r = rng.next();
      if (r < odds.out) return;
      t.h++;
      if (r < odds.out + odds.single) t.b1++;
      else if (r < odds.out + odds.single + odds.double) t.b2++;
      else if (r < odds.out + odds.single + odds.double + odds.triple) t.b3++;
      else t.hr++;
      return;
    }
  }
}

function toLine(t: Tally): RateLine {
  const tb = t.b1 + 2 * t.b2 + 3 * t.b3 + 4 * t.hr;
  const avg = t.h / t.ab;
  const slg = tb / t.ab;
  const lwRuns =
    LW.BB * t.bb + LW.HBP * t.hbp + LW["1B"] * t.b1 + LW["2B"] * t.b2 + LW["3B"] * t.b3 + LW.HR * t.hr;
  return {
    PA: t.pa,
    AVG: avg,
    OBP: (t.h + t.bb + t.hbp) / t.pa,
    SLG: slg,
    ISO: slg - avg,
    Kpct: t.k / t.pa,
    BBpct: t.bb / t.pa,
    HRper600: (600 * t.hr) / t.pa,
    BABIP: (t.h - t.hr) / (t.ab - t.k - t.hr),
    runsPer600: (600 * lwRuns) / t.pa,
  };
}

const emptyTally = (): Tally => ({ pa: 0, ab: 0, h: 0, b1: 0, b2: 0, b3: 0, hr: 0, bb: 0, hbp: 0, k: 0 });

/** Pitchers weighted by their share of league batters faced (rotation ~ 3x a reliever). */
function pitcherPool(league: League): { profiles: PitcherProfile[]; weights: number[] } {
  const profiles: PitcherProfile[] = [];
  const weights: number[] = [];
  for (const t of league.teams) {
    for (const id of t.depth.rotation) {
      profiles.push(pitcherProfile(league.players[id]!));
      weights.push(3);
    }
    for (const id of t.depth.bullpen) {
      profiles.push(pitcherProfile(league.players[id]!));
      weights.push(1);
    }
  }
  return { profiles, weights };
}

function hitterPool(league: League): BatterProfile[] {
  const out: BatterProfile[] = [];
  for (const t of league.teams) {
    for (const id of [...Object.values(t.depth.starters), t.depth.dh]) out.push(batterProfile(league.players[id]!));
  }
  return out;
}

export function batterRates(
  batter: BatterProfile,
  league: League,
  park: Park,
  def: Defense,
  pa: number,
  seed = "chart",
): RateLine {
  const rng = new Rng(seed);
  const pool = pitcherPool(league);
  const t = emptyTally();
  for (let i = 0; i < pa; i++) {
    const pitcher = pool.profiles[rng.weightedIndex(pool.weights)]!;
    const side = battingSide(batter.bats, pitcher.throws);
    const P = ENGINE.platoon;
    const ctx: PitchContext = {
      batter,
      pitcher,
      fatigue: 0,
      batterBoost: side === pitcher.throws ? P.same : P.opposite,
      pullSign: side === "R" ? -1 : 1,
      catcherFraming: def.C.range,
      avgCatcherFraming: def.C.range,
      runnersOn: false,
    };
    simulatePA(ctx, park, def, rng, t);
  }
  return toLine(t);
}

export function pitcherRates(
  pitcher: PitcherProfile,
  league: League,
  park: Park,
  def: Defense,
  pa: number,
  seed = "chart",
): RateLine {
  const rng = new Rng(seed);
  const hitters = hitterPool(league);
  const t = emptyTally();
  for (let i = 0; i < pa; i++) {
    const batter = hitters[Math.floor(rng.next() * hitters.length)]!;
    const side = battingSide(batter.bats, pitcher.throws);
    const P = ENGINE.platoon;
    const ctx: PitchContext = {
      batter,
      pitcher,
      fatigue: 0,
      batterBoost: side === pitcher.throws ? P.same : P.opposite,
      pullSign: side === "R" ? -1 : 1,
      catcherFraming: def.C.range,
      avgCatcherFraming: def.C.range,
      runnersOn: false,
    };
    simulatePA(ctx, park, def, rng, t);
  }
  return toLine(t);
}

/** An all-50 hitter (average tools, neutral swing). */
export function averageBatter(): BatterProfile {
  return { id: -1, bats: "R", contact: 0, power: 0, eye: 0, speed: 0, launch: 0, pull: 0, aggression: 0 };
}

/** An average starter: 50 fastball / slider / changeup, 50 control and command. */
export function averagePitcher(): PitcherProfile {
  return {
    id: -2,
    throws: "R",
    control: 0,
    command: 0,
    stamina: 55,
    pitches: [
      { type: "FF", z: 0, usage: 1, fastball: true },
      { type: "SL", z: 0, usage: 0.6, fastball: false },
      { type: "CH", z: 0, usage: 0.4, fastball: false },
    ],
  };
}

export const profileOf = (p: Player) => (p.pitching ? pitcherProfile(p) : batterProfile(p));
