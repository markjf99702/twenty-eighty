import { winterAdvice } from "../advice/advice";
import { clamp } from "../core/math";
import { closeBooks, priceTickets } from "../finance/finance";
import { acceptJob, reviewSeason, setGoals } from "../finance/owner";
import { Rng } from "../core/rng";
import { WINTER_TARGETS, recenterGrades } from "../league/generate";
import type { League, Team } from "../league/types";
import {
  ARB_YEARS,
  arbitrationSalary,
  DOLLARS_PER_WAR,
  ensureMajorContract,
  FREE_AGENT_YEARS,
  minorContract,
  orgPlayers,
  preArbSalary,
  seasonWar,
  serviceYears,
} from "../org/contracts";
import { logTransaction, refreshDepth, releasePlayer, type RosterContext } from "../org/roster";
import { aiExtensions } from "../org/extensions";
import { winterOffer } from "../org/offers";
import { aiTradeMarket } from "../org/trades";
import { believedWar, warShift } from "../scouting/analytics";
import { clearAmateurLooks, staffCost } from "../scouting/scouting";
import { peakValue, playerValue } from "../org/value";
import { developPlayer } from "../players/development";
import { LEVELS, playerName, type Player } from "../players/types";
import { Season } from "../season/season";
import { createDraft, simDraft } from "./draft";
import { closeFreeAgency, freeAgencyWeek, openFreeAgency } from "./freeAgency";
import { recordCareers, recordHistory, seasonAwards } from "./history";
import { finishInternational, openInternational } from "./international";
import { springTraining } from "./spring";
import type { DevelopmentChange, OffseasonPhase, OffseasonState, Retirement, Tender } from "./types";

/**
 * The offseason, start to finish. `beginOffseason` closes the books on the
 * season (careers, awards, history), ages and develops every player, retires
 * some, and rolls contracts forward. `advanceOffseason` then steps through
 * the tender deadline, the draft, free agency, international signings and
 * spring training, with the AI making every decision the user doesn't.
 */

/** Calendar days (from the finished season's Opening Day) for each phase's moves. */
export const WINTER_DAYS: Record<OffseasonPhase, number> = {
  review: 218, // Oct 30
  tenders: 237, // Nov 18
  draft: 257, // Dec 8
  freeAgency: 261, // Dec 12, then weekly
  international: 321, // Feb 9
  spring: 340, // Mar 1
};

/** Routine moves that aren't worth keeping past the season they happened in. */
const ROUTINE = new Set(["promote", "demote", "injury", "call-up", "option", "il-place", "il-activate", "il-transfer"]);

export const winterRng = (league: League, label: string) => new Rng(`${league.seed}:${league.year}:winter:${label}`);

export function winterContext(league: League, phase: OffseasonPhase, extraDays = 0): RosterContext {
  return { league, day: WINTER_DAYS[phase] + extraDays, expanded: false, offseason: true };
}

/** Waiver priority: worst record first. */
export function waiverOrder(league: League, season: Season): Team[] {
  return [...season.records].sort((a, b) => season.compare(b, a)).map((r) => league.teams[r.teamId]!);
}

const grade = (v: number) => Math.round(clamp(50 + v / 2, 20, 80));

/** Everyone on an injured list comes back after the World Series (the 60-day list back onto the 40-man). */
function reinstateInjured(league: League): void {
  for (const team of league.teams) {
    for (const id of team.injured) {
      const p = league.players[id]!;
      if (p.il === "IL60" && !p.onFortyMan) {
        p.onFortyMan = true;
        team.fortyMan.push(id);
        ensureMajorContract(p);
      }
      p.il = null;
      p.ilDay = null;
      p.level = "MLB";
      team.rosters.MLB.push(id);
    }
    team.injured = [];
  }
}

function retireChance(p: Player, inOrg: boolean): number {
  const v = playerValue(p);
  if (p.age >= 43) return 1;
  if (!inOrg) return p.age >= 32 ? 0.6 : v < -25 ? 0.4 : 0.15;
  if (p.age >= 38) return clamp(0.45 + 0.1 * (p.age - 38) - (v > 10 ? 0.3 : 0), 0.1, 1);
  if (p.age >= 35) return v < -10 ? 0.55 : v < 5 ? 0.25 : 0.08;
  if (p.age >= 32) return v < -15 ? 0.3 : 0.03;
  if (!p.onFortyMan && p.age >= 27 && peakValue(p) < -25) return 0.4;
  if (!p.onFortyMan && p.age >= 24 && peakValue(p) < -40) return 0.3;
  return 0;
}

function removeFromOrg(team: Team, id: number): void {
  for (const level of LEVELS) team.rosters[level] = team.rosters[level].filter((x) => x !== id);
  team.fortyMan = team.fortyMan.filter((x) => x !== id);
  team.injured = team.injured.filter((x) => x !== id);
}

function retirePlayers(league: League, rng: Rng, day: number): Retirement[] {
  const out: Retirement[] = [];
  const freeAgents = new Set(league.freeAgents);
  for (const p of league.players) {
    if (p.retired !== undefined) continue;
    const inOrg = p.teamId !== null;
    if (!inOrg && !freeAgents.has(p.id)) continue;
    if (!rng.chance(retireChance(p, inOrg))) continue;
    if (inOrg) {
      const team = league.teams[p.teamId!]!;
      removeFromOrg(team, p.id);
      if (p.service >= 2 * 172 || p.onFortyMan) {
        logTransaction(league, day, team, p, "retire", `${playerName(p)} retired at ${p.age}`);
        out.push({ playerId: p.id, teamId: team.id, age: p.age });
      }
    } else {
      freeAgents.delete(p.id);
      if (p.service >= 3 * 172) out.push({ playerId: p.id, teamId: null, age: p.age });
    }
    p.retired = league.year;
    p.teamId = null;
    p.contract = null;
    p.onFortyMan = false;
    p.il = null;
    p.injury = null;
  }
  league.freeAgents = [...freeAgents];
  return out;
}

/** Contracts move forward a year: guaranteed deals tick down; one-year deals come up for renewal. */
function rollContracts(league: League): { tenders: Tender[]; expiring: number[] } {
  const tenders: Tender[] = [];
  const expiring: number[] = [];
  for (const team of league.teams) {
    for (const p of orgPlayers(league, team)) {
      const c = p.contract;
      if (c && c.type === "guaranteed" && c.years > 1) {
        c.years -= 1;
        continue;
      }
      if (!p.onFortyMan) {
        p.contract = minorContract();
        continue;
      }
      const yrs = serviceYears(p);
      if (yrs >= FREE_AGENT_YEARS) {
        expiring.push(p.id);
      } else if (yrs >= ARB_YEARS) {
        const salary = arbitrationSalary(p, league.year);
        // Keep him if he's worth his award over a replacement-level player, or if it's cheap.
        const tender = Math.max(0, seasonWar(p) - 0.3) * DOLLARS_PER_WAR >= 0.9 * salary || salary <= 1.2;
        tenders.push({ playerId: p.id, teamId: team.id, salary, tender });
      } else {
        p.contract = { type: "pre-arb", salary: preArbSalary(p), years: 1 };
      }
    }
    team.deadMoney = team.deadMoney.map((d) => ({ ...d, years: d.years - 1 })).filter((d) => d.years > 0);
    budgetTenders(league, team, tenders.filter((t) => t.teamId === team.id), expiring);
  }
  return { tenders, expiring };
}

/** A club over budget non-tenders its worst values for the money first. */
function budgetTenders(league: League, team: Team, tenders: Tender[], expiring: number[]): void {
  const leaving = new Set(expiring);
  let total = 0;
  for (const p of orgPlayers(league, team)) {
    if (leaving.has(p.id) || tenders.some((t) => t.playerId === p.id)) continue;
    if (p.contract && p.contract.type !== "minor") total += p.contract.salary;
  }
  for (const d of team.deadMoney) total += d.amount;
  total += staffCost(league, team);
  for (const t of tenders) if (t.tender) total += t.salary;
  const byValue = tenders
    .filter((t) => t.tender)
    .map((t) => ({ t, ratio: (Math.max(0, seasonWar(league.players[t.playerId]!)) * DOLLARS_PER_WAR) / t.salary }))
    .sort((a, b) => a.ratio - b.ratio);
  for (const { t, ratio } of byValue) {
    if (total <= team.budget * 0.9 || ratio >= 1.6) break;
    t.tender = false;
    total -= t.salary;
  }
}

export function beginOffseason(league: League, season: Season): OffseasonState {
  if (league.offseason) return league.offseason;
  const day = WINTER_DAYS.review;
  clearAmateurLooks(league);
  recordCareers(league, season);
  recordHistory(league, season, seasonAwards(league, season));
  // The owner reviews the season, then the books close and next year's budgets are set.
  reviewSeason(league, season);
  closeBooks(league, season);
  reinstateInjured(league);

  // Development and aging for everyone still in the game.
  const rng = winterRng(league, "develop");
  const freeAgents = new Set(league.freeAgents);
  const before = new Map<number, number>();
  for (const p of league.players) {
    if (p.retired !== undefined || (p.teamId === null && !freeAgents.has(p.id))) continue;
    before.set(p.id, playerValue(p));
    developPlayer(p, rng);
    p.optionedDay = null;
  }
  const retirements = retirePlayers(league, winterRng(league, "retire"), day);
  for (const t of league.teams) refreshDepth(league, t);
  const shift = recenterGrades(league, WINTER_TARGETS);

  const changes: DevelopmentChange[] = [];
  for (const [id, b] of before) {
    const p = league.players[id]!;
    if (p.retired !== undefined || p.teamId === null) continue;
    changes.push({ playerId: id, teamId: p.teamId, age: p.age, before: grade(b), after: grade(playerValue(p)) });
  }
  const risers = changes
    .filter((c) => c.after >= 45)
    .sort((a, b) => b.after - b.before - (a.after - a.before))
    .slice(0, 15);
  const fallers = changes
    .filter((c) => c.before >= 50)
    .sort((a, b) => a.after - a.before - (b.after - b.before))
    .slice(0, 15);

  const { tenders, expiring } = rollContracts(league);
  const state: OffseasonState = {
    year: league.year,
    phase: "review",
    development: { risers, fallers, retirements },
    shift,
    tenders,
    expiring,
    draft: null,
    freeAgency: null,
    international: null,
  };
  league.offseason = state;
  winterAdvice(league, season, offerClock(league, season));
  return state;
}

function applyTenders(ctx: RosterContext, s: OffseasonState): void {
  const league = ctx.league;
  for (const t of s.tenders) {
    const p = league.players[t.playerId]!;
    const team = league.teams[t.teamId]!;
    if (p.teamId !== team.id) continue;
    if (t.tender) {
      p.contract = { type: "arb", salary: t.salary, years: 1 };
      logTransaction(league, ctx.day, team, p, "arbitration", `Agreed to a one-year, $${t.salary.toFixed(2)}M contract with ${playerName(p)} (arbitration)`);
    } else {
      logTransaction(league, ctx.day, team, p, "non-tender", `Non-tendered ${playerName(p)}`);
      releasePlayer(ctx, team, p);
    }
  }
  for (const id of s.expiring) {
    const p = league.players[id]!;
    if (p.teamId === null) continue;
    const team = league.teams[p.teamId]!;
    removeFromOrg(team, id);
    p.teamId = null;
    p.onFortyMan = false;
    p.contract = null;
    league.freeAgents.push(id);
    logTransaction(league, ctx.day, team, p, "free-agent", `${playerName(p)} became a free agent`);
  }
  for (const t of league.teams) refreshDepth(league, t);
}

function startSeason(league: League, minors: boolean): Season {
  league.transactions = league.transactions.filter((t) => t.year >= league.year || !ROUTINE.has(t.type));
  league.year += 1;
  league.offseason = null;
  for (const p of league.players) p.optionedDay = null;
  priceTickets(league);
  return new Season(league, { minors });
}

/**
 * Finish the current phase (the AI makes any decisions left) and move to the
 * next. Returns the new Season once spring training ends.
 */
export function advanceOffseason(league: League, season: Season): Season | null {
  const next = advancePhase(league, season);
  // The staff's notes for the phase that just opened.
  if (!next) winterAdvice(league, season, offerClock(league, season));
  return next;
}

function advancePhase(league: League, season: Season): Season | null {
  const s = league.offseason;
  if (!s) throw new Error("Not in the offseason.");
  const waivers = waiverOrder(league, season);
  switch (s.phase) {
    case "review":
      // A fired GM has to pick a new club first (the CLI and tests take the first offer).
      if (league.gm?.fired) acceptJob(league, league.gm.offers[0]!);
      s.phase = "tenders";
      return null;
    case "tenders":
      applyTenders(winterContext(league, "tenders"), s);
      s.draft = createDraft(league, season, winterRng(league, "draft"));
      s.phase = "draft";
      return null;
    case "draft":
      simDraft(league, s.draft!, WINTER_DAYS.draft, null);
      s.freeAgency = openFreeAgency(league);
      s.phase = "freeAgency";
      return null;
    case "freeAgency": {
      const fa = s.freeAgency!;
      while (fa.week < fa.weeks) winterWeek(league, season);
      closeFreeAgency(winterContext(league, "freeAgency", 7 * fa.weeks), fa);
      s.international = openInternational(league, season, winterRng(league, "intl"));
      s.phase = "international";
      return null;
    }
    case "international":
      finishInternational(league, s.international!, WINTER_DAYS.international, null);
      // Spring is when clubs lock up the players they believe in.
      aiExtensions(winterContext(league, "spring"), winterRng(league, "extensions"), (viewer, p) => warShift(season, viewer, p));
      springTraining(winterContext(league, "spring"), waivers);
      setGoals(league, WINTER_DAYS.spring);
      s.phase = "spring";
      return null;
    case "spring":
      return startSeason(league, season.simulateMinors);
  }
}

/** One week of the winter market: free-agent offers and decisions, and a few trades between AI clubs. */
export function winterWeek(league: League, season: Season): void {
  const s = league.offseason;
  const fa = s?.freeAgency;
  if (!s || s.phase !== "freeAgency" || !fa || fa.week >= fa.weeks) return;
  const ctx = winterContext(league, "freeAgency", 7 * fa.week);
  const rng = winterRng(league, `fa${fa.week}`);
  // Clubs bid and trade on what their own scouts and analysts believe.
  const beliefs = new Map<number, number>();
  const judge = (team: Team, p: Player) => {
    const key = team.id * 1_000_000 + p.id;
    let war = beliefs.get(key);
    if (war === undefined) beliefs.set(key, (war = believedWar(season, team.id, p)));
    return war;
  };
  freeAgencyWeek(ctx, fa, rng, waiverOrder(league, season), judge);
  aiTradeMarket(ctx, rng.fork("trades"), 2, 1, (viewer, p) => warShift(season, viewer, p));
  // A club may call the user; the offer stands until the next week.
  const now = offerClock(league, season);
  winterOffer(league, season, now, now);
}

/**
 * The clock trade offers run on: the season day during the season, and 1000
 * plus the winter calendar day in the offseason (free agency adds a day per
 * week so each week's offers lapse when the next week is played).
 */
export function offerClock(league: League, season: Season): number {
  const w = league.offseason;
  if (!w) return season.day;
  const weeks = w.phase === "freeAgency" ? (w.freeAgency?.week ?? 0) : 0;
  return 1000 + WINTER_DAYS[w.phase] + 7 * weeks;
}

/** Play an entire offseason with the AI deciding everything (CLI and tests). */
export function runOffseason(league: League, season: Season): Season {
  beginOffseason(league, season);
  for (;;) {
    const next = advanceOffseason(league, season);
    if (next) return next;
  }
}
