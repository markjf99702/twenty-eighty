import type { DepthChart, League, Team, TransactionType } from "../league/types";
import {
  FIELD_POSITIONS,
  type IlType,
  isPitcher,
  type Level,
  MAX_OPTION_YEARS,
  MINOR_LEVELS,
  type MinorLevel,
  type Player,
  playerName,
  SERVICE_DAYS_PER_YEAR,
} from "../players/types";
import { maxAssignment } from "../core/assignment";
import { canPlayPosition } from "../players/defense";
import { injuryName } from "../players/injuries";
import { autoDepthChart, slotValue } from "./depth";
import { budgetRoom, ensureMajorContract, followTender, MIN_SALARY, outrightContract, tenderWindow } from "./contracts";
import { peakValue, playerValue } from "./value";

/**
 * Roster rules, simplified from the real ones but faithful where it matters
 * for a GM:
 *
 * - 26-man active roster (28 from September 1), at most 13 pitchers (14).
 * - 40-man reserve list. Only 40-man players can be on the active roster.
 * - Optioning a player to the minors uses one of his three option years
 *   (once per season); veterans with five years of service can't be optioned.
 *   An optioned player must stay down 10 days (15 for pitchers) unless he's
 *   replacing someone who went on the injured list.
 * - Injured list: 10-day (position players), 15-day (pitchers), 60-day. The
 *   60-day list frees a 40-man spot.
 * - Designating a player for assignment removes him from the 40-man. Other
 *   clubs get a waiver claim; if nobody claims him he's outrighted to AAA.
 *
 * Every function returns `{ ok: false, reason }` instead of throwing, so the
 * UI can show why a move isn't allowed.
 */

export type RosterResult = { ok: true } | { ok: false; reason: string };

export interface RosterContext {
  league: League;
  day: number;
  /** September rosters: 28 active, 14 pitchers. */
  expanded: boolean;
  /** Winter and spring training: sending a player down doesn't use an option year. */
  offseason?: boolean;
}

export const ACTIVE_LIMIT = 26;
export const EXPANDED_ACTIVE_LIMIT = 28;
export const PITCHER_LIMIT = 13;
export const EXPANDED_PITCHER_LIMIT = 14;
export const FORTY_MAN_LIMIT = 40;
export const MIN_OPTION_DAYS = { hitter: 10, pitcher: 15 };
export const MIN_IL_DAYS: Record<IlType, number> = { IL10: 10, IL15: 15, IL60: 60 };
/** Veterans with this much service can refuse an option assignment. */
const OPTION_VETO_SERVICE = 5 * SERVICE_DAYS_PER_YEAR;

const ok: RosterResult = { ok: true };
const fail = (reason: string): RosterResult => ({ ok: false, reason });

export const activeLimit = (ctx: RosterContext) => (ctx.expanded ? EXPANDED_ACTIVE_LIMIT : ACTIVE_LIMIT);
export const pitcherLimit = (ctx: RosterContext) => (ctx.expanded ? EXPANDED_PITCHER_LIMIT : PITCHER_LIMIT);

/**
 * Whether the active roster's limits (26 players, 13 pitchers) hold: all season, and in the winter once spring
 * training has set the Opening Day 26. Until then everyone back from the injured list is on it and nobody plays.
 * (By the winter's phase, not its calendar day: offseason.ts imports this file.)
 */
export const activeLimitsApply = (ctx: RosterContext): boolean => !ctx.offseason || ctx.league.offseason?.phase === "spring";

export function positionLabel(p: Player): string {
  if (p.pitching) return p.throws === "L" ? "LHP" : "RHP";
  return p.position;
}

const label = (p: Player) => `${positionLabel(p)} ${playerName(p)}`;

export function logTransaction(league: League, day: number, team: Team, p: Player, type: TransactionType, text: string): void {
  league.transactions.push({ year: league.year, day, teamId: team.id, playerId: p.id, type, text });
}

export function activePitchers(league: League, team: Team): number {
  return team.rosters.MLB.filter((id) => league.players[id]!.pitching).length;
}

export function optionsRemaining(p: Player): number {
  return MAX_OPTION_YEARS - p.options.used + (p.options.usedThisYear ? 1 : 0);
}

export function canBeOptioned(p: Player): boolean {
  if (p.service >= OPTION_VETO_SERVICE) return false;
  return p.options.usedThisYear || p.options.used < MAX_OPTION_YEARS;
}

const LINEUP = [...FIELD_POSITIONS, "DH"] as const;
type LineupSlot = (typeof LINEUP)[number];
const slotOf = (d: DepthChart, slot: LineupSlot) => (slot === "DH" ? d.dh : d.starters[slot]);
function setSlot(d: DepthChart, slot: LineupSlot, id: number): void {
  if (slot === "DH") d.dh = id;
  else d.starters[slot] = id;
}
const sameOrder = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Rebuild the MLB depth chart after a move. The manager draws every club's,
 * except the parts of the user's that the user sets (the lineup, the pitching
 * staff), which follow his plan: whoever he placed takes his spot whenever
 * he's on the active roster; while he's hurt or sent down the manager fills
 * in, and he gets the spot back when he returns.
 */
export function refreshDepth(league: League, team: Team): void {
  const roster = team.rosters.MLB.map((id) => league.players[id]!);
  const auto = autoDepthChart(roster);
  const plan = league.userTeamId === team.id ? team.depthPlan : undefined;
  if (!plan || (!team.manualLineup && !team.manualPitching)) {
    team.depth = auto;
    return;
  }
  // Players who have left the organization drop out of the plan.
  const gone = (id: number) => id >= 0 && league.players[id]?.teamId !== team.id;
  for (const slot of LINEUP) if (gone(slotOf(plan, slot))) setSlot(plan, slot, -1);
  plan.rotation = plan.rotation.map((id) => (gone(id) ? -1 : id));
  plan.bench = plan.bench.filter((id) => !gone(id));
  plan.bullpen = plan.bullpen.filter((id) => !gone(id));

  const d = structuredClone(auto);
  const hitters = new Set(roster.filter((p) => !isPitcher(p)).map((p) => p.id));
  const pitchers = new Set(roster.filter(isPitcher).map((p) => p.id));
  const used = new Set<number>();
  /** The first `limit` candidates from the pool not already placed elsewhere. */
  const take = (candidates: Iterable<number>, pool: Set<number>, limit = Infinity): number[] => {
    const out: number[] = [];
    for (const id of candidates) {
      if (out.length < limit && pool.has(id) && !used.has(id)) {
        used.add(id);
        out.push(id);
      }
    }
    return out;
  };
  if (team.manualLineup) {
    // Lock in everyone the user placed who's here before filling any hole.
    for (const slot of LINEUP) setSlot(d, slot, take([slotOf(plan, slot)], hitters, 1)[0] ?? -1);
    const holes = LINEUP.filter((slot) => slotOf(d, slot) < 0);
    if (holes.length) {
      // Fill the holes together from the hitters who aren't starting: someone
      // who plays the position if anyone does, then someone who can handle it,
      // and among those whoever adds the most there (as the manager builds his
      // own lineup). A hole in center goes to a center fielder, not to the
      // first player free or to a catcher with a better bat. They're filled
      // afresh after every move, so a call-up who plays the position takes over.
      const free = roster.filter((p) => hitters.has(p.id) && !used.has(p.id));
      const fit = (p: Player, slot: LineupSlot) => (slot === "DH" || p.positions.includes(slot) ? 2 : canPlayPosition(p, slot) ? 1 : 0);
      const n = Math.max(free.length, holes.length);
      const value = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => {
          const p = free[i];
          // Columns past the holes are the bench; a row past the free hitters is nobody.
          if (j >= holes.length) return 0;
          return p ? 1000 * fit(p, holes[j]!) + slotValue(p, holes[j]!) : -10_000;
        }),
      );
      maxAssignment(value).forEach((j, i) => {
        const p = free[i];
        if (!p || j >= holes.length) return;
        setSlot(d, holes[j]!, p.id);
        used.add(p.id);
      });
    }
    d.bench = take([...plan.bench, ...auto.bench, ...hitters], hitters);
  }
  if (team.manualPitching) {
    // His starters keep their turns; a starter who's away has his turn taken by the manager's next choice.
    const size = Math.min(5, Math.max(auto.rotation.length, plan.rotation.length));
    const turns = Array.from({ length: size }, (_, i) => take([plan.rotation[i] ?? -1], pitchers, 1)[0] ?? -1);
    d.rotation = turns.map((id) => (id >= 0 ? id : (take([...auto.rotation, ...auto.bullpen], pitchers, 1)[0] ?? -1))).filter((id) => id >= 0);
    d.bullpen = take([...plan.bullpen, ...auto.bullpen, ...pitchers], pitchers);
  }
  team.depth = d;
}

/**
 * The user's own depth chart, from the Depth chart tab. The part he changed
 * (the lineup with its bench, or the pitching staff) becomes his plan, and the
 * other stays the manager's. In a part that's already his, only the spots he
 * changed take the new choice: a player who's hurt or sent down keeps his
 * spot waiting for him, rather than losing it to whoever is filling in.
 */
export function handSetDepth(league: League, team: Team, next: DepthChart): void {
  const live = team.depth;
  const plan = structuredClone(team.depthPlan ?? live);
  const away = (id: number) => league.players[id]?.teamId === team.id && !team.rosters.MLB.includes(id);
  /** The new order, with anyone from the plan who's away back in his old place in it. */
  const keepWaiting = (order: number[], planned: number[]) => {
    const out = [...order];
    planned.forEach((id, i) => {
      if (away(id) && !out.includes(id)) out.splice(Math.min(i, out.length), 0, id);
    });
    return out;
  };
  if (LINEUP.some((slot) => slotOf(next, slot) !== slotOf(live, slot)) || !sameOrder(next.bench, live.bench)) {
    if (team.manualLineup) {
      for (const slot of LINEUP) if (slotOf(next, slot) !== slotOf(live, slot)) setSlot(plan, slot, slotOf(next, slot));
      plan.bench = keepWaiting(next.bench, plan.bench);
    } else {
      plan.starters = { ...next.starters };
      plan.dh = next.dh;
      plan.bench = [...next.bench];
    }
    team.manualLineup = true;
  }
  if (!sameOrder(next.rotation, live.rotation) || !sameOrder(next.bullpen, live.bullpen)) {
    if (team.manualPitching) {
      next.rotation.forEach((id, i) => {
        if (id !== live.rotation[i]) plan.rotation[i] = id;
      });
      plan.bullpen = keepWaiting(next.bullpen, plan.bullpen);
    } else {
      plan.rotation = [...next.rotation];
      plan.bullpen = [...next.bullpen];
    }
    team.manualPitching = true;
  }
  team.depthPlan = plan;
  refreshDepth(league, team);
}

/** Take over parts of the depth chart as they stand (the roster tab's switch), or hand them back to the manager. */
export function setDepthOwners(league: League, team: Team, owners: { lineup?: boolean; pitching?: boolean }): void {
  const plan = structuredClone(team.depthPlan ?? team.depth);
  const now = team.depth;
  if (owners.lineup !== undefined) {
    if (owners.lineup && !team.manualLineup) {
      plan.starters = { ...now.starters };
      plan.dh = now.dh;
      plan.bench = [...now.bench];
    }
    team.manualLineup = owners.lineup;
  }
  if (owners.pitching !== undefined) {
    if (owners.pitching && !team.manualPitching) {
      plan.rotation = [...now.rotation];
      plan.bullpen = [...now.bullpen];
    }
    team.manualPitching = owners.pitching;
  }
  if (team.manualLineup || team.manualPitching) team.depthPlan = plan;
  else delete team.depthPlan;
  refreshDepth(league, team);
}

function removeFrom(list: number[], id: number): void {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
}

function moveLevel(team: Team, p: Player, to: Level): void {
  for (const level of Object.keys(team.rosters) as Level[]) removeFrom(team.rosters[level], p.id);
  team.rosters[to].push(p.id);
  p.level = to;
}

// ---------------------------------------------------------------------------
// 40-man

export function addToFortyMan(ctx: RosterContext, team: Team, p: Player, log = true): RosterResult {
  if (p.teamId !== team.id) return fail(`${playerName(p)} isn't in the organization.`);
  if (p.onFortyMan) return ok;
  if (team.fortyMan.length >= FORTY_MAN_LIMIT) return fail("The 40-man roster is full. Designate someone for assignment first.");
  team.fortyMan.push(p.id);
  p.onFortyMan = true;
  ensureMajorContract(p);
  if (log) logTransaction(ctx.league, ctx.day, team, p, "add-40", `Added ${label(p)} to the 40-man roster`);
  return ok;
}

// ---------------------------------------------------------------------------
// Call-ups and options

/**
 * `roomComing`: the caller will open a 40-man spot first if the player needs one. `spotComing`: someone of his kind
 * goes down first (a swap), so a full active roster or pitching staff doesn't stand in the way.
 */
export function canCallUp(ctx: RosterContext, team: Team, p: Player, replacingInjury = false, roomComing = false, spotComing = false): RosterResult {
  if (p.teamId !== team.id) return fail(`${playerName(p)} isn't in the organization.`);
  if (p.level === "MLB") return fail(`${playerName(p)} is already in the majors.`);
  if (p.injury && p.injury.daysLeft > 0) return fail(`${playerName(p)} is injured.`);
  if (!spotComing && team.rosters.MLB.length >= activeLimit(ctx)) return fail(`The active roster is full (${activeLimit(ctx)}).`);
  if (!spotComing && p.pitching && activePitchers(ctx.league, team) >= pitcherLimit(ctx)) return fail(`Already carrying ${pitcherLimit(ctx)} pitchers.`);
  if (!p.onFortyMan && !roomComing && team.fortyMan.length >= FORTY_MAN_LIMIT) return fail("He isn't on the 40-man roster and it's full.");
  if (p.optionedDay !== null && !replacingInjury) {
    const minDays = p.pitching ? MIN_OPTION_DAYS.pitcher : MIN_OPTION_DAYS.hitter;
    const waited = ctx.day - p.optionedDay;
    if (waited < minDays) return fail(`Optioned ${waited} day(s) ago; must wait ${minDays} unless replacing an injured player.`);
  }
  return ok;
}

export function callUp(ctx: RosterContext, team: Team, p: Player, replacingInjury = false): RosterResult {
  const check = canCallUp(ctx, team, p, replacingInjury);
  if (!check.ok) return check;
  const from = p.level;
  const selected = !p.onFortyMan;
  if (selected) addToFortyMan(ctx, team, p, false);
  moveLevel(team, p, "MLB");
  p.optionedDay = null;
  const verb = selected ? "Selected the contract of" : "Recalled";
  logTransaction(ctx.league, ctx.day, team, p, "call-up", `${verb} ${label(p)} from ${from}`);
  refreshDepth(ctx.league, team);
  return ok;
}

export function canOption(ctx: RosterContext, team: Team, p: Player): RosterResult {
  if (p.teamId !== team.id) return fail(`${playerName(p)} isn't in the organization.`);
  if (p.level !== "MLB") return fail(`${playerName(p)} isn't in the majors.`);
  if (p.il) return fail(`${playerName(p)} is on the injured list.`);
  if (!p.onFortyMan) return fail(`${playerName(p)} isn't on the 40-man roster.`);
  if (p.service >= OPTION_VETO_SERVICE) return fail(`${playerName(p)} has 5+ years of service and can refuse an option.`);
  if (!canBeOptioned(p)) return fail(`${playerName(p)} is out of options. He'd have to clear waivers.`);
  return ok;
}

export function optionPlayer(ctx: RosterContext, team: Team, p: Player, to: MinorLevel = "AAA"): RosterResult {
  const check = canOption(ctx, team, p);
  if (!check.ok) return check;
  let note = "option year already used this season";
  if (ctx.offseason) {
    note = "offseason assignment, no option used";
  } else if (!p.options.usedThisYear) {
    p.options.used++;
    p.options.usedThisYear = true;
    note = `option year ${p.options.used} of ${MAX_OPTION_YEARS}`;
  }
  moveLevel(team, p, to);
  p.optionedDay = ctx.offseason ? null : ctx.day;
  logTransaction(ctx.league, ctx.day, team, p, "option", `Optioned ${label(p)} to ${to} (${note})`);
  refreshDepth(ctx.league, team);
  return ok;
}

/** Move a minor leaguer between affiliates. */
export function assignMinors(ctx: RosterContext, team: Team, p: Player, to: MinorLevel): RosterResult {
  if (p.teamId !== team.id) return fail(`${playerName(p)} isn't in the organization.`);
  if (p.level === "MLB") return fail("Use an option or outright to send a major leaguer down.");
  if (p.level === to) return ok;
  const up = MINOR_LEVELS.indexOf(to) < MINOR_LEVELS.indexOf(p.level as MinorLevel);
  moveLevel(team, p, to);
  logTransaction(ctx.league, ctx.day, team, p, up ? "promote" : "demote", `${up ? "Promoted" : "Assigned"} ${label(p)} to ${to}`);
  return ok;
}

// ---------------------------------------------------------------------------
// Injured list

export function defaultIl(p: Player, days: number): IlType {
  if (days > 60) return "IL60";
  return p.pitching ? "IL15" : "IL10";
}

export function placeOnIl(ctx: RosterContext, team: Team, p: Player, type?: IlType): RosterResult {
  if (p.teamId !== team.id) return fail(`${playerName(p)} isn't in the organization.`);
  if (p.level !== "MLB") return fail("Only major leaguers go on the MLB injured list.");
  if (p.il) return fail(`${playerName(p)} is already on the injured list.`);
  if (!p.injury) return fail(`${playerName(p)} isn't injured.`);
  const il = type ?? defaultIl(p, p.injury.daysLeft);
  removeFrom(team.rosters.MLB, p.id);
  team.injured.push(p.id);
  p.il = il;
  p.optionedDay = null;
  if (il === "IL60") {
    removeFrom(team.fortyMan, p.id);
    p.onFortyMan = false;
  }
  const kind = il === "IL60" ? "60-day" : il === "IL15" ? "15-day" : "10-day";
  p.ilDay = ctx.day;
  const why = injuryName(p.injury.name);
  logTransaction(ctx.league, ctx.day, team, p, "il-place", `Placed ${label(p)} on the ${kind} injured list (${why})`);
  refreshDepth(ctx.league, team);
  return ok;
}

export function transferTo60(ctx: RosterContext, team: Team, p: Player): RosterResult {
  if (!p.il || p.il === "IL60") return fail(`${playerName(p)} isn't on the short-term injured list.`);
  p.il = "IL60";
  removeFrom(team.fortyMan, p.id);
  p.onFortyMan = false;
  logTransaction(ctx.league, ctx.day, team, p, "il-transfer", `Transferred ${label(p)} to the 60-day injured list`);
  return ok;
}

export function ilDaysServed(ctx: RosterContext, p: Player): number {
  return p.ilDay === null ? Infinity : ctx.day - p.ilDay;
}

export function canActivate(ctx: RosterContext, team: Team, p: Player, to: "MLB" | MinorLevel = "MLB"): RosterResult {
  if (!p.il) return fail(`${playerName(p)} isn't on the injured list.`);
  if (p.injury && p.injury.daysLeft > 0) return fail(`${playerName(p)} is still hurt (${p.injury.daysLeft} more days).`);
  if (ilDaysServed(ctx, p) < MIN_IL_DAYS[p.il]) return fail(`Minimum stay on the ${p.il} not served.`);
  if (p.il === "IL60" && team.fortyMan.length >= FORTY_MAN_LIMIT) return fail("The 40-man roster is full.");
  if (to === "MLB") {
    if (team.rosters.MLB.length >= activeLimit(ctx)) return fail("The active roster is full.");
    if (p.pitching && activePitchers(ctx.league, team) >= pitcherLimit(ctx)) return fail(`Already carrying ${pitcherLimit(ctx)} pitchers.`);
  } else if (!canBeOptioned(p) || p.service >= OPTION_VETO_SERVICE) {
    return fail(`${playerName(p)} can't be optioned.`);
  }
  return ok;
}

export function activateFromIl(ctx: RosterContext, team: Team, p: Player, to: "MLB" | MinorLevel = "MLB"): RosterResult {
  const check = canActivate(ctx, team, p, to);
  if (!check.ok) return check;
  removeFrom(team.injured, p.id);
  if (p.il === "IL60") {
    team.fortyMan.push(p.id);
    p.onFortyMan = true;
    ensureMajorContract(p);
  }
  p.il = null;
  p.ilDay = null;
  if (to === "MLB") {
    team.rosters.MLB.push(p.id);
    p.level = "MLB";
    logTransaction(ctx.league, ctx.day, team, p, "il-activate", `Activated ${label(p)} from the injured list`);
  } else {
    if (!p.options.usedThisYear) {
      p.options.used++;
      p.options.usedThisYear = true;
    }
    team.rosters[to].push(p.id);
    p.level = to;
    p.optionedDay = ctx.day;
    logTransaction(ctx.league, ctx.day, team, p, "il-activate", `Activated ${label(p)} from the injured list and optioned him to ${to}`);
  }
  refreshDepth(ctx.league, team);
  return ok;
}

// ---------------------------------------------------------------------------
// DFA, waivers, outrights

/** Value of a club's weakest 40-man player: the bar a waiver claim has to clear. */
function weakestFortyMan(league: League, team: Team): number {
  let worst = Infinity;
  for (const id of team.fortyMan) worst = Math.min(worst, playerValue(league.players[id]!));
  return worst;
}

/** What claiming him adds to a payroll beyond a minimum-salary player: a guaranteed or arbitration salary over the minimum. */
function claimCost(p: Player): number {
  const c = p.contract;
  return c && (c.type === "guaranteed" || c.type === "arb") ? Math.max(0, c.salary - MIN_SALARY) : 0;
}

export function designateForAssignment(
  ctx: RosterContext,
  team: Team,
  p: Player,
  waiverOrder: Team[] = ctx.league.teams,
): RosterResult {
  if (p.teamId !== team.id) return fail(`${playerName(p)} isn't in the organization.`);
  if (!p.onFortyMan && p.il !== "IL60") return fail(`${playerName(p)} isn't on the 40-man roster.`);
  if (p.il) return fail("Can't designate a player on the injured list.");
  const league = ctx.league;
  removeFrom(team.fortyMan, p.id);
  p.onFortyMan = false;
  const wasMlb = p.level === "MLB";
  logTransaction(league, ctx.day, team, p, "dfa", `Designated ${label(p)} for assignment`);
  const designated = league.transactions[league.transactions.length - 1]!;

  // Waivers: the first club (worst record first) that wants him, has room
  // and can fit his salary in its budget claims him. The user's club claims
  // only through his assistant GM, as with its other roster moves.
  const value = playerValue(p);
  const cost = claimCost(p);
  for (const other of waiverOrder) {
    if (other.id === team.id || other.fortyMan.length >= FORTY_MAN_LIMIT) continue;
    const yours = other.id === league.userTeamId;
    if (yours && other.manualRoster) continue;
    if (value <= weakestFortyMan(league, other) + 4) continue;
    if (cost > Math.max(0, budgetRoom(league, other))) continue;
    for (const level of Object.keys(team.rosters) as Level[]) removeFrom(team.rosters[level], p.id);
    p.teamId = other.id;
    other.fortyMan.push(p.id);
    p.onFortyMan = true;
    other.rosters.AAA.push(p.id);
    p.level = "AAA";
    p.optionedDay = ctx.day;
    followTender(league, p);
    logTransaction(league, ctx.day, other, p, "claim", `${yours ? "Your assistant GM claimed" : "Claimed"} ${label(p)} off waivers from ${team.abbrev}`);
    // The claim is logged on the club that made it; your own moves tell the rest of the story.
    if (team.id === league.userTeamId) designated.text += `; claimed off waivers by ${other.abbrev}`;
    if (wasMlb) refreshDepth(league, team);
    return ok;
  }

  moveLevel(team, p, "AAA");
  p.optionedDay = null;
  outrightContract(p);
  logTransaction(league, ctx.day, team, p, "outright", `${label(p)} cleared waivers and was outrighted to AAA`);
  if (wasMlb) refreshDepth(league, team);
  return ok;
}

/** Release a player outright (he becomes a free agent). */
export function releasePlayer(ctx: RosterContext, team: Team, p: Player): RosterResult {
  if (p.teamId !== team.id) return fail(`${playerName(p)} isn't in the organization.`);
  for (const level of Object.keys(team.rosters) as Level[]) removeFrom(team.rosters[level], p.id);
  removeFrom(team.fortyMan, p.id);
  removeFrom(team.injured, p.id);
  const wasMlb = p.level === "MLB";
  // The club still owes what's guaranteed, a year at a time, and the rest of an arbitration salary, as it would if he
  // were outrighted. Before the tender deadline a veteran whose deal is up, or an arbitration case not yet tendered,
  // is owed nothing: releasing him is a non-tender.
  const w = tenderWindow(ctx.league);
  const settled = w !== null && (w.expiring.includes(p.id) || w.tenders.some((t) => t.playerId === p.id));
  const c = settled ? null : p.contract;
  if (c && (c.type === "guaranteed" || c.type === "arb") && c.years > 0) team.deadMoney.push({ playerId: p.id, amount: c.salary, years: c.years });
  p.teamId = null;
  p.onFortyMan = false;
  p.il = null;
  p.ilDay = null;
  p.contract = null;
  logTransaction(ctx.league, ctx.day, team, p, "release", `Released ${label(p)}`);
  // Big leaguers and real prospects hit the open market; the rest leave the game.
  if (p.service > 0 || playerValue(p) > -20 || peakValue(p) > 0) ctx.league.freeAgents.push(p.id);
  else p.retired = ctx.league.year;
  if (wasMlb) refreshDepth(ctx.league, team);
  return ok;
}

// ---------------------------------------------------------------------------
// Checks

/** Rule violations for a club's current rosters (empty when legal). */
export function rosterProblems(ctx: RosterContext, team: Team): string[] {
  const problems: string[] = [];
  const league = ctx.league;
  if (activeLimitsApply(ctx)) {
    if (team.rosters.MLB.length > activeLimit(ctx)) problems.push(`Active roster has ${team.rosters.MLB.length} (max ${activeLimit(ctx)}).`);
    if (activePitchers(league, team) > pitcherLimit(ctx)) problems.push(`Carrying ${activePitchers(league, team)} pitchers (max ${pitcherLimit(ctx)}).`);
  }
  if (team.fortyMan.length > FORTY_MAN_LIMIT) problems.push(`40-man roster has ${team.fortyMan.length}.`);
  for (const id of team.rosters.MLB) {
    const p = league.players[id]!;
    if (!p.onFortyMan) problems.push(`${playerName(p)} is active but not on the 40-man.`);
  }
  return problems;
}
