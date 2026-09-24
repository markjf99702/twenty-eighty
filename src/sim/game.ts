import { sigmoid } from "../core/math";
import type { Rng } from "../core/rng";
import type { League, Park, Team } from "../league/types";
import { armZ, defenseGrade, defenseZ } from "../players/defense";
import { injuryChance, rollInjury, INJURY_RATES } from "../players/injuries";
import type { FieldPosition, Injury, LineupPosition } from "../players/types";
import { FIELD_POSITIONS } from "../players/types";
import {
  addBatting,
  addFielding,
  addPitching,
  emptyBatting,
  emptyFielding,
  emptyPitching,
  LineBook,
  type BattingLine,
  type FieldingLine,
  type PitchingLine,
} from "../stats/lines";
import { baseOutState, type EventCode, type RunTracker } from "../stats/runExpectancy";
import {
  battedBallOdds,
  isBarrel,
  type BattedBall,
  type BattedBallType,
  type BipOdds,
  type Defense,
  type Fielder,
} from "./battedBall";
import { ENGINE, type Region } from "./constants";
import { simulatePitch, type PitchContext, type PitchOutcome } from "./pitch";
import {
  batterProfile,
  battingSide,
  pitcherProfile,
  pitchLimit,
  type BatterProfile,
  type PitcherProfile,
} from "./profiles";

export interface LineupSlot {
  id: number;
  pos: LineupPosition;
}

export interface TeamGameSetup {
  team: Team;
  /** Batting order (9) with each hitter's defensive position (one DH). */
  lineup: LineupSlot[];
  /** Healthy bench players available as substitutes. */
  bench?: number[];
  starter: number;
  /** The whole bullpen, best first. */
  bullpen: number[];
  /** Relievers who shouldn't pitch today (used only in an emergency). */
  unavailable?: ReadonlySet<number>;
  /** Pre-game fatigue (z) from recent workload, by pitcher id. */
  fatigue?: ReadonlyMap<number, number>;
  /** Ballpark when this club is home (defaults to the MLB park). */
  park?: Park;
}

/** League-wide baserunning tallies, used to calibrate the running game. */
export interface RunningCounters {
  secondOnSingle: number;
  scoredFromSecond: number;
  firstOnSingle: number;
  firstToThird: number;
  firstOnDouble: number;
  scoredFromFirst: number;
  dpOpportunities: number;
  doublePlays: number;
  sacFlyOpportunities: number;
  sacFlies: number;
}

export const emptyRunningCounters = (): RunningCounters => ({
  secondOnSingle: 0,
  scoredFromSecond: 0,
  firstOnSingle: 0,
  firstToThird: 0,
  firstOnDouble: 0,
  scoredFromFirst: 0,
  dpOpportunities: 0,
  doublePlays: 0,
  sacFlyOpportunities: 0,
  sacFlies: 0,
});

/** Launch-angle buckets used for calibration against Statcast's published splits. */
export const LA_BUCKETS = ["<10", "10-20", "20-30", "30-40", "40-50", "50+"] as const;
export type LaBucket = (typeof LA_BUCKETS)[number];

export function laBucket(la: number): LaBucket {
  if (la < 10) return "<10";
  if (la < 20) return "10-20";
  if (la < 30) return "20-30";
  if (la < 40) return "30-40";
  if (la < 50) return "40-50";
  return "50+";
}

export interface OutcomeTally {
  n: number;
  "1B": number;
  "2B": number;
  "3B": number;
  HR: number;
  E: number;
}

/** League-wide outcome tallies by launch-angle bucket, for calibration. */
export type BattedBallCounters = Record<LaBucket, OutcomeTally>;

export const emptyBattedBallCounters = (): BattedBallCounters => {
  const out = {} as BattedBallCounters;
  for (const b of LA_BUCKETS) out[b] = { n: 0, "1B": 0, "2B": 0, "3B": 0, HR: 0, E: 0 };
  return out;
};

export interface SimEnv {
  league: League;
  /** League-average defense at each position; the baseline for defensive credit and xStats. */
  avgDefense: Defense;
  neutralPark: Park;
  tracker?: RunTracker;
  running?: RunningCounters;
  battedBalls?: BattedBallCounters;
  /** Compute expected stats and defensive credit (skipped in the minors to save time). */
  detailed?: boolean;
}

export interface GameResult {
  awayId: number;
  homeId: number;
  /** [away, home] */
  score: [number, number];
  hits: [number, number];
  errors: [number, number];
  innings: number;
  lineScore: [number[], number[]];
  winningPitcher: number | null;
  losingPitcher: number | null;
  savePitcher: number | null;
  starters: [number, number];
  /** Starting lineups, [away, home]. */
  lineups: [LineupSlot[], LineupSlot[]];
  /** Everyone who batted in each lineup slot, starter first, [away, home]. */
  battingOrder: [SlotEntry[][], SlotEntry[][]];
  /** Injuries suffered during the game. */
  injuries: { playerId: number; injury: Injury }[];
  pitchersUsed: [number[], number[]];
  /** Pitches thrown by each pitcher who appeared. */
  pitchCounts: Map<number, number>;
  batting: LineBook<BattingLine>;
  pitching: LineBook<PitchingLine>;
  fielding: LineBook<FieldingLine>;
}

export type SubType = "PH" | "PR" | "DEF" | "INJ";

export interface SlotEntry extends LineupSlot {
  /** How he entered the game (absent for starters). */
  sub?: SubType;
  inning?: number;
}

interface Runner {
  id: number;
  /** Pitcher charged if this runner scores. */
  pitcher: number;
  unearned: boolean;
  speed: number;
  aggression: number;
}

interface Stint {
  id: number;
  profile: PitcherProfile;
  starter: boolean;
  pitches: number;
  limit: number;
  preFatigue: number;
  outs: number;
  runs: number;
  battersFaced: number;
  entryLead: number;
  /** Entered in a save situation (lead of 1-3, or the tying run at least on deck). */
  entrySave: boolean;
  /** Entered with the tying run on base, at bat, or on deck. */
  entryTying: boolean;
  exitLead: number;
  blew: boolean;
  faced: Map<number, number>;
  /** Pitch count at which an arm injury strikes during this outing, if one does. */
  injuryAtPitch: number | null;
}

interface Side {
  setup: TeamGameSetup;
  order: SlotEntry[];
  slots: SlotEntry[][];
  bench: number[];
  defensiveSubs: number;
  batters: BatterProfile[];
  next: number;
  defense: Record<Fielder, number>;
  defSkill: Defense;
  catcherFraming: number;
  catcherArm: number;
  pitcher: Stint;
  stints: Stint[];
  bullpenLeft: number[];
  line: number[];
  hits: number;
  errors: number;
}

const OUTFIELD: ReadonlySet<Fielder> = new Set(["LF", "CF", "RF"]);
const OUT_KEYS: Record<FieldPosition, keyof FieldingLine> = {
  C: "outsC",
  "1B": "outs1B",
  "2B": "outs2B",
  "3B": "outs3B",
  SS: "outsSS",
  LF: "outsLF",
  CF: "outsCF",
  RF: "outsRF",
};

type Hit = "1B" | "2B" | "3B" | "HR";

export class GameSim {
  private readonly sides: [Side, Side];
  private readonly batting = new LineBook<BattingLine>(emptyBatting, { add: addBatting });
  private readonly pitching = new LineBook<PitchingLine>(emptyPitching, { add: addPitching });
  private readonly fielding = new LineBook<FieldingLine>(emptyFielding, { add: addFielding });
  private readonly park: Park;
  private readonly score: [number, number] = [0, 0];
  private inning = 1;
  private half = 0;
  private outs = 0;
  private bases: [Runner | null, Runner | null, Runner | null] = [null, null, null];
  private walkoff = false;
  private runsSinceMark = 0;
  private markState = 0;
  private winCandidate: [number | null, number | null] = [null, null];
  private loseCandidate: [number | null, number | null] = [null, null];
  private readonly injuries: { playerId: number; injury: Injury }[] = [];
  private readonly hurt = new Set<number>();

  constructor(
    private readonly env: SimEnv,
    away: TeamGameSetup,
    home: TeamGameSetup,
    private readonly rng: Rng,
    private readonly day = 0,
  ) {
    this.park = home.park ?? home.team.park;
    this.sides = [this.makeSide(away), this.makeSide(home)];
  }

  private makeSide(setup: TeamGameSetup): Side {
    const players = this.env.league.players;
    const defense = {} as Record<Fielder, number>;
    for (const slot of setup.lineup) if (slot.pos !== "DH") defense[slot.pos] = slot.id;
    defense.P = setup.starter;
    const defSkill = {} as Defense;
    for (const pos of FIELD_POSITIONS) {
      const p = players[defense[pos]]!;
      defSkill[pos] = { range: defenseZ(p, pos), arm: armZ(p) };
    }
    defSkill.P = { range: 0, arm: 0 };
    const catcher = players[defense.C]!;
    const inLineup = new Set(setup.lineup.map((s) => s.id));

    for (const slot of setup.lineup) {
      this.batting.get(slot.id).G += 1;
      if (slot.pos === "DH") this.fielding.get(slot.id).gamesDH += 1;
    }
    const starter = this.newStint(setup, setup.starter, true, 0, 0);
    this.pitching.get(setup.starter).GS += 1;
    const order: SlotEntry[] = setup.lineup.map((s) => ({ ...s }));
    return {
      setup,
      order,
      slots: order.map((s) => [s]),
      bench: (setup.bench ?? []).filter((id) => !inLineup.has(id)),
      defensiveSubs: 0,
      batters: setup.lineup.map((s) => batterProfile(players[s.id]!)),
      next: 0,
      defense,
      defSkill,
      catcherFraming: defenseZ(catcher, "C"),
      catcherArm: armZ(catcher),
      pitcher: starter,
      stints: [starter],
      bullpenLeft: setup.bullpen.filter((id) => id !== setup.starter),
      line: [],
      hits: 0,
      errors: 0,
    };
  }

  private newStint(setup: TeamGameSetup, id: number, starter: boolean, lead: number, runners: number): Stint {
    const player = this.env.league.players[id]!;
    const profile = pitcherProfile(player);
    const preFatigue = setup.fatigue?.get(id) ?? 0;
    const jitter = starter ? this.rng.normal(0, ENGINE.fatigue.limitJitter) : this.rng.normal(0, 2);
    this.pitching.get(id).G += 1;
    // Arm injuries: a per-appearance risk (strikes at some point in the outing)
    // plus a per-pitch risk checked as he throws.
    const risk = injuryChance(player, 0);
    const injuryAtPitch = this.rng.chance(risk) ? this.rng.int(1, starter ? 90 : 25) : null;
    return {
      id,
      profile,
      starter,
      pitches: 0,
      limit: pitchLimit(profile.stamina) * (1 - 0.35 * preFatigue) + jitter,
      preFatigue,
      outs: 0,
      runs: 0,
      battersFaced: 0,
      entryLead: lead,
      entrySave: !starter && lead >= 1 && (lead <= 3 || lead <= runners + 2),
      entryTying: !starter && lead >= 1 && lead <= runners + 2,
      exitLead: lead,
      blew: false,
      faced: new Map(),
      injuryAtPitch,
    };
  }

  // -------------------------------------------------------------------------
  // Game flow

  run(): GameResult {
    for (;;) {
      this.playHalf(0);
      if (this.inning >= 9 && this.score[1] > this.score[0]) break;
      this.playHalf(1);
      if (this.walkoff) break;
      if (this.inning >= 9 && this.score[0] !== this.score[1]) break;
      this.inning++;
    }
    return this.finish();
  }

  private get battingSide(): Side {
    return this.sides[this.half]!;
  }

  private get fieldingSide(): Side {
    return this.sides[1 - this.half]!;
  }

  /** Lead from the perspective of the fielding (pitching) team. */
  private get fieldingLead(): number {
    return this.score[1 - this.half]! - this.score[this.half]!;
  }

  private state(): number {
    const b = this.bases;
    return baseOutState(this.outs, (b[0] ? 1 : 0) | (b[1] ? 2 : 0) | (b[2] ? 4 : 0));
  }

  private mark(): void {
    this.markState = this.state();
    this.runsSinceMark = 0;
  }

  private record(code: EventCode): void {
    this.env.tracker?.record(this.markState, this.state(), this.runsSinceMark, code);
    this.mark();
  }

  private playHalf(half: number): void {
    this.half = half;
    this.outs = 0;
    this.bases = [null, null, null];
    const bat = this.battingSide;
    const field = this.fieldingSide;
    const runsBefore = this.score[half]!;

    this.maybeChangePitcher(true);
    this.considerDefensiveSubs();
    if (this.inning >= 10) {
      // Extra innings start with the previous hitter on second (unearned if he scores).
      const b = bat.batters[(bat.next + 8) % 9]!;
      this.bases[1] = { id: b.id, pitcher: field.pitcher.id, unearned: true, speed: b.speed, aggression: b.aggression };
    }
    this.mark();
    while (this.outs < 3 && !this.walkoff) {
      this.maybeChangePitcher(false);
      this.considerPinchHitter();
      this.plateAppearance();
      if (this.outs < 3 && !this.walkoff) this.considerPinchRunner();
    }
    this.env.tracker?.endHalf(this.outs >= 3);

    const outsMade = Math.min(3, this.outs);
    for (const pos of FIELD_POSITIONS) this.fielding.get(field.defense[pos])[OUT_KEYS[pos]] += outsMade;
    bat.line.push(this.score[half]! - runsBefore);
  }

  // -------------------------------------------------------------------------
  // Plate appearance

  private plateAppearance(): void {
    const bat = this.battingSide;
    const field = this.fieldingSide;
    const batter = bat.batters[bat.next]!;
    const stint = field.pitcher;
    const side = battingSide(batter.bats, stint.profile.throws);
    const seen = stint.faced.get(batter.id) ?? 0;
    const P = ENGINE.platoon;
    const boost =
      (side === stint.profile.throws ? P.same : P.opposite) +
      ENGINE.timesThrough[Math.min(seen, ENGINE.timesThrough.length - 1)]!;

    const ctx: PitchContext = {
      batter,
      pitcher: stint.profile,
      fatigue: 0,
      batterBoost: boost,
      pullSign: side === "R" ? -1 : 1,
      catcherFraming: field.catcherFraming,
      avgCatcherFraming: this.env.avgDefense.C.range,
      runnersOn: false,
    };

    let balls = 0;
    let strikes = 0;
    for (;;) {
      if (this.tryStolenBase()) {
        if (this.outs >= 3) return; // caught stealing ended the inning; batter leads off next time
      }
      ctx.fatigue = this.fatigueOf(stint);
      ctx.runnersOn = this.bases[0] !== null || this.bases[1] !== null || this.bases[2] !== null;
      const o = simulatePitch(ctx, balls, strikes, this.rng);
      stint.pitches++;
      if (stint.injuryAtPitch === null && this.rng.chance(INJURY_RATES.pitcherPerPitch * this.riskOf(stint.id))) {
        stint.injuryAtPitch = stint.pitches;
      }
      this.recordPitch(batter.id, stint.id, o, field);

      if (o.kind === "ball") {
        if (o.wildPitch) {
          this.wildPitch();
          if (this.walkoff) return;
        }
        if (++balls === 4) {
          this.walk(batter, "BB");
          break;
        }
      } else if (o.kind === "called" || o.kind === "whiff") {
        if (++strikes === 3) {
          this.strikeout(batter);
          break;
        }
      } else if (o.kind === "foul") {
        if (strikes < 2) strikes++;
      } else if (o.kind === "foulOut") {
        this.foulOut(batter, field);
        break;
      } else if (o.kind === "hbp") {
        this.walk(batter, "HBP");
        break;
      } else {
        this.ballInPlay(batter, o.ball!);
        break;
      }
    }
    stint.faced.set(batter.id, seen + 1);
    stint.battersFaced++;
    this.pitching.get(stint.id).BF += 1;
    this.batting.get(batter.id).PA += 1;
    const slot = bat.next;
    bat.next = (bat.next + 1) % 9;
    this.maybeInjureHitter(bat, slot);
  }

  private fatigueOf(stint: Stint): number {
    const F = ENGINE.fatigue;
    return Math.min(F.max, stint.preFatigue + Math.max(0, stint.pitches - (stint.limit - F.window)) * F.perPitch);
  }

  private recordPitch(batterId: number, pitcherId: number, o: PitchOutcome, field: Side): void {
    const b = this.batting.get(batterId);
    const p = this.pitching.get(pitcherId);
    const inZone = zoneShare(o.region);
    const contact = o.swung && o.kind !== "whiff";
    b.pitches++;
    b.zonePitches += inZone;
    b.outPitches += 1 - inZone;
    p.pitches++;
    p.zonePitches += inZone;
    p.outPitches += 1 - inZone;
    if (o.swung) {
      b.zoneSwings += inZone;
      b.outSwings += 1 - inZone;
      p.swings++;
      p.outSwings += 1 - inZone;
      if (contact) {
        b.zoneContact += inZone;
        b.outContact += 1 - inZone;
      }
    }
    if (o.kind === "whiff") p.whiffs++;
    if (o.kind === "called") p.calledStrikes++;
    if (o.kind !== "ball" && o.kind !== "hbp") p.strikes++;
    if (o.framing) {
      const c = this.fielding.get(field.defense.C);
      c.framingExpected += o.framing.average;
      if (o.kind === "called") c.framingActual += 1;
    }
  }

  // -------------------------------------------------------------------------
  // Outcomes

  private addOut(): void {
    this.outs++;
    const stint = this.fieldingSide.pitcher;
    stint.outs++;
    this.pitching.get(stint.id).outs++;
  }

  private runnerFor(b: BatterProfile, unearned = false): Runner {
    return { id: b.id, pitcher: this.fieldingSide.pitcher.id, unearned, speed: b.speed, aggression: b.aggression };
  }

  private scoreRun(r: Runner, rbiTo: number | null, errorPlay = false): void {
    const half = this.half;
    const leadBefore = this.score[half]! - this.score[1 - half]!;
    this.score[half]!++;
    this.runsSinceMark++;
    this.batting.get(r.id).R++;
    const pl = this.pitching.get(r.pitcher);
    pl.R++;
    if (!r.unearned && !errorPlay) pl.ER++;
    if (rbiTo !== null) this.batting.get(rbiTo).RBI++;
    const field = this.fieldingSide;
    const stint = field.stints.find((s) => s.id === r.pitcher);
    if (stint) stint.runs++;

    const leadAfter = leadBefore + 1;
    if (leadBefore <= 0 && leadAfter > 0) {
      this.winCandidate[half] = this.battingSide.pitcher.id;
      this.loseCandidate[1 - half] = r.pitcher;
    }
    if (leadBefore < 0 && leadAfter >= 0) {
      // The fielding team just lost its lead: its current reliever blew it.
      const cur = field.pitcher;
      if (cur.entrySave) cur.blew = true;
      this.winCandidate[1 - half] = null;
    }
    if (half === 1 && this.inning >= 9 && this.score[1] > this.score[0]) this.walkoff = true;
  }

  private walk(batter: BatterProfile, code: "BB" | "HBP"): void {
    const runner = this.runnerFor(batter);
    const [r1, r2, r3] = this.bases;
    if (r1) {
      if (r2) {
        if (r3) this.scoreRun(r3, batter.id);
        this.bases[2] = r2;
      }
      this.bases[1] = r1;
    }
    this.bases[0] = runner;
    if (code === "BB") {
      this.batting.get(batter.id).BB++;
      this.pitching.get(runner.pitcher).BB++;
    } else {
      this.batting.get(batter.id).HBP++;
      this.pitching.get(runner.pitcher).HBP++;
    }
    this.record(code);
  }

  private strikeout(batter: BatterProfile): void {
    this.batting.get(batter.id).SO++;
    this.batting.get(batter.id).AB++;
    this.pitching.get(this.fieldingSide.pitcher.id).SO++;
    this.addOut();
    this.record("K");
  }

  private foulOut(batter: BatterProfile, field: Side): void {
    const b = this.batting.get(batter.id);
    b.AB++;
    const catcherish: Fielder = this.rng.pick(["C", "C", "1B", "3B"] as const);
    this.fielding.get(field.defense[catcherish]).chances++;
    // Foul pop-ups count as (weak) batted balls.
    const p = this.pitching.get(field.pitcher.id);
    b.BBE++;
    b.PU++;
    b.evSum += 65;
    b.laSum += 60;
    p.BBE++;
    p.PU++;
    p.evSum += 65;
    this.addOut();
    this.record("OUT");
  }

  private wildPitch(): void {
    const [r1, r2, r3] = this.bases;
    this.pitching.get(this.fieldingSide.pitcher.id).WP++;
    this.bases = [null, r1, r2];
    if (r3) this.scoreRun(r3, null);
    this.record("WP");
  }

  private tryStolenBase(): boolean {
    const [r1, r2, r3] = this.bases;
    let runner: Runner | null = null;
    let target = 0;
    if (r1 && !r2) {
      runner = r1;
      target = 2;
    } else if (r2 && !r3 && !r1) {
      runner = r2;
      target = 3;
    }
    if (!runner) return false;
    const S = ENGINE.steal;
    if (runner.speed < S.minSpeed) return false;
    // Nobody runs down big late.
    if (this.inning >= 7 && this.fieldingLead >= 4) return false;
    const pAttempt =
      S.attempt * Math.exp(S.speed * runner.speed + S.aggression * runner.aggression) * (target === 3 ? S.thirdMult : 1);
    if (!this.rng.chance(pAttempt)) return false;

    this.mark();
    const field = this.fieldingSide;
    const base = S.success + S.successSpeed * runner.speed - (target === 3 ? S.thirdPenalty : 0);
    const pSafe = sigmoid(base - S.catcherArm * field.catcherArm);
    const pAvg = sigmoid(base - S.catcherArm * this.env.avgDefense.C.arm);
    const c = this.fielding.get(field.defense.C);
    c.sbAttempts++;
    c.sbExpected += pAvg;
    const pl = this.pitching.get(field.pitcher.id);
    if (this.rng.chance(pSafe)) {
      c.sbAllowed++;
      pl.SB++;
      this.batting.get(runner.id).SB++;
      if (target === 2) this.bases = [null, runner, r3];
      else this.bases = [null, null, runner];
      this.record("SB");
    } else {
      pl.CS++;
      this.batting.get(runner.id).CS++;
      if (target === 2) this.bases[0] = null;
      else this.bases[1] = null;
      this.addOut();
      this.record("CS");
    }
    return true;
  }

  private ballInPlay(batter: BatterProfile, bb: BattedBall): void {
    const field = this.fieldingSide;
    const odds = battedBallOdds(bb, this.park, field.defSkill, batter.speed);
    const r = this.rng.next();
    let outcome: Hit | "out";
    if (r < odds.out) outcome = "out";
    else if (r < odds.out + odds.single) outcome = "1B";
    else if (r < odds.out + odds.single + odds.double) outcome = "2B";
    else if (r < odds.out + odds.single + odds.double + odds.triple) outcome = "3B";
    else outcome = "HR";

    this.recordBattedBall(batter.id, field.pitcher.id, bb, odds);
    const tally = this.env.battedBalls?.[laBucket(bb.la)];
    if (tally) {
      tally.n++;
      if (outcome !== "out") tally[outcome]++;
    }

    // Defensive credit: this fielder vs. an average one on the same ball.
    const fielderId = field.defense[odds.fielder];
    let fl: FieldingLine | null = null;
    if (outcome !== "HR" && odds.fielder !== "P" && this.env.detailed !== false) {
      const avg = battedBallOdds(bb, this.park, this.env.avgDefense, batter.speed);
      const inPlay = 1 - avg.hr;
      if (inPlay > 0.01) {
        fl = this.fielding.get(fielderId);
        // An average fielder would also boot some of the outs; errors count like singles.
        const avgErr = errorRate(avg.type, this.env.avgDefense[odds.fielder].range);
        fl.exp1B += (avg.single + avg.out * avgErr) / inPlay;
        fl.exp2B += avg.double / inPlay;
        fl.exp3B += avg.triple / inPlay;
      }
    }

    if (outcome === "out") {
      const pErr = errorRate(odds.type, field.defSkill[odds.fielder].range);
      this.fielding.get(fielderId).chances++;
      if (this.rng.chance(pErr)) {
        this.fielding.get(fielderId).errors++;
        field.errors++;
        if (tally) tally.E++;
        if (fl) fl.act1B += 1;
        this.reachOnError(batter);
      } else if (odds.type === "GB") {
        this.groundOut(batter, bb, odds);
      } else {
        this.airOut(batter, odds);
      }
      return;
    }

    if (fl) {
      if (outcome === "1B") fl.act1B++;
      else if (outcome === "2B") fl.act2B++;
      else if (outcome === "3B") fl.act3B++;
    }
    this.hit(batter, outcome, bb, odds);
  }

  private recordBattedBall(batterId: number, pitcherId: number, bb: BattedBall, odds: BipOdds): void {
    const x = this.env.detailed !== false ? battedBallOdds(bb, this.env.neutralPark, this.env.avgDefense, 0) : NO_XSTATS;
    const b = this.batting.get(batterId);
    const p = this.pitching.get(pitcherId);
    const hard = bb.ev >= 95 ? 1 : 0;
    const barrel = isBarrel(bb.ev, bb.la) ? 1 : 0;
    b.BBE++;
    p.BBE++;
    b[odds.type]++;
    p[odds.type]++;
    b.evSum += bb.ev;
    p.evSum += bb.ev;
    b.laSum += bb.la;
    b.hardHit += hard;
    p.hardHit += hard;
    b.barrels += barrel;
    p.barrels += barrel;
    if (bb.la >= 8 && bb.la <= 32) b.sweetSpot++;
    b.x1B += x.single;
    b.x2B += x.double;
    b.x3B += x.triple;
    b.xHR += x.hr;
    p.x1B += x.single;
    p.x2B += x.double;
    p.x3B += x.triple;
    p.xHR += x.hr;
  }

  private reachOnError(batter: BatterProfile): void {
    const [r1, r2, r3] = this.bases;
    if (r3) this.scoreRun(r3, null, true);
    this.bases = [this.runnerFor(batter, true), r1, r2];
    const b = this.batting.get(batter.id);
    b.AB++;
    b.ROE++;
    this.record("ROE");
  }

  private throwingArm(odds: BipOdds, bb: BattedBall): number {
    let f = odds.fielder;
    if (!OUTFIELD.has(f)) f = bb.spray < -15 ? "LF" : bb.spray > 15 ? "RF" : "CF";
    return this.fieldingSide.defSkill[f].arm;
  }

  private hit(batter: BatterProfile, kind: Hit, bb: BattedBall, odds: BipOdds): void {
    const R = ENGINE.running;
    const counters = this.env.running;
    const b = this.batting.get(batter.id);
    const p = this.pitching.get(this.fieldingSide.pitcher.id);
    b.AB++;
    b.H++;
    b[kind]++;
    p.H++;
    if (kind !== "1B") p[kind]++;
    this.battingSide.hits++;

    const runner = this.runnerFor(batter);
    const [r1, r2, r3] = this.bases;
    const twoOuts = this.outs === 2;
    const arm = this.throwingArm(odds, bb);
    const ease =
      odds.type === "GB" ? -0.2 - (bb.ev - 90) / 25 : (odds.distance - 230) / 60 + (odds.type === "LD" ? -0.3 : 0);
    const threshold = twoOuts ? R.sendThresholdTwoOuts : R.sendThreshold;
    const advanceOdds = (base: number, r: Runner, extra = 0) =>
      sigmoid(base + R.speed * r.speed - R.arm * arm + R.aggression * r.aggression + (twoOuts ? R.twoOuts : 0) + extra);

    if (kind === "HR" || kind === "3B") {
      for (const r of [r3, r2, r1]) if (r) this.scoreRun(r, batter.id);
      if (kind === "HR") {
        this.scoreRun(runner, batter.id);
        this.bases = [null, null, null];
      } else {
        this.bases = [null, null, runner];
      }
      this.record(kind);
      return;
    }

    const next: [Runner | null, Runner | null, Runner | null] = [null, null, null];
    if (kind === "2B") {
      if (r3) this.scoreRun(r3, batter.id);
      if (r2) this.scoreRun(r2, batter.id);
      if (r1) {
        if (counters) counters.firstOnDouble++;
        const s = advanceOdds(R.firstHomeOnDouble, r1, ease);
        if (s >= threshold) {
          if (this.rng.chance(s)) {
            this.scoreRun(r1, batter.id);
            if (counters) counters.scoredFromFirst++;
          } else this.addOut();
        } else next[2] = r1;
      }
      next[1] = runner;
    } else {
      if (r3) this.scoreRun(r3, batter.id);
      if (r2) {
        if (counters) counters.secondOnSingle++;
        const s = advanceOdds(R.secondHomeOnSingle, r2, ease);
        if (s >= threshold) {
          if (this.rng.chance(s)) {
            this.scoreRun(r2, batter.id);
            if (counters) counters.scoredFromSecond++;
          } else this.addOut();
        } else next[2] = r2;
      }
      if (r1) {
        if (!next[2] && this.outs < 3) {
          if (counters) counters.firstOnSingle++;
          const side = bb.spray > 10 ? R.rightField : bb.spray < -10 ? R.leftField : 0;
          const s = advanceOdds(R.firstThirdOnSingle, r1, side + 0.5 * ease - (twoOuts ? 0.5 * R.twoOuts : 0));
          if (s >= R.firstThirdThreshold) {
            if (this.rng.chance(s)) {
              next[2] = r1;
              if (counters) counters.firstToThird++;
            } else this.addOut();
          } else next[1] = r1;
        } else next[1] = r1;
      }
      next[0] = runner;
    }
    this.bases = this.outs >= 3 ? [null, null, null] : next;
    this.record(kind);
  }

  private groundOut(batter: BatterProfile, bb: BattedBall, odds: BipOdds): void {
    const R = ENGINE.running;
    const counters = this.env.running;
    const b = this.batting.get(batter.id);
    b.AB++;
    const [r1, r2, r3] = this.bases;
    if (this.outs === 2) {
      this.addOut();
      this.bases = [null, null, null];
      this.record("OUT");
      return;
    }
    const field = this.fieldingSide;
    const unforcedScore = (r: Runner) =>
      this.rng.chance(sigmoid(R.scoreFromThirdOnGrounder + 0.6 * r.speed + (bb.ev < 85 ? 0.5 : -0.3)));

    if (r1) {
      if (counters) counters.dpOpportunities++;
      const middle = (field.defSkill.SS.range + field.defSkill["2B"].range) / 2;
      const corner = odds.fielder === "1B" || odds.fielder === "3B" ? R.dpCorner : 0;
      const pDp = sigmoid(R.dpBase + R.dpEV * (bb.ev - 85) - R.dpSpeed * batter.speed + R.dpFielder * middle + corner);
      if (this.rng.chance(pDp)) {
        if (counters) counters.doublePlays++;
        b.GIDP++;
        this.addOut();
        this.addOut();
        if (this.outs < 3) {
          if (r3) this.scoreRun(r3, null);
          this.bases = [null, null, r2];
        } else {
          this.bases = [null, null, null];
        }
        this.record("OUT");
        return;
      }
      const runner = this.runnerFor(batter);
      if (this.rng.chance(R.forceAtSecond)) {
        // Lead runner forced at second; batter safe at first.
        this.addOut();
        const next: [Runner | null, Runner | null, Runner | null] = [runner, null, null];
        if (r2) {
          if (r3) this.scoreRun(r3, batter.id);
          next[2] = r2;
        } else if (r3) {
          if (unforcedScore(r3)) this.scoreRun(r3, batter.id);
          else next[2] = r3;
        }
        this.bases = next;
      } else {
        this.addOut();
        const next: [Runner | null, Runner | null, Runner | null] = [null, r1, null];
        if (r2) {
          if (r3) this.scoreRun(r3, batter.id);
          next[2] = r2;
        } else if (r3) {
          if (unforcedScore(r3)) this.scoreRun(r3, batter.id);
          else next[2] = r3;
        }
        this.bases = next;
      }
      this.record("OUT");
      return;
    }

    this.addOut();
    const next: [Runner | null, Runner | null, Runner | null] = [null, null, null];
    if (r3) {
      if (unforcedScore(r3)) this.scoreRun(r3, batter.id);
      else next[2] = r3;
    }
    if (r2) {
      const toThird =
        !next[2] && this.rng.chance(sigmoid(R.advanceSecondOnGrounder + 0.5 * r2.speed + (bb.spray > 5 ? R.rightSide : -0.6)));
      if (toThird) next[2] = r2;
      else next[1] = r2;
    }
    this.bases = next;
    this.record("OUT");
  }

  private airOut(batter: BatterProfile, odds: BipOdds): void {
    const R = ENGINE.running;
    const counters = this.env.running;
    const b = this.batting.get(batter.id);
    this.addOut();
    const [, r2, r3] = this.bases;
    let sacFly = false;
    if (this.outs < 3 && OUTFIELD.has(odds.fielder) && odds.type !== "PU") {
      const arm = this.fieldingSide.defSkill[odds.fielder].arm;
      if (r3) {
        if (counters) counters.sacFlyOpportunities++;
        const s = sigmoid((odds.distance - R.sacFlyDistance) / R.sacFlyScale + 0.6 * r3.speed - 0.45 * arm + 0.2 * r3.aggression);
        if (s >= R.sacFlyThreshold) {
          this.bases[2] = null;
          if (this.rng.chance(s)) {
            this.scoreRun(r3, batter.id);
            sacFly = true;
            if (counters) counters.sacFlies++;
          } else {
            this.addOut();
          }
        }
      }
      if (this.outs < 3 && r2 && !this.bases[2] && odds.distance > R.tagThirdDistance) {
        const lean = odds.fielder === "RF" ? 0.8 : odds.fielder === "LF" ? -0.5 : 0;
        if (this.rng.chance(sigmoid(-1 + (odds.distance - 300) / 25 + 0.5 * r2.speed + lean))) {
          this.bases[1] = null;
          this.bases[2] = r2;
        }
      }
    }
    if (sacFly) b.SF++;
    else b.AB++;
    if (this.outs >= 3) this.bases = [null, null, null];
    this.record("OUT");
  }

  // -------------------------------------------------------------------------
  // Pitching changes

  private maybeChangePitcher(inningStart: boolean): void {
    const field = this.fieldingSide;
    const s = field.pitcher;
    const lead = this.fieldingLead;
    const runners = (this.bases[0] ? 1 : 0) + (this.bases[1] ? 1 : 0) + (this.bases[2] ? 1 : 0);
    let pull = false;
    const hurt = s.injuryAtPitch !== null && s.pitches >= s.injuryAtPitch;
    if (hurt) {
      this.injure(s.id);
      pull = true;
    } else if (s.pitches >= s.limit) pull = true;
    else if (s.starter) {
      if (s.runs >= 6 && s.pitches >= 40) pull = true;
      else if (s.runs >= 5 && this.inning <= 5 && s.pitches >= 60) pull = true;
      else if (inningStart && s.pitches >= s.limit - 7) pull = true;
      else if (!inningStart && runners >= 2 && this.inning >= 5 && s.pitches >= s.limit - 12) pull = true;
      else if (inningStart && this.inning >= 7 && s.battersFaced >= 27 && Math.abs(lead) <= 2) pull = true;
    } else {
      const longMan = field.setup.bullpen.indexOf(s.id) >= field.setup.bullpen.length - 2;
      const blowout = lead >= 5 || lead <= -4;
      if (inningStart && s.outs >= 3 && !(longMan && blowout && s.pitches < s.limit - 10)) pull = true;
      else if (!inningStart && s.runs >= 3 && s.pitches >= 15) pull = true;
    }
    if (!pull) return;
    const next = this.chooseReliever(field, lead, runners);
    if (next === null) return;

    s.exitLead = lead;
    const stint = this.newStint(field.setup, next, false, lead, runners);
    field.pitcher = stint;
    field.stints.push(stint);
    field.defense.P = next;
    field.bullpenLeft = field.bullpenLeft.filter((id) => id !== next);
    // Runners already on base stay charged to the previous pitcher.
  }

  private chooseReliever(field: Side, lead: number, runners: number): number | null {
    const left = field.bullpenLeft;
    if (left.length === 0) return null;
    const rested = left.filter((id) => !field.setup.unavailable?.has(id));
    // Out of rested arms: the least-worked of the rest has to go.
    if (rested.length === 0) {
      const fatigue = field.setup.fatigue;
      return [...left].sort((a, b) => (fatigue?.get(a) ?? 0) - (fatigue?.get(b) ?? 0))[0]!;
    }
    const ranked = field.setup.bullpen.filter((id) => rested.includes(id));
    const closer = field.setup.bullpen[0];
    const saveSituation = lead >= 1 && (lead <= 3 || lead <= runners + 2);
    const late = this.inning >= 9;
    if (late && (saveSituation || (lead === 0 && this.inning >= 10))) return ranked[0]!;
    if (this.inning >= 7 && (saveSituation || Math.abs(lead) <= 1)) {
      const setup = ranked.filter((id) => id !== closer || late);
      return (setup[0] ?? ranked[0])!;
    }
    if (lead >= 5 || lead <= -4) return ranked[ranked.length - 1]!;
    const middle = ranked.filter((id) => id !== closer);
    const pool = middle.length > 0 ? middle : ranked;
    return pool[Math.floor(pool.length / 2)]!;
  }

  // -------------------------------------------------------------------------
  // Injuries and substitutions

  private riskOf(id: number): number {
    const p = this.env.league.players[id]!;
    // injuryChance for a pitcher with 0 pitches is the per-appearance rate; strip it to get the multiplier.
    return injuryChance(p, 0) / INJURY_RATES.pitcherPerAppearance;
  }

  private injure(id: number): void {
    if (this.hurt.has(id)) return;
    this.hurt.add(id);
    this.injuries.push({ playerId: id, injury: rollInjury(this.env.league.players[id]!, this.day, this.rng) });
  }

  /** Per-PA injury risk for the hitter who just batted; if hurt he leaves the game. */
  private maybeInjureHitter(side: Side, slot: number): void {
    const entry = side.order[slot]!;
    const p = this.env.league.players[entry.id]!;
    const perPa = injuryChance(p, 0) / 4.2;
    if (!this.rng.chance(perPa)) return;
    this.injure(p.id);
    const sub = this.bestSub(side, entry.pos, "defense");
    if (sub === undefined) return; // no one left: he plays through it
    this.substitute(side, slot, sub, "INJ");
  }

  /** Offensive value (runs per 600 PA) of a hitter against this pitcher's hand. */
  private matchupValue(b: BatterProfile, throws: "L" | "R"): number {
    const side = battingSide(b.bats, throws);
    const platoon = side === throws ? -8 : 3;
    return 19 * b.contact + 19 * b.power + 6 * b.eye + 5 * b.speed + platoon;
  }

  private canPlay(id: number, pos: LineupPosition): boolean {
    if (pos === "DH") return true;
    const p = this.env.league.players[id]!;
    return p.positions.includes(pos) || defenseGrade(p, pos) >= 40;
  }

  private bestSub(side: Side, pos: LineupPosition, by: "defense" | "speed" | "bat", throws: "L" | "R" = "R"): number | undefined {
    const players = this.env.league.players;
    let best: number | undefined;
    let bestScore = -Infinity;
    for (const id of side.bench) {
      if (this.hurt.has(id)) continue;
      const p = players[id]!;
      const eligible = this.canPlay(id, pos);
      let score: number;
      if (by === "defense") score = (pos === "DH" ? 0 : defenseGrade(p, pos)) + (eligible ? 100 : 0) + batterProfile(p).power;
      else if (by === "speed") score = p.hitting.speed.present + (eligible ? 100 : 0);
      else score = this.matchupValue(batterProfile(p), throws) + (eligible ? 1000 : -1000);
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  private substitute(side: Side, slot: number, id: number, type: SubType): void {
    const players = this.env.league.players;
    const old = side.order[slot]!;
    const entry: SlotEntry = { id, pos: old.pos, sub: type, inning: this.inning };
    side.order[slot] = entry;
    side.slots[slot]!.push(entry);
    side.batters[slot] = batterProfile(players[id]!);
    side.bench = side.bench.filter((b) => b !== id);
    this.batting.get(id).G += 1;
    if (old.pos === "DH") {
      this.fielding.get(id).gamesDH += 1;
    } else {
      side.defense[old.pos] = id;
      side.defSkill[old.pos] = { range: defenseZ(players[id]!, old.pos), arm: armZ(players[id]!) };
      if (old.pos === "C") {
        side.catcherFraming = defenseZ(players[id]!, "C");
        side.catcherArm = armZ(players[id]!);
      }
    }
    // A pinch runner (or an injured runner's replacement) takes his place on base.
    for (let b = 0; b < 3; b++) {
      const r = this.bases[b];
      if (r && r.id === old.id) {
        const prof = side.batters[slot]!;
        this.bases[b] = { ...r, id, speed: prof.speed, aggression: prof.aggression };
      }
    }
  }

  private closeGame(maxDeficit: number, maxLead: number): boolean {
    const diff = this.score[this.half]! - this.score[1 - this.half]!;
    return diff <= maxLead && diff >= -maxDeficit;
  }

  private considerPinchHitter(): void {
    if (this.inning < 7 || !this.closeGame(4, 1)) return;
    const bat = this.battingSide;
    if (bat.bench.length === 0) return;
    const slot = bat.next;
    const cur = bat.order[slot]!;
    const throws = this.fieldingSide.pitcher.profile.throws;
    const sub = this.bestSub(bat, cur.pos, "bat", throws);
    if (sub === undefined || !this.canPlay(sub, cur.pos)) return;
    const gain =
      this.matchupValue(batterProfile(this.env.league.players[sub]!), throws) - this.matchupValue(bat.batters[slot]!, throws);
    // Don't burn the backup catcher unless it's late.
    const players = this.env.league.players;
    const isCatcher = players[sub]!.position === "C";
    if (isCatcher && this.inning < 9) return;
    if (gain >= 12) this.substitute(bat, slot, sub, "PH");
  }

  private considerPinchRunner(): void {
    if (this.inning < 8 || !this.closeGame(1, 1)) return;
    const bat = this.battingSide;
    if (bat.bench.length === 0) return;
    for (let b = 2; b >= 0; b--) {
      const r = this.bases[b];
      if (!r || r.speed > -0.6) continue;
      const slot = bat.order.findIndex((e) => e.id === r.id);
      if (slot < 0) continue;
      const pos = bat.order[slot]!.pos;
      const sub = this.bestSub(bat, pos, "speed");
      if (sub === undefined || !this.canPlay(sub, pos)) continue;
      if ((this.env.league.players[sub]!.hitting.speed.present - 50) / 10 < r.speed + 1.2) continue;
      this.substitute(bat, slot, sub, "PR");
      return;
    }
  }

  private considerDefensiveSubs(): void {
    const field = this.fieldingSide;
    const lead = this.fieldingLead;
    if (this.inning < 8 || lead < 1 || lead > 3 || field.defensiveSubs >= 2 || field.bench.length === 0) return;
    const players = this.env.league.players;
    for (const pos of FIELD_POSITIONS) {
      if (field.defensiveSubs >= 2) return;
      const curId = field.defense[pos];
      const cur = defenseGrade(players[curId]!, pos);
      let best: number | undefined;
      let bestGrade = cur + 10;
      for (const id of field.bench) {
        if (this.hurt.has(id) || !players[id]!.positions.includes(pos)) continue;
        const g = defenseGrade(players[id]!, pos);
        if (g > bestGrade) {
          bestGrade = g;
          best = id;
        }
      }
      if (best === undefined) continue;
      const slot = field.order.findIndex((e) => e.id === curId);
      if (slot < 0) continue;
      this.substitute(field, slot, best, "DEF");
      field.defensiveSubs++;
    }
  }

  // -------------------------------------------------------------------------
  // Wrap-up

  private finish(): GameResult {
    // Arm injuries that struck after the pitcher's last check-in still count.
    for (const side of this.sides) {
      for (const st of side.stints) if (st.injuryAtPitch !== null && st.pitches >= st.injuryAtPitch) this.injure(st.id);
    }
    const winner = this.score[1] > this.score[0] ? 1 : 0;
    const loser = 1 - winner;
    const [away, home] = this.sides;
    const finalLead = (i: number) => this.score[i]! - this.score[1 - i]!;
    this.sides.forEach((side, i) => (side.stints[side.stints.length - 1]!.exitLead = finalLead(i)));

    const w = this.sides[winner]!;
    let wp = this.winCandidate[winner] ?? w.stints[0]!.id;
    const wpStint = w.stints.find((s) => s.id === wp);
    if (wpStint?.starter && wpStint.outs < 15 && w.stints.length > 1) {
      const relievers = w.stints.slice(1);
      wp = relievers.reduce((best, s) => (s.outs > best.outs ? s : best), relievers[0]!).id;
    }
    const lp = this.loseCandidate[loser] ?? this.sides[loser]!.stints[0]!.id;
    this.pitching.get(wp).W++;
    this.pitching.get(lp).L++;

    let sv: number | null = null;
    const last = w.stints[w.stints.length - 1]!;
    if (!last.starter && last.id !== wp) {
      const qualifies =
        (last.entryLead >= 1 && last.entryLead <= 3 && last.outs >= 3) ||
        (last.entryTying && last.outs >= 1) ||
        last.outs >= 9;
      if (qualifies && last.entryLead >= 1) {
        sv = last.id;
        this.pitching.get(sv).SV++;
      }
    }
    for (const side of this.sides) {
      for (const s of side.stints) {
        if (s.blew) this.pitching.get(s.id).BS++;
        else if (
          !s.starter &&
          s.entrySave &&
          s.outs >= 1 &&
          s.exitLead > 0 &&
          s !== side.stints[side.stints.length - 1] &&
          s.id !== wp &&
          s.id !== lp
        ) {
          this.pitching.get(s.id).HLD++;
        }
      }
    }

    const pitchCounts = new Map<number, number>();
    for (const side of this.sides) for (const s of side.stints) pitchCounts.set(s.id, s.pitches);

    return {
      awayId: away.setup.team.id,
      homeId: home.setup.team.id,
      score: [this.score[0], this.score[1]],
      hits: [away.hits, home.hits],
      errors: [away.errors, home.errors],
      innings: this.inning,
      lineScore: [away.line, home.line],
      winningPitcher: wp,
      losingPitcher: lp,
      savePitcher: sv,
      starters: [away.stints[0]!.id, home.stints[0]!.id],
      lineups: [away.setup.lineup, home.setup.lineup],
      battingOrder: [away.slots, home.slots],
      injuries: this.injuries,
      pitchersUsed: [away.stints.map((s) => s.id), home.stints.map((s) => s.id)],
      pitchCounts,
      batting: this.batting,
      pitching: this.pitching,
      fielding: this.fielding,
    };
  }
}

const NO_XSTATS = { single: 0, double: 0, triple: 0, hr: 0 };

function errorRate(type: BattedBallType, skill: number): number {
  const E = ENGINE.errors;
  return (type === "GB" ? E.ground : E.air) * Math.exp(E.skill * skill);
}

/** Heart pitches are in the zone, shadow pitches straddle it (count half), chase/waste are out. */
function zoneShare(region: Region): number {
  return region === "heart" ? 1 : region === "shadow" ? 0.5 : 0;
}

export function simulateGame(env: SimEnv, away: TeamGameSetup, home: TeamGameSetup, rng: Rng, day = 0): GameResult {
  return new GameSim(env, away, home, rng, day).run();
}
