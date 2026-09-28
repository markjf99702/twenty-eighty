import { Rng } from "../core/rng";
import { bookPostseason } from "../finance/finance";
import type { DepthChart, League, Team } from "../league/types";
import { orgPlayers } from "../org/contracts";
import { autoDepthChart } from "../org/depth";
import { canStart } from "../org/value";
import type { Player } from "../players/types";
import { believedWar } from "../scouting/analytics";
import type { GameResult } from "../sim/game";
import { simulateGame } from "../sim/game";
import { inningsPitched } from "../stats/lines";
import type { GameSummary, Season, TeamRecord } from "./season";

/**
 * Twelve-team postseason (the 2022+ format): per league, three division
 * winners and three wild cards. Seeds 1-2 get byes; the Wild Card Series is
 * best-of-3 at the higher seed, then best-of-5 Division Series, best-of-7
 * League Championship Series and World Series.
 *
 * It's played a day at a time and saved as it goes (`season.bracket`), so the
 * user can take it game by game with a playoff roster and rotation of their
 * own. When the World Series ends, `season.postseason` holds the result the
 * rest of the game reads (the winter, the owner, the books).
 */

export type Round = "Wild Card Series" | "Division Series" | "Championship Series" | "World Series";
const ROUNDS: Round[] = ["Wild Card Series", "Division Series", "Championship Series", "World Series"];
const BEST_OF: Record<Round, number> = { "Wild Card Series": 3, "Division Series": 5, "Championship Series": 7, "World Series": 7 };

export interface SeriesResult {
  round: string;
  league: number | null;
  higher: number;
  lower: number;
  wins: [number, number];
  winner: number;
  games: GameSummary[];
}

export interface PostseasonResult {
  /** Seeded team ids per league, 1 through 6. */
  seeds: number[][];
  series: SeriesResult[];
  champion: number;
}

export interface PostGame extends GameSummary {
  /** The game in a sentence: the score, then the moments (a walk-off, a gem, a big night at the plate). */
  recap: string;
  /** Starting pitchers, [away, home]. */
  starters: [number, number];
}

/** A player's running line in a series (for its MVP). */
interface Tally {
  team: number;
  ab: number;
  h: number;
  tb: number;
  hr: number;
  rbi: number;
  bb: number;
  outs: number;
  er: number;
  so: number;
  w: number;
  sv: number;
}

export interface LiveSeries {
  round: Round;
  league: number | null;
  higher: number;
  lower: number;
  /** Wins, [higher, lower]. */
  wins: [number, number];
  games: PostGame[];
  /** Day of the next game (null once it's decided). */
  next: number | null;
  winner: number | null;
  /** Most valuable player (Championship Series and World Series). */
  mvp: { playerId: number; line: string } | null;
  tally: Record<number, Tally>;
}

/** The user's club in October: who's on the playoff roster and who starts. */
export interface PlayoffPlan {
  /** The playoff roster (null: the active roster as it stands). */
  roster: number[] | null;
  /** Starters in order; each series starts from the top with whoever is rested (null: the best four). */
  rotation: number[] | null;
}

export interface Bracket {
  seeds: number[][];
  series: LiveSeries[];
  /** The next day with games. */
  day: number;
  champion: number | null;
  plan: PlayoffPlan;
}

export const PLAYOFF_ROSTER = 26;
export const PLAYOFF_PITCHERS = 13;

/** Whether the higher seed is home in each game of a best-of-N. */
const HOME_PATTERN: Record<number, boolean[]> = {
  3: [true, true, true],
  5: [true, true, false, false, true],
  7: [true, true, false, false, false, true, true],
};

export function playoffSeeds(season: Season): number[][] {
  return season.standings().map((divisions) => {
    const winners = divisions.map((d) => d[0]!).sort((a, b) => season.compare(a, b));
    const rest: TeamRecord[] = divisions.flatMap((d) => d.slice(1)).sort((a, b) => season.compare(a, b));
    return [...winners, ...rest.slice(0, 3)].map((r) => r.teamId);
  });
}

const newSeries = (round: Round, league: number | null, higher: number, lower: number, day: number): LiveSeries => ({
  round,
  league,
  higher,
  lower,
  wins: [0, 0],
  games: [],
  next: day,
  winner: null,
  mvp: null,
  tally: {},
});

/** Seed the bracket (once): the four Wild Card Series start two days after the regular season. */
export function startPostseason(season: Season): Bracket {
  if (season.bracket) return season.bracket;
  const seeds = playoffSeeds(season);
  const start = season.totalDays + 2;
  const series: LiveSeries[] = [];
  seeds.forEach((s, lg) => {
    series.push(newSeries("Wild Card Series", lg, s[2]!, s[5]!, start), newSeries("Wild Card Series", lg, s[3]!, s[4]!, start));
  });
  season.bracket = { seeds, series, day: start, champion: null, plan: { roster: null, rotation: null } };
  return season.bracket;
}

// ---------------------------------------------------------------------------
// Playoff rosters

const isPitcher = (p: Player) => Boolean(p.pitching);
const canCatch = (p: Player) => !p.pitching && (p.position === "C" || p.positions.includes("C"));

/**
 * A club's depth chart for October: its playoff roster (the user's pick, or the
 * active roster), four starters in the rotation (the user's order, or its best
 * four), and the rest of the starters in the bullpen as long men.
 */
export function playoffDepth(season: Season, team: Team, plan: PlayoffPlan | null): DepthChart {
  const league = season.league;
  const mine = plan && team.id === league.userTeamId ? plan : null;
  const roster = mine?.roster ? new Set(mine.roster) : null;
  const has = (id: number) => id >= 0 && (!roster || roster.has(id));
  let depth = team.depth;
  // A regular left off the playoff roster: the manager redraws the lineup from who's there.
  if (roster && !(Object.values(depth.starters).every(has) && has(depth.dh))) {
    depth = autoDepthChart([...roster].map((id) => league.players[id]!));
  }
  const wanted = (mine?.rotation ?? depth.rotation.slice(0, 4)).filter((id) => has(id) && league.players[id]?.pitching);
  const rotation = wanted.length ? wanted : depth.rotation.filter(has).slice(0, 4);
  const inLineup = new Set([...Object.values(depth.starters), depth.dh]);
  const bench = depth.bench.filter(has);
  const bullpen = [...depth.bullpen.filter((id) => has(id) && !rotation.includes(id)), ...depth.rotation.filter((id) => has(id) && !rotation.includes(id))];
  if (roster) {
    for (const id of roster) {
      if (inLineup.has(id) || bench.includes(id) || bullpen.includes(id) || rotation.includes(id)) continue;
      (isPitcher(league.players[id]!) ? bullpen : bench).push(id);
    }
  }
  return { starters: depth.starters, dh: depth.dh, bench, rotation, bullpen };
}

/**
 * The playoff roster a club would carry: its healthy active roster, trimmed to
 * 26 (at most 13 pitchers) or filled from the 40-man, best first by its own read.
 */
export function defaultPlayoffRoster(season: Season, team: Team): number[] {
  const league = season.league;
  const war = (p: Player) => believedWar(season, team.id, p);
  const healthy = (p: Player) => !season.isOut(p.id);
  const active = team.rosters.MLB.map((id) => league.players[id]!).filter(healthy);
  const reserves = orgPlayers(league, team).filter((p) => p.onFortyMan && p.level !== "MLB" && healthy(p));
  const pool = [...active.sort((a, b) => war(b) - war(a)), ...reserves.sort((a, b) => war(b) - war(a))];
  const out: Player[] = [];
  const pitchers = () => out.filter(isPitcher).length;
  // A catcher first (two if there are two), then the best of the rest within the limits.
  for (const c of pool.filter(canCatch).slice(0, 2)) out.push(c);
  for (const p of pool) {
    if (out.length >= PLAYOFF_ROSTER) break;
    if (out.includes(p)) continue;
    if (isPitcher(p) && pitchers() >= PLAYOFF_PITCHERS) continue;
    if (!isPitcher(p) && out.length - pitchers() >= PLAYOFF_ROSTER - 11) continue;
    out.push(p);
  }
  return out.map((p) => p.id);
}

/** Starters a club would line up for October, best first by its own read. */
export function defaultPlayoffRotation(season: Season, team: Team, roster: number[]): number[] {
  const league = season.league;
  const on = new Set(roster);
  const war = (p: Player) => believedWar(season, team.id, p);
  const depth = team.depth.rotation.filter((id) => on.has(id));
  const others = roster.map((id) => league.players[id]!).filter((p) => p.pitching && canStart(p) && !depth.includes(p.id));
  return [...depth.map((id) => league.players[id]!), ...others]
    .filter((p) => !season.isOut(p.id))
    .sort((a, b) => war(b) - war(a))
    .slice(0, 4)
    .map((p) => p.id);
}

/** What's wrong with a playoff plan, if anything. */
export function planProblem(season: Season, team: Team, plan: PlayoffPlan): string | null {
  const league = season.league;
  const roster = plan.roster ?? team.rosters.MLB;
  if (plan.roster) {
    if (new Set(plan.roster).size !== plan.roster.length) return "Someone is on the roster twice.";
    for (const id of plan.roster) {
      const p = league.players[id];
      if (!p || p.teamId !== team.id || !(p.onFortyMan || p.level === "MLB")) return "Only players on your 40-man roster can be on the playoff roster.";
    }
    if (plan.roster.length !== PLAYOFF_ROSTER) return `The playoff roster is ${PLAYOFF_ROSTER} players (you have ${plan.roster.length}).`;
    const pitchers = plan.roster.filter((id) => league.players[id]!.pitching).length;
    if (pitchers > PLAYOFF_PITCHERS) return `At most ${PLAYOFF_PITCHERS} pitchers (you have ${pitchers}).`;
    if (!plan.roster.some((id) => canCatch(league.players[id]!))) return "You need a catcher.";
  }
  if (plan.rotation) {
    if (plan.rotation.length < 3 || plan.rotation.length > 5) return "Name three, four or five starters.";
    for (const id of plan.rotation) {
      const p = league.players[id];
      if (!p?.pitching || !roster.includes(id)) return "Starters have to be pitchers on the playoff roster.";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Playing it

const lastDay = (...series: LiveSeries[]) => Math.max(...series.map((s) => s.games[s.games.length - 1]!.day));

function bySeed(seeds: number[], x: number, y: number): [number, number] {
  return seeds.indexOf(x) < seeds.indexOf(y) ? [x, y] : [y, x];
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/** What happened in a game, in a sentence, from its box score. */
export function recapOf(league: League, r: GameResult): string {
  const P = league.players;
  const last = (id: number) => P[id]!.lastName;
  const [as, hs] = r.score;
  const w = hs > as ? 1 : 0;
  const l = 1 - w;
  const team = (i: number) => league.teams[i ? r.homeId : r.awayId]!;
  const bits: string[] = [];

  // A walk-off: the home side won it in its last turn at bat.
  const homeBefore = r.lineScore[1].slice(0, -1).reduce((s, x) => s + x, 0);
  if (w === 1 && r.lineScore[1].length === r.innings && homeBefore <= as) bits.push(`a walk-off in the ${ordinal(r.innings)}`);
  else if (r.innings > 9) bits.push(`${r.innings} innings`);

  // The winners' biggest deficit along the way.
  let score = [0, 0];
  let down = 0;
  for (let i = 0; i < r.innings; i++) {
    for (const side of [0, 1]) {
      score[side]! += r.lineScore[side]![i] ?? 0;
      down = Math.max(down, score[l]! - score[w]!);
    }
  }
  if (down >= 3) bits.push(`back from ${down} down`);

  // The starter's night.
  const sp = r.starters[w];
  const line = r.pitching.get(sp);
  if (r.score[l] === 0 && r.pitchersUsed[w].length === 1) bits.push(`${last(sp)} threw a shutout with ${line.SO} strikeouts`);
  else if (r.score[l] === 0) bits.push(`a combined shutout`);
  else if (line.outs >= 21 && line.ER <= 1) bits.push(`${last(sp)} went ${inningsPitched(line.outs).toFixed(1)} innings, ${line.ER === 0 ? "scoreless" : "one run"}, ${line.SO} K`);

  // The big bat on the winning side.
  const hitters = [...new Set(r.battingOrder[w].flat().map((e) => e.id))].map((id) => ({ id, b: r.batting.get(id) }));
  const byHr = [...hitters].sort((a, b) => b.b.HR - a.b.HR || b.b.RBI - a.b.RBI)[0];
  const byRbi = [...hitters].sort((a, b) => b.b.RBI - a.b.RBI || b.b.HR - a.b.HR)[0];
  if (byHr && byHr.b.HR >= 2) bits.push(`${last(byHr.id)} homered ${byHr.b.HR === 2 ? "twice" : `${byHr.b.HR} times`}`);
  else if (byRbi && byRbi.b.RBI >= 3) bits.push(`${last(byRbi.id)} drove in ${byRbi.b.RBI}`);
  else if (byHr && byHr.b.HR === 1 && bits.length < 2) bits.push(`${last(byHr.id)} homered`);

  if (bits.length === 0 && Math.abs(hs - as) >= 7) bits.push("a rout");
  const head = `${team(w).nickname} ${Math.max(as, hs)}, ${team(l).nickname} ${Math.min(as, hs)}`;
  return bits.length ? `${head}: ${bits.slice(0, 2).join("; ")}.` : `${head}.`;
}

function tallyGame(s: LiveSeries, r: GameResult): void {
  const get = (id: number, team: number): Tally =>
    (s.tally[id] ??= { team, ab: 0, h: 0, tb: 0, hr: 0, rbi: 0, bb: 0, outs: 0, er: 0, so: 0, w: 0, sv: 0 });
  for (const side of [0, 1] as const) {
    const team = side ? r.homeId : r.awayId;
    for (const id of new Set(r.battingOrder[side].flat().map((e) => e.id))) {
      const b = r.batting.get(id);
      const t = get(id, team);
      t.ab += b.AB;
      t.h += b.H;
      t.tb += b.H + b["2B"] + 2 * b["3B"] + 3 * b.HR;
      t.hr += b.HR;
      t.rbi += b.RBI;
      t.bb += b.BB;
    }
    for (const id of r.pitchersUsed[side]) {
      const p = r.pitching.get(id);
      const t = get(id, team);
      t.outs += p.outs;
      t.er += p.ER;
      t.so += p.SO;
      if (r.winningPitcher === id) t.w++;
      if (r.savePitcher === id) t.sv++;
    }
  }
}

/** The winners' most valuable player over the series, and his line. */
function seriesMvp(league: League, s: LiveSeries): LiveSeries["mvp"] {
  let best: { id: number; score: number; t: Tally } | null = null;
  for (const [key, t] of Object.entries(s.tally)) {
    if (t.team !== s.winner) continue;
    const bat = t.tb + 0.8 * t.rbi + 0.5 * t.bb - 0.25 * (t.ab - t.h);
    const arm = (1.2 * t.outs) / 3 + 0.3 * t.so - 1.5 * t.er + 1.5 * t.w + t.sv;
    const score = league.players[Number(key)]!.pitching ? arm : bat;
    if (!best || score > best.score) best = { id: Number(key), score, t };
  }
  if (!best) return null;
  const t = best.t;
  const line = league.players[best.id]!.pitching
    ? [`${inningsPitched(t.outs).toFixed(1)} IP`, `${t.er} ER`, `${t.so} K`, t.w ? `${t.w} W` : "", t.sv ? `${t.sv} SV` : ""].filter(Boolean).join(", ")
    : [`${t.h}-for-${t.ab}`, t.hr ? `${t.hr} HR` : "", `${t.rbi} RBI`].filter(Boolean).join(", ");
  return { playerId: best.id, line };
}

function playGame(season: Season, b: Bracket, s: LiveSeries): PostGame {
  const bestOf = BEST_OF[s.round];
  const g = s.games.length;
  const pattern = HOME_PATTERN[bestOf]!;
  const higherHome = pattern[g]!;
  const home = season.team(higherHome ? s.higher : s.lower);
  const away = season.team(higherHome ? s.lower : s.higher);
  const day = s.next!;
  const rng = new Rng(`${season.league.seed}:${season.league.year}:post:${s.round}:${s.higher}:${s.lower}:${g}`);
  // Postseason games don't feed regular-season stats or calibration tallies.
  const env = { ...season.env, tracker: undefined, running: undefined, battedBalls: undefined };
  // Each series starts its rotation from the top (whoever is rested).
  const key = b.series.indexOf(s);
  const setup = (t: Team) => season.gameSetup(t, rng, day, "MLB", { depth: playoffDepth(season, t, b.plan), rotationKey: `${t.id}:post:${key}` });
  const awaySetup = setup(away);
  const homeSetup = setup(home);
  const result = simulateGame(env, awaySetup, homeSetup, rng);
  season.staff.record(result.pitchCounts, day);
  season.onGame?.("MLB", result, day);

  const homeWon = result.score[1] > result.score[0];
  s.wins[(homeWon ? home.id : away.id) === s.higher ? 0 : 1]++;
  tallyGame(s, result);
  const game: PostGame = {
    day,
    awayId: away.id,
    homeId: home.id,
    score: result.score,
    innings: result.innings,
    hits: result.hits,
    errors: result.errors,
    winningPitcher: result.winningPitcher,
    losingPitcher: result.losingPitcher,
    savePitcher: result.savePitcher,
    starters: result.starters,
    recap: recapOf(season.league, result),
  };
  s.games.push(game);
  const need = Math.ceil(bestOf / 2);
  if (s.wins[0] === need || s.wins[1] === need) {
    s.winner = s.wins[0] === need ? s.higher : s.lower;
    s.next = null;
    if (s.round === "Championship Series" || s.round === "World Series") s.mvp = seriesMvp(season.league, s);
  } else {
    // A travel day when the series changes cities.
    s.next = day + 1 + (pattern[g + 1] !== higherHome ? 1 : 0);
  }
  return game;
}

/** Open each round once the one before it is decided. */
function openRounds(season: Season, b: Bracket): void {
  const find = (round: Round, lg: number | null) => b.series.filter((s) => s.round === round && s.league === lg);
  const decided = (xs: LiveSeries[]) => xs.length > 0 && xs.every((s) => s.winner !== null);
  b.seeds.forEach((seeds, lg) => {
    const wc = find("Wild Card Series", lg);
    if (decided(wc) && find("Division Series", lg).length === 0) {
      const start = lastDay(...wc) + 2;
      // The top seed plays the 4-5 winner; the second seed the 3-6 winner.
      b.series.push(newSeries("Division Series", lg, seeds[0]!, wc[1]!.winner!, start), newSeries("Division Series", lg, seeds[1]!, wc[0]!.winner!, start));
    }
    const ds = find("Division Series", lg);
    if (decided(ds) && find("Championship Series", lg).length === 0) {
      const [h, l] = bySeed(seeds, ds[0]!.winner!, ds[1]!.winner!);
      b.series.push(newSeries("Championship Series", lg, h, l, lastDay(...ds) + 2));
    }
  });
  const cs = b.series.filter((s) => s.round === "Championship Series");
  if (cs.length === 2 && decided(cs) && find("World Series", null).length === 0) {
    const [a, c] = [cs[0]!.winner!, cs[1]!.winner!];
    const [h, l] = season.compare(season.records[a]!, season.records[c]!) <= 0 ? [a, c] : [c, a];
    b.series.push(newSeries("World Series", null, h, l, lastDay(...cs) + 2));
  }
  const ws = find("World Series", null)[0];
  if (ws?.winner !== undefined && ws.winner !== null) b.champion = ws.winner;
}

function finish(season: Season, b: Bracket): void {
  const order = (s: LiveSeries) => (s.league ?? 9) * 10 + ROUNDS.indexOf(s.round);
  const series = [...b.series]
    .sort((x, y) => order(x) - order(y))
    .map((s): SeriesResult => ({ round: s.round, league: s.league, higher: s.higher, lower: s.lower, wins: s.wins, winner: s.winner!, games: s.games }));
  season.postseason = { seeds: b.seeds, series, champion: b.champion! };
  bookPostseason(season);
}

/** Play every game on the bracket's next day. Returns the games played. */
export function playPostseasonDay(season: Season): PostGame[] {
  const b = season.bracket ?? startPostseason(season);
  if (b.champion !== null) return [];
  const today = b.day;
  const played = b.series.filter((s) => s.next === today).map((s) => playGame(season, b, s));
  openRounds(season, b);
  const upcoming = b.series.map((s) => s.next).filter((d): d is number => d !== null);
  b.day = upcoming.length ? Math.min(...upcoming) : today + 1;
  if (b.champion !== null) finish(season, b);
  return played;
}

/** The club at home for a series' next game. */
export function nextHome(s: LiveSeries): number {
  return HOME_PATTERN[BEST_OF[s.round]]![s.games.length] ? s.higher : s.lower;
}

/** Who a club would start in its next game of a series (without moving its rotation along). */
export function probableStarter(season: Season, s: LiveSeries, teamId: number): number | null {
  const b = season.bracket;
  if (!b || s.next === null) return null;
  const depth = playoffDepth(season, season.team(teamId), b.plan);
  if (depth.rotation.length === 0) return null;
  return season.staff.peekStarter(`${teamId}:post:${b.series.indexOf(s)}`, depth.rotation, s.next, (id) => !season.isOut(id));
}

/** The earliest round still being played. */
export function currentRound(b: Bracket): Round | null {
  const open = b.series.filter((s) => s.winner === null);
  if (open.length === 0) return null;
  return ROUNDS[Math.min(...open.map((s) => ROUNDS.indexOf(s.round)))]!;
}

/** The series a club is in (or last played), if it made the postseason. */
export function seriesOf(b: Bracket, teamId: number): LiveSeries | null {
  const mine = b.series.filter((s) => s.higher === teamId || s.lower === teamId);
  return mine[mine.length - 1] ?? null;
}

/** Still playing: in the bracket and not knocked out. */
export function stillAlive(b: Bracket, teamId: number): boolean {
  if (!b.seeds.flat().includes(teamId)) return false;
  const s = seriesOf(b, teamId);
  return !s || s.winner === null || (s.winner === teamId && b.champion === null);
}

export type PostseasonStep = "game" | "round" | "all";

/**
 * Play on: through a club's next game (or, with no game of its own coming, one
 * day), to the end of the round being played, or to the end.
 */
export function playPostseason(season: Season, step: PostseasonStep, teamId: number | null = null): PostGame[] {
  const b = season.bracket ?? startPostseason(season);
  const round = currentRound(b);
  const out: PostGame[] = [];
  const waiting = teamId !== null && stillAlive(b, teamId);
  const series = teamId !== null ? seriesOf(b, teamId) : null;
  while (b.champion === null) {
    const games = playPostseasonDay(season);
    out.push(...games);
    if (step === "game" && (!waiting || games.some((g) => g.awayId === teamId || g.homeId === teamId))) break;
    // Coming off a bye (or a series win): stop once the next opponent is known, before Game 1.
    if (step === "game" && teamId !== null && seriesOf(b, teamId) !== series) break;
    if (step === "round" && round !== null && b.series.filter((s) => s.round === round).every((s) => s.winner !== null)) break;
  }
  return out;
}

/** The whole postseason at once (the AI's seasons, scripts and tests). */
export function runPostseason(season: Season): PostseasonResult {
  startPostseason(season);
  playPostseason(season, "all");
  return season.postseason!;
}
