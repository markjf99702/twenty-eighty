import type { Rng } from "../core/rng";
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
  orgPlayers,
  payroll,
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
/** What an AI club wants on top of fair value before it says yes to the user. */
const AI_MARGIN = 0.1;

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
export function controlYears(p: Player, fraction = 1): ControlYear[] {
  const c = p.contract;
  if (!c || p.teamId === null) return [];
  const out: ControlYear[] = [];
  let q = p;
  if (c.type === "guaranteed") {
    for (let y = 0; y < c.years; y++) {
      out.push({ offset: y, war: seasonWar(q), salary: c.salary, guaranteed: true });
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
    const war = seasonWar(q);
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

/** Surplus value in millions: discounted projected value minus salary over the years of control. */
export function surplusValue(p: Player, fraction = 1): number {
  let total = 0;
  for (const y of controlYears(p, fraction)) {
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

/** Would the AI club accept? The user's club sends `give` and receives `get`. */
export function evaluateTrade(league: League, userTeam: Team, partner: Team, give: number[], get: number[], fraction = 1): TradeCheck {
  const P = (id: number) => league.players[id]!;
  const giveValue = give.reduce((s, id) => s + surplusValue(P(id), fraction), 0);
  const getValue = get.reduce((s, id) => s + surplusValue(P(id), fraction), 0);
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
  if (salaryIn - salaryOut > 0 && payroll(league, partner) + salaryIn - salaryOut > partner.budget * 1.05) {
    return { ...base, ok: false, reason: `${partner.nickname} can't take on that much salary.` };
  }
  const want = getValue + Math.max(1, AI_MARGIN * Math.abs(getValue));
  if (giveValue < want) {
    const short = Math.round((want - giveValue) * 10) / 10;
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

/**
 * The AI trade market: contenders buy established players from rebuilding
 * clubs with prospects of similar surplus value. Returns trades made.
 */
export function aiTradeMarket(ctx: RosterContext, rng: Rng, attempts: number, fraction = 1): number {
  const league = ctx.league;
  const clubs = league.teams.filter((t) => t.id !== league.userTeamId);
  const ranked = [...clubs].sort((a, b) => teamStrength(league, b) - teamStrength(league, a));
  const buyers = ranked.slice(0, 12);
  const sellers = ranked.slice(-10);
  let made = 0;
  for (let i = 0; i < attempts; i++) {
    const buyer = rng.pick(buyers);
    const seller = rng.pick(sellers);
    const room = buyer.budget - payroll(league, buyer);
    const target = orgPlayers(league, seller)
      .filter((p) => p.level === "MLB" && !p.il && p.age >= 27 && seasonWar(p) >= 2 && (p.contract?.salary ?? 0) <= room)
      .sort((a, b) => seasonWar(b) - seasonWar(a))[0];
    if (!target) continue;
    const price = surplusValue(target, fraction);
    if (price <= 2) continue;
    const top = new Set(
      orgPlayers(league, buyer)
        .filter((p) => p.level === "MLB")
        .sort((a, b) => seasonWar(b) - seasonWar(a))
        .slice(0, 20)
        .map((p) => p.id),
    );
    const chips = orgPlayers(league, buyer)
      .filter((p) => !top.has(p.id) && !p.il && p.age <= 26)
      .map((p) => ({ p, v: surplusValue(p, fraction) }))
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
    if (fortyManAfter(league, buyer, incoming, [target.id]) > FORTY_MAN_LIMIT + 1) continue;
    executeTrade(ctx, seller, buyer, [target.id], incoming);
    made++;
  }
  return made;
}
