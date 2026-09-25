import { hashNormal, hashUniform, seedHash } from "../core/hash";
import type { Rng } from "../core/rng";
import type { League, Team } from "../league/types";
import { projectPlayer } from "../players/development";
import { type Contract, playerName, type Player, SERVICE_DAYS_PER_YEAR } from "../players/types";
import {
  ARB_SHARE,
  ARB_YEARS,
  budgetRoom,
  FREE_AGENT_YEARS,
  MIN_SALARY,
  marketSalary,
  seasonWar,
} from "./contracts";
import { logTransaction, type RosterContext } from "./roster";
import { DISCOUNT, serviceAt, surplusValue, type WarShift } from "./trades";

/**
 * Contract extensions: a club buys out a player's arbitration years, and
 * maybe some of his free-agent years, with a guaranteed deal now.
 *
 * The player asks, season by season, for what he'd expect to make without it
 * (the pre-arbitration scale, arbitration awards, then the free-agent market),
 * less a discount for the security that grows the further he is from free
 * agency, spread evenly over the deal at the same rate clubs discount the
 * future. His side knows him about as well as his own club does, so the ask
 * comes from his real projection, give or take a little: a deal pays off
 * through the discount and the risk the club takes on, and a club's scouts
 * only have to be right about him.
 *
 * A deal starts at once as a guaranteed contract: in season, this year's
 * salary becomes the new one for the rest of the year.
 */

export const MIN_EXTENSION_YEARS = 2;
export const MAX_EXTENSION_YEARS = 8;
/** Players won't sign through a season older than this. */
const LAST_AGE = 37;
/** Share of players a season from free agency who'd rather test the market. */
const TEST_MARKET = 0.35;
/** The discount on arbitration seasons, and on free-agent seasons by how far off free agency is. */
const ARB_DISCOUNT = 0.08;
const FREE_DISCOUNT = (seasonsAway: number) => 0.02 + 0.02 * Math.min(3, seasonsAway);

/** How far his side's read of his WAR is off the truth (about as close as his own club's read). */
const AGENT_ERROR = 0.1;

const money = (x: number) => Math.round(x * 20) / 20;

/** His side's read of his WAR against the truth: stable through a season, redrawn each year. */
export const agentShift = (league: League, p: Player) => AGENT_ERROR * hashNormal(seedHash(league.seed), p.id, league.year, 59);

export interface ExtensionTerms {
  years: number;
  /** Annual salary, $M. */
  salary: number;
  total: number;
  /** First and last seasons covered. */
  first: number;
  through: number;
  /** Seasons covered that would have been pre-arbitration, arbitration and free agency. */
  covers: { preArb: number; arb: number; free: number };
}

export type ExtensionOffer = { ok: true; options: ExtensionTerms[] } | { ok: false; reason: string };

/** Where a player stands: what's already owed him and his service clock. */
interface Standing {
  inSeason: boolean;
  /** The first season a deal would cover: this one, or in the winter the coming one. */
  first: number;
  /** Seasons from `first` already set: salary fixed (a guaranteed deal, this year's contract, a pending arbitration award). */
  owed: number;
  owedSalary: number;
  /** Service years at the start of season `first + y`. */
  service: (y: number) => number;
}

function standing(league: League, p: Player, fraction: number): Standing | string {
  const c = p.contract;
  if (!c || p.teamId === null || p.retired !== undefined) return "He isn't under contract.";
  if (c.type === "minor" || !p.onFortyMan) return "Only players on the 40-man roster can sign extensions.";
  const w = league.offseason;
  const service = serviceAt(p, fraction);
  if (!w) return { inSeason: true, first: league.year, owed: c.type === "guaranteed" ? c.years : 1, owedSalary: c.salary, service };
  const first = league.year + 1;
  if (w.expiring.includes(p.id)) return { inSeason: false, first, owed: 0, owedSalary: 0, service };
  const tender = w.tenders.find((t) => t.playerId === p.id);
  if (tender) return { inSeason: false, first, owed: 1, owedSalary: tender.salary, service };
  return { inSeason: false, first, owed: c.type === "guaranteed" ? c.years : 1, owedSalary: c.salary, service };
}

/**
 * The deals a player would sign, one per length. `shift` is his side's read
 * of his WAR against the truth.
 */
export function extensionOptions(league: League, p: Player, fraction: number, shift = agentShift(league, p)): ExtensionOffer {
  const s = standing(league, p, fraction);
  if (typeof s === "string") return { ok: false, reason: s };
  if (s.owed > 2) return { ok: false, reason: `He's signed through ${s.first + s.owed - 1}. He'll talk about an extension in the last two years of his deal.` };
  const shortest = Math.max(MIN_EXTENSION_YEARS, s.owed + 1);
  const longest = Math.min(MAX_EXTENSION_YEARS, LAST_AGE - p.age + 1);
  if (longest < shortest) return { ok: false, reason: "At his age he'd rather go year to year." };
  // A player a season from free agency may want to see what the market says.
  const walkYear = s.owed <= 1 && s.service(1) >= FREE_AGENT_YEARS;
  if (walkYear && hashUniform(seedHash(league.seed), p.id, s.first, 71) < TEST_MARKET) {
    return { ok: false, reason: "He wants to test free agency and won't talk about an extension." };
  }

  // What each season would pay him without a deal, and what he'd knock off for the security.
  const seasonsToFree = (() => {
    let y = 0;
    while (y < 12 && s.service(y) < FREE_AGENT_YEARS) y++;
    return y;
  })();
  const seasons: { pay: number; cut: number; weight: number; kind: keyof ExtensionTerms["covers"] }[] = [];
  let q = p;
  for (let y = 0; y < longest; y++) {
    if (y > 0) q = projectPlayer(q, 1);
    const svc = s.service(y);
    const kind = svc < ARB_YEARS ? "preArb" : svc < FREE_AGENT_YEARS ? "arb" : "free";
    const weight = (y === 0 && s.inSeason ? fraction : 1) / (1 + DISCOUNT) ** y;
    if (y < s.owed) {
      seasons.push({ pay: s.owedSalary, cut: 0, weight, kind });
      continue;
    }
    const war = seasonWar(q) + shift;
    if (kind === "preArb") seasons.push({ pay: MIN_SALARY + 0.03 * svc, cut: 0, weight, kind });
    else if (kind === "arb") {
      const share = ARB_SHARE[Math.min(ARB_SHARE.length - 1, svc - ARB_YEARS)]!;
      seasons.push({ pay: Math.max(MIN_SALARY + 0.3, share * marketSalary(war)), cut: ARB_DISCOUNT, weight, kind });
    } else seasons.push({ pay: 1.05 * marketSalary(war), cut: FREE_DISCOUNT(seasonsToFree), weight, kind });
  }

  const options: ExtensionTerms[] = [];
  for (let years = shortest; years <= longest; years++) {
    const covered = seasons.slice(0, years);
    const wanted = covered.reduce((sum, x) => sum + x.weight * x.pay * (1 - x.cut), 0);
    const units = covered.reduce((sum, x) => sum + x.weight, 0);
    const salary = money(Math.max(MIN_SALARY, wanted / units));
    const covers = { preArb: 0, arb: 0, free: 0 };
    for (const x of covered) covers[x.kind]++;
    // A deal that only covers minimum-salary seasons buys nothing.
    if (covers.arb + covers.free === 0) continue;
    options.push({ years, salary, total: money(salary * years), first: s.first, through: s.first + years - 1, covers });
  }
  if (options.length === 0) return { ok: false, reason: "He's too far from arbitration for a deal to buy anything yet." };
  return { ok: true, options };
}

/** His contract as it stands for valuing him: a pending arbitration award counts; a player about to walk is worth nothing to keep. */
function contractNow(league: League, p: Player): Contract | null {
  const w = league.offseason;
  if (w?.expiring.includes(p.id)) return null;
  const tender = w?.tenders.find((t) => t.playerId === p.id);
  if (tender) return { type: "arb", salary: tender.salary, years: 1 };
  return p.contract;
}

/**
 * What a deal is worth to a club over keeping him as he is, in surplus value
 * ($M): `shift` is the club's belief about his WAR against the truth.
 */
export function extensionGain(league: League, p: Player, terms: ExtensionTerms, fraction: number, shift: number): number {
  const now = contractNow(league, p);
  const before = now ? surplusValue({ ...p, contract: now }, fraction, shift) : 0;
  const after = surplusValue({ ...p, contract: { type: "guaranteed", salary: terms.salary, years: terms.years } }, fraction, shift);
  return Math.round((after - before) * 10) / 10;
}

export function signExtension(ctx: RosterContext, team: Team, p: Player, terms: ExtensionTerms): void {
  const league = ctx.league;
  p.contract = { type: "guaranteed", salary: terms.salary, years: terms.years, signed: terms.first, total: terms.total };
  const w = league.offseason;
  if (w) {
    w.tenders = w.tenders.filter((t) => t.playerId !== p.id);
    w.expiring = w.expiring.filter((id) => id !== p.id);
  }
  const deal = `a ${terms.years}-year, $${terms.total.toFixed(1)}M extension through ${terms.through}`;
  logTransaction(league, ctx.day, team, p, "extension", `Signed ${playerName(p)} to ${deal}`);
}

/**
 * Spring training: each AI club locks up a player or two it believes in, when
 * its own scouts say the deal beats going year to year and the budget can
 * carry the raise. Returns deals made.
 */
export function aiExtensions(ctx: RosterContext, rng: Rng, seen: WarShift): number {
  const league = ctx.league;
  let made = 0;
  for (const team of league.teams) {
    if (team.id === league.userTeamId) continue;
    const candidates = team.fortyMan
      .map((id) => league.players[id]!)
      .filter((p) => p.age <= 30 && p.contract !== null && p.contract.type !== "minor")
      .map((p) => ({ p, war: seasonWar(p) + seen(team.id, p) }))
      .filter((x) => x.war >= 2)
      .sort((a, b) => b.war - a.war)
      .slice(0, 6);
    let signed = 0;
    for (const { p } of candidates) {
      if (signed >= 2 || !rng.chance(0.5)) continue;
      const offer = extensionOptions(league, p, 1);
      if (!offer.ok) continue;
      // Any length its scouts say is worth it; clubs differ in how long they like to commit.
      const worth = offer.options.filter((t) => t.years <= 6 && extensionGain(league, p, t, 1, seen(team.id, p)) >= Math.max(3, 0.08 * t.total));
      if (worth.length === 0) continue;
      const terms = rng.pick(worth);
      if (terms.salary - (p.contract?.salary ?? 0) > budgetRoom(league, team)) continue;
      signExtension(ctx, team, p, terms);
      signed++;
      made++;
    }
  }
  return made;
}

/** A player's clock: service years, when arbitration starts and when he can walk (null if he isn't under contract). */
export function serviceClock(league: League, p: Player, fraction: number): { service: number; arbFrom: number | null; freeAfter: number } | null {
  const s = standing(league, p, fraction);
  if (typeof s === "string") return null;
  let arbFrom: number | null = null;
  let free = s.first + 15;
  for (let y = 0; y < 15; y++) {
    const svc = s.service(y);
    if (svc >= FREE_AGENT_YEARS) {
      free = s.first + y;
      break;
    }
    if (arbFrom === null && svc >= ARB_YEARS) arbFrom = s.first + y;
  }
  return { service: p.service / SERVICE_DAYS_PER_YEAR, arbFrom, freeAfter: Math.max(free - 1, s.first + s.owed - 1) };
}

export interface ExtensionCandidate {
  p: Player;
  offer: ExtensionOffer;
  /** The length that gains the club the most by its own read, if any gains at all. */
  best: { terms: ExtensionTerms; gain: number } | null;
}

/** The players a club could talk to about an extension, the most valuable (by its read) first. */
export function extensionCandidates(league: League, team: Team, fraction: number, seen: WarShift, limit = 12): ExtensionCandidate[] {
  return team.fortyMan
    .map((id) => league.players[id]!)
    .filter((p) => p.contract !== null && p.contract.type !== "minor" && p.age <= 34)
    .map((p) => ({ p, war: seasonWar(p) + seen(team.id, p) }))
    .sort((a, b) => b.war - a.war)
    .slice(0, limit)
    .map(({ p }) => {
      const offer = extensionOptions(league, p, fraction);
      let best: ExtensionCandidate["best"] = null;
      if (offer.ok) {
        for (const terms of offer.options) {
          const gain = extensionGain(league, p, terms, fraction, seen(team.id, p));
          if (gain > 0 && (!best || gain > best.gain)) best = { terms, gain };
        }
      }
      return { p, offer, best };
    });
}
