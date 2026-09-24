import { Rng } from "../core/rng";
import type { League, Team, TradeOffer } from "../league/types";
import { playerName, type Player } from "../players/types";
import { warShift } from "../scouting/analytics";
import type { Season } from "../season/season";
import { budgetRoom, orgPlayers, seasonWar } from "./contracts";
import type { RosterContext } from "./roster";
import {
  aiTradeMarket,
  evaluateTrade,
  executeTrade,
  marketSides,
  surplusValue,
  teamStrength,
  TRADE_DEADLINE_DAY,
  type WarShift,
} from "./trades";

/**
 * The trade market during the season, and trade offers to the user.
 *
 * AI clubs trade with each other from late May to the July 31 deadline, more
 * as it nears: contenders (within a few games of a playoff spot) buy
 * established players from clubs that are out of it, paying in prospects and
 * picking up only what's left of the salary. Every so often a club proposes a
 * deal to the user instead: a contender asking for one of the user's
 * veterans, or a seller offering one of its own. Each club judges players
 * through its own scouts, so an offer can be a bargain or a trap. Offers stand
 * for a few days (a week in the winter) and are kept on the league, so they
 * save and resume.
 *
 * Offers run on one clock: season days during the season, and 1000 plus the
 * winter calendar day in the offseason.
 */

/** In-season offers stand this many days. */
const OFFER_DAYS = 3;
/** A club waits this long before proposing to the user again. */
const OFFER_GAP = 14;
const MAX_OPEN = 2;
/** Games behind the last playoff spot: buyers are this close, sellers this far out. */
const BUYER_GB = 4;
const SELLER_GB = 7;

type Side = { buyers: Team[]; sellers: Team[] };

/** Games behind the last playoff spot in the club's league (negative when holding one). */
export function gamesOut(season: Season, teamId: number): number {
  const league = season.league;
  const lg = league.teams[teamId]!.league;
  const recs = season.records.filter((r) => league.teams[r.teamId]!.league === lg).sort((a, b) => season.compare(a, b));
  const line = recs[5];
  const me = season.records[teamId]!;
  if (!line) return 0;
  const rank = recs.indexOf(me);
  const gb = (line.w - me.w + (me.l - line.l)) / 2;
  return rank <= 5 ? Math.min(0, gb) : Math.max(0, gb);
}

/** Buyers and sellers by the standings (the user's club left out). */
export function raceSides(season: Season): Side {
  const league = season.league;
  const clubs = league.teams.filter((t) => t.id !== league.userTeamId);
  return {
    buyers: clubs.filter((t) => gamesOut(season, t.id) <= BUYER_GB),
    sellers: clubs.filter((t) => gamesOut(season, t.id) >= SELLER_GB),
  };
}

const salaryOf = (p: Player) => (p.contract && p.contract.type !== "minor" ? p.contract.salary : 0);

/** Young players a club would part with: not among its 20 best big leaguers, healthy, 26 or younger. */
function chips(league: League, team: Team): Player[] {
  const core = new Set(
    orgPlayers(league, team)
      .filter((p) => p.level === "MLB")
      .sort((a, b) => seasonWar(b) - seasonWar(a))
      .slice(0, 20)
      .map((p) => p.id),
  );
  return orgPlayers(league, team).filter((p) => !core.has(p.id) && !p.il && !p.injury && p.age <= 26);
}

/** Up to three players whose values add to between `lo` and `hi`, best first. */
function pack(pool: { p: Player; v: number }[], lo: number, hi: number): { p: Player; v: number }[] | null {
  const out: { p: Player; v: number }[] = [];
  let sum = 0;
  for (const x of pool) {
    if (sum >= lo || out.length >= 3) break;
    if (sum + x.v > hi) continue;
    out.push(x);
    sum += x.v;
  }
  return sum >= lo ? out : null;
}

const labeled = (p: Player) => `${p.pitching ? (p.role === "SP" ? "SP" : "RP") : p.position} ${playerName(p)}`;
const list = (ps: Player[]) => {
  const names = ps.map(labeled);
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

interface Draft {
  partner: Team;
  give: Player[];
  get: Player[];
  kind: "buy" | "sell";
}

/** A contender wants one of the user's veterans and offers prospects it values a bit below him. */
function buyOffer(league: League, user: Team, buyers: Team[], rng: Rng, fraction: number, seen: WarShift): Draft | null {
  const buyer = rng.pick(buyers);
  const room = budgetRoom(league, buyer) + 0.05 * buyer.budget;
  const targets = orgPlayers(league, user)
    .filter((p) => p.level === "MLB" && !p.il && !p.injury && p.age >= 25 && seasonWar(p) >= 1.5 && salaryOf(p) * fraction <= room)
    .map((p) => ({ p, v: surplusValue(p, fraction, seen(buyer.id, p)) }))
    .filter((x) => x.v > 3)
    .sort((a, b) => b.v - a.v)
    .slice(0, 5);
  if (targets.length === 0) return null;
  const t = rng.pick(targets);
  const pool = chips(league, buyer)
    .map((p) => ({ p, v: surplusValue(p, fraction, seen(buyer.id, p)) }))
    .filter((x) => x.v > 0.5)
    .sort((a, b) => b.v - a.v);
  // They keep an edge in their own eyes (the same one they'd want from a proposal).
  const got = pack(pool, 0.72 * t.v, Math.min(0.9 * t.v, t.v - 1.1));
  return got ? { partner: buyer, give: [t.p], get: got.map((x) => x.p), kind: "buy" } : null;
}

/** A seller offers one of its veterans for young players it values a bit above him. */
function sellOffer(league: League, user: Team, sellers: Team[], rng: Rng, fraction: number, seen: WarShift): Draft | null {
  const seller = rng.pick(sellers);
  const vets = orgPlayers(league, seller)
    .filter((p) => p.level === "MLB" && !p.il && !p.injury && p.age >= 26 && seasonWar(p) >= 1.5)
    .map((p) => ({ p, v: surplusValue(p, fraction, seen(seller.id, p)) }))
    .filter((x) => x.v > 2)
    .sort((a, b) => b.v - a.v)
    .slice(0, 5);
  if (vets.length === 0) return null;
  const t = rng.pick(vets);
  const pool = chips(league, user)
    .map((p) => ({ p, v: surplusValue(p, fraction, seen(seller.id, p)) }))
    .filter((x) => x.v > 0.5)
    .sort((a, b) => b.v - a.v);
  const lo = Math.max(1.12 * t.v + 1, t.v + 2);
  const got = pack(pool, lo, 1.35 * lo + 2);
  return got ? { partner: seller, give: got.map((x) => x.p), get: [t.p], kind: "sell" } : null;
}

function pitch(d: Draft, inSeason: boolean): string {
  const club = `The ${d.partner.nickname}`;
  if (d.kind === "buy") {
    const target = d.give[0]!;
    return inSeason
      ? `${club} are chasing a playoff spot and want ${labeled(target)}. They'll send ${list(d.get)}.`
      : `${club} want ${labeled(target)} and are offering ${list(d.get)}.`;
  }
  const vet = d.get[0]!;
  const c = vet.contract;
  const rental = inSeason && c && (c.type !== "guaranteed" || c.years <= 1) && c.type !== "pre-arb" ? " (a rental: his contract is up after the season)" : "";
  return inSeason
    ? `${club} are out of the race and shopping ${labeled(vet)}${rental}. They want ${list(d.give)}.`
    : `${club} would move ${labeled(vet)} for ${list(d.give)}.`;
}

/** Whether an offer still stands: open, this season, in time, and everyone still where they were. */
export function offerLive(league: League, o: TradeOffer, now: number): boolean {
  const user = league.userTeamId;
  if (o.status !== "open" || o.year !== league.year || now > o.expires || user === null) return false;
  return o.give.every((id) => league.players[id]!.teamId === user) && o.get.every((id) => league.players[id]!.teamId === o.teamId);
}

/** Close offers that no longer stand and forget old ones. Returns the open ones. */
export function refreshOffers(league: League, now: number): TradeOffer[] {
  for (const o of league.tradeOffers) if (o.status === "open" && !offerLive(league, o, now)) o.status = "expired";
  league.tradeOffers = league.tradeOffers.filter((o) => o.year === league.year && (o.status === "open" || now - o.made <= 60));
  return league.tradeOffers.filter((o) => o.status === "open");
}

/**
 * Maybe propose a deal to the user. `race` says whether the user's club is
 * contending (it gets offers of veterans) or out of it (clubs ask for its
 * veterans). Returns the offer made, if any.
 */
export function proposeToUser(
  league: League,
  rng: Rng,
  now: number,
  expires: number,
  sides: Side,
  race: "contender" | "seller" | "middle",
  fraction: number,
  seen: WarShift,
  inSeason: boolean,
): TradeOffer | null {
  const userId = league.userTeamId;
  if (userId === null) return null;
  const open = refreshOffers(league, now);
  if (open.length >= MAX_OPEN) return null;
  // Clubs that proposed recently wait their turn.
  const recent = new Set(league.tradeOffers.filter((o) => now - o.made < OFFER_GAP).map((o) => o.teamId));
  const available = (teams: Team[]) => teams.filter((t) => !recent.has(t.id));
  const user = league.teams[userId]!;
  const sellFirst = race === "contender" ? rng.chance(0.7) : race === "seller" ? rng.chance(0.2) : rng.chance(0.5);
  const tries: ("buy" | "sell")[] = sellFirst ? ["sell", "buy"] : ["buy", "sell"];
  for (const kind of tries) {
    const pool = available(kind === "buy" ? sides.buyers : sides.sellers);
    if (pool.length === 0) continue;
    const d = kind === "buy" ? buyOffer(league, user, pool, rng, fraction, seen) : sellOffer(league, user, pool, rng, fraction, seen);
    if (!d) continue;
    const give = d.give.map((p) => p.id);
    const get = d.get.map((p) => p.id);
    // Only what the club would actually accept if the user proposed it.
    if (!evaluateTrade(league, user, d.partner, give, get, fraction, seen).ok) continue;
    const offer: TradeOffer = {
      id: league.year * 1_000_000 + now * 100 + d.partner.id,
      teamId: d.partner.id,
      give,
      get,
      kind: d.kind,
      pitch: pitch(d, inSeason),
      year: league.year,
      made: now,
      expires,
      status: "open",
    };
    league.tradeOffers.push(offer);
    return offer;
  }
  return null;
}

/** Accept or decline an offer. Accepting re-checks it (the club can change its mind) and makes the trade. */
export function answerOffer(
  ctx: RosterContext,
  id: number,
  accept: boolean,
  now: number,
  fraction: number,
  seen: WarShift,
): { ok: boolean; reason?: string } {
  const league = ctx.league;
  const o = league.tradeOffers.find((x) => x.id === id);
  if (!o || o.status !== "open") return { ok: false, reason: "That offer is no longer on the table." };
  if (!offerLive(league, o, now)) {
    o.status = "expired";
    return { ok: false, reason: "That offer has expired." };
  }
  if (!accept) {
    o.status = "declined";
    return { ok: true };
  }
  const user = league.teams[league.userTeamId!]!;
  const partner = league.teams[o.teamId]!;
  const check = evaluateTrade(league, user, partner, o.give, o.get, fraction, seen);
  if (!check.ok) {
    o.status = "expired";
    return { ok: false, reason: `The ${partner.nickname} have changed their minds. ${check.reason ?? ""}`.trim() };
  }
  executeTrade(ctx, user, partner, o.give, o.get);
  o.status = "accepted";
  const moved = new Set([...o.give, ...o.get]);
  for (const x of league.tradeOffers) if (x.status === "open" && [...x.give, ...x.get].some((pid) => moved.has(pid))) x.status = "expired";
  return { ok: true };
}

/** Where the user's club stands in the race. */
function userRace(season: Season): "contender" | "seller" | "middle" {
  const user = season.league.userTeamId;
  if (user === null) return "middle";
  const gb = gamesOut(season, user);
  return gb <= BUYER_GB ? "contender" : gb >= SELLER_GB ? "seller" : "middle";
}

/**
 * The end of a season day: the AI market (weekly from late May, more often
 * in the last three weeks, and on deadline day) and now and then an offer to
 * the user. Randomness comes from the date, so replays and resumes agree.
 */
export function tradeDay(season: Season): void {
  const league = season.league;
  const day = season.day;
  if (day > TRADE_DEADLINE_DAY) return;
  const rng = new Rng(`${league.seed}:${league.year}:trades:${day}`);
  const fraction = Math.max(0, 1 - day / season.totalDays);
  const seen: WarShift = (viewer, p) => warShift(season, viewer, p);
  const ctx = season.rosterContext();
  const late = day >= TRADE_DEADLINE_DAY - 21;
  if ((day >= 55 && day % 7 === 3) || day === TRADE_DEADLINE_DAY) {
    const attempts = day === TRADE_DEADLINE_DAY ? 14 : late ? 7 : 3;
    aiTradeMarket(ctx, rng.fork("market"), attempts, fraction, seen, raceSides(season));
  }
  // Offers can only be answered before the deadline passes.
  if (league.userTeamId === null || day < 20 || day >= TRADE_DEADLINE_DAY) return;
  const chance = late ? 0.22 : day >= 55 ? 0.08 : 0.04;
  if (!rng.chance(chance)) return;
  // It stands for the next few days, never past the deadline.
  const expires = Math.min(day + OFFER_DAYS, TRADE_DEADLINE_DAY);
  proposeToUser(league, rng.fork("offer"), day, expires, raceSides(season), userRace(season), fraction, seen, true);
}

/** A winter week of the market: maybe an offer to the user, standing until the next week. */
export function winterOffer(league: League, season: Season, now: number, nextWeek: number): TradeOffer | null {
  const userId = league.userTeamId;
  if (userId === null) return null;
  const rng = new Rng(`${league.seed}:${league.year}:winter-offer:${now}`);
  if (!rng.chance(0.5)) return null;
  // Where the user's club ranks on paper decides who calls.
  const ranked = [...league.teams].sort((a, b) => teamStrength(league, b) - teamStrength(league, a));
  const rank = ranked.findIndex((t) => t.id === userId);
  const race = rank < 12 ? "contender" : rank >= ranked.length - 10 ? "seller" : "middle";
  return proposeToUser(league, rng, now, nextWeek, marketSides(league), race, 1, (viewer, p) => warShift(season, viewer, p), false);
}
