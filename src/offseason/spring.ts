import type { League, Team } from "../league/types";
import { ensureMajorContract } from "../org/contracts";
import { designateForAssignment, FORTY_MAN_LIMIT, refreshDepth, releasePlayer, type RosterContext } from "../org/roster";
import { canStart, peakValue, playerValue } from "../org/value";
import { defenseGrade } from "../players/defense";
import { LEVELS, type MinorLevel, MINOR_LEVELS, type Player } from "../players/types";

/**
 * Spring training: the winter heals most injuries, every club trims its 40-man
 * roster and protects its best prospects on it, picks an Opening Day 26 and
 * sorts the rest of the organization into
 * its four affiliates by ability (with age floors, so teenagers start low).
 * Players who don't fit anywhere are released.
 */

const WINTER_HEALING_DAYS = 150;
const ACTIVE_PITCHERS = 13;
const ACTIVE_HITTERS = 13;
/** Players per affiliate: 13 pitchers and 13 position players. */
const PER_LEVEL = 13;
const MIN_AGE: Record<MinorLevel, number> = { AAA: 21, AA: 20, "A+": 19, A: 0 };

const hurt = (p: Player) => p.injury !== null && p.injury.daysLeft > 0;

export function healOverWinter(league: League): void {
  for (const p of league.players) {
    if (!p.injury) continue;
    p.injury.daysLeft -= WINTER_HEALING_DAYS;
    p.injury.startDay = -1;
    if (p.injury.daysLeft <= 0) p.injury = null;
  }
}

/** Worth keeping in the organization: today's value, or a prospect's projected peak. */
export const keepScore = (p: Player) => Math.max(playerValue(p), peakValue(p) - 8) - (p.age >= 28 && !p.onFortyMan ? 6 : 0);

/** DFA the weakest until the 40-man fits (long-term injuries are headed to the 60-day list and don't count). */
function trimFortyMan(ctx: RosterContext, team: Team, waiverOrder: Team[]): void {
  const league = ctx.league;
  const counted = () => team.fortyMan.filter((id) => (league.players[id]!.injury?.daysLeft ?? 0) <= 60).length;
  let guard = 0;
  while (counted() > FORTY_MAN_LIMIT && guard++ < 20) {
    const cut = team.fortyMan
      .map((id) => league.players[id]!)
      .filter((p) => !p.il && (p.injury?.daysLeft ?? 0) <= 60)
      .sort((a, b) => keepScore(a) - keepScore(b))[0];
    if (!cut || !designateForAssignment(ctx, team, cut, waiverOrder).ok) break;
  }
}

/** How much better (runs) a minor leaguer has to be than the weakest 40-man player to take his spot. */
const PROTECT_MARGIN = 6;
const MAX_PROTECTED = 5;

/**
 * Protect the organization's best players who aren't on the 40-man yet (young
 * players who've outgrown the minors, prospects with big futures) by
 * designating its weakest 40-man players to make room, a few a winter.
 */
function protectProspects(ctx: RosterContext, team: Team, waiverOrder: Team[]): void {
  const league = ctx.league;
  const org = () => [...new Set(MINOR_LEVELS.flatMap((l) => team.rosters[l]))].map((id) => league.players[id]!);
  for (let n = 0; n < MAX_PROTECTED; n++) {
    const best = org()
      .filter((p) => !p.onFortyMan && !hurt(p) && !p.il)
      .sort((a, b) => keepScore(b) - keepScore(a))[0];
    if (!best) return;
    const weakest = team.fortyMan
      .map((id) => league.players[id]!)
      .filter((p) => !p.il && !hurt(p) && Boolean(p.pitching) === Boolean(best.pitching))
      .sort((a, b) => keepScore(a) - keepScore(b))[0];
    if (team.fortyMan.length >= FORTY_MAN_LIMIT) {
      if (!weakest || keepScore(best) < keepScore(weakest) + PROTECT_MARGIN) return;
      if (!designateForAssignment(ctx, team, weakest, waiverOrder).ok) return;
    } else if (weakest && keepScore(best) < keepScore(weakest)) {
      return;
    }
    best.onFortyMan = true;
    team.fortyMan.push(best.id);
    ensureMajorContract(best);
  }
}

/** Enough healthy hitters and pitchers on the 40-man to fill an Opening Day roster (with depth). */
const FORTY_MAN_MIX = { hitters: 16, pitchers: 17 };

function balanceFortyMan(ctx: RosterContext, team: Team, waiverOrder: Team[]): void {
  const league = ctx.league;
  const org = () => [...new Set([...LEVELS.flatMap((l) => team.rosters[l]), ...team.injured])].map((id) => league.players[id]!);
  for (const pitchers of [false, true]) {
    const need = pitchers ? FORTY_MAN_MIX.pitchers : FORTY_MAN_MIX.hitters;
    const otherNeed = pitchers ? FORTY_MAN_MIX.hitters : FORTY_MAN_MIX.pitchers;
    let guard = 0;
    while (guard++ < 12) {
      const members = org();
      const onForty = members.filter((p) => p.onFortyMan && !hurt(p));
      const have = onForty.filter((p) => Boolean(p.pitching) === pitchers).length;
      if (have >= need) break;
      const add = members
        .filter((p) => !p.onFortyMan && !hurt(p) && Boolean(p.pitching) === pitchers && !p.il)
        .sort((a, b) => playerValue(b) - playerValue(a))[0];
      if (!add) break;
      if (team.fortyMan.length >= FORTY_MAN_LIMIT) {
        const others = onForty.filter((p) => Boolean(p.pitching) !== pitchers);
        if (others.length <= otherNeed) break;
        const cut = others.filter((p) => !p.il).sort((a, b) => keepScore(a) - keepScore(b))[0];
        if (!cut || !designateForAssignment(ctx, team, cut, waiverOrder).ok) break;
      }
      add.onFortyMan = true;
      team.fortyMan.push(add.id);
      ensureMajorContract(add);
    }
  }
}

/** Opening Day 26: five starters and eight relievers, two catchers, and the best bats and gloves. */
function openingDay(fortyMan: Player[]): Set<number> {
  const healthy = fortyMan.filter((p) => !hurt(p));
  const pitchers = healthy.filter((p) => p.pitching).sort((a, b) => playerValue(b) - playerValue(a));
  const starters = pitchers.filter(canStart).slice(0, 5);
  const staff = [...starters, ...pitchers.filter((p) => !starters.includes(p))].slice(0, ACTIVE_PITCHERS);

  const hitters = healthy.filter((p) => !p.pitching).sort((a, b) => playerValue(b) - playerValue(a));
  const catchers = hitters.filter((p) => defenseGrade(p, "C") >= 40 && p.positions.includes("C")).slice(0, 2);
  const bats = [...catchers];
  for (const need of ["SS", "CF"] as const) {
    if (!bats.some((p) => defenseGrade(p, need) >= 45)) {
      const glove = hitters.find((p) => !bats.includes(p) && defenseGrade(p, need) >= 45);
      if (glove) bats.push(glove);
    }
  }
  for (const p of hitters) if (bats.length < ACTIVE_HITTERS && !bats.includes(p)) bats.push(p);
  return new Set([...staff, ...bats].map((p) => p.id));
}

function reorganize(ctx: RosterContext, team: Team): void {
  const league = ctx.league;
  const members = [...new Set([...LEVELS.flatMap((l) => team.rosters[l]), ...team.injured])].map((id) => league.players[id]!);
  for (const l of LEVELS) team.rosters[l] = [];
  team.injured = [];

  // Still hurt after the winter: to the injured list (the 60-day list frees his 40-man spot).
  for (const p of members) {
    p.optionedDay = null;
    if (!p.onFortyMan || !hurt(p)) continue;
    const long = p.injury!.daysLeft > 60;
    p.il = long ? "IL60" : p.pitching ? "IL15" : "IL10";
    p.ilDay = 0;
    p.level = "MLB";
    team.injured.push(p.id);
    if (long) {
      p.onFortyMan = false;
      team.fortyMan = team.fortyMan.filter((id) => id !== p.id);
    }
  }
  const rest = members.filter((p) => !team.injured.includes(p.id));

  // Opening Day roster from the 40-man (adding minor leaguers if the 40-man is thin).
  let active = openingDay(rest.filter((p) => p.onFortyMan));
  if (active.size < ACTIVE_PITCHERS + ACTIVE_HITTERS) {
    const extra = rest
      .filter((p) => !p.onFortyMan && !hurt(p))
      .sort((a, b) => playerValue(b) - playerValue(a))
      .slice(0, Math.max(0, FORTY_MAN_LIMIT - team.fortyMan.length));
    for (const p of extra) {
      p.onFortyMan = true;
      team.fortyMan.push(p.id);
      ensureMajorContract(p);
    }
    active = openingDay(rest.filter((p) => p.onFortyMan));
  }
  for (const p of rest) {
    if (active.has(p.id)) {
      p.level = "MLB";
      team.rosters.MLB.push(p.id);
    }
  }

  // Everyone else to the farm, best first, with age floors. Released if there's no room.
  const farm = rest.filter((p) => !active.has(p.id)).sort((a, b) => keepScore(b) - keepScore(a));
  const capacity = PER_LEVEL * 2 * MINOR_LEVELS.length;
  const keep = farm.filter((p, i) => p.onFortyMan || i < capacity);
  const cut = farm.filter((p) => !keep.includes(p));
  for (const kind of [true, false]) {
    let pool = keep.filter((p) => Boolean(p.pitching) === kind).sort((a, b) => playerValue(b) - playerValue(a));
    for (const level of MINOR_LEVELS) {
      const last = level === "A";
      const eligible = pool.filter((p) => p.age >= MIN_AGE[level]);
      const chosen = last ? pool : [...eligible.slice(0, PER_LEVEL), ...pool.filter((p) => !eligible.includes(p))].slice(0, PER_LEVEL);
      for (const p of chosen) {
        p.level = level;
        team.rosters[level].push(p.id);
      }
      pool = pool.filter((p) => !chosen.includes(p));
    }
  }
  for (const p of cut) {
    p.level = "A";
    team.rosters.A.push(p.id);
    releasePlayer(ctx, team, p);
  }
  refreshDepth(league, team);
}

/** Heal, trim, and set every organization for Opening Day. */
export function springTraining(ctx: RosterContext, waiverOrder: Team[]): void {
  healOverWinter(ctx.league);
  for (const team of ctx.league.teams) {
    trimFortyMan(ctx, team, waiverOrder);
    // The user protects their own prospects when they run the roster.
    if (!(team.id === ctx.league.userTeamId && team.manualRoster)) protectProspects(ctx, team, waiverOrder);
    balanceFortyMan(ctx, team, waiverOrder);
  }
  for (const team of ctx.league.teams) reorganize(ctx, team);
}
