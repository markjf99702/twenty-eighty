import type { League } from "../league/types";
import { playerName, type Player } from "../players/types";
import type { GameResult } from "../sim/game";
import { type CareerTotals, careerTotals } from "../stats/career";
import type { BattingLine, PitchingLine } from "../stats/lines";
import { type CareerStat, careerRecords, careerTable, formatRecord, liveSeason, type SeasonStat, seasonRecords, STATS } from "../stats/records";
import type { Season } from "./season";

/**
 * The season's moments, noticed game by game: no-hitters and perfect games,
 * cycles, four-homer games, huge strikeout games, long hitting streaks,
 * career and season milestones, and records tied and broken. They go on
 * `league.moments` for the front office, the record book and the stop rules.
 */

export type MomentKind = "no-hitter" | "perfect-game" | "cycle" | "four-homers" | "strikeouts" | "streak" | "milestone" | "record";

export interface Moment {
  year: number;
  day: number;
  kind: MomentKind;
  playerId: number;
  teamId: number | null;
  text: string;
  /** A streak's length, a milestone's number, a record's new mark. */
  value?: number;
  /** A hitting streak that's over. */
  ended?: boolean;
  /** The game's box score key (`day-home`), if one day it's kept. */
  box?: string;
}

/** Hitting streaks worth a mention, and how often after that. */
export const STREAK_NOTICE = 25;
const STREAK_STEP = 5;
/** A pitcher's strikeouts worth a mention. */
export const BIG_STRIKEOUTS = 17;

const CAREER_MARKS: Partial<Record<CareerStat, number[]>> = {
  HR: [300, 400, 500, 600, 700, 800],
  H: [2000, 2500, 3000, 3500, 4000],
  RBI: [1500, 2000],
  SB: [500, 750, 1000],
  W: [200, 250, 300],
  SO: [2500, 3000, 3500, 4000, 4500, 5000],
  SV: [300, 400, 500, 600],
};
const SEASON_MARKS: Partial<Record<SeasonStat, number[]>> = { HR: [50, 60], SB: [100], W: [20], SO: [300], SV: [50] };
const COUNTING: CareerStat[] = ["HR", "RBI", "H", "SB", "W", "SO", "SV"];
const NOUN: Record<string, [string, string]> = {
  HR: ["home run", "home runs"],
  RBI: ["run batted in", "runs batted in"],
  H: ["hit", "hits"],
  SB: ["stolen base", "stolen bases"],
  W: ["win", "wins"],
  SO: ["strikeout", "strikeouts"],
  SV: ["save", "saves"],
  streak: ["game", "games"],
};

export const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n.toLocaleString("en-US")}${s}`;
};

/** A record's holder, for as long as this session has been watching. */
export interface Mark {
  value: number;
  name: string;
  year: number | null;
  playerId: number | null;
}

export interface Watch {
  base: Map<number, CareerTotals>;
  season: Map<SeasonStat, Mark | null>;
  career: Map<CareerStat, Mark | null>;
}

// Per season: career totals before it started, and the records as they stand. Rebuilt after a reload.
const watching = new WeakMap<Season, Watch>();

/** Start watching for records before the day's games (so the marks don't already include them). */
export function watch(season: Season): Watch {
  let w = watching.get(season);
  if (!w) {
    const league = season.league;
    const live = liveSeason(season);
    const top = (rows: ReturnType<typeof seasonRecords>): Mark | null => {
      const r = rows[0];
      return r ? { value: r.value, name: r.name, year: r.year, playerId: r.playerId } : null;
    };
    w = { base: new Map(), season: new Map(), career: new Map() };
    for (const s of [...COUNTING, "streak"] as SeasonStat[]) w.season.set(s, top(seasonRecords(league, s, { live, limit: 1 })));
    const table = careerTable(league, live);
    for (const s of COUNTING) w.career.set(s, top(careerRecords(league, s, { live, limit: 1, table })));
    watching.set(season, w);
  }
  return w;
}

function baseOf(w: Watch, p: Player): CareerTotals {
  let t = w.base.get(p.id);
  if (!t) {
    t = careerTotals(p);
    w.base.set(p.id, t);
  }
  return t;
}

const batValue = (stat: CareerStat, b: BattingLine | undefined) => (!b ? 0 : stat === "HR" ? b.HR : stat === "RBI" ? b.RBI : stat === "H" ? b.H : stat === "SB" ? b.SB : 0);
const pitValue = (stat: CareerStat, q: PitchingLine | undefined) => (!q ? 0 : stat === "W" ? q.W : stat === "SO" ? q.SO : stat === "SV" ? q.SV : 0);
const careerValue = (stat: CareerStat, t: CareerTotals) =>
  STATS[stat].pitching ? (t.pit ? (t.pit as unknown as Record<string, number>)[stat]! : 0) : t.bat ? (t.bat as unknown as Record<string, number>)[stat]! : 0;

function tag(league: League, p: Player): string {
  const t = p.teamId !== null ? league.teams[p.teamId] : undefined;
  return `${playerName(p)}${t ? ` (${t.abbrev})` : ""}`;
}

/** Look over a finished game for moments. `context` places a postseason game ("in Game 3 of the World Series"). */
export function noteMoments(season: Season, result: GameResult, day: number, context?: string): void {
  const league = season.league;
  const year = league.year;
  const box = `${day}-${result.homeId}`;
  const ids: [number, number] = [result.awayId, result.homeId];
  /** The other club's nickname, facing side `s` (0 away, 1 home). */
  const opponent = (s: number) => league.teams[s === 0 ? result.homeId : result.awayId]!.nickname;
  const where = context ? ` ${context}` : "";
  const push = (m: Omit<Moment, "year" | "day" | "box">) => league.moments.push({ year, day, box, ...m });
  const P = (id: number) => league.players[id]!;

  // No-hitters and perfect games: nine innings or more without a hit.
  for (const s of [0, 1] as const) {
    if (result.hits[1 - s] !== 0) continue;
    const used = result.pitchersUsed[s];
    let outs = 0;
    let bf = 0;
    let so = 0;
    for (const id of used) {
      const q = result.pitching.lines.get(id);
      outs += q?.outs ?? 0;
      bf += q?.BF ?? 0;
      so += q?.SO ?? 0;
    }
    if (outs < 27) continue;
    const perfect = bf === outs;
    const what = perfect ? "a perfect game" : "a no-hitter";
    const opp = opponent(s);
    if (used.length === 1) {
      push({ kind: perfect ? "perfect-game" : "no-hitter", playerId: used[0]!, teamId: ids[s], text: `${tag(league, P(used[0]!))} threw ${what} against the ${opp}${where}, striking out ${so}.` });
    } else {
      const names = used.map((id) => playerName(P(id)));
      const list = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
      push({ kind: perfect ? "perfect-game" : "no-hitter", playerId: used[0]!, teamId: ids[s], text: `${list} of the ${league.teams[ids[s]]!.nickname} combined on ${what} against the ${opp}${where}.` });
    }
  }

  // Big nights at the plate and on the mound.
  const sideOf = (id: number) => (result.battingOrder[0].some((slot) => slot.some((e) => e.id === id)) ? 0 : 1);
  for (const [id, b] of result.batting.lines) {
    const p = P(id);
    const opp = opponent(sideOf(id));
    if (b["1B"] > 0 && b["2B"] > 0 && b["3B"] > 0 && b.HR > 0) push({ kind: "cycle", playerId: id, teamId: p.teamId, text: `${tag(league, p)} hit for the cycle against the ${opp}${where}.` });
    if (b.HR >= 4) push({ kind: "four-homers", playerId: id, teamId: p.teamId, text: `${tag(league, p)} hit ${b.HR === 4 ? "four" : b.HR} home runs against the ${opp}${where}.` });
  }
  for (const [id, q] of result.pitching.lines) {
    if (q.SO < BIG_STRIKEOUTS) continue;
    const p = P(id);
    const s = result.pitchersUsed[0].includes(id) ? 0 : 1;
    push({ kind: "strikeouts", playerId: id, teamId: p.teamId, value: q.SO, text: `${tag(league, p)} struck out ${q.SO} ${opponent(s)}${where}.` });
  }
  if (context) return; // Streaks, milestones and records are the regular season's.

  const w = watch(season);
  // Hitting streaks: a hit extends one, an at-bat without one ends it (a game of walks leaves it be).
  for (const [id, b] of result.batting.lines) {
    const p = P(id);
    const n = season.streaks.get(id) ?? 0;
    if (b.H > 0) {
      const next = n + 1;
      season.streaks.set(id, next);
      const mark = w.season.get("streak");
      if (mark && next > mark.value && n <= mark.value && mark.playerId !== id) {
        push({ kind: "record", playerId: id, teamId: p.teamId, value: next, text: `${tag(league, p)} has hit in ${next} straight games, breaking ${mark.name}'s record of ${mark.value}${mark.year ? ` (${mark.year})` : ""}.` });
        w.season.set("streak", { value: next, name: playerName(p), year, playerId: id });
      } else if (mark && next === mark.value && mark.playerId !== id) {
        push({ kind: "streak", playerId: id, teamId: p.teamId, value: next, text: `${tag(league, p)} has hit in ${next} straight games, tying ${mark.name}'s record${mark.year ? ` (${mark.year})` : ""}.` });
      } else if (next >= STREAK_NOTICE && (next - STREAK_NOTICE) % STREAK_STEP === 0) {
        push({ kind: "streak", playerId: id, teamId: p.teamId, value: next, text: `${tag(league, p)} has hit in ${next} straight games.` });
      }
      if (mark && mark.playerId === id) mark.value = Math.max(mark.value, next);
    } else if (b.AB > 0) {
      season.streaks.delete(id);
      if (n >= STREAK_NOTICE) push({ kind: "streak", playerId: id, teamId: p.teamId, value: n, ended: true, text: `${playerName(p)}'s hitting streak ended at ${n} games${p.teamId !== null ? ` (${league.teams[p.teamId]!.abbrev})` : ""}.` });
    }
  }

  // Milestones and records: this season's totals (the game included) against what came before.
  const check = (p: Player, stat: CareerStat, game: number, seasonTotal: number) => {
    if (game <= 0) return;
    const [one, many] = NOUN[stat]!;
    const seasonBefore = seasonTotal - game;
    for (const m of SEASON_MARKS[stat] ?? []) {
      if (seasonBefore < m && seasonTotal >= m) push({ kind: "milestone", playerId: p.id, teamId: p.teamId, value: m, text: `${tag(league, p)} reached ${m} ${many} for the season.` });
    }
    const sMark = w.season.get(stat);
    if (sMark && sMark.playerId !== p.id && seasonTotal > sMark.value && seasonBefore <= sMark.value) {
      push({ kind: "record", playerId: p.id, teamId: p.teamId, value: seasonTotal, text: `${tag(league, p)} has ${seasonTotal} ${many}, breaking ${sMark.name}'s single-season record of ${formatRecord(stat, sMark.value)}${sMark.year ? ` (${sMark.year})` : ""}.` });
      w.season.set(stat, { value: seasonTotal, name: playerName(p), year, playerId: p.id });
    } else if (sMark && sMark.playerId !== p.id && seasonTotal === sMark.value && seasonBefore < sMark.value) {
      push({ kind: "record", playerId: p.id, teamId: p.teamId, value: seasonTotal, text: `${tag(league, p)} tied ${sMark.name}'s single-season record of ${formatRecord(stat, sMark.value)} ${many}${sMark.year ? ` (${sMark.year})` : ""}.` });
    } else if (sMark && sMark.playerId === p.id) sMark.value = Math.max(sMark.value, seasonTotal);

    const after = careerValue(stat, baseOf(w, p)) + seasonTotal;
    const before = after - game;
    for (const m of CAREER_MARKS[stat] ?? []) {
      if (before < m && after >= m) push({ kind: "milestone", playerId: p.id, teamId: p.teamId, value: m, text: `${tag(league, p)} recorded his ${ordinal(m)} career ${one}.` });
    }
    const cMark = w.career.get(stat);
    if (cMark && cMark.playerId !== p.id && after > cMark.value && before <= cMark.value) {
      push({ kind: "record", playerId: p.id, teamId: p.teamId, value: after, text: `${tag(league, p)} passed ${cMark.name} for the most career ${many}: ${after.toLocaleString("en-US")}.` });
      w.career.set(stat, { value: after, name: playerName(p), year: null, playerId: p.id });
    } else if (cMark && cMark.playerId === p.id) cMark.value = Math.max(cMark.value, after);
  };
  for (const [id, b] of result.batting.lines) {
    const p = P(id);
    if (p.pitching) continue;
    const line = season.batting.lines.get(id);
    for (const stat of ["HR", "RBI", "H", "SB"] as const) check(p, stat, batValue(stat, b), batValue(stat, line));
  }
  for (const [id, q] of result.pitching.lines) {
    const p = P(id);
    const line = season.pitching.lines.get(id);
    for (const stat of ["W", "SO", "SV"] as const) check(p, stat, pitValue(stat, q), pitValue(stat, line));
  }
}

/** The regular season is over: streaks still going end with it. */
export function closeStreaks(season: Season): void {
  const league = season.league;
  for (const [id, n] of season.streaks) {
    if (n < STREAK_NOTICE) continue;
    const p = league.players[id]!;
    league.moments.push({ year: league.year, day: season.day, kind: "streak", playerId: id, teamId: p.teamId, value: n, ended: true, text: `${tag(league, p)} finished the season on a ${n}-game hitting streak.` });
  }
  season.streaks.clear();
}
