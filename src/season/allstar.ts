import type { League } from "../league/types";
import { defenseGrade } from "../players/defense";
import { FIELD_POSITIONS, type FieldPosition, type LineupPosition, playerName, type Player } from "../players/types";
import { type LineupSlot, simulateGame, type TeamGameSetup } from "../sim/game";
import type { BattingLine, FieldingLine, PitchingLine } from "../stats/lines";
import type { HitterRow, PitcherRow, Season } from "./season";

/**
 * The All-Star Game, on the second day of the break in mid-July: each
 * league's best, picked on the first half (the fans vote in the starters, and
 * every club sends someone), in one exhibition at a host club's park. It
 * counts for nothing but the record books: no stats, no fatigue, no injuries.
 */

export interface AllStarRoster {
  league: number;
  /** The starting nine, in batting order. */
  lineup: LineupSlot[];
  reserves: number[];
  /** The starting pitcher first. */
  pitchers: number[];
}

export interface AllStarBatting {
  id: number;
  /** Where he played (his first position, for a player who moved). */
  pos: LineupPosition;
  AB: number;
  R: number;
  H: number;
  HR: number;
  RBI: number;
  BB: number;
  SO: number;
}

export interface AllStarPitching {
  id: number;
  outs: number;
  H: number;
  R: number;
  ER: number;
  BB: number;
  SO: number;
}

export interface AllStarGame {
  year: number;
  day: number;
  /** The host club (its park). */
  host: number;
  /** League index of [away, home]. */
  leagues: [number, number];
  /** Both rosters, [away, home]. */
  rosters: [AllStarRoster, AllStarRoster];
  score: [number, number];
  innings: number;
  lineScore: [number[], number[]];
  /** Everyone who batted or pitched, [away, home]. */
  batting: [AllStarBatting[], AllStarBatting[]];
  pitching: [AllStarPitching[], AllStarPitching[]];
  mvp: number | null;
  /** His line, e.g. "2-for-3, HR, 3 RBI". */
  mvpNote: string;
}

/** The position he's played most this season (DH if he's mostly been the DH). */
export function mainPosition(f: FieldingLine | undefined, p: Player): LineupPosition {
  if (!f) return p.position === "P" ? "DH" : p.position;
  let best: LineupPosition = "DH";
  let most = f.gamesDH * 27;
  for (const pos of FIELD_POSITIONS) {
    const outs = f[`outs${pos}` as keyof FieldingLine] as number;
    if (outs > most) {
      most = outs;
      best = pos;
    }
  }
  return most > 0 ? best : p.position === "P" ? "DH" : p.position;
}

/** The fans' ballot: wins, with a thumb on the scale for homers and average. */
const vote = (h: HitterRow) => h.WAR + h.line.HR / 30 + (h.AVG - 0.26) * 8;
/** Pitchers: wins plus a nudge for ERA (and a reliever's saves). */
const arm = (p: PitcherRow) => p.WAR + (4 - p.ERA) * 0.3 + p.line.SV * 0.03;
const isStarter = (p: PitcherRow) => p.line.GS >= p.line.G / 2;

/** Each league's All-Stars on the first half's numbers. */
export function pickAllStars(season: Season, lg: number): AllStarRoster {
  const league = season.league;
  const stats = season.stats();
  const eligible = (id: number) => {
    const p = league.players[id]!;
    return p.teamId !== null && league.teams[p.teamId]!.league === lg && p.level === "MLB" && !season.isOut(id);
  };
  const hitters = stats.hitters.filter((h) => eligible(h.id) && h.line.PA >= 150 && !league.players[h.id]!.pitching);
  const pitchers = stats.pitchers.filter((p) => eligible(p.id) && p.line.outs >= 60);
  const pos = new Map(hitters.map((h) => [h.id, mainPosition(season.fielding.lines.get(h.id), league.players[h.id]!)]));
  const taken = new Set<number>();
  const best = <T extends { id: number }>(rows: T[], score: (r: T) => number, ok: (r: T) => boolean = () => true) =>
    rows.filter((r) => !taken.has(r.id) && ok(r)).sort((a, b) => score(b) - score(a))[0];

  // The starters: the top vote-getter at each position, then the best bat left at DH.
  const starters: { h: HitterRow; pos: LineupPosition }[] = [];
  for (const at of FIELD_POSITIONS) {
    const h =
      best(hitters, vote, (r) => pos.get(r.id) === at) ??
      best(hitters, vote, (r) => league.players[r.id]!.positions.includes(at as FieldPosition) || defenseGrade(league.players[r.id]!, at) >= 45);
    if (!h) continue;
    taken.add(h.id);
    starters.push({ h, pos: at });
  }
  const dh = best(hitters, (r) => r.battingRuns + vote(r));
  if (dh) {
    taken.add(dh.id);
    starters.push({ h: dh, pos: "DH" });
  }
  // Best hitters at the top.
  const lineup = [...starters].sort((a, b) => b.h.wOBA - a.h.wOBA).map((s) => ({ id: s.h.id, pos: s.pos }));

  // Reserves: a second catcher, then the best of the rest.
  const reserves: number[] = [];
  const add = (r: { id: number } | undefined, to: number[]) => {
    if (!r) return;
    taken.add(r.id);
    to.push(r.id);
  };
  add(best(hitters, (r) => r.WAR, (r) => pos.get(r.id) === "C"), reserves);
  while (reserves.length < 8) {
    const r = best(hitters, (x) => x.WAR);
    if (!r) break;
    add(r, reserves);
  }

  // Pitchers: seven starters (the best of them starts) and five relievers.
  const staff: number[] = [];
  add(best(pitchers, arm, (p) => isStarter(p) && p.line.outs >= 150), staff);
  for (let i = 0; i < 6; i++) add(best(pitchers, arm, isStarter), staff);
  for (let i = 0; i < 5; i++) add(best(pitchers, arm, (p) => !isStarter(p)), staff);

  // Every club sends someone.
  for (const t of league.teams.filter((x) => x.league === lg)) {
    const has = [...taken].some((id) => league.players[id]!.teamId === t.id);
    if (has) continue;
    const onTeam = (id: number) => league.players[id]!.teamId === t.id;
    const h = best(hitters, (x) => x.WAR, (x) => onTeam(x.id));
    const p = best(pitchers, (x) => x.WAR, (x) => onTeam(x.id));
    if (p && (!h || p.WAR > h.WAR)) add(p, staff);
    else add(h, reserves);
  }
  return { league: lg, lineup, reserves, pitchers: staff };
}

/** Everyone on an All-Star roster. */
export const allStarIds = (r: AllStarRoster): number[] => [...r.lineup.map((s) => s.id), ...r.reserves, ...r.pitchers];

const battingOf = (id: number, pos: LineupPosition, b: BattingLine): AllStarBatting => ({ id, pos, AB: b.AB, R: b.R, H: b.H, HR: b.HR, RBI: b.RBI, BB: b.BB, SO: b.SO });
const pitchingOf = (id: number, p: PitchingLine): AllStarPitching => ({ id, outs: p.outs, H: p.H, R: p.R, ER: p.ER, BB: p.BB, SO: p.SO });

/** "2-for-3, HR, 3 RBI" */
export function allStarLine(b: AllStarBatting): string {
  const parts = [`${b.H}-for-${b.AB}`];
  if (b.HR) parts.push(b.HR > 1 ? `${b.HR} HR` : "HR");
  if (b.RBI) parts.push(`${b.RBI} RBI`);
  if (b.BB) parts.push(b.BB > 1 ? `${b.BB} BB` : "BB");
  return parts.join(", ");
}

/** The host club rotates through the league, a year at a time. */
export const allStarHost = (league: League): number => league.teams[(league.year * 7) % league.teams.length]!.id;

/**
 * Pick the rosters and play the game. It goes into the record (each All-Star's
 * awards, the MVP's too), not into anyone's stats.
 */
export function playAllStarGame(season: Season): AllStarGame {
  const league = season.league;
  const host = league.teams[allStarHost(league)]!;
  const home = host.league;
  const away = 1 - home;
  const rosters: [AllStarRoster, AllStarRoster] = [pickAllStars(season, away), pickAllStars(season, home)];
  const setup = (r: AllStarRoster): TeamGameSetup => ({
    // Any club of the league stands in for it; only the park matters, and that's the host's.
    team: r.league === home ? host : league.teams.find((t) => t.league === r.league)!,
    lineup: r.lineup,
    bench: r.reserves,
    starter: r.pitchers[0]!,
    bullpen: r.pitchers.slice(1),
    park: host.park,
    exhibition: true,
  });
  const rng = season.rng.fork(`allstar:${league.year}`);
  const day = season.schedule.allStarDay ?? season.day;
  const result = simulateGame(season.env, setup(rosters[0]), setup(rosters[1]), rng, day);

  const sides = rosters.map((r) => new Set(allStarIds(r)));
  const batting: [AllStarBatting[], AllStarBatting[]] = [[], []];
  const pitching: [AllStarPitching[], AllStarPitching[]] = [[], []];
  const posOf = new Map<number, LineupPosition>();
  for (const side of result.battingOrder) for (const slot of side) for (const e of slot) if (!posOf.has(e.id)) posOf.set(e.id, e.pos);
  for (const [id, b] of result.batting.lines) if (b.PA > 0) batting[sides[0]!.has(id) ? 0 : 1].push(battingOf(id, posOf.get(id) ?? "DH", b));
  for (const [id, p] of result.pitching.lines) if (p.BF > 0) pitching[sides[0]!.has(id) ? 0 : 1].push(pitchingOf(id, p));
  // Box order: the batting order as it went, then the pitchers in order of appearance.
  result.battingOrder.forEach((slots, s) => {
    const order = slots.flat().map((e) => e.id);
    batting[s]!.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  });
  result.pitchersUsed.forEach((used, s) => pitching[s]!.sort((a, b) => used.indexOf(a.id) - used.indexOf(b.id)));

  // The MVP: the winners' biggest bat (or, in a low-scoring game, their best arm).
  const won = result.score[0] > result.score[1] ? 0 : 1;
  const hitScore = (b: AllStarBatting) => b.H + 2 * b.HR + b.RBI + 0.5 * b.R + 0.3 * b.BB;
  const topBat = [...batting[won]].sort((a, b) => hitScore(b) - hitScore(a))[0];
  const armScore = (p: AllStarPitching) => p.outs / 3 + 0.5 * p.SO - p.R - 0.5 * (p.H + p.BB);
  const topArm = [...pitching[won]].sort((a, b) => armScore(b) - armScore(a))[0];
  let mvp: number | null = null;
  let mvpNote = "";
  if (topBat && (!topArm || hitScore(topBat) >= 2 || armScore(topArm) < 2.5)) {
    mvp = topBat.id;
    mvpNote = allStarLine(topBat);
  } else if (topArm) {
    mvp = topArm.id;
    const ip = `${Math.floor(topArm.outs / 3)}${topArm.outs % 3 ? `.${topArm.outs % 3}` : ""}`;
    mvpNote = `${ip} ${topArm.R === 0 ? "scoreless " : ""}inning${topArm.outs === 3 ? "" : "s"}, ${topArm.SO} K`;
  }

  const game: AllStarGame = {
    year: league.year,
    day,
    host: host.id,
    leagues: [away, home],
    rosters,
    score: result.score,
    innings: result.innings,
    lineScore: result.lineScore,
    batting,
    pitching,
    mvp,
    mvpNote,
  };
  const leagueName = (lg: number) => league.structure.leagues[lg]!;
  for (const r of rosters) for (const id of allStarIds(r)) league.players[id]!.awards.push(`${league.year} ${leagueName(r.league)} All-Star`);
  if (mvp !== null) league.players[mvp]!.awards.push(`${league.year} All-Star Game MVP`);
  return game;
}

/** "Riley Cho (SEA), 2-for-3, HR, 3 RBI" */
export const mvpText = (league: League, g: AllStarGame): string | null => {
  if (g.mvp === null) return null;
  const p = league.players[g.mvp]!;
  const team = p.teamId !== null ? league.teams[p.teamId]!.abbrev : "FA";
  return `${playerName(p)} (${team}), ${g.mvpNote}`;
};
