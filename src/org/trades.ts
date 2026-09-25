import type { Rng } from "../core/rng";
import { dials } from "../league/settings";
import type { League, Team } from "../league/types";
import { projectPlayer } from "../players/development";
import { LEVELS, type Level, playerName, type Player } from "../players/types";
import {
  ARB_SHARE,
  ARB_YEARS,
  DOLLARS_PER_WAR,
  FREE_AGENT_YEARS,
  MIN_SALARY,
  marketSalary,
  budgetRoom,
  orgPlayers,
  seasonWar,
  serviceYears,
} from "./contracts";
import { FORTY_MAN_LIMIT, logTransaction, refreshDepth, type RosterContext } from "./roster";

/**
 * Trades, valued the way front offices value them: surplus value, meaning
 * the wins a player is projected to produce over the years a club controls
 * him, priced at the free-agent rate, minus what he'll be paid. A cheap young
 * star is worth a fortune; an aging star on a big contract may be worth less
 * than nothing.
 */

/** Each year further out is worth this much less. */
const DISCOUNT = 0.1;
/** The last day of the season (from Opening Day) that trades are allowed: July 31. */
export const TRADE_DEADLINE_DAY = 127;


export interface ControlYear {
  /** Seasons from now (0 = the current or upcoming season). */
  offset: number;
  war: number;
  salary: number;
  guaranteed: boolean;
}

/**
 * The seasons a club controls a player, with projected WAR and salary.
 * `fraction` is how much of the current season is left (1 in the offseason).
 */
export function controlYears(p: Player, fraction = 1, warShift = 0): ControlYear[] {
  const c = p.contract;
  if (!c || p.teamId === null) return [];
  const out: ControlYear[] = [];
  let q = p;
  if (c.type === "guaranteed") {
    for (let y = 0; y < c.years; y++) {
      out.push({ offset: y, war: seasonWar(q) + warShift, salary: c.salary, guaranteed: true });
      q = projectPlayer(q, 1);
    }
    return out;
  }
  // Pre-arbitration and arbitration: control runs until six years of service.
  // A prospect's clock starts when he's projected to be a big leaguer.
  const service = serviceYears(p);
  let eta = 0;
  if (p.level !== "MLB" && service === 0) {
    let r = p;
    while (eta < 6 && seasonWar(r) < 1) {
      r = projectPlayer(r, 1);
      eta++;
    }
  }
  const years = Math.max(0, FREE_AGENT_YEARS - service) + eta;
  for (let y = 0; y < Math.min(12, years); y++) {
    const war = seasonWar(q) + warShift;
    if (y < eta) {
      out.push({ offset: y, war: 0, salary: 0, guaranteed: false });
    } else {
      const svc = service + (y - eta);
      const salary =
        y === 0 && c.type !== "minor"
          ? c.salary
          : svc < ARB_YEARS
            ? MIN_SALARY
            : ARB_SHARE[Math.min(ARB_SHARE.length - 1, svc - ARB_YEARS)]! * marketSalary(war);
      out.push({ offset: y, war, salary, guaranteed: false });
    }
    q = projectPlayer(q, 1);
  }
  if (out[0]) {
    out[0].war *= fraction;
    out[0].salary *= fraction;
  }
  return out;
}

/**
 * Surplus value in millions: discounted projected value minus salary over the
 * years of control. `warShift` is a club's belief about him relative to the
 * truth (see scouting/analytics), applied to every projected season.
 */
export function surplusValue(p: Player, fraction = 1, warShift = 0): number {
  let total = 0;
  for (const y of controlYears(p, fraction, warShift)) {
    let surplus = Math.max(0, y.war) * DOLLARS_PER_WAR - y.salary;
    // A club can always walk away from a player it doesn't guarantee.
    if (!y.guaranteed) surplus = Math.max(surplus, -0.5);
    total += surplus / (1 + DISCOUNT) ** y.offset;
  }
  return Math.round(total * 10) / 10;
}

export interface TradeCheck {
  ok: boolean;
  reason?: string;
  /** Surplus the user sends and receives, $M. */
  give: number;
  get: number;
}

function fortyManAfter(league: League, team: Team, out: number[], incoming: number[]): number {
  const on = (id: number) => league.players[id]!.onFortyMan;
  return team.fortyMan.length - out.filter(on).length + incoming.filter(on).length;
}

/** A club's belief about a player's WAR relative to the truth (0 = sees him exactly). */
export type WarShift = (viewer: number, p: Player) => number;

/**
 * Would the AI club accept? The user's club sends `give` and receives `get`.
 * Each side values the players through its own scouts (`seen`); the values
 * returned are the user's view.
 */
export function evaluateTrade(
  league: League,
  userTeam: Team,
  partner: Team,
  give: number[],
  get: number[],
  fraction = 1,
  seen: WarShift = () => 0,
): TradeCheck {
  const P = (id: number) => league.players[id]!;
  const value = (viewer: number, ids: number[]) => ids.reduce((s, id) => s + surplusValue(P(id), fraction, seen(viewer, P(id))), 0);
  const giveValue = value(userTeam.id, give);
  const getValue = value(userTeam.id, get);
  const base = { give: Math.round(giveValue * 10) / 10, get: Math.round(getValue * 10) / 10 };
  if (give.length === 0 && get.length === 0) return { ...base, ok: false, reason: "Put players on both sides." };
  if (give.some((id) => P(id).teamId !== userTeam.id) || get.some((id) => P(id).teamId !== partner.id)) {
    return { ...base, ok: false, reason: "Those players aren't all on the right clubs." };
  }
  if (fortyManAfter(league, userTeam, give, get) > FORTY_MAN_LIMIT) {
    return { ...base, ok: false, reason: "You'd be over 40 on the 40-man roster. Clear a spot first." };
  }
  if (fortyManAfter(league, partner, get, give) > FORTY_MAN_LIMIT + 2) {
    return { ...base, ok: false, reason: `${partner.nickname} don't have room on their 40-man roster.` };
  }
  const salaryIn = give.reduce((s, id) => s + (P(id).contract?.type === "guaranteed" ? P(id).contract!.salary : 0), 0);
  const salaryOut = get.reduce((s, id) => s + (P(id).contract?.type === "guaranteed" ? P(id).contract!.salary : 0), 0);
  if (salaryIn - salaryOut > 0 && salaryIn - salaryOut > budgetRoom(league, partner) + 0.05 * partner.budget) {
    return { ...base, ok: false, reason: `${partner.nickname} can't take on that much salary.` };
  }
  // The other club judges with its own scouts.
  const theirIn = value(partner.id, give);
  const theirOut = value(partner.id, get);
  // What an AI club wants on top of fair value before it says yes (set by the difficulty).
  const margin = dials(league).tradeMargin;
  const want = theirOut + Math.max(1, margin * Math.abs(theirOut));
  if (theirIn < want) {
    const short = Math.round((want - theirIn) * 10) / 10;
    return { ...base, ok: false, reason: `${partner.nickname} want more: about $${short}M more in surplus value.` };
  }
  return { ...base, ok: true };
}

function moveTo(league: League, from: Team, to: Team, p: Player): void {
  let level: Level = p.level;
  for (const l of LEVELS) from.rosters[l] = from.rosters[l].filter((id) => id !== p.id);
  const injured = from.injured.includes(p.id);
  from.injured = from.injured.filter((id) => id !== p.id);
  if (p.onFortyMan) {
    from.fortyMan = from.fortyMan.filter((id) => id !== p.id);
    to.fortyMan.push(p.id);
  }
  p.teamId = to.id;
  if (injured) to.injured.push(p.id);
  else {
    if (!LEVELS.includes(level)) level = "AAA";
    to.rosters[level].push(p.id);
  }
}

/** Swap players between two organizations (everyone keeps his level and contract). */
export function executeTrade(ctx: RosterContext, a: Team, b: Team, aSends: number[], bSends: number[]): void {
  const league = ctx.league;
  const P = (id: number) => league.players[id]!;
  const names = (ids: number[]) => ids.map((id) => playerName(P(id))).join(", ") || "nothing";
  for (const id of aSends) moveTo(league, a, b, P(id));
  for (const id of bSends) moveTo(league, b, a, P(id));
  for (const id of aSends) logTransaction(league, ctx.day, b, P(id), "trade", `Acquired ${playerName(P(id))} from ${a.abbrev} for ${names(bSends)}`);
  for (const id of bSends) logTransaction(league, ctx.day, a, P(id), "trade", `Acquired ${playerName(P(id))} from ${b.abbrev} for ${names(aSends)}`);
  refreshDepth(league, a);
  refreshDepth(league, b);
}

/** A club's projected strength: WAR of its best 26. */
export function teamStrength(league: League, team: Team): number {
  const wars = orgPlayers(league, team)
    .filter((p) => p.onFortyMan || p.level === "MLB")
    .map(seasonWar)
    .sort((a, b) => b - a);
  return wars.slice(0, 26).reduce((s, x) => s + Math.max(0, x), 0);
}

/** Contenders and sellers: in the winter by projected strength (the user's club left out). */
export function marketSides(league: League): { buyers: Team[]; sellers: Team[] } {
  const clubs = league.teams.filter((t) => t.id !== league.userTeamId);
  const ranked = [...clubs].sort((a, b) => teamStrength(league, b) - teamStrength(league, a));
  return { buyers: ranked.slice(0, 12), sellers: ranked.slice(-10) };
}

/**
 * The AI trade market: contenders buy established players from rebuilding
 * clubs with prospects of similar surplus value. During the season the sides
 * come from the standings and a buyer pays only what's left of the salary.
 * Returns trades made.
 */
export function aiTradeMarket(
  ctx: RosterContext,
  rng: Rng,
  attempts: number,
  fraction = 1,
  seen: WarShift = () => 0,
  sides: { buyers: Team[]; sellers: Team[] } = marketSides(ctx.league),
): number {
  const league = ctx.league;
  const { buyers, sellers } = sides;
  if (buyers.length === 0 || sellers.length === 0) return 0;
  // In the winter spring training trims 40-man rosters; in season they have to fit now.
  const slack = ctx.offseason ? 1 : 0;
  const minWar = ctx.offseason ? 2 : 1.2;
  let made = 0;
  for (let i = 0; i < attempts; i++) {
    const buyer = rng.pick(buyers);
    const seller = rng.pick(sellers);
    const room = budgetRoom(league, buyer) + (ctx.offseason ? 0 : 0.05 * buyer.budget);
    const target = orgPlayers(league, seller)
      // In season, relievers and role players are on the market too.
      .filter((p) => p.level === "MLB" && !p.il && !p.injury && p.age >= 27 && seasonWar(p) >= minWar && (p.contract?.salary ?? 0) * fraction <= room)
      .sort((a, b) => seasonWar(b) - seasonWar(a))[0];
    if (!target) continue;
    const price = surplusValue(target, fraction, seen(seller.id, target));
    if (price <= 2) continue;
    const top = new Set(
      orgPlayers(league, buyer)
        .filter((p) => p.level === "MLB")
        .sort((a, b) => seasonWar(b) - seasonWar(a))
        .slice(0, 20)
        .map((p) => p.id),
    );
    // The seller prices the prospects it's offered with its own scouts.
    const chips = orgPlayers(league, buyer)
      .filter((p) => !top.has(p.id) && !p.il && !p.injury && p.age <= 26)
      .map((p) => ({ p, v: surplusValue(p, fraction, seen(seller.id, p)) }))
      .filter((x) => x.v > 1 && x.v < price * 1.3)
      .sort((a, b) => b.v - a.v);
    const pkg: typeof chips = [];
    let sum = 0;
    for (const c of chips) {
      if (sum >= price * 1.05 || pkg.length >= 3) break;
      pkg.push(c);
      sum += c.v;
    }
    if (sum < price * 1.05) continue;
    const incoming = pkg.map((x) => x.p.id);
    if (fortyManAfter(league, buyer, incoming, [target.id]) > FORTY_MAN_LIMIT + slack) continue;
    executeTrade(ctx, seller, buyer, [target.id], incoming);
    made++;
  }
  return made;
}
