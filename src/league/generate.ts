import { clampGrade } from "../core/grades";
import { clamp } from "../core/math";
import { Rng } from "../core/rng";
import { generateHitter, generatePitcher, randomAge } from "../players/generate";
import type { FieldPosition, Player, ToolGrade } from "../players/types";
import { FIELD_POSITIONS } from "../players/types";
import { DEFAULT_STRUCTURE, FRANCHISES, type FranchiseSeed } from "./franchises";
import type { DepthChart, League, Team } from "./types";

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

/** Composite offensive quality in z units, used for lineups and benches. */
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
const STARTER_BAT_SD = 11;
const BENCH_BAT: [number, number] = [-18, 7];
const ROTATION_TIERS = [14, 8, 3, -1, -5];
const BULLPEN_TIERS = [14, 10, 7, 4, 1, -2, -5, -8];
const PITCHER_SD = 6;
/** Runs per 600 of team-wide talent per unit of organizational strength. */
const ORG_BAT = 8;
const ORG_ARM = 6;

function buildTeam(rng: Rng, id: number, seed: FranchiseSeed, players: Player[], teamSpread: number): Team {
  const org = rng.normal(0, teamSpread);
  const add = (p: Player): number => {
    players.push(p);
    return p.id;
  };
  const nextId = () => players.length;

  const starters = {} as Record<FieldPosition, number>;
  for (const pos of FIELD_POSITIONS) {
    const value = STARTER_BAT[pos] + ORG_BAT * org + rng.normal(0, STARTER_BAT_SD);
    starters[pos] = add(generateHitter(rng, { id: nextId(), position: pos, value, age: randomAge(rng) }));
  }
  const dhValue = STARTER_BAT.DH + ORG_BAT * org + rng.normal(0, STARTER_BAT_SD);
  const dh = add(generateHitter(rng, { id: nextId(), position: "DH", value: dhValue, age: randomAge(rng, 30) }));
  const bench = BENCH_SLOTS.map((pos) =>
    add(
      generateHitter(rng, {
        id: nextId(),
        position: pos,
        value: BENCH_BAT[0] + ORG_BAT * org + rng.normal(0, BENCH_BAT[1]),
        age: randomAge(rng, 29.5, 4),
      }),
    ),
  );

  const rotation = ROTATION_TIERS.map((tier) =>
    add(
      generatePitcher(rng, {
        id: nextId(),
        role: "SP",
        value: tier + ORG_ARM * org + rng.normal(0, PITCHER_SD),
        age: randomAge(rng),
      }),
    ),
  );
  const bullpen = BULLPEN_TIERS.map((tier) =>
    add(
      generatePitcher(rng, {
        id: nextId(),
        role: "RP",
        value: tier + ORG_ARM * org + rng.normal(0, PITCHER_SD),
        age: randomAge(rng, 29, 3.5),
      }),
    ),
  );

  // Farm system: young players with modest present grades and real projection.
  const reserves: number[] = [];
  for (let i = 0; i < 12; i++) {
    const age = Math.round(clamp(rng.normal(21, 1.8), 18, 25));
    // Young and raw today; the growth in their future grades is the projection.
    const value = rng.normal(-30 + 2.5 * (age - 21), 10);
    if (i % 2 === 0) {
      const pos = rng.pick(FIELD_POSITIONS);
      reserves.push(add(generateHitter(rng, { id: nextId(), position: pos, value, age })));
    } else {
      const role = rng.chance(0.6) ? "SP" : "RP";
      reserves.push(add(generatePitcher(rng, { id: nextId(), role, value: value * 0.8, age })));
    }
  }

  const byPitching = (a: number, b: number) => pitcherQuality(players[b]!) - pitcherQuality(players[a]!);
  const depth: DepthChart = {
    starters,
    dh,
    bench,
    rotation: [...rotation].sort(byPitching),
    bullpen: [...bullpen].sort(byPitching),
  };

  return {
    id,
    city: seed.city,
    nickname: seed.nickname,
    abbrev: seed.abbrev,
    league: seed.league,
    division: seed.division,
    park: seed.park,
    market: seed.market,
    active: [...Object.values(starters), dh, ...bench, ...rotation, ...bullpen],
    reserves,
    depth,
  };
}

function shiftTool(t: ToolGrade, delta: number): void {
  t.present = clampGrade(t.present + delta);
  t.future = clampGrade(Math.max(t.present, t.future + delta));
}

/**
 * Re-center grades so that 50 is the playing-time-weighted MLB average.
 * This is what makes the scale honest: a 50 hitter is a league-average bat
 * in this universe, not just in the generator's imagination.
 */
export function recenterGrades(league: League): void {
  const { players, teams } = league;
  const hitterWeights = new Map<number, number>();
  const pitcherWeights = new Map<number, number>();
  for (const t of teams) {
    for (const id of [...Object.values(t.depth.starters), t.depth.dh]) hitterWeights.set(id, 1);
    for (const id of t.depth.bench) hitterWeights.set(id, 0.3);
    for (const id of t.depth.rotation) pitcherWeights.set(id, 1);
    for (const id of t.depth.bullpen) pitcherWeights.set(id, 0.4);
  }

  for (const key of ["hit", "power", "eye", "speed"] as const) {
    let sum = 0;
    let w = 0;
    for (const [id, weight] of hitterWeights) {
      sum += players[id]!.hitting[key].present * weight;
      w += weight;
    }
    const delta = 50 - sum / w;
    for (const p of players) if (p.position !== "P") shiftTool(p.hitting[key], delta);
  }

  let stuffSum = 0;
  let stuffW = 0;
  const ctl = { control: [0, 0], command: [0, 0] };
  for (const [id, weight] of pitcherWeights) {
    const pit = players[id]!.pitching!;
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
    if (!p.pitching) continue;
    for (const pitch of p.pitching.pitches) shiftTool(pitch.grade, stuffDelta);
    shiftTool(p.pitching.control, controlDelta);
    shiftTool(p.pitching.command, commandDelta);
  }
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
  };
  recenterGrades(league);
  return league;
}
