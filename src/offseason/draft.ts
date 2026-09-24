import type { Rng } from "../core/rng";
import { rawness } from "../league/generate";
import type { League, Team } from "../league/types";
import { minorContract } from "../org/contracts";
import { logTransaction } from "../org/roster";
import { peakValue } from "../org/value";
import { carryReport, valueShift } from "../scouting/scouting";
import { generateHitter, generatePitcher } from "../players/generate";
import { type FieldPosition, playerName, type Player } from "../players/types";
import type { Season } from "../season/season";
import type { DraftState } from "./types";

/**
 * The amateur draft: ten rounds, worst record picks first in every round.
 * High schoolers are 18 and raw with the most room to grow; college players
 * are 21-22 and closer to the majors. Draftees sign and report to Single-A
 * (or High-A for the best college bats and arms).
 */

export const DRAFT_ROUNDS = 10;

const HITTER_SPOTS: FieldPosition[] = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const HITTER_WEIGHTS = [12, 9, 9, 11, 18, 10, 17, 14];

/** Talent of an amateur class, in runs per 600 vs. an average big leaguer. */
export const AMATEUR_TALENT = {
  highSchool: { share: 0.4, age: 18, hitter: [-60, 11], pitcher: [-58, 9] },
  college: { share: 0.6, age: 21, hitter: [-46, 9], pitcher: [-44, 8] },
} as const;

/** Build an amateur (not yet in the league; negative id until he signs). */
export function amateur(rng: Rng, id: number, kind: "highSchool" | "college", pitcher: boolean, shift = 0): Player {
  const t = AMATEUR_TALENT[kind];
  const age = kind === "college" ? t.age + (rng.chance(0.3) ? 1 : 0) : t.age;
  const [mean, sd] = pitcher ? t.pitcher : t.hitter;
  const value = mean + shift + rng.normal(0, sd);
  const p = pitcher
    ? generatePitcher(rng, { id, role: rng.chance(0.7) ? "SP" : "RP", value, age })
    : generateHitter(rng, { id, position: rng.weighted(HITTER_SPOTS, HITTER_WEIGHTS), value, age });
  rawness(p, kind === "college" ? "A+" : "A");
  return p;
}

export function draftClass(rng: Rng, size: number): Player[] {
  const pool: Player[] = [];
  for (let i = 0; i < size; i++) {
    const kind = rng.chance(AMATEUR_TALENT.highSchool.share) ? "highSchool" : "college";
    pool.push(amateur(rng, -(i + 1), kind, rng.chance(0.5)));
  }
  return pool;
}

/** Worst record first; run differential breaks ties. */
export function draftOrder(season: Season): number[] {
  return [...season.records]
    .sort((a, b) => a.w / Math.max(1, a.w + a.l) - b.w / Math.max(1, b.w + b.l) || a.rs - a.ra - (b.rs - b.ra))
    .map((r) => r.teamId);
}

export function createDraft(league: League, season: Season, rng: Rng): DraftState {
  return {
    order: draftOrder(season),
    rounds: DRAFT_ROUNDS,
    pool: draftClass(rng, Math.round(league.teams.length * DRAFT_ROUNDS * 1.5)),
    picks: [],
  };
}

/** Who's on the clock (null when the draft is over). */
export function onTheClock(d: DraftState): { round: number; pick: number; teamId: number } | null {
  const n = d.picks.length;
  const total = d.order.length * d.rounds;
  if (n >= total || d.pool.length === 0) return null;
  return { round: Math.floor(n / d.order.length) + 1, pick: n + 1, teamId: d.order[n % d.order.length]! };
}

const boardCache = new WeakMap<Player, number>();
/** The draft board: projected peak value, with a nudge toward players closer to the majors. */
export function boardValue(p: Player): number {
  let v = boardCache.get(p);
  if (v === undefined) {
    v = peakValue(p) + (p.age >= 21 ? 2 : 0);
    boardCache.set(p, v);
  }
  return v;
}

/** The best prospect left on a club's board, as its own scouts see the class. */
export function bestAvailable(league: League, d: DraftState, teamId: number): Player | undefined {
  let best: Player | undefined;
  let bestScore = -Infinity;
  for (const p of d.pool) {
    const score = boardValue(p) + valueShift(league, teamId, p, true);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/** Sign an amateur into an organization: he gets a real id and joins the league. */
export function signAmateur(league: League, team: Team, p: Player): Player {
  const poolId = p.id;
  p.id = league.players.length;
  carryReport(league, p, poolId);
  p.teamId = team.id;
  p.level = p.age >= 21 && boardValue(p) > -10 ? "A+" : "A";
  p.contract = minorContract();
  league.players.push(p);
  team.rosters[p.level].push(p.id);
  return p;
}

export function makePick(league: League, d: DraftState, teamId: number, poolId: number, day: number): Player | null {
  const clock = onTheClock(d);
  if (!clock || clock.teamId !== teamId) return null;
  const i = d.pool.findIndex((p) => p.id === poolId);
  if (i < 0) return null;
  const [p] = d.pool.splice(i, 1);
  const team = league.teams[teamId]!;
  const round = clock.round;
  const pickInRound = ((clock.pick - 1) % d.order.length) + 1;
  signAmateur(league, team, p!);
  p!.draft = { year: league.year, round, pick: clock.pick, teamId };
  d.picks.push({ round, pick: clock.pick, teamId, playerId: p!.id });
  const hand = p!.pitching ? (p!.throws === "L" ? "LHP" : "RHP") : p!.position;
  const school = p!.age >= 21 ? "college" : "high school";
  logTransaction(league, day, team, p!, "draft", `Drafted ${hand} ${playerName(p!)} (${school}) in round ${round}, pick ${pickInRound} (#${clock.pick} overall)`);
  return p!;
}

/** Let the AI pick until `stopAt` is on the clock (or the draft ends). Returns picks made. */
export function simDraft(league: League, d: DraftState, day: number, stopAt: number | null): number {
  let made = 0;
  for (;;) {
    const clock = onTheClock(d);
    if (!clock || clock.teamId === stopAt) return made;
    const choice = bestAvailable(league, d, clock.teamId);
    if (!choice) return made;
    makePick(league, d, clock.teamId, choice.id, day);
    made++;
  }
}
