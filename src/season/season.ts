import { Rng } from "../core/rng";
import { NEUTRAL_PARK } from "../league/parks";
import type { DepthChart, League, Team } from "../league/types";
import { manageOrganization, type PerformanceLookup } from "../org/ai";
import { autoDepthChart } from "../org/depth";
import { logTransaction, positionLabel, type RosterContext } from "../org/roster";
import { offenseValue, pitchingValue } from "../org/value";
import { injuryPhrase } from "../players/injuries";
import { LEVELS, type Level, type Player, playerName, SERVICE_DAYS_PER_YEAR } from "../players/types";
import {
  emptyBattedBallCounters,
  emptyRunningCounters,
  simulateGame,
  type GameResult,
  type SimEnv,
  type TeamGameSetup,
} from "../sim/game";
import { averageDefense, buildLineup } from "../sim/manager";
import {
  buildLeagueContext,
  finishHitterWar,
  finishPitcherWar,
  hitterAdvanced,
  pitcherAdvanced,
  type HitterAdvanced,
  type LeagueContext,
  type PitcherAdvanced,
} from "../stats/advanced";
import {
  addBatting,
  addFielding,
  addPitching,
  emptyBatting,
  emptyFielding,
  emptyPitching,
  LineBook,
  type BattingLine,
  type FieldingLine,
  type PitchingLine,
} from "../stats/lines";
import { batRow, pitRow, RECENT_GAMES, RecentLog } from "../stats/recent";
import { RunTracker } from "../stats/runExpectancy";
import type { PostseasonResult } from "./postseason";
import { buildSchedule, type Schedule } from "./schedule";
import { StaffTracker } from "./staff";

export interface GameSummary {
  day: number;
  awayId: number;
  homeId: number;
  score: [number, number];
  innings: number;
  hits: [number, number];
  errors: [number, number];
  winningPitcher: number | null;
  losingPitcher: number | null;
  savePitcher: number | null;
}

export interface TeamRecord {
  teamId: number;
  w: number;
  l: number;
  rs: number;
  ra: number;
  homeW: number;
  homeL: number;
  awayW: number;
  awayL: number;
  divW: number;
  divL: number;
  /** Positive = winning streak, negative = losing streak. */
  streak: number;
  last10: boolean[];
}

export interface HitterRow extends HitterAdvanced {
  id: number;
  name: string;
  team: string;
  pos: string;
  line: BattingLine;
}

export interface PitcherRow extends PitcherAdvanced {
  id: number;
  name: string;
  team: string;
  role: string;
  line: PitchingLine;
}

export interface SeasonStats {
  level: Level;
  context: LeagueContext;
  hitters: HitterRow[];
  pitchers: PitcherRow[];
}

const summarize = (day: number, r: GameResult): GameSummary => ({
  day,
  awayId: r.awayId,
  homeId: r.homeId,
  score: r.score,
  innings: r.innings,
  hits: r.hits,
  errors: r.errors,
  winningPitcher: r.winningPitcher,
  losingPitcher: r.losingPitcher,
  savePitcher: r.savePitcher,
});

export const emptyRecord = (teamId: number): TeamRecord => ({
  teamId,
  w: 0,
  l: 0,
  rs: 0,
  ra: 0,
  homeW: 0,
  homeL: 0,
  awayW: 0,
  awayL: 0,
  divW: 0,
  divL: 0,
  streak: 0,
  last10: [],
});

/** One level's season: its games, standings and stat books. */
export class LevelSeason {
  tracker = new RunTracker();
  readonly batting = new LineBook<BattingLine>(emptyBatting, { running: true, add: addBatting });
  readonly pitching = new LineBook<PitchingLine>(emptyPitching, { running: true, add: addPitching });
  readonly fielding = new LineBook<FieldingLine>(emptyFielding, { running: true, add: addFielding });
  records: TeamRecord[];
  games: GameSummary[] = [];
  env: SimEnv;
  parkRuns: { home: number; homeG: number; road: number; roadG: number }[];
  /** Each player's most recent game lines at this level (for recent-form views). */
  readonly recentBat = new RecentLog();
  readonly recentPit = new RecentLog();

  constructor(
    readonly level: Level,
    readonly league: League,
  ) {
    const mlb = level === "MLB";
    this.env = {
      league,
      avgDefense: averageDefense(league, level),
      neutralPark: NEUTRAL_PARK,
      tracker: this.tracker,
      running: mlb ? emptyRunningCounters() : undefined,
      battedBalls: mlb ? emptyBattedBallCounters() : undefined,
      detailed: mlb,
    };
    this.records = league.teams.map((t) => emptyRecord(t.id));
    this.parkRuns = league.teams.map(() => ({ home: 0, homeG: 0, road: 0, roadG: 0 }));
  }

  absorb(r: GameResult, day: number): GameSummary {
    this.batting.merge(r.batting);
    this.pitching.merge(r.pitching);
    this.fielding.merge(r.fielding);
    for (const [id, line] of r.batting.lines) this.recentBat.push(id, batRow(day, line));
    for (const [id, line] of r.pitching.lines) this.recentPit.push(id, pitRow(day, line));

    const teams = this.league.teams;
    const [awayRuns, homeRuns] = r.score;
    const away = this.records[r.awayId]!;
    const home = this.records[r.homeId]!;
    const homeWon = homeRuns > awayRuns;
    const sameDiv = teams[r.awayId]!.league === teams[r.homeId]!.league && teams[r.awayId]!.division === teams[r.homeId]!.division;
    const apply = (rec: TeamRecord, won: boolean, rs: number, ra: number, isHome: boolean) => {
      rec.rs += rs;
      rec.ra += ra;
      if (won) {
        rec.w++;
        if (isHome) rec.homeW++;
        else rec.awayW++;
        if (sameDiv) rec.divW++;
        rec.streak = rec.streak > 0 ? rec.streak + 1 : 1;
      } else {
        rec.l++;
        if (isHome) rec.homeL++;
        else rec.awayL++;
        if (sameDiv) rec.divL++;
        rec.streak = rec.streak < 0 ? rec.streak - 1 : -1;
      }
      rec.last10.push(won);
      if (rec.last10.length > 10) rec.last10.shift();
    };
    apply(home, homeWon, homeRuns, awayRuns, true);
    apply(away, !homeWon, awayRuns, homeRuns, false);

    const total = homeRuns + awayRuns;
    this.parkRuns[r.homeId]!.home += total;
    this.parkRuns[r.homeId]!.homeG++;
    this.parkRuns[r.awayId]!.road += total;
    this.parkRuns[r.awayId]!.roadG++;

    const summary = summarize(day, r);
    this.games.push(summary);
    return summary;
  }

  /**
   * Park factors from home vs. road scoring, regressed halfway to neutral and
   * halved (a hitter plays only half his games at home), FanGraphs-style.
   */
  parkFactors(): Map<number, number> {
    const m = new Map<number, number>();
    this.parkRuns.forEach((p, id) => {
      if (p.homeG === 0 || p.roadG === 0) {
        m.set(id, 1);
        return;
      }
      const raw = p.home / p.homeG / (p.road / p.roadG);
      const regressed = 1 + (raw - 1) * 0.5;
      m.set(id, (1 + regressed) / 2);
    });
    return m;
  }

  context(): LeagueContext {
    return buildLeagueContext({
      batting: this.batting.total(),
      pitching: this.pitching.total(),
      games: this.games.length,
      runs: this.records.reduce((s, r) => s + r.rs, 0),
      linearWeights: this.tracker.linearWeights(),
      outValue: this.tracker.outValue(),
      parkFactors: this.parkFactors(),
    });
  }

  stats(): SeasonStats {
    const ctx = this.context();
    const players = this.league.players;
    const teams = this.league.teams;
    const pf = (id: number) => ctx.parkFactors.get(players[id]?.teamId ?? -1) ?? 1;
    const abbrev = (id: number) => teams[players[id]?.teamId ?? -1]?.abbrev ?? "FA";

    const hitters: HitterRow[] = [];
    for (const [id, line] of this.batting.lines) {
      if (line.PA === 0) continue;
      const p = players[id]!;
      const adv = hitterAdvanced(line, this.fielding.lines.get(id), pf(id), ctx);
      hitters.push({ ...adv, id, name: playerName(p), team: abbrev(id), pos: p.position, line });
    }
    finishHitterWar(hitters, ctx);

    const pitchers: PitcherRow[] = [];
    for (const [id, line] of this.pitching.lines) {
      if (line.outs === 0 && line.BF === 0) continue;
      const p = players[id]!;
      const adv = pitcherAdvanced(line, pf(id), ctx);
      pitchers.push({ ...adv, id, name: playerName(p), team: abbrev(id), role: p.role ?? "P", line });
    }
    finishPitcherWar(pitchers, ctx);
    return { level: this.level, context: ctx, hitters, pitchers };
  }

  winPct(r: TeamRecord): number {
    return r.w + r.l > 0 ? r.w / (r.w + r.l) : 0;
  }

  /** Sort comparator: win pct, then run differential, then a stable coin flip. */
  compare(a: TeamRecord, b: TeamRecord): number {
    return (
      this.winPct(b) - this.winPct(a) ||
      b.rs - b.ra - (a.rs - a.ra) ||
      ((a.teamId * 7919 + this.league.year) % 13) - ((b.teamId * 7919 + this.league.year) % 13)
    );
  }

  /** Division standings: [league][division] -> records, best first. */
  standings(): TeamRecord[][][] {
    const out: TeamRecord[][][] = this.league.structure.leagues.map(() =>
      this.league.structure.divisions.map(() => [] as TeamRecord[]),
    );
    for (const r of this.records) {
      const t = this.league.teams[r.teamId]!;
      out[t.league]![t.division]!.push(r);
    }
    for (const lg of out) for (const div of lg) div.sort((a, b) => this.compare(a, b));
    return out;
  }
}

export interface SeasonOptions {
  seed?: string;
  /** False when restoring a saved season (don't reset per-season player flags). */
  fresh?: boolean;
  /** Simulate the minor league affiliates too (default true). */
  minors?: boolean;
  /** Let AI front offices make roster moves (default true). */
  aiRosters?: boolean;
}

const OPENING_DAY = { month: 2, day: 26 }; // March 26

export class Season {
  schedule: Schedule;
  staff = new StaffTracker();
  /** Set once the playoffs have been played. */
  postseason: PostseasonResult | null = null;
  /** Called with every finished game (the UI keeps recent box scores). */
  onGame?: (level: Level, result: GameResult, day: number) => void;
  readonly levels: Record<Level, LevelSeason>;
  readonly simulateMinors: boolean;
  readonly aiRosters: boolean;
  /** Players currently hurt (healing daily). */
  readonly injured = new Set<number>();
  /** Service days accrued this season (capped at one year). */
  readonly seasonService = new Map<number, number>();
  rng: Rng;
  private perfCache: { day: number; lookup: PerformanceLookup } | null = null;
  private depthCache = new Map<string, { key: string; depth: DepthChart }>();
  day = 0;

  constructor(
    readonly league: League,
    opts: SeasonOptions | string = {},
  ) {
    const o = typeof opts === "string" ? { seed: opts } : opts;
    this.rng = new Rng(o.seed ?? `${league.seed}:${league.year}`);
    this.simulateMinors = o.minors ?? true;
    this.aiRosters = o.aiRosters ?? true;
    this.schedule = buildSchedule(league, this.rng.fork("schedule"));
    this.levels = {} as Record<Level, LevelSeason>;
    for (const level of LEVELS) this.levels[level] = new LevelSeason(level, league);
    if (o.fresh ?? true) {
      for (const p of league.players) {
        p.options.usedThisYear = false;
        if (p.injury) this.injured.add(p.id);
      }
    }
  }

  // --- MLB shortcuts (most of the game looks at the big leagues) -------------
  get mlb(): LevelSeason {
    return this.levels.MLB;
  }
  get env(): SimEnv {
    return this.mlb.env;
  }
  get tracker(): RunTracker {
    return this.mlb.tracker;
  }
  get batting(): LineBook<BattingLine> {
    return this.mlb.batting;
  }
  get pitching(): LineBook<PitchingLine> {
    return this.mlb.pitching;
  }
  get fielding(): LineBook<FieldingLine> {
    return this.mlb.fielding;
  }
  get records(): TeamRecord[] {
    return this.mlb.records;
  }
  get games(): GameSummary[] {
    return this.mlb.games;
  }
  stats(level: Level = "MLB"): SeasonStats {
    return this.levels[level].stats();
  }
  context(level: Level = "MLB"): LeagueContext {
    return this.levels[level].context();
  }
  parkFactors(): Map<number, number> {
    return this.mlb.parkFactors();
  }
  standings(level: Level = "MLB"): TeamRecord[][][] {
    return this.levels[level].standings();
  }
  winPct(r: TeamRecord): number {
    return this.mlb.winPct(r);
  }
  compare(a: TeamRecord, b: TeamRecord): number {
    return this.mlb.compare(a, b);
  }
  /**
   * The first day of a club's last `games` scheduled games before today (every
   * level plays the same schedule). Recent-form views count from here.
   */
  recentCutoff(teamId: number, games = RECENT_GAMES): number {
    let found = 0;
    for (let d = Math.min(this.day, this.schedule.days.length) - 1; d >= 0; d--) {
      if (this.schedule.days[d]!.some((g) => g.home === teamId || g.away === teamId)) {
        found++;
        if (found === games) return d;
      }
    }
    return 0;
  }

  gamesBehind(leader: TeamRecord, r: TeamRecord): number {
    return (leader.w - r.w + (r.l - leader.l)) / 2;
  }

  get totalDays(): number {
    return this.schedule.days.length;
  }

  get done(): boolean {
    return this.day >= this.schedule.days.length;
  }

  team(id: number): Team {
    return this.league.teams[id]!;
  }

  player(id: number): Player {
    return this.league.players[id]!;
  }

  /** Calendar date of a season day. */
  dateOf(day: number): Date {
    return new Date(Date.UTC(this.league.year, OPENING_DAY.month, OPENING_DAY.day + day));
  }

  /** September 1 and later: expanded rosters. */
  expanded(day = this.day): boolean {
    return this.dateOf(day).getUTCMonth() >= 8;
  }

  rosterContext(day = this.day): RosterContext {
    return { league: this.league, day, expanded: this.expanded(day) };
  }

  isOut = (id: number): boolean => {
    const inj = this.league.players[id]!.injury;
    return inj !== null && inj.daysLeft > 0;
  };

  /** Lineup, starter, bench and bullpen state for one club at one level today. */
  gameSetup(team: Team, rng: Rng, day = this.day, level: Level = "MLB"): TeamGameSetup {
    const league = this.league;
    const depth = level === "MLB" ? team.depth : this.minorDepth(team, level);
    const lineup = buildLineup(league, depth, rng, { unavailable: this.isOut });
    const inLineup = new Set(lineup.map((s) => s.id));
    const position = [...Object.values(depth.starters), depth.dh, ...depth.bench];
    const bench = position.filter((id) => id >= 0 && !inLineup.has(id) && !this.isOut(id));
    const starter = this.staff.nextStarter(`${team.id}:${level}`, depth.rotation, day, (id) => !this.isOut(id));
    // Relievers first; the other starters are emergency arms only.
    const relievers = depth.bullpen.filter((id) => !this.isOut(id));
    const bullpen = [...relievers, ...depth.rotation.filter((id) => id !== starter && !this.isOut(id))];
    const unavailable = new Set(bullpen.filter((id) => !relievers.includes(id) || !this.staff.isRested(id, day)));
    return {
      team,
      lineup,
      bench,
      starter,
      bullpen,
      unavailable,
      fatigue: this.staff.fatigueMap(bullpen, day),
      park: level === "MLB" ? team.park : team.affiliates[level].park,
    };
  }

  /** A minor league affiliate's depth chart, rebuilt only when its healthy roster changes. */
  private minorDepth(team: Team, level: Level): DepthChart {
    const healthy = team.rosters[level].filter((id) => !this.isOut(id));
    const key = healthy.join(",");
    const cacheKey = `${team.id}:${level}`;
    const hit = this.depthCache.get(cacheKey);
    if (hit && hit.key === key) return hit.depth;
    const depth = autoDepthChart(healthy.map((id) => this.league.players[id]!));
    this.depthCache.set(cacheKey, { key, depth });
    return depth;
  }

  /**
   * What each player has actually done this season, in runs per 600 PA (or
   * BF) on the major-league scale, for the AI's roster decisions.
   */
  private shiftCache: { key: string; shifts: Map<Level, { bat: number; arm: number }> } | null = null;

  /**
   * A level's average talent on the major-league scale (runs per 600 PA or
   * BF): what a league-average line there translates to in the majors.
   */
  levelShift(level: Level): { bat: number; arm: number } {
    // Rosters change with every logged move (the day stands still all winter).
    const key = `${this.day}:${this.league.transactions.length}`;
    if (!this.shiftCache || this.shiftCache.key !== key) {
      const shifts = new Map<Level, { bat: number; arm: number }>();
      for (const lv of LEVELS) {
        const roster = this.league.teams.flatMap((t) => t.rosters[lv]).map((id) => this.league.players[id]!);
        const hitters = roster.filter((x) => !x.pitching);
        const arms = roster.filter((x) => x.pitching);
        shifts.set(lv, {
          bat: hitters.reduce((s, x) => s + offenseValue(x), 0) / Math.max(1, hitters.length),
          arm: arms.reduce((s, x) => s + pitchingValue(x), 0) / Math.max(1, arms.length),
        });
      }
      this.shiftCache = { key, shifts };
    }
    return this.shiftCache.shifts.get(level)!;
  }

  performance(): PerformanceLookup {
    // Recomputed daily from live totals (cheap), so saved games resume identically.
    if (this.perfCache && this.perfCache.day === this.day) return this.perfCache.lookup;
    const levelInfo = new Map<Level, { lgWoba: number; lgRa9: number; batShift: number; armShift: number }>();
    for (const level of LEVELS) {
      const ls = this.levels[level];
      const b = ls.batting.total();
      const p = ls.pitching.total();
      const lgWoba = b.PA > 0 ? fixedWoba(b) : 0.315;
      const lgRa9 = p.outs > 0 ? (27 * p.R) / p.outs : 4.4;
      const shift = this.levelShift(level);
      levelInfo.set(level, { lgWoba, lgRa9, batShift: shift.bat, armShift: shift.arm });
    }
    const lookup: PerformanceLookup = (player) => {
      const info = levelInfo.get(player.level)!;
      const ls = this.levels[player.level];
      if (player.pitching) {
        const line = ls.pitching.lines.get(player.id);
        if (!line || line.BF < 20) return null;
        const ra9 = (27 * line.R) / Math.max(1, line.outs);
        // Runs saved per 600 batters faced (about 142 innings) vs. the level, on the MLB scale.
        return { runs: ((info.lgRa9 - ra9) * 142) / 9 + info.armShift, sample: line.BF };
      }
      const line = ls.batting.lines.get(player.id);
      if (!line || line.PA < 20) return null;
      return { runs: ((fixedWoba(line) - info.lgWoba) / 1.2) * 600 + info.batShift, sample: line.PA };
    };
    this.perfCache = { day: this.day, lookup };
    return lookup;
  }

  /** Waiver priority: worst MLB record first. */
  private waiverOrder(): Team[] {
    return [...this.records].sort((a, b) => this.compare(b, a)).map((r) => this.team(r.teamId));
  }

  private heal(): void {
    for (const id of [...this.injured]) {
      const inj = this.league.players[id]!.injury;
      if (!inj) {
        this.injured.delete(id);
        continue;
      }
      if (inj.startDay >= this.day) continue;
      inj.daysLeft = Math.max(0, inj.daysLeft - 1);
      if (inj.daysLeft === 0) {
        this.league.players[id]!.injury = null;
        this.injured.delete(id);
      }
    }
  }

  private manageRosters(): void {
    if (!this.aiRosters) return;
    const ctx = this.rosterContext();
    const opts = {
      performance: this.performance(),
      weekly: this.day > 0 && this.day % 7 === 0,
      farmCheck: this.day > 0 && this.day % 14 === 0,
      waiverOrder: this.waiverOrder(),
      rng: this.rng.fork(`ai${this.day}`),
    };
    for (const team of this.league.teams) {
      if (this.league.userTeamId === team.id && team.manualRoster) continue;
      manageOrganization(ctx, team, opts);
    }
  }

  private applyInjuries(r: GameResult, level: Level): void {
    for (const { playerId, injury } of r.injuries) {
      const p = this.league.players[playerId]!;
      if (p.injury) continue;
      p.injury = injury;
      this.injured.add(p.id);
      if (level === "MLB" && p.teamId !== null) {
        const days = `${injury.days} day${injury.days === 1 ? "" : "s"}`;
        logTransaction(
          this.league,
          this.day,
          this.team(p.teamId),
          p,
          "injury",
          `${positionLabel(p)} ${playerName(p)} left the game with ${injuryPhrase(injury.name)} (out about ${days})`,
        );
      }
    }
  }

  private accrueService(): void {
    for (const team of this.league.teams) {
      for (const id of [...team.rosters.MLB, ...team.injured]) {
        const used = this.seasonService.get(id) ?? 0;
        if (used >= SERVICE_DAYS_PER_YEAR) continue;
        this.seasonService.set(id, used + 1);
        this.league.players[id]!.service++;
      }
    }
  }

  /** Simulate one day at every level. Returns the day's MLB games. */
  simDay(): GameSummary[] {
    if (this.done) return [];
    const day = this.day;
    this.heal();
    this.manageRosters();

    const out: GameSummary[] = [];
    const levels: Level[] = this.simulateMinors ? [...LEVELS] : ["MLB"];
    for (const level of levels) {
      const ls = this.levels[level];
      for (const g of this.schedule.days[day]!) {
        const rng = this.rng.fork(`g${day}:${level}:${g.home}`);
        const away = this.team(g.away);
        const home = this.team(g.home);
        const result = simulateGame(ls.env, this.gameSetup(away, rng, day, level), this.gameSetup(home, rng, day, level), rng, day);
        this.staff.record(result.pitchCounts, day);
        this.applyInjuries(result, level);
        const summary = ls.absorb(result, day);
        this.onGame?.(level, result, day);
        if (level === "MLB") out.push(summary);
      }
    }
    this.accrueService();
    this.day++;
    return out;
  }

  simDays(n: number): void {
    for (let i = 0; i < n && !this.done; i++) this.simDay();
  }

  simToEnd(onDay?: (day: number, total: number) => void): void {
    while (!this.done) {
      this.simDay();
      onDay?.(this.day, this.totalDays);
    }
  }
}

/** wOBA with fixed (typical MLB) weights, for quick performance reads. */
function fixedWoba(b: BattingLine): number {
  const denom = b.AB + b.BB - b.IBB + b.SF + b.HBP;
  if (denom <= 0) return 0;
  return (0.69 * (b.BB - b.IBB) + 0.72 * b.HBP + 0.88 * b["1B"] + 1.25 * b["2B"] + 1.6 * b["3B"] + 2.05 * b.HR) / denom;
}
