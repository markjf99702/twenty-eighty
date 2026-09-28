import type { Team } from "../league/types";
import { type FieldPosition, playerName, type Player } from "../players/types";
import { warShift } from "../scouting/analytics";
import type { Season } from "../season/season";
import { orgPlayers, seasonWar } from "./contracts";
import { BUYER_GB, chips, gamesOut, raceSides, upgrade } from "./offers";
import { asking, evaluateTrade, marketSides, surplusValue, type WarShift } from "./trades";
import { canStart } from "./value";

/**
 * The trade market as the user's front office sees it: the veterans clubs out
 * of the race are shopping, and what a club would want from the user's
 * system for one of its players. Any club will make any trade that clears its
 * price, so this is a guide to realistic targets, not a rule: the list is who
 * sellers are willing to move, sorted by how much each would help the user's
 * club by its own read.
 */

/** Where a player would fit: a lineup spot, the rotation or the bullpen. */
export type Group = FieldPosition | "DH" | "SP" | "RP";

/** Pitchers by what they can do: anyone who can start is valued (and fits) as a starter. */
export const groupOf = (p: Player): Group => (p.pitching ? (canStart(p) ? "SP" : "RP") : p.position === "P" ? "DH" : p.position);

export interface BlockEntry {
  player: Player;
  team: Team;
  /** Games behind the last playoff spot (null in the winter). */
  gamesOut: number | null;
  group: Group;
  /** Wins a season he'd add over who plays there now, by the viewer's read. */
  fit: number;
}

/** Sellers: clubs well out of the race, and rebuilding clubs that aren't in it. In the winter, the weakest rosters. */
function shopping(season: Season): Team[] {
  const league = season.league;
  const rebuilding = marketSides(league).sellers;
  if (league.offseason) return rebuilding;
  const sellers = new Set([...raceSides(season).sellers, ...rebuilding.filter((t) => gamesOut(season, t.id) > BUYER_GB)]);
  return league.teams.filter((t) => sellers.has(t));
}

/** A regular in the seller's own eyes: a season's worth of wins it would want paid for. */
const regular = (group: Group, war: number) => war >= (group === "RP" ? 0.25 : 1);

/**
 * Veterans sellers would move: healthy big leaguers 26 or older whom their
 * own club counts as regulars, with how much each would help the viewer.
 */
export function onTheBlock(season: Season, viewer: number): BlockEntry[] {
  const league = season.league;
  const me = league.teams[viewer]!;
  const seen: WarShift = (v, p) => warShift(season, v, p);
  const out: BlockEntry[] = [];
  for (const team of shopping(season)) {
    if (team.id === viewer) continue;
    const gb = league.offseason ? null : gamesOut(season, team.id);
    for (const p of orgPlayers(league, team)) {
      if (p.level !== "MLB" || p.il || p.injury || p.age < 26) continue;
      const group = groupOf(p);
      if (!regular(group, seasonWar(p) + seen(team.id, p))) continue;
      out.push({ player: p, team, gamesOut: gb, group, fit: upgrade(league, me, p, seen) });
    }
  }
  return out.sort((a, b) => b.fit - a.fit);
}

export type AskingPrice =
  | {
      ok: true;
      give: Player[];
      /** What the other club values the players it sends at, and what it wants back, by its scouts. */
      theirValue: number;
      want: number;
      /** What the package is worth by the user's read. */
      ourCost: number;
    }
  | { ok: false; reason: string };

const MAX_PACKAGE = 3;

/**
 * What a club would want from the user's system for players it sends, the
 * way clubs ask when they shop a player: its favorites among the user's young
 * players (never the user's 20 best big leaguers), by its own scouts, adding
 * up to its price without running far past it. It's their ask, not a bargain:
 * the user can haggle from there in the builder.
 */
export function askingPrice(season: Season, user: Team, partner: Team, get: number[], fraction: number): AskingPrice {
  const league = season.league;
  const seen: WarShift = (v, p) => warShift(season, v, p);
  const players = get.map((id) => league.players[id]!);
  if (players.length === 0) return { ok: false, reason: "Pick who you want from them first." };
  if (players.some((p) => p.teamId !== partner.id)) return { ok: false, reason: "Those players aren't all on their club." };
  const theirValue = players.reduce((s, p) => s + surplusValue(p, fraction, seen(partner.id, p)), 0);
  const want = asking(league, theirValue);
  const fits = (give: Player[]) => {
    const c = evaluateTrade(league, user, partner, give.map((p) => p.id), get, fraction, seen);
    // Being over on the 40-man is the user's to fix with the deal (Make room).
    return c.ok || c.over !== undefined;
  };
  const priced = (give: Player[]) => ({ ok: true as const, give, theirValue, want, ourCost: give.reduce((s, p) => s + surplusValue(p, fraction, seen(user.id, p)), 0) });
  if (want <= 0) return fits([]) ? priced([]) : { ok: false, reason: "They'd let him go, but they can't fit the deal on their roster." };

  const pool = chips(league, user)
    .map((p) => ({ p, v: surplusValue(p, fraction, seen(partner.id, p)) }))
    .filter((x) => x.v > 0.5)
    .sort((a, b) => b.v - a.v || a.p.id - b.p.id);
  const hi = 1.35 * want + 2;
  const pack = (xs: typeof pool): Player[] | null => {
    const out: Player[] = [];
    let sum = 0;
    for (const x of xs) {
      if (sum >= want || out.length >= MAX_PACKAGE) break;
      if (sum + x.v > hi) continue;
      out.push(x.p);
      sum += x.v;
    }
    return sum >= want ? out : null;
  };
  // If their 40-man can't take all of them, they ask for players who aren't on the user's.
  for (const xs of [pool, pool.filter((x) => !x.p.onFortyMan)]) {
    const give = pack(xs);
    if (give && fits(give)) return priced(give);
  }
  const most = pool.slice(0, MAX_PACKAGE).reduce((s, x) => s + x.v, 0);
  return {
    ok: false,
    reason:
      most >= want
        ? "They'd want more than three of your young players, or more than their roster and budget can take. Try building a deal yourself."
        : `Nothing in your system adds up: they'd want about $${want.toFixed(1)}M in young players by their read, and your three they like best come to $${most.toFixed(1)}M.`,
  };
}
