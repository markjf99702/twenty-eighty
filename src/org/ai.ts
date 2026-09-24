import type { Rng } from "../core/rng";
import type { Team } from "../league/types";
import { IL_THRESHOLD_DAYS } from "../players/injuries";
import { generateHitter, generatePitcher } from "../players/generate";
import { type FieldPosition, type Level, MINOR_LEVELS, type MinorLevel, type Player } from "../players/types";
import {
  activateFromIl,
  activeLimit,
  activePitchers,
  assignMinors,
  callUp,
  canActivate,
  canCallUp,
  canOption,
  designateForAssignment,
  FORTY_MAN_LIMIT,
  ilDaysServed,
  logTransaction,
  MIN_IL_DAYS,
  optionPlayer,
  pitcherLimit,
  placeOnIl,
  refreshDepth,
  releasePlayer,
  type RosterContext,
  transferTo60,
} from "./roster";
import { canStart, offenseValue, pitchingValue, playerValue } from "./value";

/**
 * The AI front office. Every club (and the user's, unless they take the
 * wheel) runs these each day: injured-list moves, activations, keeping the
 * active roster full and balanced, weekly performance swaps between the
 * majors and AAA, and promotions up the farm system.
 *
 * The AI judges players by their grades blended with how they're actually
 * performing, so a slumping veteran can lose his job and a hot prospect can
 * force his way up.
 */

/** Recent performance, in runs per 600 PA / BF vs. level average, with sample size. */
export type PerformanceLookup = (p: Player) => { runs: number; sample: number } | null;

export interface AiOptions {
  performance?: PerformanceLookup;
  /** Weekly and farm-system moves run only on these days. */
  weekly: boolean;
  farmCheck: boolean;
  /** Waiver priority (worst record first). */
  waiverOrder: Team[];
  rng: Rng;
}

const MIN_HITTERS = 12;
const MIN_PITCHERS = 11;
const MAX_MINOR_ROSTER = 28;

const isPitcher = (p: Player) => Boolean(p.pitching);
const healthy = (p: Player) => !p.injury || p.injury.daysLeft <= 0;

/**
 * What the AI believes a player is worth right now (runs per season-ish).
 * Grades are the prior; production pulls the estimate as the sample grows.
 */
function estimate(p: Player, perf?: PerformanceLookup): number {
  const seen = perf?.(p);
  if (p.pitching) {
    const scale = canStart(p) ? 1.25 : 0.45;
    const base = pitchingValue(p);
    if (!seen) return base * scale;
    const w = seen.sample / (seen.sample + 350);
    return scale * ((1 - w) * base + w * seen.runs);
  }
  const total = playerValue(p);
  if (!seen) return total;
  // Only the bat is measured by production; defense stays as graded.
  const w = seen.sample / (seen.sample + 450);
  return total + w * (seen.runs - offenseValue(p));
}

const byValueDesc = (perf?: PerformanceLookup) => (a: Player, b: Player) => estimate(b, perf) - estimate(a, perf);

function players(ctx: RosterContext, ids: number[]): Player[] {
  return ids.map((id) => ctx.league.players[id]!);
}

function catchersActive(ctx: RosterContext, team: Team): number {
  return players(ctx, team.rosters.MLB).filter((p) => p.position === "C" && healthy(p)).length;
}

/** Best call-up candidate of a type from the upper minors. */
function bestCandidate(ctx: RosterContext, team: Team, wantPitcher: boolean, opts: AiOptions, preferPos?: FieldPosition): Player | undefined {
  const pool = [...players(ctx, team.rosters.AAA), ...players(ctx, team.rosters.AA)].filter(
    // callUpBest makes room on the 40-man if the choice needs it.
    (p) => isPitcher(p) === wantPitcher && healthy(p) && p.optionedDay !== ctx.day && canCallUp(ctx, team, p, true, true).ok,
  );
  if (pool.length === 0) return undefined;
  const score = (p: Player) =>
    estimate(p, opts.performance) + (p.onFortyMan ? 4 : 0) + (preferPos && p.position === preferPos ? 15 : 0) - (p.level === "AA" ? 6 : 0);
  return pool.reduce((a, b) => (score(b) > score(a) ? b : a));
}

/** Make room on the 40-man: move a long-term injury to the 60-day list, or DFA the weakest minor leaguer on it. */
function openFortyManSpot(ctx: RosterContext, team: Team, opts: AiOptions): boolean {
  if (team.fortyMan.length < FORTY_MAN_LIMIT) return true;
  const longInjury = players(ctx, team.injured).find((p) => p.il && p.il !== "IL60" && (p.injury?.daysLeft ?? 0) > 45);
  if (longInjury) return transferTo60(ctx, team, longInjury).ok;
  const expendable = players(ctx, team.fortyMan)
    .filter((p) => p.level !== "MLB" && !p.il)
    .sort((a, b) => playerValue(a, true) + playerValue(a) - (playerValue(b, true) + playerValue(b)))[0];
  if (!expendable) return false;
  return designateForAssignment(ctx, team, expendable, opts.waiverOrder).ok;
}

function callUpBest(ctx: RosterContext, team: Team, wantPitcher: boolean, opts: AiOptions, preferPos?: FieldPosition): boolean {
  const c = bestCandidate(ctx, team, wantPitcher, opts, preferPos);
  if (!c) return false;
  if (!c.onFortyMan && !openFortyManSpot(ctx, team, opts)) return false;
  return callUp(ctx, team, c, true).ok;
}

// ---------------------------------------------------------------------------

function handleInjuries(ctx: RosterContext, team: Team, opts: AiOptions): void {
  for (const p of players(ctx, [...team.rosters.MLB])) {
    if (!p.injury || p.injury.daysLeft < IL_THRESHOLD_DAYS) continue;
    if (!placeOnIl(ctx, team, p).ok) continue;
    const needCatcher = p.position === "C" && catchersActive(ctx, team) < 2;
    callUpBest(ctx, team, isPitcher(p), opts, needCatcher ? "C" : undefined);
  }
}

function handleActivations(ctx: RosterContext, team: Team, opts: AiOptions): void {
  for (const p of players(ctx, [...team.injured])) {
    if (p.injury && p.injury.daysLeft > 0) continue;
    if (p.il === "IL60" && !openFortyManSpot(ctx, team, opts)) continue;
    if (canActivate(ctx, team, p, "MLB").ok) {
      activateFromIl(ctx, team, p, "MLB");
      continue;
    }
    // A minimum stay not yet served: nothing to clear space for yet.
    if (ilDaysServed(ctx, p) < MIN_IL_DAYS[p.il!]) continue;
    // A pitcher can't come back while the staff is at the pitcher limit, even with an open spot.
    if (p.pitching && team.rosters.MLB.length < activeLimit(ctx) && activePitchers(ctx.league, team) >= pitcherLimit(ctx)) {
      const hitter = players(ctx, team.rosters.MLB).find((x) => !x.pitching && canOption(ctx, team, x).ok);
      if (!hitter) continue;
    }
    // Roster is full: send down the weakest optionable player of the same type,
    // or DFA the weakest if he's clearly worse than the returning player.
    const sameType = players(ctx, team.rosters.MLB)
      .filter((x) => isPitcher(x) === isPitcher(p))
      .sort((a, b) => estimate(a, opts.performance) - estimate(b, opts.performance));
    const optionable = sameType.find((x) => canOption(ctx, team, x).ok);
    const worst = sameType[0];
    if (optionable && estimate(optionable, opts.performance) < estimate(p, opts.performance) + 10) {
      optionPlayer(ctx, team, optionable);
    } else if (canActivate(ctx, team, p, "AAA").ok && !optionable) {
      activateFromIl(ctx, team, p, "AAA");
      continue;
    } else if (worst && estimate(worst, opts.performance) < estimate(p, opts.performance)) {
      designateForAssignment(ctx, team, worst, opts.waiverOrder);
    } else if (optionable) {
      optionPlayer(ctx, team, optionable);
    }
    if (canActivate(ctx, team, p, "MLB").ok) activateFromIl(ctx, team, p, "MLB");
  }
}

function fillActiveRoster(ctx: RosterContext, team: Team, opts: AiOptions): void {
  const limit = activeLimit(ctx);
  const pitcherTarget = Math.min(pitcherLimit(ctx), Math.ceil(limit / 2));
  let guard = 0;
  while (team.rosters.MLB.length < limit && guard++ < 6) {
    const needPitcher = activePitchers(ctx.league, team) < pitcherTarget;
    const needCatcher = !needPitcher && catchersActive(ctx, team) < 2;
    if (!callUpBest(ctx, team, needPitcher, opts, needCatcher ? "C" : undefined)) {
      if (!callUpBest(ctx, team, !needPitcher, opts)) break;
    }
  }
}

/** Weekly: swap an underperforming big leaguer for a better AAA option. */
function performanceMoves(ctx: RosterContext, team: Team, opts: AiOptions): void {
  for (const wantPitcher of [true, false]) {
    const active = players(ctx, team.rosters.MLB)
      .filter((p) => isPitcher(p) === wantPitcher && healthy(p))
      .sort((a, b) => estimate(a, opts.performance) - estimate(b, opts.performance));
    const incumbent = active[0];
    const candidate = bestCandidate(ctx, team, wantPitcher, opts);
    if (!incumbent || !candidate) continue;
    // Keep a second catcher around.
    if (incumbent.position === "C" && catchersActive(ctx, team) <= 2 && candidate.position !== "C") continue;
    const gain = estimate(candidate, opts.performance) - estimate(incumbent, opts.performance);
    const optionable = canOption(ctx, team, incumbent).ok;
    if (gain < (optionable ? 8 : 18)) continue;
    if (!candidate.onFortyMan && !openFortyManSpot(ctx, team, opts)) continue;
    if (optionable) optionPlayer(ctx, team, incumbent);
    else designateForAssignment(ctx, team, incumbent, opts.waiverOrder);
    callUp(ctx, team, candidate, true);
  }
}

/** Every couple of weeks: move players up the ladder when they've outgrown a level. */
function farmMoves(ctx: RosterContext, team: Team, opts: AiOptions): void {
  // Top of the ladder first, and nobody moves twice in one day.
  const ladder: [MinorLevel, MinorLevel][] = [
    ["AA", "AAA"],
    ["A+", "AA"],
    ["A", "A+"],
  ];
  const moved = new Set<number>();
  for (const [from, to] of ladder) {
    for (const wantPitcher of [true, false]) {
      const eligible = (p: Player) => isPitcher(p) === wantPitcher && healthy(p) && !moved.has(p.id);
      const lower = players(ctx, team.rosters[from]).filter(eligible);
      const upper = players(ctx, team.rosters[to]).filter(eligible);
      if (lower.length === 0 || upper.length === 0) continue;
      const best = lower.sort(byValueDesc(opts.performance))[0]!;
      const worst = upper.sort(byValueDesc(opts.performance))[upper.length - 1]!;
      if (estimate(best, opts.performance) > estimate(worst, opts.performance) + 6) {
        assignMinors(ctx, team, best, to);
        assignMinors(ctx, team, worst, from);
        moved.add(best.id);
        moved.add(worst.id);
      }
    }
  }
}

function signFiller(ctx: RosterContext, team: Team, level: MinorLevel, pitcher: boolean, rng: Rng): void {
  const age = rng.int(19, 23);
  const value = -48 + rng.normal(0, 7);
  const id = ctx.league.players.length;
  const p = pitcher
    ? generatePitcher(rng, { id, role: rng.chance(0.5) ? "SP" : "RP", value, age })
    : generateHitter(rng, { id, position: rng.pick(["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const), value, age });
  p.teamId = team.id;
  p.level = level;
  ctx.league.players.push(p);
  team.rosters[level].push(p.id);
  logTransaction(ctx.league, ctx.day, team, p, "promote", `Signed ${p.firstName} ${p.lastName} to a minor league contract (${level})`);
}

/** Keep every affiliate able to field a team: enough healthy hitters, a catcher, and arms. */
function balanceMinors(ctx: RosterContext, team: Team, opts: AiOptions): void {
  const levels = MINOR_LEVELS;
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i]!;
    const below = levels[i + 1];
    for (const wantPitcher of [true, false]) {
      const need = wantPitcher ? MIN_PITCHERS : MIN_HITTERS;
      let guard = 0;
      while (guard++ < 8) {
        const have = players(ctx, team.rosters[level]).filter((p) => isPitcher(p) === wantPitcher && healthy(p));
        const catchers = have.filter((p) => p.position === "C").length;
        const short = have.length < need || (!wantPitcher && catchers === 0);
        if (!short) break;
        const wantCatcher = !wantPitcher && catchers === 0;
        if (below) {
          const pool = players(ctx, team.rosters[below]).filter(
            (p) => isPitcher(p) === wantPitcher && healthy(p) && (!wantCatcher || p.position === "C"),
          );
          if (pool.length > need - 3 || wantCatcher) {
            const up = pool.sort(byValueDesc(opts.performance))[0];
            if (up) {
              assignMinors(ctx, team, up, level);
              continue;
            }
          }
        }
        if (wantCatcher) {
          const id = ctx.league.players.length;
          const p = generateHitter(opts.rng, { id, position: "C", value: -45, age: opts.rng.int(20, 26) });
          p.teamId = team.id;
          p.level = level;
          ctx.league.players.push(p);
          team.rosters[level].push(p.id);
          logTransaction(ctx.league, ctx.day, team, p, "promote", `Signed C ${p.firstName} ${p.lastName} to a minor league contract (${level})`);
          continue;
        }
        signFiller(ctx, team, level, wantPitcher, opts.rng);
      }
    }
    // Trim bloated rosters from the bottom (injured players don't count against
    // the limit): send the weakest down, or release at the lowest level.
    let guard = 0;
    while (players(ctx, team.rosters[level]).filter(healthy).length > MAX_MINOR_ROSTER && guard++ < 6) {
      const worst = players(ctx, team.rosters[level])
        .filter((p) => !p.onFortyMan && healthy(p) && p.optionedDay !== ctx.day)
        .sort((a, b) => playerValue(a, true) - playerValue(b, true))[0];
      if (!worst) break;
      if (below) assignMinors(ctx, team, worst, below);
      else releasePlayer(ctx, team, worst);
    }
  }
}

export function manageOrganization(ctx: RosterContext, team: Team, opts: AiOptions): void {
  handleInjuries(ctx, team, opts);
  handleActivations(ctx, team, opts);
  fillActiveRoster(ctx, team, opts);
  if (opts.weekly) performanceMoves(ctx, team, opts);
  if (opts.farmCheck) farmMoves(ctx, team, opts);
  balanceMinors(ctx, team, opts);
  refreshDepth(ctx.league, team);
}

/** Healthy players at a level (for lineups and rotations). */
export function available(ctx: RosterContext, team: Team, level: Level): Player[] {
  return players(ctx, team.rosters[level]).filter(healthy);
}

export { estimate as aiEstimate };
