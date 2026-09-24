import { Rng, type RngState } from "../core/rng";
import type { League } from "../league/types";
import { LEVELS, type Level } from "../players/types";
import type { PostseasonResult } from "../season/postseason";
import type { Schedule } from "../season/schedule";
import { Season, type GameSummary, type TeamRecord } from "../season/season";
import { StaffTracker, type StaffState } from "../season/staff";
import type { Defense } from "../sim/battedBall";
import type { BattedBallCounters, RunningCounters } from "../sim/game";
import { emptyBatting, emptyFielding, emptyPitching, type LineBook } from "../stats/lines";
import { RunTracker, type RunTrackerState } from "../stats/runExpectancy";
import { backfillBooks } from "../finance/finance";
import { migrateLeague } from "./migrate";

/**
 * Save games: the league (plain JSON already) plus everything a season needs
 * to resume exactly where it left off. Stat books are packed as rows of
 * numbers to keep saves small.
 */

export const SAVE_FORMAT = "twenty-eighty-save";
export const SAVE_VERSION = 5;

interface PackedBook {
  keys: string[];
  rows: number[][];
}

interface LevelState {
  tracker: RunTrackerState;
  batting: PackedBook;
  pitching: PackedBook;
  fielding: PackedBook;
  records: TeamRecord[];
  games: GameSummary[];
  parkRuns: { home: number; homeG: number; road: number; roadG: number }[];
  avgDefense: Defense;
  running?: RunningCounters;
  battedBalls?: BattedBallCounters;
  /** Recent game lines (absent in saves made before recent form existed). */
  recent?: { bat: [number, number[][]][]; pit: [number, number[][]][] };
}

export interface SeasonState {
  minors: boolean;
  aiRosters: boolean;
  rng: RngState;
  day: number;
  schedule: Schedule;
  staff: StaffState;
  injured: number[];
  seasonService: [number, number][];
  postseason: PostseasonResult | null;
  levels: Record<Level, LevelState>;
}

export interface SaveGame {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
  league: League;
  season: SeasonState | null;
}


function pack<T extends object>(book: LineBook<T>, empty: () => T): PackedBook {
  const keys = Object.keys(empty());
  const rows: number[][] = [];
  for (const [id, line] of book.lines) {
    const rec = line as unknown as Record<string, number>;
    // Full precision: expected-stat sums feed analytics, and resumes must be exact.
    rows.push([id, ...keys.map((k) => rec[k] ?? 0)]);
  }
  return { keys, rows };
}

function unpack<T extends object>(packed: PackedBook, book: LineBook<T>): void {
  const entries: [number, T][] = packed.rows.map((row) => {
    const line: Record<string, number> = {};
    packed.keys.forEach((k, i) => (line[k] = row[i + 1]!));
    return [row[0]!, line as unknown as T];
  });
  book.load(entries);
}

/** Fifteen club games (off days and the All-Star break included) fit well inside this many days; older rows can't be shown again. */
const RECENT_HORIZON_DAYS = 30;

function recentWindow(entries: [number, number[][]][], day: number): [number, number[][]][] {
  const out: [number, number[][]][] = [];
  for (const [id, rows] of entries) {
    const kept = rows.filter((r) => r[0]! >= day - RECENT_HORIZON_DAYS);
    if (kept.length) out.push([id, kept]);
  }
  return out;
}

export function saveGame(league: League, season: Season | null): SaveGame {
  let state: SeasonState | null = null;
  if (season) {
    const levels = {} as Record<Level, LevelState>;
    for (const level of LEVELS) {
      const ls = season.levels[level];
      levels[level] = {
        tracker: ls.tracker.toJSON(),
        batting: pack(ls.batting, emptyBatting),
        pitching: pack(ls.pitching, emptyPitching),
        fielding: pack(ls.fielding, emptyFielding),
        records: ls.records,
        // Minor league box-score summaries aren't needed once standings and stats are updated.
        games: level === "MLB" ? ls.games : [],
        parkRuns: ls.parkRuns,
        avgDefense: ls.env.avgDefense,
        running: ls.env.running,
        battedBalls: ls.env.battedBalls,
        recent: { bat: recentWindow(ls.recentBat.toJSON(), season.day), pit: recentWindow(ls.recentPit.toJSON(), season.day) },
      };
    }
    state = {
      minors: season.simulateMinors,
      aiRosters: season.aiRosters,
      rng: season.rng.getState(),
      day: season.day,
      schedule: season.schedule,
      staff: season.staff.toJSON(),
      injured: [...season.injured],
      seasonService: [...season.seasonService],
      postseason: season.postseason,
      levels,
    };
  }
  return { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: new Date().toISOString(), league, season: state };
}

export function loadGame(save: SaveGame): { league: League; season: Season | null } {
  if (save.format !== SAVE_FORMAT) throw new Error("Not a twenty-eighty save file.");
  if (save.version > SAVE_VERSION) throw new Error(`Save version ${save.version} is newer than this game understands.`);
  const league = save.league;
  migrateLeague(league, save.version);
  const s = save.season;
  if (!s) return { league, season: null };

  const season = new Season(league, { minors: s.minors, aiRosters: s.aiRosters, fresh: false });
  season.schedule = s.schedule;
  season.rng = new Rng(s.rng);
  season.day = s.day;
  season.staff = StaffTracker.fromJSON(s.staff);
  for (const id of s.injured) season.injured.add(id);
  for (const [id, days] of s.seasonService) season.seasonService.set(id, days);
  season.postseason = s.postseason;
  for (const level of LEVELS) {
    const ls = season.levels[level];
    const st = s.levels[level];
    ls.tracker = RunTracker.fromJSON(st.tracker);
    ls.env = {
      ...ls.env,
      tracker: ls.tracker,
      avgDefense: st.avgDefense,
      running: st.running,
      battedBalls: st.battedBalls,
    };
    unpack(st.batting, ls.batting);
    unpack(st.pitching, ls.pitching);
    unpack(st.fielding, ls.fielding);
    ls.records = st.records;
    ls.games = st.games;
    ls.parkRuns = st.parkRuns;
    if (st.recent) {
      ls.recentBat.load(st.recent.bat);
      ls.recentPit.load(st.recent.pit);
    }
  }
  if (save.version < 4) backfillBooks(season);
  return { league, season };
}

/** Round-trip through JSON text (what gets written to disk or IndexedDB). */
export function serialize(save: SaveGame): string {
  return JSON.stringify(save);
}

export function deserialize(text: string): SaveGame {
  return JSON.parse(text) as SaveGame;
}
