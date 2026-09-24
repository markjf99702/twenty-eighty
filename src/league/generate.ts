import { clampGrade } from "../core/grades";
import { clamp } from "../core/math";
import { Rng } from "../core/rng";
import { assignInitialContracts, budgetFor } from "../org/contracts";
import { autoDepthChart } from "../org/depth";
import { defaultScouting } from "../scouting/scouting";
import { playerValue } from "../org/value";
import { generateHitter, generatePitcher } from "../players/generate";
import type { FieldPosition, Level, MinorLevel, Player, ToolGrade } from "../players/types";
import { FIELD_POSITIONS, MAX_OPTION_YEARS, MINOR_LEVELS, SERVICE_DAYS_PER_YEAR } from "../players/types";
import { DEFAULT_STRUCTURE, FRANCHISES, type FranchiseSeed } from "./franchises";
import type { Affiliate, League, Park, Team } from "./types";

export interface GenerateLeagueOptions {
  seed: string;
  year?: number;
  /** Spread of organizational strength, in talent z units. */
  teamSpread?: number;
}

/** Composite pitching quality in z units, used to order staffs. */
export function pitcherQuality(p: Player): number {
  const pit = p.pitching;
  if (!pit) return -3;
  let usage = 0;
  let stuff = 0;
  for (const pitch of pit.pitches) {
    usage += pitch.usage;
    stuff += pitch.usage * pitch.grade.present;
  }
  const g = 0.6 * (stuff / usage) + 0.2 * pit.control.present + 0.2 * pit.command.present;
  return (g - 50) / 10;
}

/** Composite offensive quality in z units, used for batting orders. */
export function hitterQuality(p: Player): number {
  const h = p.hitting;
  const g = 0.4 * h.hit.present + 0.35 * h.power.present + 0.17 * h.eye.present + 0.08 * h.speed.present;
  return (g - 50) / 10;
}

const BENCH_SLOTS: ReadonlyArray<FieldPosition> = ["C", "SS", "CF", "3B"];

/**
 * Talent targets by roster slot. Hitters: runs per 600 PA vs. an all-50 bat
 * (positions differ because a shortstop's glove buys him a lighter bat).
 * Pitchers: runs saved per 600 batters faced vs. an all-50 arm.
 */
const STARTER_BAT: Record<FieldPosition | "DH", number> = {
  C: -1, "1B": 11, "2B": 3, "3B": 6, SS: 2, LF: 7, CF: 3, RF: 8, DH: 12,
};
const BENCH_BAT = -18;
const ROTATION_TIERS = [14, 8, 3, -1, -5];
const BULLPEN_TIERS = [14, 10, 7, 4, 1, -2, -5, -8];
/** Runs per 600 of talent per unit of organizational strength. */
const ORG_BAT = 8;
const ORG_ARM = 6;

interface LevelPlan {
  /** Talent relative to the MLB slot targets (runs per 600). */
  offset: number;
  batSd: number;
  armSd: number;
  age: [mean: number, sd: number, min: number, max: number];
}

const LEVEL_PLANS: Record<Level, LevelPlan> = {
  MLB: { offset: 0, batSd: 11, armSd: 6, age: [28.5, 3.4, 21, 40] },
  AAA: { offset: -17, batSd: 10, armSd: 7, age: [26.5, 2.8, 21, 34] },
  AA: { offset: -27, batSd: 10, armSd: 7, age: [23.4, 1.6, 20, 29] },
  "A+": { offset: -35, batSd: 10, armSd: 7, age: [22, 1.3, 19, 26] },
  A: { offset: -43, batSd: 10, armSd: 7, age: [20.4, 1.2, 18, 23] },
};

/** 40-man slots beyond the 26 big leaguers: a few prospects plus upper-minors depth. */
const PROSPECTS_ON_40 = 8;
const DEPTH_ON_40 = 6;

function ageFor(rng: Rng, plan: LevelPlan): number {
  const [mean, sd, min, max] = plan.age;
  return Math.round(clamp(rng.normal(mean, sd), min, max));
}

function levelRoster(rng: Rng, level: Level, strength: number, players: Player[]): number[] {
  const plan = LEVEL_PLANS[level];
  const ids: number[] = [];
  const add = (p: Player) => {
    players.push(p);
    ids.push(p.id);
  };
  const bat = (pos: FieldPosition | "DH", base: number) =>
    add(
      generateHitter(rng, {
        id: players.length,
        position: pos,
        value: base + plan.offset + ORG_BAT * strength + rng.normal(0, level === "MLB" && pos !== "DH" ? plan.batSd : plan.batSd * 0.9),
        age: level === "MLB" && pos === "DH" ? Math.round(clamp(rng.normal(30, 3.4), 23, 40)) : ageFor(rng, plan),
      }),
    );
  for (const pos of FIELD_POSITIONS) bat(pos, STARTER_BAT[pos]);
  bat("DH", STARTER_BAT.DH);
  for (const pos of BENCH_SLOTS) {
    add(
      generateHitter(rng, {
        id: players.length,
        position: pos,
        value: BENCH_BAT + plan.offset + ORG_BAT * strength + rng.normal(0, 7),
        age: level === "MLB" ? Math.round(clamp(rng.normal(29.5, 4), 22, 40)) : ageFor(rng, plan),
      }),
    );
  }
  for (const tier of ROTATION_TIERS) {
    add(
      generatePitcher(rng, {
        id: players.length,
        role: "SP",
        value: tier + plan.offset + ORG_ARM * strength + rng.normal(0, plan.armSd),
        age: ageFor(rng, plan),
      }),
    );
  }
  for (const tier of BULLPEN_TIERS) {
    add(
      generatePitcher(rng, {
        id: players.length,
        role: "RP",
        value: tier + plan.offset + ORG_ARM * strength + rng.normal(0, plan.armSd),
        age: level === "MLB" ? Math.round(clamp(rng.normal(29, 3.5), 22, 40)) : ageFor(rng, plan),
      }),
    );
  }
  for (const id of ids) {
    const p = players[id]!;
    p.level = level;
    rawness(p, level);
  }
  return ids;
}

/**
 * Minor leaguers are raw in characteristic ways: pitchers are wilder and
 * hitters chase more. Shift grades between tools without changing overall
 * value, so the low minors walk and strike out more than the majors.
 */
const RAWNESS: Record<Level, number> = { MLB: 0, AAA: 0.25, AA: 0.45, "A+": 0.65, A: 0.85 };

export function rawness(p: Player, level: Level): void {
  const r = RAWNESS[level];
  if (r === 0) return;
  if (p.pitching) {
    const ctl = 10 * r;
    p.pitching.control.present = r1(clampGrade(p.pitching.control.present - ctl));
    for (const pitch of p.pitching.pitches) pitch.grade.present = r1(clampGrade(pitch.grade.present + (ctl * 4) / 22));
  } else {
    const eye = 8 * r;
    p.hitting.eye.present = r1(clampGrade(p.hitting.eye.present - eye));
    p.hitting.power.present = r1(clampGrade(p.hitting.power.present + (eye * 6) / 19));
  }
}

function affiliatePark(rng: Rng, name: string, level: MinorLevel): Park {
  // A handful of upper-minors parks sit at altitude, like the real Pacific Coast League.
  const high = level === "AAA" ? rng.chance(0.2) : rng.chance(0.05);
  return {
    name,
    dims: [rng.int(318, 340), rng.int(360, 392), rng.int(395, 412), rng.int(360, 392), rng.int(318, 340)],
    walls: [rng.int(8, 16), rng.int(8, 12), rng.int(8, 12), rng.int(8, 12), rng.int(8, 16)],
    altitude: high ? rng.int(3500, 5300) : rng.int(0, 1500),
  };
}

function assignServiceAndOptions(rng: Rng, p: Player, level: Level): void {
  if (level === "MLB") {
    const years = clamp(p.age - 23.5 + rng.normal(0, 1.5), 0, 16);
    p.service = Math.round(years * SERVICE_DAYS_PER_YEAR);
    p.options.used = years >= 5 ? MAX_OPTION_YEARS : Math.min(MAX_OPTION_YEARS, Math.floor(years * 0.7 + rng.next() * 1.5));
  } else if (p.onFortyMan) {
    p.options.used = Math.min(2, Math.max(0, Math.floor((p.age - 21) / 1.5 + rng.next())));
    p.service = level === "AAA" ? Math.round(rng.next() * 0.6 * SERVICE_DAYS_PER_YEAR) : 0;
  } else if (level === "AAA" && p.age >= 27) {
    // Veteran minor leaguers with a cup of coffee or two.
    p.service = Math.round(rng.next() * 2.5 * SERVICE_DAYS_PER_YEAR);
  }
}

function buildTeam(rng: Rng, id: number, seed: FranchiseSeed, players: Player[], teamSpread: number): Team {
  const org = rng.normal(0, teamSpread);
  const farm = rng.normal(0, teamSpread * 1.2);

  const rosters = { MLB: levelRoster(rng, "MLB", org, players) } as Record<Level, number[]>;
  const affiliates = {} as Record<MinorLevel, Affiliate>;
  for (const level of MINOR_LEVELS) {
    rosters[level] = levelRoster(rng, level, farm, players);
    const name = `${seed.nickname} ${level}`;
    affiliates[level] = { level, name, park: affiliatePark(rng, `${name} Ballpark`, level) };
  }

  // 40-man: the big leaguers, the best prospects (who must be protected), and
  // upper-minors depth ready for a call-up.
  const minors = MINOR_LEVELS.flatMap((l) => rosters[l]).map((pid) => players[pid]!);
  const prospects = [...minors]
    .filter((p) => p.age >= 20)
    .sort((a, b) => playerValue(b, true) - playerValue(a, true))
    .slice(0, PROSPECTS_ON_40);
  const depth = minors
    .filter((p) => p.level === "AAA" && !prospects.includes(p))
    .sort((a, b) => playerValue(b) - playerValue(a))
    .slice(0, DEPTH_ON_40);
  const fortyMan = [...rosters.MLB, ...prospects.map((p) => p.id), ...depth.map((p) => p.id)];

  for (const level of ["MLB", ...MINOR_LEVELS] as Level[]) {
    for (const pid of rosters[level]) {
      const p = players[pid]!;
      p.teamId = id;
      p.onFortyMan = fortyMan.includes(pid);
      assignServiceAndOptions(rng, p, level);
    }
  }

  return {
    id,
    city: seed.city,
    nickname: seed.nickname,
    abbrev: seed.abbrev,
    league: seed.league,
    division: seed.division,
    park: seed.park,
    market: seed.market,
    rosters,
    fortyMan,
    injured: [],
    depth: autoDepthChart(rosters.MLB.map((pid) => players[pid]!)),
    affiliates,
    budget: budgetFor(seed.market),
    deadMoney: [],
  };
}

const r1 = (x: number) => Math.round(x * 10) / 10;

function shiftTool(t: ToolGrade, delta: number): void {
  t.present = r1(clampGrade(t.present + delta));
  t.future = r1(clampGrade(Math.max(t.present, t.future + delta)));
}

/**
 * Re-center grades so that 50 is the playing-time-weighted MLB average.
 * This is what makes the scale honest: a 50 hitter is a league-average bat
 * in this universe, not just in the generator's imagination. Minor leaguers
 * shift with everyone else, so their grades stay major-league relative.
 */
/**
 * Where regulars' glove and arm and starting pitchers' stamina sit in a
 * generated league. These aren't centered on 50 (a shortstop's glove is plus
 * by nature), so each winter they're held at these levels instead.
 */
export const WINTER_TARGETS = { field: 57, arm: 56.5, stamina: 56 };

export function recenterGrades(league: League, targets?: typeof WINTER_TARGETS): Record<string, number> {
  const { players, teams } = league;
  const hitterWeights = new Map<number, number>();
  const pitcherWeights = new Map<number, number>();
  for (const t of teams) {
    for (const pid of [...Object.values(t.depth.starters), t.depth.dh]) hitterWeights.set(pid, 1);
    for (const pid of t.depth.bench) hitterWeights.set(pid, 0.3);
    for (const pid of t.depth.rotation) pitcherWeights.set(pid, 1);
    for (const pid of t.depth.bullpen) pitcherWeights.set(pid, 0.4);
  }

  const deltas: Record<string, number> = {};
  for (const key of ["hit", "power", "eye", "speed"] as const) {
    let sum = 0;
    let w = 0;
    for (const [pid, weight] of hitterWeights) {
      sum += players[pid]!.hitting[key].present * weight;
      w += weight;
    }
    const delta = 50 - sum / w;
    deltas[key] = delta;
    for (const p of players) if (p.position !== "P" && p.retired === undefined) shiftTool(p.hitting[key], delta);
  }
  if (targets) {
    const regulars = teams.flatMap((t) => Object.values(t.depth.starters)).map((pid) => players[pid]!);
    for (const key of ["field", "arm"] as const) {
      const delta = targets[key] - regulars.reduce((s, p) => s + p.hitting[key].present, 0) / regulars.length;
      deltas[key] = delta;
      for (const p of players) if (p.position !== "P" && p.retired === undefined) shiftTool(p.hitting[key], delta);
    }
    const rotation = teams.flatMap((t) => t.depth.rotation).map((pid) => players[pid]!);
    const delta = targets.stamina - rotation.reduce((s, p) => s + p.pitching!.stamina.present, 0) / rotation.length;
    deltas.stamina = delta;
    for (const p of players) if (p.pitching && p.retired === undefined) shiftTool(p.pitching.stamina, delta);
  }

  let stuffSum = 0;
  let stuffW = 0;
  const ctl = { control: [0, 0], command: [0, 0] };
  for (const [pid, weight] of pitcherWeights) {
    const pit = players[pid]!.pitching!;
    const total = pit.pitches.reduce((s, x) => s + x.usage, 0);
    for (const pitch of pit.pitches) {
      stuffSum += pitch.grade.present * weight * (pitch.usage / total);
      stuffW += weight * (pitch.usage / total);
    }
    ctl.control[0]! += pit.control.present * weight;
    ctl.control[1]! += weight;
    ctl.command[0]! += pit.command.present * weight;
    ctl.command[1]! += weight;
  }
  const stuffDelta = 50 - stuffSum / stuffW;
  const controlDelta = 50 - ctl.control[0]! / ctl.control[1]!;
  const commandDelta = 50 - ctl.command[0]! / ctl.command[1]!;
  for (const p of players) {
    if (!p.pitching || p.retired !== undefined) continue;
    for (const pitch of p.pitching.pitches) shiftTool(pitch.grade, stuffDelta);
    shiftTool(p.pitching.control, controlDelta);
    shiftTool(p.pitching.command, commandDelta);
  }
  return { ...deltas, stuff: stuffDelta, control: controlDelta, command: commandDelta };
}

export function generateLeague(opts: GenerateLeagueOptions): League {
  const rng = new Rng(opts.seed);
  const players: Player[] = [];
  const teams = FRANCHISES.map((f, i) => buildTeam(rng.fork(f.abbrev), i, f, players, opts.teamSpread ?? 0.3));
  const league: League = {
    seed: opts.seed,
    year: opts.year ?? 2026,
    structure: DEFAULT_STRUCTURE,
    teams,
    players,
    transactions: [],
    userTeamId: null,
    history: [],
    freeAgents: [],
    offseason: null,
    scouting: { scouting: [], analytics: [], looks: {}, looksLeft: 0, looksWindow: "" },
  };
  recenterGrades(league);
  for (const t of teams) t.depth = autoDepthChart(t.rosters.MLB.map((pid) => players[pid]!));
  league.scouting = defaultScouting(league, rng.fork("scouting"));
  assignInitialContracts(league, rng.fork("contracts"));
  return league;
}
