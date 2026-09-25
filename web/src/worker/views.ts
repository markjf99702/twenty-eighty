/**
 * Turn the live League/Season into the view models the UI renders.
 */
import { MAX_OPTION_YEARS, MINOR_LEVELS, PITCH_NAMES, playerName, SERVICE_DAYS_PER_YEAR } from "../../../src/players/types";
import type { FieldPosition, Level, MinorLevel, Player } from "../../../src/players/types";
import { FIELD_POSITIONS, LEVELS } from "../../../src/players/types";
import type { League, Team } from "../../../src/league/types";
import { onTheClock as draftClock } from "../../../src/offseason/draft";
import { teamName } from "../../../src/league/types";
import { defenseGrade } from "../../../src/players/defense";
import {
  activeLimit,
  activePitchers,
  canActivate,
  canBeOptioned,
  canCallUp,
  canOption,
  FORTY_MAN_LIMIT,
  pitcherLimit,
  positionLabel,
  type RosterContext,
  rosterProblems,
} from "../../../src/org/roster";
import { unreadAdvice } from "../../../src/advice/advice";
import { mood } from "../../../src/finance/owner";
import { settingsOf } from "../../../src/league/settings";
import { committed, payroll } from "../../../src/org/contracts";
import { offerLive } from "../../../src/org/offers";
import { surplusValue, TRADE_DEADLINE_DAY } from "../../../src/org/trades";
import { offerClock } from "../../../src/offseason/offseason";
import { overallGrade } from "../../../src/org/value";
import type { Season, SeasonStats, TeamRecord } from "../../../src/season/season";
import type { GameResult } from "../../../src/sim/game";
import { inningsPitched } from "../../../src/stats/lines";
import { BAT_ROW, PIT_ROW, sumRows } from "../../../src/stats/recent";
import { belief, warShift } from "../../../src/scouting/analytics";
import { looksLeft, perceive, staffCost, uncertainty } from "../../../src/scouting/scouting";
import type {
  BoxScoreView,
  Confidence,
  ContractView,
  PayrollView,
  DashboardView,
  GameItem,
  PlayerSummary,
  PlayerView,
  PostseasonView,
  RosterActionOption,
  StandingRow,
  StatSnapshot,
  StandingsView,
  Status,
  TeamRef,
  TeamView,
  TransactionItem,
} from "../api/protocol";

// ---------------------------------------------------------------------------
// Shared helpers

export const teamRef = (t: Team): TeamRef => ({
  id: t.id,
  abbrev: t.abbrev,
  city: t.city,
  nickname: t.nickname,
  league: t.league,
  division: t.division,
});

export function dateLabel(season: Season, day: number): string {
  return season.dateOf(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function phaseOf(season: Season): "regular" | "postseason" | "done" | "offseason" {
  if (season.league.offseason) return "offseason";
  if (!season.done) return "regular";
  return season.postseason ? "done" : "postseason";
}


const WINTER_LABELS: Record<string, [string, string]> = {
  review: ["Season in review", "Go to the tender deadline"],
  tenders: ["Tender deadline", "Tender contracts"],
  draft: ["Amateur draft", "Finish the draft"],
  freeAgency: ["Free agency", "Finish free agency"],
  international: ["International signings", "Close the signing period"],
  spring: ["Spring training", "Start the season"],
};

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3).replace(/^(-?)0\./, "$1.") : "---");

/** Per-level season stats, cached until the next simulated day. */
export class StatsCache {
  private cache = new Map<Level, { day: number; stats: SeasonStats; hit: Map<number, number>; pit: Map<number, number> }>();

  constructor(private season: () => Season) {}

  clear(): void {
    this.cache.clear();
  }

  get(level: Level) {
    const season = this.season();
    const hit = this.cache.get(level);
    if (hit && hit.day === season.day) return hit;
    const stats = season.levels[level].stats();
    const entry = {
      day: season.day,
      stats,
      hit: new Map(stats.hitters.map((h, i) => [h.id, i])),
      pit: new Map(stats.pitchers.map((p, i) => [p.id, i])),
    };
    this.cache.set(level, entry);
    return entry;
  }

  hitter(level: Level, id: number) {
    const c = this.get(level);
    const i = c.hit.get(id);
    return i === undefined ? undefined : c.stats.hitters[i];
  }

  pitcher(level: Level, id: number) {
    const c = this.get(level);
    const i = c.pit.get(id);
    return i === undefined ? undefined : c.stats.pitchers[i];
  }
}

export function status(league: League | null, season: Season | null, hasSave: boolean): Status {
  if (!league || !season) return { hasGame: false, hasSave };
  const user = league.userTeamId;
  const rec = user !== null ? season.records[user] : null;
  return {
    hasGame: true,
    hasSave,
    seed: league.seed,
    year: league.year,
    day: season.day,
    totalDays: season.totalDays,
    date: dateLabel(season, Math.min(season.day, season.totalDays - 1)),
    phase: phaseOf(season),
    ...winterStatus(league, season),
    userTeamId: user,
    minors: season.simulateMinors,
    leagues: league.structure.leagues,
    divisions: league.structure.divisions,
    teams: league.teams.map(teamRef),
    record: rec ? { w: rec.w, l: rec.l } : null,
    owner: league.gm ? { confidence: league.gm.confidence, mood: mood(league.gm.confidence), fired: league.gm.fired } : null,
    offers: user !== null ? league.tradeOffers.filter((o) => offerLive(league, o, offerClock(league, season))).length : 0,
    settings: settingsOf(league),
    staffUnread: user !== null ? unreadAdvice(league) : 0,
    deadline:
      !league.offseason && season.day <= TRADE_DEADLINE_DAY
        ? { date: dateLabel(season, TRADE_DEADLINE_DAY), daysLeft: TRADE_DEADLINE_DAY - season.day }
        : null,
  };
}

function winterStatus(league: League, season: Season): Partial<Status> {
  const phase = phaseOf(season);
  const w = league.offseason;
  const canTrade = phase === "offseason" || (phase === "regular" && season.day <= TRADE_DEADLINE_DAY);
  const tradeNote = canTrade
    ? undefined
    : phase === "regular"
      ? "The trade deadline has passed. Trading reopens in the offseason."
      : "Trading reopens when the offseason begins.";
  if (!w) return { canTrade, tradeNote };
  const [label, action] = WINTER_LABELS[w.phase]!;
  const fa = w.freeAgency;
  const clock = w.draft ? draftClock(w.draft) : null;
  return {
    canTrade,
    winter: {
      phase: w.phase,
      label: w.phase === "freeAgency" && fa ? `${label}, week ${Math.min(fa.week + 1, fa.weeks)} of ${fa.weeks}` : label,
      action: w.phase === "spring" ? `Start the ${league.year + 1} season` : action,
      ...(fa ? { week: fa.week, weeks: fa.weeks } : {}),
      ...(w.phase === "draft" ? { userOnClock: clock?.teamId === league.userTeamId } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Players

function serviceLabel(days: number): string {
  const years = Math.floor(days / SERVICE_DAYS_PER_YEAR);
  return `${years}.${String(days % SERVICE_DAYS_PER_YEAR).padStart(3, "0")}`;
}

function stuffGrade(p: Player): number {
  const pit = p.pitching!;
  const usage = pit.pitches.reduce((s, x) => s + x.usage, 0);
  return pit.pitches.reduce((s, x) => s + x.grade.present * x.usage, 0) / usage;
}

function statLine(p: Player, stats: StatsCache): string {
  if (p.pitching) {
    const s = stats.pitcher(p.level, p.id);
    if (!s) return "";
    const ip = inningsPitched(s.line.outs).toFixed(1);
    const base = `${s.line.G} G${s.line.GS ? `, ${s.line.GS} GS` : ""}, ${ip} IP, ${s.ERA.toFixed(2)} ERA`;
    return `${base}, ${(100 * s.Kpct).toFixed(1)} K%${s.line.SV ? `, ${s.line.SV} SV` : ""}`;
  }
  const s = stats.hitter(p.level, p.id);
  if (!s) return "";
  return `${s.PA} PA, ${f3(s.AVG)}/${f3(s.OBP)}/${f3(s.SLG)}, ${s.line.HR} HR, ${Math.round(s.wRCplus)} wRC+`;
}

const money = (x: number) => (x >= 10 ? `$${x.toFixed(1)}M` : `$${x.toFixed(2)}M`);

export function contractView(p: Player, year: number): ContractView | null {
  const c = p.contract;
  if (!c) return null;
  const through = year + c.years - 1;
  const label =
    c.type === "minor"
      ? "Minor league deal"
      : c.type === "pre-arb"
        ? `Pre-arb ${money(c.salary)}`
        : c.type === "arb"
          ? `Arbitration ${money(c.salary)}`
          : `${money(c.salary)} through ${through}`;
  return { type: c.type, salary: c.salary, years: c.years, through, label };
}

/** This season's line at his current level (in the winter, from his career record, since levels change at spring training). */
function currentSnapshot(p: Player, season: Season, stats: StatsCache): StatSnapshot | null {
  if (p.id < 0) return null;
  if (season.league.offseason) return careerSnapshot(p, season.league.year, p.level);
  const year = season.league.year;
  const level = p.level;
  const mlb = level === "MLB";
  if (p.pitching) {
    const x = stats.pitcher(level, p.id);
    if (!x) return null;
    return {
      year,
      level,
      pit: {
        G: x.line.G,
        GS: x.line.GS,
        IP: x.IP,
        W: x.line.W,
        L: x.line.L,
        SV: x.line.SV,
        ERA: x.ERA,
        FIP: x.FIP,
        ERAminus: Number.isFinite(x.ERAminus) ? Math.round(x.ERAminus) : null,
        Kpct: x.Kpct,
        BBpct: x.BBpct,
        WHIP: x.WHIP,
        WAR: x.WAR,
      },
    };
  }
  const h = stats.hitter(level, p.id);
  if (!h) return null;
  return {
    year,
    level,
    bat: {
      G: h.line.G,
      PA: h.PA,
      AVG: h.PA > 0 ? h.AVG : null,
      OBP: h.PA > 0 ? h.OBP : null,
      SLG: h.SLG,
      HR: h.line.HR,
      SB: h.line.SB,
      BBpct: h.BBpct,
      Kpct: h.Kpct,
      wRCplus: h.PA > 0 ? Math.round(h.wRCplus) : null,
      // Minor league games skip the expected-stat and fielding bookkeeping.
      xwOBA: mlb ? h.xwOBA : null,
      def: mlb ? h.fieldingRuns : null,
      WAR: h.WAR,
    },
  };
}

/** His line over his club's last 15 games at his current level. */
function recentSnapshot(p: Player, season: Season, stats: StatsCache): StatSnapshot | null {
  if (p.id < 0 || p.teamId === null) return null;
  const level = p.level;
  const ls = season.levels[level];
  const cutoff = season.recentCutoff(p.teamId);
  const base = { year: season.league.year, level, recent: true };
  const rows = (p.pitching ? ls.recentPit : ls.recentBat).since(p.id, cutoff);
  if (rows.length === 0) return null;
  const ctx = stats.get(level).stats.context;
  if (p.pitching) {
    const t = sumRows(rows, 14);
    const R = PIT_ROW;
    const ip = t[R.outs]! / 3;
    const era = ip > 0 ? (9 * t[R.ER]!) / ip : 0;
    return {
      ...base,
      pit: {
        G: rows.length,
        GS: t[R.GS]!,
        IP: ip,
        W: t[R.W]!,
        L: t[R.L]!,
        SV: t[R.SV]!,
        ERA: era,
        FIP: ip > 0 ? (13 * t[R.HR]! + 3 * (t[R.BB]! + t[R.HBP]!) - 2 * t[R.SO]!) / ip + ctx.fipConstant : 0,
        // Not park-adjusted over a two-week window.
        ERAminus: ip > 0 && ctx.lgEra > 0 ? Math.round((100 * era) / ctx.lgEra) : null,
        Kpct: t[R.BF]! > 0 ? t[R.SO]! / t[R.BF]! : null,
        BBpct: t[R.BF]! > 0 ? t[R.BB]! / t[R.BF]! : null,
        WHIP: ip > 0 ? (t[R.H]! + t[R.BB]!) / ip : null,
        WAR: null,
      },
    };
  }
  const t = sumRows(rows, 14);
  const R = BAT_ROW;
  const [pa, ab, h, d, tr, hr, bb, hbp, so, sf] = [t[R.PA]!, t[R.AB]!, t[R.H]!, t[R.D]!, t[R.T]!, t[R.HR]!, t[R.BB]!, t[R.HBP]!, t[R.SO]!, t[R.SF]!];
  const w = ctx.weights;
  const denom = ab + bb + sf + hbp;
  const wOBA = denom > 0 ? (w.BB * bb + w.HBP * hbp + w["1B"] * (h - d - tr - hr) + w["2B"] * d + w["3B"] * tr + w.HR * hr) / denom : 0;
  return {
    ...base,
    bat: {
      G: rows.length,
      PA: pa,
      AVG: ab > 0 ? h / ab : null,
      OBP: denom > 0 ? (h + bb + hbp) / denom : null,
      SLG: ab > 0 ? (h + d + 2 * tr + 3 * hr) / ab : null,
      HR: hr,
      SB: t[R.SB]!,
      BBpct: pa > 0 ? bb / pa : null,
      Kpct: pa > 0 ? so / pa : null,
      // wRC+ from this window's wOBA, without the park adjustment.
      wRCplus: pa > 0 ? Math.round((100 * ((wOBA - ctx.lgWoba) / ctx.wobaScale + ctx.runsPerPA)) / ctx.runsPerPA) : null,
      xwOBA: null,
      def: null,
      WAR: null,
    },
  };
}

/** Last season from his career record. */
function lastSnapshot(p: Player, season: Season): StatSnapshot | null {
  return careerSnapshot(p, season.league.year - 1);
}

/** A season from his career record: the line at `prefer` if he has one, else his highest level. */
function careerSnapshot(p: Player, year: number, prefer?: Level): StatSnapshot | null {
  const lines = p.career.filter((c) => c.year === year && (p.pitching ? c.pit : c.bat));
  if (lines.length === 0) return null;
  const line = lines.find((c) => c.level === prefer) ?? lines.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))[0]!;
  if (line.pit) {
    const x = line.pit;
    const ip = x.outs / 3;
    return {
      year,
      level: line.level,
      pit: {
        G: x.G,
        GS: x.GS,
        IP: ip,
        W: x.W,
        L: x.L,
        SV: x.SV,
        ERA: x.ERA,
        FIP: x.FIP,
        ERAminus: x.ERAminus ?? null,
        Kpct: x.Kpct ?? null,
        BBpct: x.BBpct ?? null,
        WHIP: x.WHIP ?? (ip > 0 ? (x.H + x.BB) / ip : null),
        WAR: x.WAR,
      },
    };
  }
  const b = line.bat!;
  return {
    year,
    level: line.level,
    bat: {
      G: b.G,
      PA: b.PA,
      AVG: b.AB > 0 ? b.H / b.AB : null,
      OBP: b.OBP ?? null,
      SLG: b.SLG ?? (b.AB > 0 ? (b.H + b.D + 2 * b.T + 3 * b.HR) / b.AB : null),
      HR: b.HR,
      SB: b.SB,
      BBpct: b.BBpct ?? (b.PA > 0 ? b.BB / b.PA : null),
      Kpct: b.Kpct ?? (b.PA > 0 ? b.SO / b.PA : null),
      wRCplus: b.PA > 0 ? b.wRCplus : null,
      xwOBA: null,
      def: null,
      WAR: b.WAR,
    },
  };
}

const toGrade = (v: number) => Math.round(Math.max(20, Math.min(80, 50 + v / 2)));

/** Scouting confidence from the typical error (grade points). */
export function confidenceOf(sigma: number): Confidence {
  return sigma <= 2.5 ? "high" : sigma <= 4.5 ? "medium" : "low";
}

/** How the user's front office sees a player: perceived grades and the scouts/analytics blend. */
export function readOf(season: Season, p: Player) {
  const league = season.league;
  const viewer = league.userTeamId;
  const seen = perceive(league, viewer, p);
  const b = belief(season, viewer, p);
  const sigma = uncertainty(league, viewer, p);
  return { seen, belief: b, sigma, now: toGrade(b.value), fv: Math.max(toGrade(b.value), overallGrade(seen, true)) };
}

export function playerSummary(
  p: Player,
  season: Season,
  stats: StatsCache,
  actions?: RosterActionOption[],
): PlayerSummary {
  const read = readOf(season, p);
  const q = read.seen;
  const h = q.hitting;
  const grades: [string, number][] = q.pitching
    ? [
        ["Stuff", stuffGrade(q)],
        ["Ctl", q.pitching.control.present],
        ["Cmd", q.pitching.command.present],
        ["Stam", q.pitching.stamina.present],
      ]
    : [
        ["Hit", h.hit.present],
        ["Pow", h.power.present],
        ["Eye", h.eye.present],
        ["Run", h.speed.present],
        ["Fld", h.field.present],
        ["Arm", h.arm.present],
      ];
  return {
    id: p.id,
    name: playerName(p),
    pos: p.pitching ? (p.role === "SP" ? "SP" : "RP") : p.position,
    age: p.age,
    bats: p.bats,
    throws: p.throws,
    level: p.level,
    teamId: p.teamId,
    ovr: read.now,
    fv: read.fv,
    pitcher: Boolean(p.pitching),
    grades,
    read: {
      scouts: toGrade(read.belief.scouts),
      analytics: read.belief.analytics ? toGrade(read.belief.analytics.value) : null,
      confidence: confidenceOf(read.sigma),
    },
    status: {
      fortyMan: p.onFortyMan || p.il === "IL60",
      optionsLeft: MAX_OPTION_YEARS - p.options.used,
      optionedThisYear: p.options.usedThisYear,
      canBeOptioned: canBeOptioned(p),
      service: serviceLabel(p.service),
      il: p.il,
      injury: p.injury && p.injury.daysLeft > 0 ? { name: p.injury.name, daysLeft: p.injury.daysLeft } : null,
    },
    line: p.id >= 0 ? statLine(p, stats) : "",
    stats: currentSnapshot(p, season, stats),
    last: lastSnapshot(p, season),
    recent: recentSnapshot(p, season, stats),
    contract: contractView(p, contractYear(season)),
    actions,
  };
}

/** The season a contract's first year refers to (next season, during the winter). */
export const contractYear = (season: Season) => season.league.year + (season.league.offseason ? 1 : 0);

/** Roster moves the user's club could make with this player right now. */
export function rosterActions(p: Player, team: Team, ctx: RosterContext): RosterActionOption[] {
  const out: RosterActionOption[] = [];
  const add = (kind: RosterActionOption["kind"], label: string, check: { ok: boolean; reason?: string }, level?: MinorLevel) =>
    out.push({ kind, label, ok: check.ok, ...(check.ok ? {} : { reason: check.reason }), ...(level ? { level } : {}) });

  if (p.il) {
    add("activate", "Activate", canActivate(ctx, team, p, "MLB"));
    add("activateToMinors", "Activate to AAA", canActivate(ctx, team, p, "AAA"));
    return out;
  }
  if (p.level === "MLB") {
    add("option", "Option to AAA", canOption(ctx, team, p));
    if (p.injury && p.injury.daysLeft > 0) add("placeIl", "Place on IL", { ok: true });
    add("dfa", "Designate for assignment", p.onFortyMan ? { ok: true } : { ok: false, reason: "Not on the 40-man." });
    return out;
  }
  add("callUp", p.onFortyMan ? "Call up" : "Select contract", canCallUp(ctx, team, p));
  const idx = MINOR_LEVELS.indexOf(p.level as MinorLevel);
  if (idx > 0) add("assign", `Promote to ${MINOR_LEVELS[idx - 1]}`, { ok: true }, MINOR_LEVELS[idx - 1]);
  if (idx < MINOR_LEVELS.length - 1) add("assign", `Send to ${MINOR_LEVELS[idx + 1]}`, { ok: true }, MINOR_LEVELS[idx + 1]);
  if (!p.onFortyMan) {
    add("add40", "Add to 40-man", team.fortyMan.length < FORTY_MAN_LIMIT ? { ok: true } : { ok: false, reason: "The 40-man roster is full." });
    add("release", "Release", { ok: true });
  } else {
    add("dfa", "Designate for assignment", { ok: true });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Standings

function standingRow(season: Season, r: TeamRecord, leader: TeamRecord): StandingRow {
  const t = season.team(r.teamId);
  const l10w = r.last10.filter(Boolean).length;
  return {
    teamId: r.teamId,
    name: teamName(t),
    abbrev: t.abbrev,
    w: r.w,
    l: r.l,
    pct: r.w + r.l > 0 ? r.w / (r.w + r.l) : 0,
    gb: season.gamesBehind(leader, r),
    rs: r.rs,
    ra: r.ra,
    streak: r.streak,
    last10: `${l10w}-${r.last10.length - l10w}`,
    home: `${r.homeW}-${r.homeL}`,
    away: `${r.awayW}-${r.awayL}`,
  };
}

export function standingsView(season: Season, level: Level): StandingsView {
  const ls = season.levels[level];
  const table = ls.standings().map((lg) => lg.map((div) => div.map((r) => standingRow(season, r, div[0]!))));
  const wildCard = ls.standings().map((lg) => {
    const rest = lg.flatMap((div) => div.slice(1)).sort((a, b) => ls.compare(a, b));
    const line = rest[2];
    return rest.map((r) => {
      const t = season.team(r.teamId);
      return {
        teamId: r.teamId,
        name: teamName(t),
        abbrev: t.abbrev,
        w: r.w,
        l: r.l,
        gb: line ? season.gamesBehind(line, r) : 0,
      };
    });
  });
  return { level, leagues: season.league.structure.leagues, divisions: season.league.structure.divisions, table, wildCard };
}

// ---------------------------------------------------------------------------
// Teams

export function payrollView(season: Season, stats: StatsCache, team: Team): PayrollView {
  const league = season.league;
  const year = contractYear(season);
  const everyone = [...LEVELS.flatMap((l) => team.rosters[l]), ...team.injured].map((id) => league.players[id]!);
  const contracts = everyone
    .filter((p) => p.contract && p.contract.type !== "minor")
    .sort((a, b) => b.contract!.salary - a.contract!.salary)
    .map((p) => ({ ...playerSummary(p, season, stats), surplus: surplusValue(p, 1, warShift(season, league.userTeamId, p)) }));
  return {
    payroll: payroll(league, team),
    budget: team.budget,
    staff: staffCost(league, team),
    deadMoney: Math.round(team.deadMoney.reduce((s2, d) => s2 + d.amount, 0) * 100) / 100,
    commitments: [1, 2, 3, 4, 5].map((k) => ({ year: year + k, amount: committed(league, team, k) })),
    contracts,
  };
}

export function teamView(season: Season, stats: StatsCache, teamId: number, ctx: RosterContext): TeamView {
  const league = season.league;
  const team = season.team(teamId);
  const isUser = league.userTeamId === teamId;
  const P = (id: number) => league.players[id]!;
  const summarize = (id: number) => playerSummary(P(id), season, stats, isUser ? rosterActions(P(id), team, ctx) : undefined);
  const rec = season.records[teamId]!;
  const minors = {} as Record<MinorLevel, PlayerSummary[]>;
  for (const level of MINOR_LEVELS) minors[level] = team.rosters[level].map(summarize);
  return {
    team: {
      ...teamRef(team),
      park: team.park.name,
      altitude: team.park.altitude,
      market: team.market,
      affiliates: Object.fromEntries(MINOR_LEVELS.map((l) => [l, team.affiliates[l].name])) as Record<MinorLevel, string>,
    },
    payroll: payrollView(season, stats, team),
    isUser,
    manualRoster: Boolean(team.manualRoster),
    manualDepth: Boolean(team.manualDepth),
    record: { w: rec.w, l: rec.l, rs: rec.rs, ra: rec.ra },
    counts: {
      active: team.rosters.MLB.length,
      activeLimit: activeLimit(ctx),
      pitchers: activePitchers(league, team),
      pitcherLimit: pitcherLimit(ctx),
      fortyMan: team.fortyMan.length,
    },
    problems: rosterProblems(ctx, team),
    depth: team.depth,
    active: team.rosters.MLB.map(summarize),
    injured: team.injured.map(summarize),
    minors,
  };
}

// ---------------------------------------------------------------------------
// Player page

export function playerView(season: Season, stats: StatsCache, playerId: number, ctx: RosterContext): PlayerView {
  const league = season.league;
  const p = league.players[playerId]!;
  const team = p.teamId !== null ? season.team(p.teamId) : null;
  const isUser = team !== null && league.userTeamId === team.id;
  const careerTeams: Record<number, string> = {};
  for (const c of p.career) if (c.teamId !== null) careerTeams[c.teamId] = league.teams[c.teamId]!.abbrev;
  const d = p.draft;
  const draft = d
    ? `${d.year} draft, round ${d.round} (#${d.pick} overall) by ${league.teams[d.teamId]!.city} ${league.teams[d.teamId]!.nickname}`
    : null;
  // Everything graded here is the user's scouts' report, not the truth.
  const read = readOf(season, p);
  const q = read.seen;
  const h = q.hitting;
  const tools = q.pitching
    ? [
        { label: "Control", present: q.pitching.control.present, future: q.pitching.control.future, note: "throwing strikes" },
        { label: "Command", present: q.pitching.command.present, future: q.pitching.command.future, note: "hitting spots" },
        { label: "Stamina", present: q.pitching.stamina.present, future: q.pitching.stamina.future, note: "how deep he goes" },
      ]
    : [
        { label: "Hit", present: h.hit.present, future: h.hit.future, note: "bat-to-ball" },
        { label: "Power", present: h.power.present, future: h.power.future, note: "raw exit velocity" },
        { label: "Eye", present: h.eye.present, future: h.eye.future, note: "plate discipline" },
        { label: "Run", present: h.speed.present, future: h.speed.future, note: "sprint speed" },
        { label: "Field", present: h.field.present, future: h.field.future, note: "range and hands" },
        { label: "Arm", present: h.arm.present, future: h.arm.future, note: "strength and accuracy" },
      ];
  const statsRows = LEVELS.flatMap((level) => {
    const hit = p.pitching ? undefined : stats.hitter(level, p.id);
    const pit = p.pitching ? stats.pitcher(level, p.id) : undefined;
    if (!hit && !pit) return [];
    return [{ level, team: team?.abbrev ?? "FA", ...(hit ? { hitting: hit } : {}), ...(pit ? { pitching: pit } : {}) }];
  });
  const traits: string[] = [];
  if (!p.pitching) {
    const t = p.traits;
    traits.push(t.launch > 0.5 ? "Fly-ball swing" : t.launch < -0.5 ? "Ground-ball swing" : "Balanced swing path");
    traits.push(t.pull > 0.5 ? "Pull hitter" : t.pull < -0.5 ? "Uses the whole field" : "Neutral spray");
    if (t.aggression > 0.8) traits.push("Aggressive baserunner");
  }
  // Medical history is private: you know your own players, and what your scouts dig up on others.
  const looks = league.scouting.looks[p.id] ?? 0;
  if (isUser || looks >= 2) traits.push(p.durability > 0.8 ? "Injury-prone" : p.durability < -0.8 ? "Durable" : "Average durability");
  return {
    summary: playerSummary(p, season, stats, isUser ? rosterActions(p, team!, ctx) : undefined),
    team: team ? teamRef(team) : null,
    born: `${league.year - p.age}`,
    tools,
    pitches: (q.pitching?.pitches ?? []).map((x) => ({
      type: x.type,
      name: PITCH_NAMES[x.type],
      present: x.grade.present,
      future: x.grade.future,
      usage: x.usage,
    })),
    velocity: p.pitching?.velocity ?? null,
    defense: p.pitching
      ? []
      : FIELD_POSITIONS.map((pos: FieldPosition) => ({ pos, grade: defenseGrade(q, pos), natural: p.positions.includes(pos) }))
          .filter((d) => d.natural || d.grade >= 40)
          .sort((a, b) => b.grade - a.grade),
    traits,
    stats: statsRows,
    transactions: league.transactions
      .filter((t) => t.playerId === p.id)
      .slice(-40)
      .reverse()
      .map((t) => ({ date: `${dateLabel(season, t.day)}${t.year !== league.year ? ` ${t.year + (t.day > 280 ? 1 : 0)}` : ""}`, text: t.text })),
    career: p.career,
    careerTeams,
    awards: p.awards,
    draft,
    surplus: team ? surplusValue(p, 1, warShift(season, league.userTeamId, p)) : null,
    retired: p.retired ?? null,
    scouting: {
      sigma: Math.round(read.sigma * 10) / 10,
      confidence: confidenceOf(read.sigma),
      familiarity: familiarityLabel(league, p),
      looks,
      looksLeft: looksLeft(league, season.day),
      canLook: league.userTeamId !== null && p.teamId !== league.userTeamId && p.retired === undefined,
      scoutsGrade: toGrade(read.belief.scouts),
      analytics: read.belief.analytics
        ? {
            grade: toGrade(read.belief.analytics.value),
            reliability: Math.round(100 * read.belief.analytics.reliability) / 100,
            sample: read.belief.analytics.sample,
            basis: read.belief.analytics.basis,
            weight: Math.round(100 * read.belief.weight) / 100,
          }
        : null,
      blendGrade: read.now,
    },
  };
}

function familiarityLabel(league: League, p: Player): string {
  if (p.teamId !== null && p.teamId === league.userTeamId) return "Your organization: your scouts see him every day";
  if (p.teamId === null) return p.service > 0 ? "Free agent with big-league time" : "Free agent";
  if (p.level === "MLB") return "Big leaguer: plenty of video and data";
  if (p.level === "AAA" || p.level === "AA") return "Another club's upper minors";
  return "Another club's lower minors: few looks";
}

// ---------------------------------------------------------------------------
// Transactions, scores, box scores

const MAJOR_TYPES = new Set(["call-up", "option", "il-place", "il-activate", "il-transfer", "dfa", "claim", "outright", "release", "add-40", "injury"]);

export function transactions(season: Season, opts: { teamId?: number; majorOnly?: boolean; limit?: number }): TransactionItem[] {
  const league = season.league;
  const out: TransactionItem[] = [];
  for (let i = league.transactions.length - 1; i >= 0 && out.length < (opts.limit ?? 200); i--) {
    const t = league.transactions[i]!;
    if (opts.teamId !== undefined && t.teamId !== opts.teamId) continue;
    if (opts.majorOnly && !MAJOR_TYPES.has(t.type)) continue;
    out.push({ date: dateLabel(season, t.day), year: t.year, teamId: t.teamId, abbrev: league.teams[t.teamId]!.abbrev, playerId: t.playerId, type: t.type, text: t.text });
  }
  return out;
}

export const gameKey = (day: number, homeId: number) => `${day}-${homeId}`;

export function gameItems(season: Season, day: number, boxes: Map<string, BoxScoreView>): GameItem[] {
  const P = season.league.players;
  const name = (id: number | null) => (id === null ? null : P[id]!.lastName);
  return season.games
    .filter((g) => g.day === day)
    .map((g) => ({
      key: gameKey(g.day, g.homeId),
      day: g.day,
      awayId: g.awayId,
      homeId: g.homeId,
      away: season.team(g.awayId).abbrev,
      home: season.team(g.homeId).abbrev,
      score: g.score,
      innings: g.innings,
      hasBox: boxes.has(gameKey(g.day, g.homeId)),
      wp: name(g.winningPitcher),
      lp: name(g.losingPitcher),
      sv: name(g.savePitcher),
    }));
}

export function boxScoreView(season: Season, r: GameResult, day: number): BoxScoreView {
  const P = season.league.players;
  const teams: [Team, Team] = [season.team(r.awayId), season.team(r.homeId)];
  const batting = [0, 1].map((i) =>
    r.battingOrder[i]!.flat().map((slot) => {
      const b = r.batting.get(slot.id);
      return {
        id: slot.id,
        name: playerName(P[slot.id]!),
        pos: slot.pos,
        ...(slot.sub ? { sub: slot.sub } : {}),
        ab: b.AB,
        r: b.R,
        h: b.H,
        rbi: b.RBI,
        bb: b.BB,
        so: b.SO,
        hr: b.HR,
        avgEv: b.BBE > 0 ? Math.round((10 * b.evSum) / b.BBE) / 10 : null,
      };
    }),
  ) as BoxScoreView["batting"];
  const pitching = [0, 1].map((i) =>
    r.pitchersUsed[i]!.map((id) => {
      const p = r.pitching.get(id);
      const note = r.winningPitcher === id ? "W" : r.losingPitcher === id ? "L" : r.savePitcher === id ? "S" : p.HLD ? "H" : p.BS ? "BS" : "";
      return { id, name: playerName(P[id]!), note, ip: inningsPitched(p.outs).toFixed(1), h: p.H, r: p.R, er: p.ER, bb: p.BB, so: p.SO, hr: p.HR, pitches: p.pitches };
    }),
  ) as BoxScoreView["pitching"];
  const notes: string[] = [];
  for (const i of [0, 1]) {
    const hrs = batting[i]!.filter((b) => b.hr > 0).map((b) => `${P[b.id]!.lastName}${b.hr > 1 ? ` ${b.hr}` : ""}`);
    if (hrs.length) notes.push(`HR (${teams[i]!.abbrev}): ${hrs.join(", ")}`);
  }
  for (const inj of r.injuries) notes.push(`Injury: ${playerName(P[inj.playerId]!)}, ${inj.injury.name.toLowerCase()} (~${inj.injury.days} days)`);
  return {
    key: gameKey(day, r.homeId),
    date: dateLabel(season, day),
    park: teams[1].park.name,
    teams: [teamRef(teams[0]), teamRef(teams[1])],
    lineScore: r.lineScore,
    totals: [
      { r: r.score[0], h: r.hits[0], e: r.errors[0] },
      { r: r.score[1], h: r.hits[1], e: r.errors[1] },
    ],
    batting,
    pitching,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Dashboard and postseason

export function dashboardView(season: Season, stats: StatsCache, boxes: Map<string, BoxScoreView>, st: Status): DashboardView {
  const league = season.league;
  const team = season.team(league.userTeamId!);
  const rec = season.records[team.id]!;
  const standings = season.standings();
  const div = standings[team.league]![team.division]!;
  const leader = div[0]!;
  const l10w = rec.last10.filter(Boolean).length;
  const recentDays = [...new Set(season.games.filter((g) => g.awayId === team.id || g.homeId === team.id).map((g) => g.day))].slice(-8);
  const recent = recentDays.flatMap((d) => gameItems(season, d, boxes).filter((g) => g.awayId === team.id || g.homeId === team.id)).reverse();

  const s = stats.get("MLB").stats;
  const mine = (id: number) => league.players[id]?.teamId === team.id;
  const hitters = s.hitters.filter((h) => mine(h.id));
  const pitchers = s.pitchers.filter((p) => mine(p.id));
  const leaders: DashboardView["leaders"] = [];
  const top = <T,>(rows: T[], by: (r: T) => number) => [...rows].sort((a, b) => by(b) - by(a))[0];
  const wh = top(hitters, (h) => h.WAR);
  if (wh) leaders.push({ label: "WAR (bat)", name: wh.name, playerId: wh.id, value: wh.WAR.toFixed(1) });
  const hr = top(hitters, (h) => h.line.HR);
  if (hr) leaders.push({ label: "Home runs", name: hr.name, playerId: hr.id, value: String(hr.line.HR) });
  const avg = top(hitters.filter((h) => h.PA >= 100), (h) => h.OBP + h.SLG);
  if (avg) leaders.push({ label: "OPS", name: avg.name, playerId: avg.id, value: f3(avg.OBP + avg.SLG) });
  const wp = top(pitchers, (p) => p.WAR);
  if (wp) leaders.push({ label: "WAR (arm)", name: wp.name, playerId: wp.id, value: wp.WAR.toFixed(1) });
  const era = top(pitchers.filter((p) => p.IP >= 20), (p) => -p.ERA);
  if (era) leaders.push({ label: "ERA", name: era.name, playerId: era.id, value: era.ERA.toFixed(2) });
  const sv = top(pitchers, (p) => p.line.SV);
  if (sv && sv.line.SV > 0) leaders.push({ label: "Saves", name: sv.name, playerId: sv.id, value: String(sv.line.SV) });

  const hurt = [...team.injured, ...team.rosters.MLB.filter((id) => (league.players[id]!.injury?.daysLeft ?? 0) > 0)];
  const prospects = MINOR_LEVELS.flatMap((l) => team.rosters[l])
    .map((id) => league.players[id]!)
    .filter((p) => p.age <= 25)
    .sort((a, b) => overallGrade(b, true) - overallGrade(a, true) || a.age - b.age)
    .slice(0, 8);

  return {
    status: st,
    team: teamRef(team),
    record: {
      w: rec.w,
      l: rec.l,
      rs: rec.rs,
      ra: rec.ra,
      streak: rec.streak,
      last10: `${l10w}-${rec.last10.length - l10w}`,
      divRank: div.indexOf(rec) + 1,
      gb: season.gamesBehind(leader, rec),
    },
    division: div.map((r) => standingRow(season, r, leader)),
    recent,
    leaders,
    injured: hurt.map((id) => playerSummary(league.players[id]!, season, stats)),
    prospects: prospects.map((p) => playerSummary(p, season, stats)),
    news: transactions(season, { majorOnly: true, limit: 14 }),
    userNews: transactions(season, { teamId: team.id, majorOnly: true, limit: 14 }),
  };
}

export function postseasonView(season: Season): PostseasonView | null {
  const post = season.postseason;
  if (!post) return null;
  const ab = (id: number) => season.team(id).abbrev;
  return {
    seeds: post.seeds.map((lg) => lg.map((id) => ({ teamId: id, abbrev: ab(id), name: teamName(season.team(id)) }))),
    series: post.series.map((s) => ({
      round: s.round,
      league: s.league === null ? "" : season.league.structure.leagues[s.league]!,
      higher: ab(s.higher),
      lower: ab(s.lower),
      winner: ab(s.winner),
      wins: s.wins,
      games: s.games.map((g) => `${ab(g.awayId)} ${g.score[0]}, ${ab(g.homeId)} ${g.score[1]}${g.innings > 9 ? ` (${g.innings})` : ""}`),
    })),
    champion: ab(post.champion),
  };
}

export { positionLabel };
