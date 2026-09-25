import { hashNormal, seedHash } from "../core/hash";
import { clamp } from "../core/math";
import type { Rng } from "../core/rng";
import { dials } from "../league/settings";
import type { League, Team } from "../league/types";
import { DEFENSE_TOOL_WEIGHTS } from "../players/defense";
import { OFFENSE_WEIGHTS, PITCHING_WEIGHTS } from "../players/generate";
import type { Player, ToolGrade } from "../players/types";
import { bestPosition, canStart, DEFENSE_RUNS_PER_Z } from "../org/value";
import type { ScoutingState } from "./types";

/**
 * Scouting: what a club believes about a player, as opposed to the truth.
 *
 * Every club sees each player through its own scouts: the true grade plus an
 * error. The error's size depends on the club's scouting department, how well
 * it knows the player (its own organization best, amateurs worst), the tool
 * (speed and arm strength are easy to measure; the hit tool and command are
 * not), and how many times the club has sent a scout to see him. The error
 * itself comes from a stable hash of (club, player, tool), so a report doesn't
 * flicker from day to day; part of it is redrawn each year. Nothing here is
 * saved except the department levels and the user's looks.
 *
 * The simulation always runs on true grades. Beliefs only drive decisions:
 * the user's screens, and the AI clubs' draft boards, free-agent bids,
 * international signings and trade evaluations.
 */

export interface Department {
  tier: number;
  label: string;
  /** Annual cost, $M. */
  cost: number;
}

export const SCOUTING_TIERS: (Department & { sigma: number })[] = [
  { tier: 1, label: "Bare bones", cost: 2, sigma: 7.0 },
  { tier: 2, label: "Thin", cost: 4, sigma: 5.6 },
  { tier: 3, label: "Solid", cost: 6, sigma: 4.6 },
  { tier: 4, label: "Strong", cost: 9, sigma: 3.7 },
  { tier: 5, label: "Elite", cost: 13, sigma: 2.9 },
];

export const ANALYTICS_TIERS: (Department & { trust: number; basis: string })[] = [
  { tier: 1, label: "A spreadsheet", cost: 1, trust: 0.35, basis: "runs allowed and wOBA" },
  { tier: 2, label: "A small group", cost: 2.5, trust: 0.5, basis: "ERA and wOBA" },
  { tier: 3, label: "Solid", cost: 4, trust: 0.65, basis: "FIP and a wOBA/xwOBA blend" },
  { tier: 4, label: "Strong", cost: 6, trust: 0.8, basis: "FIP/SIERA and mostly xwOBA" },
  { tier: 5, label: "Industry-leading", cost: 9, trust: 0.9, basis: "SIERA and xwOBA" },
];

/** How hard each tool is to read, relative to the department's baseline error. */
const TOOL_DIFFICULTY = {
  hit: 1.2,
  power: 0.8,
  eye: 1.0,
  speed: 0.45,
  field: 0.9,
  arm: 0.6,
  stuff: 0.75,
  control: 0.9,
  command: 1.2,
  stamina: 0.8,
} as const;

/** How familiar a club is with a player, as a multiplier on its error. */
export const FAMILIARITY = {
  own: 0.45,
  bigLeaguer: 0.7,
  upperMinors: 0.95,
  lowerMinors: 1.05,
  freeAgentVeteran: 0.75,
  freeAgent: 1.0,
  college: 1.25,
  amateur: 1.5,
} as const;

/** Each look a club's scouts take narrows its error: 1 look about 20%, 3 about 40%, 5 about half. */
const lookFactor = (looks: number) => 1 / Math.sqrt(1 + 0.6 * looks);

/** Looks the user gets per window: each week in season, each phase in the winter. */
export const looksAllowance = (tier: number, offseason: boolean) => (offseason ? 4 + 2 * tier : 2 + tier);

export function defaultScouting(league: League, rng: Rng): ScoutingState {
  // Richer clubs tend to spend more, but not always, and analytics is its own bet.
  const tier = (t: Team, spread: number) => Math.round(clamp(1 + (t.budget - 85) / 45 + rng.normal(0, spread), 1, 5));
  return {
    scouting: league.teams.map((t) => tier(t, 0.7)),
    analytics: league.teams.map((t) => tier(t, 1.1)),
    looks: {},
    looksLeft: 0,
    looksWindow: "",
  };
}

export const staffCost = (league: League, team: Team) =>
  SCOUTING_TIERS[league.scouting.scouting[team.id]! - 1]!.cost + ANALYTICS_TIERS[league.scouting.analytics[team.id]! - 1]!.cost;

// ---------------------------------------------------------------------------
// Errors

/**
 * The identity a player's reports hang on. Amateurs in a draft or signing
 * pool have temporary ids that repeat every year, so theirs includes the
 * year; when they sign they keep it, so the report doesn't change hands.
 */
export function scoutKey(league: League, p: Player): number {
  if (p.scoutKey !== undefined) return p.scoutKey;
  return p.id < 0 ? p.id * 7919 + league.year : p.id;
}

/** Who's looking: a club (its id), or null for a neutral, league-average read. */
export type Viewer = number | null;

function familiarity(league: League, viewer: Viewer, p: Player): number {
  let f: number;
  if (p.id < 0 || (p.teamId === null && p.service === 0 && p.career.length === 0)) {
    f = p.age >= 21 ? FAMILIARITY.college : FAMILIARITY.amateur;
  } else if (p.teamId === null) {
    f = p.service > 0 ? FAMILIARITY.freeAgentVeteran : FAMILIARITY.freeAgent;
  } else if (viewer !== null && p.teamId === viewer) {
    f = FAMILIARITY.own;
  } else if (p.level === "MLB") {
    f = FAMILIARITY.bigLeaguer;
  } else {
    f = p.level === "AAA" || p.level === "AA" ? FAMILIARITY.upperMinors : FAMILIARITY.lowerMinors;
  }
  if (viewer !== null && viewer === league.userTeamId) f *= lookFactor(league.scouting.looks[p.id] ?? 0);
  return f;
}

/** The club's baseline error for this player, in grade points (before tool difficulty). */
export function uncertainty(league: League, viewer: Viewer, p: Player): number {
  const tier = viewer === null ? 3 : league.scouting.scouting[viewer]!;
  // Difficulty sharpens or blurs the user's scouts (and on Hard, sharpens everyone else's).
  const d = dials(league);
  const scale = viewer === null ? 1 : viewer === league.userTeamId ? d.userScoutError : d.rivalScoutError;
  return SCOUTING_TIERS[tier - 1]!.sigma * familiarity(league, viewer, p) * scale;
}

type ToolKey = keyof typeof TOOL_DIFFICULTY;

/** Present and future errors (grade points) for one tool. `slot` distinguishes pitches. */
function toolError(league: League, viewer: Viewer, p: Player, key: ToolKey, slot: number, sigma: number) {
  const seed = seedHash(league.seed);
  const who = viewer === null ? 97 : viewer;
  const pid = scoutKey(league, p);
  const keyId = Object.keys(TOOL_DIFFICULTY).indexOf(key) * 16 + slot;
  const z = 0.8 * hashNormal(seed, who, pid, keyId, 11) + 0.6 * hashNormal(seed, who, pid, keyId, league.year);
  const s = sigma * TOOL_DIFFICULTY[key];
  const present = s * z;
  // Projection is harder than evaluation, and more so the further off the peak is.
  const reach = clamp((27 - p.age) / 8, 0, 1);
  const future = present + s * 0.8 * reach * hashNormal(seed, who, pid, keyId, 23);
  return { present, future };
}

function shifted(t: ToolGrade, e: { present: number; future: number }): ToolGrade {
  const present = Math.round(clamp(t.present + e.present, 20, 80) * 10) / 10;
  const future = Math.round(clamp(Math.max(present, t.future + e.future), 20, 80) * 10) / 10;
  return { present, future };
}

/** The player as a club's scouts see him: same person, perceived grades. */
export function perceive(league: League, viewer: Viewer, p: Player): Player {
  const sigma = uncertainty(league, viewer, p);
  const e = (key: ToolKey, slot = 0) => toolError(league, viewer, p, key, slot, sigma);
  const h = p.hitting;
  const hitting = p.pitching
    ? h
    : {
        hit: shifted(h.hit, e("hit")),
        power: shifted(h.power, e("power")),
        eye: shifted(h.eye, e("eye")),
        speed: shifted(h.speed, e("speed")),
        field: shifted(h.field, e("field")),
        arm: shifted(h.arm, e("arm")),
      };
  const pit = p.pitching;
  const pitching = pit
    ? {
        ...pit,
        pitches: pit.pitches.map((x, i) => ({ ...x, grade: shifted(x.grade, e("stuff", i)) })),
        control: shifted(pit.control, e("control")),
        command: shifted(pit.command, e("command")),
        stamina: shifted(pit.stamina, e("stamina")),
      }
    : undefined;
  return { ...p, hitting, pitching };
}

/**
 * How far a club's read of a player's value is off, in runs per season (the
 * same scale as `playerValue`), today or at his projected peak. A fast linear
 * version of comparing `perceive` against the truth, for AI decisions that
 * weigh hundreds of players.
 */
export function valueShift(league: League, viewer: Viewer, p: Player, future = false): number {
  const sigma = uncertainty(league, viewer, p);
  const pick = (key: ToolKey, slot = 0) => {
    const err = toolError(league, viewer, p, key, slot, sigma);
    return future ? err.future : err.present;
  };
  if (p.pitching) {
    const pit = p.pitching;
    const usage = pit.pitches.reduce((s, x) => s + x.usage, 0);
    const stuff = pit.pitches.reduce((s, x, i) => s + x.usage * pick("stuff", i), 0) / usage;
    const W = PITCHING_WEIGHTS;
    const runs = (W.stuff * stuff + W.control * pick("control") + W.command * pick("command")) / 10;
    return runs * (canStart(p) ? 1.25 : 0.45);
  }
  const W = OFFENSE_WEIGHTS;
  let runs = (W.hit * pick("hit") + W.power * pick("power") + W.eye * pick("eye") + W.speed * pick("speed")) / 10;
  const pos = bestPosition(p).pos;
  if (pos !== "DH") {
    const w = DEFENSE_TOOL_WEIGHTS[pos];
    runs += (DEFENSE_RUNS_PER_Z[pos] * (w.field * pick("field") + w.arm * pick("arm") + w.speed * pick("speed"))) / 10;
  }
  return runs;
}

// ---------------------------------------------------------------------------
// The user's looks

function lookWindow(league: League, day: number): string {
  const w = league.offseason;
  return w ? `${league.year}:${w.phase}` : `${league.year}:w${Math.floor(day / 7)}`;
}

/** Looks left for the user right now (the allowance refills each week, and each winter phase). */
export function looksLeft(league: League, day: number): number {
  const s = league.scouting;
  const user = league.userTeamId;
  if (user === null) return 0;
  const window = lookWindow(league, day);
  if (s.looksWindow !== window) {
    s.looksWindow = window;
    s.looksLeft = looksAllowance(s.scouting[user]!, league.offseason !== null);
  }
  return s.looksLeft;
}

export function takeLook(league: League, day: number, p: Player): { ok: boolean; reason?: string } {
  const user = league.userTeamId;
  if (user === null) return { ok: false, reason: "You don't run a club." };
  if (p.teamId === user) return { ok: false, reason: "Your own scouts see him every day." };
  if (looksLeft(league, day) <= 0) return { ok: false, reason: "Your scouts are all out. More looks open up next week." };
  league.scouting.looksLeft--;
  league.scouting.looks[p.id] = (league.scouting.looks[p.id] ?? 0) + 1;
  return { ok: true };
}

/** When an amateur signs, his report (and the user's looks at him) follow him to his real id. */
export function carryReport(league: League, p: Player, poolId: number): void {
  p.scoutKey = poolId * 7919 + league.year;
  const looks = league.scouting.looks[poolId];
  if (looks) {
    league.scouting.looks[p.id] = looks;
    delete league.scouting.looks[poolId];
  }
}

/** Forget looks at last winter's amateurs (their pool ids get reused). */
export function clearAmateurLooks(league: League): void {
  for (const key of Object.keys(league.scouting.looks)) if (Number(key) < 0) delete league.scouting.looks[Number(key)];
}
