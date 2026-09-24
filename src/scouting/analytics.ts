import type { League } from "../league/types";
import { seasonWar, warFromValue } from "../org/contracts";
import { canStart, offenseValue, playerValue } from "../org/value";
import type { Level, Player } from "../players/types";
import type { Season } from "../season/season";
import { hitterAdvanced, type LeagueContext, pitcherAdvanced } from "../stats/advanced";
import { ANALYTICS_TIERS, perceive, valueShift, type Viewer } from "./scouting";

/**
 * The analytics department: a read on a player from what he's actually done,
 * translated to the major-league scale. Better departments lean on metrics
 * that stabilize faster and say more about skill (xwOBA over wOBA, SIERA over
 * ERA), so their reads are both more reliable in small samples and more
 * trusted when blended with the scouts.
 */

export interface AnalyticsRead {
  /** Value on the `playerValue` scale (runs per season). */
  value: number;
  /** 0-1: how much the sample says (it grows with plate appearances or batters faced). */
  reliability: number;
  /** Plate appearances or batters faced behind it (last season's count at 60%). */
  sample: number;
  basis: string;
}

/** Share of the read that comes from expected stats (xwOBA; FIP/SIERA for pitchers), by tier. */
const HITTER_X_SHARE = [0, 0, 0.5, 0.75, 0.9];
/** Pitcher metric mix by tier: [RA9, ERA, FIP, SIERA]. */
const PITCHER_MIX = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0.5, 0.5],
  [0, 0, 0.2, 0.8],
];
/** Sample size at which each metric is half signal, half noise. */
const HALF = { wOBA: 450, xwOBA: 280, RA9: 700, ERA: 650, FIP: 400, SIERA: 280 };
/** Batters faced in 600 is about 142 innings. */
const IP_PER_600_BF = 142;

const ctxCache = new WeakMap<Season, { day: number; ctx: Map<Level, LeagueContext> }>();
function levelContext(season: Season, level: Level): LeagueContext {
  let c = ctxCache.get(season);
  if (!c || c.day !== season.day) {
    c = { day: season.day, ctx: new Map() };
    ctxCache.set(season, c);
  }
  let ctx = c.ctx.get(level);
  if (!ctx) {
    ctx = season.levels[level].context();
    c.ctx.set(level, ctx);
  }
  return ctx;
}

const tierOf = (league: League, viewer: Viewer) => (viewer === null ? 3 : league.scouting.analytics[viewer]!);

/** His defense and position as the club's scouts see them (performance data can't measure defense well here). */
function defenseAndPosition(league: League, viewer: Viewer, p: Player): number {
  const q = perceive(league, viewer, p);
  return playerValue(q) - offenseValue(q);
}

export function analyticsRead(season: Season, viewer: Viewer, p: Player): AnalyticsRead | null {
  if (p.id < 0) return null;
  const league = season.league;
  const tier = tierOf(league, viewer);
  const parts: { runs: number; n: number; half: number }[] = [];

  if (p.pitching) {
    const mix = PITCHER_MIX[tier - 1]!;
    const half = mix[0]! * HALF.RA9 + mix[1]! * HALF.ERA + mix[2]! * HALF.FIP + mix[3]! * HALF.SIERA;
    const line = season.levels[p.level].pitching.lines.get(p.id);
    if (line && line.BF >= 10) {
      const ctx = levelContext(season, p.level);
      const adv = pitcherAdvanced(line, 1, ctx);
      const ra9 = (27 * line.R) / Math.max(1, line.outs);
      const saved = mix[0]! * (ctx.lgRa9 - ra9) + mix[1]! * (ctx.lgEra - adv.ERA) + mix[2]! * (ctx.lgEra - adv.FIP) + mix[3]! * (ctx.lgEra - adv.SIERA);
      parts.push({ runs: (saved * IP_PER_600_BF) / 9 + season.levelShift(p.level).arm, n: line.BF, half });
    }
    const last = p.career.find((c) => c.year === league.year - 1 && c.level === "MLB" && c.pit);
    if (last?.pit && last.pit.outs > 30) {
      const ctx = levelContext(season, "MLB");
      const metric = tier >= 3 ? last.pit.FIP : last.pit.ERA;
      parts.push({ runs: ((ctx.lgEra - metric) * IP_PER_600_BF) / 9, n: 0.6 * last.pit.outs * 1.4, half });
    }
    if (parts.length === 0) return null;
    // Same role scaling as playerValue: a starter's innings are worth more.
    return finish(parts, (runs) => runs * (canStart(p) ? 1.25 : 0.45), ANALYTICS_TIERS[tier - 1]!.basis);
  }

  const xShare = HITTER_X_SHARE[tier - 1]!;
  const line = season.levels[p.level].batting.lines.get(p.id);
  if (line && line.PA >= 10) {
    const ctx = levelContext(season, p.level);
    const adv = hitterAdvanced(line, undefined, 1, ctx);
    // Expected stats are tracked in the majors only.
    const x = p.level === "MLB" ? xShare : 0;
    const woba = (1 - x) * adv.wOBA + x * adv.xwOBA;
    const half = (1 - x) * HALF.wOBA + x * HALF.xwOBA;
    parts.push({ runs: ((woba - ctx.lgWoba) / ctx.wobaScale) * 600 + season.levelShift(p.level).bat, n: line.PA, half });
  }
  const last = p.career.find((c) => c.year === league.year - 1 && c.level === "MLB" && c.bat);
  if (last?.bat && last.bat.PA >= 30) {
    const ctx = levelContext(season, "MLB");
    parts.push({ runs: ((last.bat.wRCplus - 100) / 100) * ctx.runsPerPA * 600, n: 0.6 * last.bat.PA, half: HALF.wOBA });
  }
  if (parts.length === 0) return null;
  const defense = defenseAndPosition(league, viewer, p);
  return finish(parts, (runs) => runs + defense, ANALYTICS_TIERS[tier - 1]!.basis);
}

function finish(parts: { runs: number; n: number; half: number }[], toValue: (runs: number) => number, basis: string): AnalyticsRead {
  const n = parts.reduce((s, x) => s + x.n, 0);
  const runs = parts.reduce((s, x) => s + x.runs * x.n, 0) / n;
  const half = parts.reduce((s, x) => s + x.half * x.n, 0) / n;
  return { value: toValue(runs), reliability: n / (n + half), sample: Math.round(n), basis };
}

export interface Belief {
  /** Scouts' value (from perceived grades) and the analytics read. */
  scouts: number;
  analytics: AnalyticsRead | null;
  /** Weight on analytics in the blend. */
  weight: number;
  /** What the club believes, on the `playerValue` scale. */
  value: number;
}

/** What a club believes a player is worth today: its scouts' grades blended with its analytics read. */
export function belief(season: Season, viewer: Viewer, p: Player): Belief {
  const league = season.league;
  const scouts = playerValue(perceive(league, viewer, p));
  const read = analyticsRead(season, viewer, p);
  const weight = read ? ANALYTICS_TIERS[tierOf(league, viewer) - 1]!.trust * read.reliability : 0;
  return { scouts, analytics: read, weight, value: read ? (1 - weight) * scouts + weight * read.value : scouts };
}

/** A club's belief about a player's WAR over a full season in his role. */
export const believedWar = (season: Season, viewer: Viewer, p: Player) => warFromValue(p, belief(season, viewer, p).value);

/**
 * How far a club's belief about a player's WAR is from the truth: for big
 * leaguers its scouts-plus-analytics blend, for prospects its scouts' read of
 * where he'll peak. Every projected season shifts by about this much.
 */
export function warShift(season: Season, viewer: Viewer, p: Player): number {
  if (p.level === "MLB" || p.service > 0 || p.teamId === null) return believedWar(season, viewer, p) - seasonWar(p);
  const slope = warFromValue(p, 1) - warFromValue(p, 0);
  return slope * valueShift(season.league, viewer, p, true);
}
