import { sigmoid } from "../core/math";
import type { Rng } from "../core/rng";
import type { League, Park, Team } from "../league/types";
import { armZ, defenseZ } from "../players/defense";
import type { FieldPosition, LineupPosition } from "../players/types";
import { FIELD_POSITIONS } from "../players/types";
import {
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
  starter: number;
  /** The whole bullpen, best first. */
  bullpen: number[];
  /** Relievers who shouldn't pitch today (used only in an emergency). */
  unavailable?: ReadonlySet<number>;
  /** Pre-game fatigue (z) from recent workload, by pitcher id. */
  fatigue?: ReadonlyMap<number, number>;
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
  /** Pitches thrown by each pitcher who appeared. */
  pitchCounts: Map<number, number>;
  batting: LineBook<BattingLine>;
  pitching: LineBook<PitchingLine>;
  fielding: LineBook<FieldingLine>;
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
}

interface Side {
  setup: TeamGameSetup;
  order: LineupSlot[];
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
  private readonly batting = new LineBook<BattingLine>(emptyBatting);
  private readonly pitching = new LineBook<PitchingLine>(emptyPitching);
  private readonly fielding = new LineBook<FieldingLine>(emptyFielding);
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

  constructor(
    private readonly env: SimEnv,
    away: TeamGameSetup,
    home: TeamGameSetup,
    private readonly rng: Rng,
  ) {
    this.park = home.team.park;
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

    for (const slot of setup.lineup) {
      this.batting.get(slot.id).G += 1;
      if (slot.pos === "DH") this.fielding.get(slot.id).gamesDH += 1;
    }
    const starter = this.newStint(setup, setup.starter, true, 0, 0);
    this.pitching.get(setup.starter).GS += 1;
    return {
      setup,
      order: setup.lineup,
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
    if (this.inning >= 10) {
      // Extra innings start with the previous hitter on second (unearned if he scores).
      const b = bat.batters[(bat.next + 8) % 9]!;
      this.bases[1] = { id: b.id, pitcher: field.pitcher.id, unearned: true, speed: b.speed, aggression: b.aggression };
    }
    this.mark();
    while (this.outs < 3 && !this.walkoff) {
      this.maybeChangePitcher(false);
      this.plateAppearance();
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
    bat.next = (bat.next + 1) % 9;
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
    if (outcome !== "HR" && odds.fielder !== "P") {
      const avg = battedBallOdds(bb, this.park, this.env.avgDefense, batter.speed);
      const inPlay = 1 - avg.hr;
      if (inPlay > 0.01) {
        fl = this.fielding.get(fielderId);
        fl.exp1B += avg.single / inPlay;
        fl.exp2B += avg.double / inPlay;
        fl.exp3B += avg.triple / inPlay;
      }
    }

    if (outcome === "out") {
      const skill = field.defSkill[odds.fielder].range;
      const E = ENGINE.errors;
      const pErr = (odds.type === "GB" ? E.ground : E.air) * Math.exp(E.skill * skill);
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
    const x = battedBallOdds(bb, this.env.neutralPark, this.env.avgDefense, 0);
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
    if (s.pitches >= s.limit) pull = true;
    else if (s.starter) {
      if (s.runs >= 6 && s.pitches >= 40) pull = true;
      else if (s.runs >= 5 && this.inning <= 5 && s.pitches >= 60) pull = true;
      else if (inningStart && s.pitches >= s.limit - 12) pull = true;
      else if (!inningStart && runners >= 2 && this.inning >= 5 && s.pitches >= s.limit - 20) pull = true;
      else if (inningStart && this.inning >= 7 && s.battersFaced >= 24 && Math.abs(lead) <= 2) pull = true;
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
  // Wrap-up

  private finish(): GameResult {
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
      pitchCounts,
      batting: this.batting,
      pitching: this.pitching,
      fielding: this.fielding,
    };
  }
}

/** Heart pitches are in the zone, shadow pitches straddle it (count half), chase/waste are out. */
function zoneShare(region: Region): number {
  return region === "heart" ? 1 : region === "shadow" ? 0.5 : 0;
}

export function simulateGame(env: SimEnv, away: TeamGameSetup, home: TeamGameSetup, rng: Rng): GameResult {
  return new GameSim(env, away, home, rng).run();
}
