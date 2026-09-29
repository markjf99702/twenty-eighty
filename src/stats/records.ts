import type { League } from "../league/types";
import { playerName, type Player } from "../players/types";
import type { HitterRow, PitcherRow, Season } from "../season/season";
import { careerTotals, type CareerTotals, type LiveLines } from "./career";

/**
 * The record book: the best seasons and careers in the league's history, the
 * legends' and the simulated seasons' alike, league-wide or for one club.
 */

export type SeasonStat = "HR" | "RBI" | "H" | "SB" | "AVG" | "bWAR" | "streak" | "W" | "SO" | "SV" | "ERA" | "pWAR";
export type CareerStat = Exclude<SeasonStat, "streak">;

export interface StatDef {
  label: string;
  /** Lower is better (ERA). */
  low?: boolean;
  places: number;
  pitching: boolean;
}

export const STATS: Record<SeasonStat, StatDef> = {
  HR: { label: "Home runs", places: 0, pitching: false },
  RBI: { label: "Runs batted in", places: 0, pitching: false },
  H: { label: "Hits", places: 0, pitching: false },
  SB: { label: "Stolen bases", places: 0, pitching: false },
  AVG: { label: "Batting average", places: 3, pitching: false },
  bWAR: { label: "WAR (hitters)", places: 1, pitching: false },
  streak: { label: "Hitting streak", places: 0, pitching: false },
  W: { label: "Wins", places: 0, pitching: true },
  SO: { label: "Strikeouts", places: 0, pitching: true },
  SV: { label: "Saves", places: 0, pitching: true },
  ERA: { label: "ERA", low: true, places: 2, pitching: true },
  pWAR: { label: "WAR (pitchers)", places: 1, pitching: true },
};
export const SEASON_STATS = Object.keys(STATS) as SeasonStat[];
export const CAREER_STATS = SEASON_STATS.filter((s): s is CareerStat => s !== "streak");

/** Qualifying for the rate records: a batting title's 502 PA or an ERA title's 162 innings; over a career, 4,000 PA or 1,500 innings. */
export const SEASON_PA = 502;
export const SEASON_OUTS = 486;
export const CAREER_PA = 4000;
export const CAREER_OUTS = 4500;

export interface RecordRow {
  value: number;
  name: string;
  playerId: number | null;
  legendId: number | null;
  /** The season (null for a career). */
  year: number | null;
  /** A career's span, "1998–2016". */
  years: string | null;
  teamId: number | null;
  /** Still playing. */
  active: boolean;
  /** This season, still being played. */
  live: boolean;
}

/** What a season's line is worth in each record (null if it doesn't qualify). */
interface SeasonValues {
  HR: number;
  RBI: number;
  H: number;
  SB: number;
  AB: number;
  PA: number;
  bWAR: number;
  W: number;
  SO: number;
  SV: number;
  ER: number;
  outs: number;
  pWAR: number;
}

function valueOf(stat: CareerStat, v: Partial<SeasonValues>, career: boolean): number | null {
  switch (stat) {
    case "AVG":
      return (v.PA ?? 0) >= (career ? CAREER_PA : SEASON_PA) && (v.AB ?? 0) > 0 ? v.H! / v.AB! : null;
    case "ERA":
      return (v.outs ?? 0) >= (career ? CAREER_OUTS : SEASON_OUTS) ? (v.ER! * 27) / v.outs! : null;
    case "bWAR":
      return v.PA ? (v.bWAR ?? null) : null;
    case "pWAR":
      return v.outs ? (v.pWAR ?? null) : null;
    default: {
      const x = v[stat];
      return x === undefined || x === 0 ? null : x;
    }
  }
}

const better = (stat: SeasonStat) => (a: RecordRow, b: RecordRow) => (STATS[stat].low ? a.value - b.value : b.value - a.value) || (a.year ?? 0) - (b.year ?? 0);

/** This season's lines, for a season still being played (null once it's on everyone's record). */
export interface LiveSeason {
  year: number;
  /** Games still to play (the asterisk); false once the regular season is over but not yet on the record. */
  inProgress: boolean;
  hitters: Map<number, HitterRow>;
  pitchers: Map<number, PitcherRow>;
}

export function liveSeason(season: Season): LiveSeason | null {
  const league = season.league;
  if (league.offseason || league.history.some((h) => h.year === league.year)) return null;
  const stats = season.stats();
  return { year: league.year, inProgress: !season.done, hitters: new Map(stats.hitters.map((h) => [h.id, h])), pitchers: new Map(stats.pitchers.map((p) => [p.id, p])) };
}

export const liveLines = (live: LiveSeason | null, id: number): LiveLines | undefined => {
  if (!live) return undefined;
  const h = live.hitters.get(id);
  const q = live.pitchers.get(id);
  if (!h && !q) return undefined;
  return { year: live.year, ...(h ? { bat: h.line, batWar: h.WAR } : {}), ...(q ? { pit: q.line, pitWar: q.WAR } : {}) };
};

const rowFor = (p: Player, value: number, year: number | null, teamId: number | null, live = false, years: string | null = null): RecordRow => ({
  value,
  name: playerName(p),
  playerId: p.id,
  legendId: null,
  year,
  years,
  teamId,
  active: p.retired === undefined,
  live,
});

/** The best seasons: everyone's recorded big-league seasons, this one so far, and the legends' record seasons. */
export function seasonRecords(league: League, stat: SeasonStat, opts: { live?: LiveSeason | null; teamId?: number; limit?: number } = {}): RecordRow[] {
  const { live = null, teamId, limit = 10 } = opts;
  const rows: RecordRow[] = [];
  if (stat === "streak") {
    // Hitting streaks come from the moments: the longest each player put together in a season.
    const best = new Map<string, RecordRow>();
    for (const m of league.moments) {
      if (m.kind !== "streak" || m.value === undefined || (teamId !== undefined && m.teamId !== teamId)) continue;
      const key = `${m.playerId}:${m.year}`;
      const p = league.players[m.playerId]!;
      if ((best.get(key)?.value ?? 0) < m.value) best.set(key, rowFor(p, m.value, m.year, m.teamId, live?.inProgress === true && live.year === m.year && !m.ended));
    }
    rows.push(...best.values());
  } else {
    for (const p of league.players) {
      for (const c of p.career) {
        if (c.level !== "MLB" || (teamId !== undefined && c.teamId !== teamId)) continue;
        const v: Partial<SeasonValues> = {};
        if (c.bat) Object.assign(v, { HR: c.bat.HR, RBI: c.bat.RBI, H: c.bat.H, SB: c.bat.SB, AB: c.bat.AB, PA: c.bat.PA, bWAR: c.bat.WAR });
        if (c.pit) Object.assign(v, { W: c.pit.W, SO: c.pit.SO, SV: c.pit.SV, ER: c.pit.ER, outs: c.pit.outs, pWAR: c.pit.WAR });
        const x = valueOf(stat, v, false);
        if (x !== null) rows.push(rowFor(p, x, c.year, c.teamId));
      }
    }
    if (live) {
      const add = (id: number, v: Partial<SeasonValues>) => {
        const p = league.players[id]!;
        if (teamId !== undefined && p.teamId !== teamId) return;
        const x = valueOf(stat, v, false);
        if (x !== null) rows.push(rowFor(p, x, live.year, p.teamId, live.inProgress));
      };
      if (!STATS[stat].pitching) for (const [id, h] of live.hitters) add(id, { HR: h.line.HR, RBI: h.line.RBI, H: h.line.H, SB: h.line.SB, AB: h.line.AB, PA: h.line.PA, bWAR: h.WAR });
      else for (const [id, q] of live.pitchers) add(id, { W: q.line.W, SO: q.line.SO, SV: q.line.SV, ER: q.line.ER, outs: q.line.outs, pWAR: q.WAR });
    }
  }
  for (const l of league.legends) {
    if (teamId !== undefined && l.teamId !== teamId) continue;
    for (const r of l.records) if (r.stat === stat) rows.push({ value: r.value, name: l.name, playerId: null, legendId: l.id, year: r.year, years: null, teamId: l.teamId, active: false, live: false });
  }
  return rows.sort(better(stat)).slice(0, limit);
}

/** A career's value in a record (null if it doesn't qualify). */
export function careerValue(stat: CareerStat, t: CareerTotals): number | null {
  const v: Partial<SeasonValues> = {};
  if (t.bat) Object.assign(v, { HR: t.bat.HR, RBI: t.bat.RBI, H: t.bat.H, SB: t.bat.SB, AB: t.bat.AB, PA: t.bat.PA, bWAR: t.bat.WAR });
  if (t.pit) Object.assign(v, { W: t.pit.W, SO: t.pit.SO, SV: t.pit.SV, ER: t.pit.ER, outs: t.pit.outs, pWAR: t.pit.WAR });
  return valueOf(stat, v, true);
}

/** Every big-league career, totaled once (the career boards share it). */
export interface CareerEntry {
  p: Player;
  t: CareerTotals;
}

export function careerTable(league: League, live: LiveSeason | null = null, teamId?: number): CareerEntry[] {
  const out: CareerEntry[] = [];
  for (const p of league.players) {
    if (!p.prior && !p.career.some((c) => c.level === "MLB") && !live?.hitters.has(p.id) && !live?.pitchers.has(p.id)) continue;
    out.push({ p, t: careerTotals(p, liveLines(live, p.id), teamId) });
  }
  return out;
}

/** The best careers: every player's (prior career, recorded seasons, this season so far) and the legends'. With a club, only seasons with it. */
export function careerRecords(league: League, stat: CareerStat, opts: { live?: LiveSeason | null; teamId?: number; limit?: number; table?: CareerEntry[] } = {}): RecordRow[] {
  const { live = null, teamId, limit = 10 } = opts;
  const rows: RecordRow[] = [];
  for (const { p, t } of opts.table ?? careerTable(league, live, teamId)) {
    const x = careerValue(stat, t);
    if (x === null) continue;
    const years = t.first === null ? null : `${t.first}–${p.retired === undefined ? "" : t.last}`;
    rows.push(rowFor(p, x, null, teamId ?? p.teamId, false, years));
  }
  for (const l of league.legends) {
    if (teamId !== undefined && l.teamId !== teamId) continue;
    const x = careerValue(stat, { seasons: l.to - l.from + 1, first: l.from, last: l.to, bat: l.bat ?? null, pit: l.pit ?? null });
    if (x !== null) rows.push({ value: x, name: l.name, playerId: null, legendId: l.id, year: null, years: `${l.from}–${l.to}`, teamId: l.teamId, active: false, live: false });
  }
  return rows.sort(better(stat)).slice(0, limit);
}

/** A record's value as the book prints it: .367, 1.74, 74. */
export function formatRecord(stat: SeasonStat, value: number): string {
  if (stat === "AVG") return value.toFixed(3).replace(/^0/, "");
  return value.toFixed(STATS[stat].places);
}
