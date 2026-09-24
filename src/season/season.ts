import { Rng } from "../core/rng";
import { NEUTRAL_PARK } from "../league/parks";
import type { League, Team } from "../league/types";
import type { Player } from "../players/types";
import { playerName } from "../players/types";
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
  emptyBatting,
  emptyFielding,
  emptyPitching,
  LineBook,
  type BattingLine,
  type FieldingLine,
  type PitchingLine,
} from "../stats/lines";
import { RunTracker } from "../stats/runExpectancy";
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

export class Season {
  readonly schedule: Schedule;
  readonly env: SimEnv;
  readonly staff = new StaffTracker();
  readonly tracker = new RunTracker();
  readonly batting = new LineBook<BattingLine>(emptyBatting);
  readonly pitching = new LineBook<PitchingLine>(emptyPitching);
  readonly fielding = new LineBook<FieldingLine>(emptyFielding);
  readonly records: TeamRecord[];
  readonly games: GameSummary[] = [];
  readonly teamOf = new Map<number, number>();
  private readonly parkRuns: { home: number; homeG: number; road: number; roadG: number }[];
  private readonly rng: Rng;
  day = 0;

  constructor(
    readonly league: League,
    seed = `${league.seed}:${league.year}`,
  ) {
    this.rng = new Rng(seed);
    this.schedule = buildSchedule(league, this.rng.fork("schedule"));
    this.env = {
      league,
      avgDefense: averageDefense(league),
      neutralPark: NEUTRAL_PARK,
      tracker: this.tracker,
      running: emptyRunningCounters(),
      battedBalls: emptyBattedBallCounters(),
    };
    this.records = league.teams.map((t) => ({
      teamId: t.id,
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
    }));
    this.parkRuns = league.teams.map(() => ({ home: 0, homeG: 0, road: 0, roadG: 0 }));
    for (const t of league.teams) for (const id of [...t.active, ...t.reserves]) this.teamOf.set(id, t.id);
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

  /** Lineup, starter and bullpen state for one club today. */
  gameSetup(team: Team, rng: Rng, day = this.day): TeamGameSetup {
    return {
      team,
      lineup: buildLineup(this.league, team, rng),
      starter: this.staff.nextStarter(team, day),
      bullpen: team.depth.bullpen,
      unavailable: this.staff.unavailableRelievers(team, day),
      fatigue: this.staff.fatigueMap(team, day),
    };
  }

  simDay(): GameSummary[] {
    if (this.done) return [];
    const day = this.day;
    const out: GameSummary[] = [];
    for (const g of this.schedule.days[day]!) {
      const rng = this.rng.fork(`g${day}:${g.home}`);
      const away = this.team(g.away);
      const home = this.team(g.home);
      const result = simulateGame(this.env, this.gameSetup(away, rng, day), this.gameSetup(home, rng, day), rng);
      this.absorb(result, day);
      const summary = summarize(day, result);
      this.games.push(summary);
      out.push(summary);
    }
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

  private absorb(r: GameResult, day: number): void {
    this.staff.record(r.pitchCounts, day);
    this.batting.merge(r.batting);
    this.pitching.merge(r.pitching);
    this.fielding.merge(r.fielding);

    const [awayRuns, homeRuns] = r.score;
    const away = this.records[r.awayId]!;
    const home = this.records[r.homeId]!;
    const homeWon = homeRuns > awayRuns;
    const sameDiv =
      this.team(r.awayId).league === this.team(r.homeId).league &&
      this.team(r.awayId).division === this.team(r.homeId).division;
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
    const lw = this.tracker.linearWeights();
    const counts = this.batting.total();
    const outValue = this.tracker.outValue();
    const runs = this.records.reduce((s, r) => s + r.rs, 0);
    return buildLeagueContext({
      batting: counts,
      pitching: this.pitching.total(),
      games: this.games.length,
      runs,
      linearWeights: lw,
      outValue,
      parkFactors: this.parkFactors(),
    });
  }

  stats(): SeasonStats {
    const ctx = this.context();
    const pf = (id: number) => ctx.parkFactors.get(this.teamOf.get(id) ?? -1) ?? 1;
    const teamAbbrev = (id: number) => this.league.teams[this.teamOf.get(id) ?? -1]?.abbrev ?? "FA";

    const hitters: HitterRow[] = [];
    for (const [id, line] of this.batting.lines) {
      if (line.PA === 0) continue;
      const p = this.player(id);
      const adv = hitterAdvanced(line, this.fielding.lines.get(id), pf(id), ctx);
      hitters.push({ ...adv, id, name: playerName(p), team: teamAbbrev(id), pos: p.position, line });
    }
    finishHitterWar(hitters, ctx);

    const pitchers: PitcherRow[] = [];
    for (const [id, line] of this.pitching.lines) {
      if (line.outs === 0 && line.BF === 0) continue;
      const p = this.player(id);
      const adv = pitcherAdvanced(line, pf(id), ctx);
      pitchers.push({ ...adv, id, name: playerName(p), team: teamAbbrev(id), role: p.role ?? "P", line });
    }
    finishPitcherWar(pitchers, ctx);
    return { context: ctx, hitters, pitchers };
  }

  // -------------------------------------------------------------------------
  // Standings

  winPct(r: TeamRecord): number {
    return r.w + r.l > 0 ? r.w / (r.w + r.l) : 0;
  }

  /** Division standings: [league][division] -> records, best first. */
  standings(): TeamRecord[][][] {
    const out: TeamRecord[][][] = this.league.structure.leagues.map(() =>
      this.league.structure.divisions.map(() => [] as TeamRecord[]),
    );
    for (const r of this.records) {
      const t = this.team(r.teamId);
      out[t.league]![t.division]!.push(r);
    }
    for (const lg of out) for (const div of lg) div.sort((a, b) => this.compare(a, b));
    return out;
  }

  /** Sort comparator: win pct, then run differential, then a stable coin flip. */
  compare(a: TeamRecord, b: TeamRecord): number {
    return (
      this.winPct(b) - this.winPct(a) ||
      b.rs - b.ra - (a.rs - a.ra) ||
      ((a.teamId * 7919 + this.league.year) % 13) - ((b.teamId * 7919 + this.league.year) % 13)
    );
  }

  gamesBehind(leader: TeamRecord, r: TeamRecord): number {
    return (leader.w - r.w + (r.l - leader.l)) / 2;
  }
}
