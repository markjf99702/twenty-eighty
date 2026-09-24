import type { Rng } from "../core/rng";
import type { League, Team } from "../league/types";
import { DOLLARS_PER_WAR, MIN_SALARY, marketSalary, payroll, projectedWar, seasonWar } from "../org/contracts";
import { designateForAssignment, FORTY_MAN_LIMIT, logTransaction, type RosterContext, type RosterResult } from "../org/roster";
import { canStart, peakValue, playerValue } from "../org/value";
import { playerName, type Player } from "../players/types";
import type { FreeAgencyState, FreeAgentAsk } from "./types";

/**
 * Free agency, a week at a time. Every free agent has an ask (years and
 * annual salary) from his projected WAR over the deal. Each week the clubs
 * with a hole he fills and the budget room to pay him make offers; he takes
 * the best one if it's close enough to his ask, and his demands soften as
 * the winter drags on. The user's offers compete with everyone else's.
 */

export const FREE_AGENCY_WEEKS = 8;
/** How much a player's demands soften each week (share of his ask). */
const SOFTEN = 0.07;

const money = (x: number) => Math.round(x * 20) / 20;

/** What he wants: longer deals for younger, better players; salary averaged over the deal's projected WAR. */
export function askFor(p: Player): FreeAgentAsk {
  const war = seasonWar(p);
  let years = 1;
  if (war >= 3.5) years = Math.min(8, Math.max(1, 35 - p.age));
  else if (war >= 2) years = Math.min(5, Math.max(1, 33 - p.age));
  else if (war >= 1) years = Math.min(3, Math.max(1, 31 - p.age));
  let total = 0;
  for (let y = 0; y < years; y++) total += marketSalary(projectedWar(p, y));
  const salary = war < 0.4 ? MIN_SALARY : money(Math.max(MIN_SALARY, (1.05 * total) / years));
  return { playerId: p.id, years, salary };
}

export function openFreeAgency(league: League): FreeAgencyState {
  const pool = league.freeAgents.filter((id) => league.players[id]!.retired === undefined);
  league.freeAgents = pool;
  return { week: 0, weeks: FREE_AGENCY_WEEKS, asks: pool.map((id) => askFor(league.players[id]!)), offers: [], signings: [] };
}

/** How good an offer looks to the player: mostly the annual salary, with a little extra for security. */
export const offerScore = (o: { years: number; salary: number }) => o.salary * (1 + 0.1 * (o.years - 1));

/** The bar an offer has to clear this week. */
export const acceptBar = (ask: FreeAgentAsk, week: number) => offerScore(ask) * Math.max(0.45, 1 - SOFTEN * week);

type Role = "hitter" | "sp" | "rp";
const roleOf = (p: Player): Role => (p.pitching ? (canStart(p) ? "sp" : "rp") : "hitter");

/** A club's weakest regular in each role: the player a signing would replace. */
function incumbents(league: League, team: Team): Record<Role, number> {
  const war: Record<Role, number[]> = { hitter: [], sp: [], rp: [] };
  for (const id of team.fortyMan) {
    const p = league.players[id]!;
    war[roleOf(p)].push(seasonWar(p));
  }
  const nth = (xs: number[], n: number) => xs.sort((a, b) => b - a)[n] ?? -0.5;
  return { hitter: nth(war.hitter, 8), sp: nth(war.sp, 4), rp: nth(war.rp, 6) };
}

/** Clubs spend like their market: rich clubs pay a premium for the wins they want. */
const wealth = (team: Team) => Math.min(1.3, Math.max(0.85, 0.85 + (team.budget - 95) / 350));

export function signFreeAgent(ctx: RosterContext, team: Team, p: Player, years: number, salary: number): RosterResult {
  const league = ctx.league;
  if (team.fortyMan.length >= FORTY_MAN_LIMIT) return { ok: false, reason: "The 40-man roster is full." };
  league.freeAgents = league.freeAgents.filter((id) => id !== p.id);
  p.teamId = team.id;
  p.level = "MLB";
  p.onFortyMan = true;
  p.il = null;
  p.ilDay = null;
  p.optionedDay = null;
  p.contract = { type: "guaranteed", salary, years, signed: league.year, total: money(salary * years) };
  team.fortyMan.push(p.id);
  team.rosters.MLB.push(p.id);
  const terms = years === 1 ? `a one-year, $${salary.toFixed(2)}M deal` : `a ${years}-year, $${(salary * years).toFixed(1)}M deal`;
  logTransaction(league, ctx.day, team, p, "sign", `Signed free agent ${playerName(p)} to ${terms}`);
  return { ok: true };
}

/** Clear a 40-man spot for a signing by designating the weakest non-big-leaguer. */
function makeRoom(ctx: RosterContext, team: Team, waiverOrder: Team[]): boolean {
  if (team.fortyMan.length < FORTY_MAN_LIMIT) return true;
  const cut = team.fortyMan
    .map((id) => ctx.league.players[id]!)
    .filter((p) => !p.il && p.contract?.type !== "guaranteed")
    .sort((a, b) => playerValue(a) - playerValue(b))[0];
  return cut ? designateForAssignment(ctx, team, cut, waiverOrder).ok : false;
}

export function validateOffer(league: League, state: FreeAgencyState, teamId: number, offer: FreeAgentAsk): RosterResult {
  const p = league.players[offer.playerId];
  if (!p || !league.freeAgents.includes(p.id)) return { ok: false, reason: "He isn't a free agent." };
  if (!state.asks.some((a) => a.playerId === p.id)) return { ok: false, reason: "He isn't on the market." };
  if (offer.years < 1 || offer.years > 10 || !Number.isInteger(offer.years)) return { ok: false, reason: "Offer 1 to 10 years." };
  if (offer.salary < MIN_SALARY) return { ok: false, reason: `The minimum salary is $${MIN_SALARY}M.` };
  const team = league.teams[teamId]!;
  const pending = state.offers.filter((o) => o.playerId !== offer.playerId).length;
  if (team.fortyMan.length + pending >= FORTY_MAN_LIMIT) return { ok: false, reason: "Your 40-man roster doesn't have room for another signing." };
  return { ok: true };
}

/**
 * One week: AI clubs make offers, then every free agent with an offer that
 * clears his bar signs with the best bidder.
 */
export function freeAgencyWeek(ctx: RosterContext, state: FreeAgencyState, rng: Rng, waiverOrder: Team[]): void {
  const league = ctx.league;
  const user = league.userTeamId;
  const asks = new Map(state.asks.filter((a) => league.freeAgents.includes(a.playerId)).map((a) => [a.playerId, a]));
  const bids = new Map<number, { teamId: number; years: number; salary: number }[]>();
  const bid = (playerId: number, b: { teamId: number; years: number; salary: number }) => {
    const list = bids.get(playerId) ?? [];
    list.push(b);
    bids.set(playerId, list);
  };
  for (const o of state.offers) if (user !== null && asks.has(o.playerId)) bid(o.playerId, { teamId: user, years: o.years, salary: o.salary });

  // The user's club shops too when the assistant GM is running its roster.
  const clubs = rng.shuffle(league.teams.filter((t) => t.id !== user || !t.manualRoster));
  const userOffers = new Set(state.offers.map((o) => o.playerId));
  for (const team of clubs) {
    // Late in the winter, clubs will stretch a little past budget for a bargain.
    const stretch = state.week >= state.weeks / 2 ? 0.05 * team.budget : 0;
    const room = team.budget + stretch - payroll(league, team) - 3;
    if (room < MIN_SALARY) continue;
    const need = incumbents(league, team);
    const pay = wealth(team);
    const targets: { p: Player; ask: FreeAgentAsk; upgrade: number }[] = [];
    for (const ask of asks.values()) {
      if (team.id === user && userOffers.has(ask.playerId)) continue;
      const p = league.players[ask.playerId]!;
      const war = seasonWar(p);
      const upgrade = war - need[roleOf(p)];
      if (upgrade < 0.4) continue;
      const bar = acceptBar(ask, state.week) / (1 + 0.1 * (ask.years - 1));
      if (bar > room || bar > war * DOLLARS_PER_WAR * pay + 1) continue;
      targets.push({ p, ask, upgrade });
    }
    targets.sort((a, b) => b.upgrade - a.upgrade);
    const offers = room > 40 ? 2 : 1;
    for (const t of targets.slice(0, offers)) {
      const bar = acceptBar(t.ask, state.week) / (1 + 0.1 * (t.ask.years - 1));
      const salary = money(Math.min(room, Math.max(bar, t.ask.salary * (0.9 + 0.15 * rng.next()) * (1 - SOFTEN * state.week))));
      bid(t.p.id, { teamId: team.id, years: t.ask.years, salary });
    }
  }

  // Decisions, best players first (they sign before the market reacts to anyone else).
  const decided = [...bids.keys()].sort((a, b) => asks.get(b)!.salary - asks.get(a)!.salary);
  for (const playerId of decided) {
    const ask = asks.get(playerId)!;
    const p = league.players[playerId]!;
    const list = bids.get(playerId)!.sort((a, b) => offerScore(b) - offerScore(a));
    for (const b of list) {
      if (offerScore(b) < acceptBar(ask, state.week)) break;
      const team = league.teams[b.teamId]!;
      const stretch = state.week >= state.weeks / 2 ? 0.05 * team.budget : 0;
      const assistant = b.teamId !== user || !userOffers.has(playerId);
      if (assistant && (team.budget + stretch - payroll(league, team) < b.salary || !makeRoom(ctx, team, waiverOrder))) continue;
      if (signFreeAgent(ctx, team, p, b.years, b.salary).ok) {
        state.signings.push({ playerId, teamId: b.teamId, years: b.years, salary: b.salary, week: state.week });
        break;
      }
    }
  }
  state.offers = state.offers.filter((o) => league.freeAgents.includes(o.playerId));
  state.week++;
}

/**
 * After the last week: useful players still unsigned take minor league deals
 * (a spring training invitation from a club thin at their spot); older
 * players nobody wanted retire; the rest wait for a call.
 */
export function closeFreeAgency(ctx: RosterContext, state: FreeAgencyState): void {
  const league = ctx.league;
  const invites = new Map<number, number>();
  const needs = new Map(league.teams.map((t) => [t.id, incumbents(league, t)]));
  const left = [...league.freeAgents].map((id) => league.players[id]!).sort((a, b) => seasonWar(b) - seasonWar(a));
  for (const p of left) {
    const war = seasonWar(p);
    const prospect = p.age <= 26 && peakValue(p) >= -15;
    if ((war >= 0.3 && p.age <= 36) || prospect) {
      const team = league.teams
        .filter((t) => (invites.get(t.id) ?? 0) < 5 && t.id !== league.userTeamId)
        .sort((a, b) => needs.get(a.id)![roleOf(p)] - needs.get(b.id)![roleOf(p)])[0];
      if (team) {
        invites.set(team.id, (invites.get(team.id) ?? 0) + 1);
        league.freeAgents = league.freeAgents.filter((x) => x !== p.id);
        p.teamId = team.id;
        p.level = "AAA";
        p.onFortyMan = false;
        p.contract = { type: "minor", salary: 0, years: 1 };
        team.rosters.AAA.push(p.id);
        logTransaction(league, ctx.day, team, p, "sign", `Signed ${playerName(p)} to a minor league contract with an invitation to spring training`);
        continue;
      }
    }
    // Nobody wanted him: older or marginal players call it a career.
    if (p.age >= 30 || war < 0.3) {
      p.retired = league.year;
      league.freeAgents = league.freeAgents.filter((x) => x !== p.id);
    }
  }
  state.offers = [];
  state.week = state.weeks;
}
