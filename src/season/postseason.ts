import { Rng } from "../core/rng";
import { simulateGame } from "../sim/game";
import type { GameSummary, Season, TeamRecord } from "./season";

/**
 * Twelve-team postseason (the 2022+ format): per league, three division
 * winners and three wild cards. Seeds 1-2 get byes; the Wild Card Series is
 * best-of-3 at the higher seed, then best-of-5 Division Series, best-of-7
 * League Championship Series and World Series.
 */

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

function playSeries(
  season: Season,
  round: string,
  league: number | null,
  higher: number,
  lower: number,
  bestOf: number,
  startDay: number,
): SeriesResult {
  const need = Math.ceil(bestOf / 2);
  const wins: [number, number] = [0, 0];
  const games: GameSummary[] = [];
  const pattern = HOME_PATTERN[bestOf]!;
  // Postseason games don't feed regular-season stats or calibration tallies.
  const env = { ...season.env, tracker: undefined, running: undefined, battedBalls: undefined };
  let day = startDay;
  for (let g = 0; wins[0] < need && wins[1] < need; g++) {
    const higherHome = pattern[g]!;
    const home = season.team(higherHome ? higher : lower);
    const away = season.team(higherHome ? lower : higher);
    const rng = new Rng(`${season.league.seed}:${season.league.year}:post:${round}:${higher}:${lower}:${g}`);
    const result = simulateGame(env, season.gameSetup(away, rng, day), season.gameSetup(home, rng, day), rng);
    season.staff.record(result.pitchCounts, day);
    const homeWon = result.score[1] > result.score[0];
    wins[homeWon === higherHome ? 0 : 1]++;
    games.push({
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
    });
    day++;
    // Travel day when the series changes cities.
    const next = pattern[g + 1];
    if (next !== undefined && next !== higherHome) day++;
  }
  return { round, league, higher, lower, wins, winner: wins[0] === need ? higher : lower, games };
}

const lastDay = (...series: SeriesResult[]) => Math.max(...series.map((s) => s.games[s.games.length - 1]!.day));

function bySeed(seeds: number[], x: number, y: number): [number, number] {
  return seeds.indexOf(x) < seeds.indexOf(y) ? [x, y] : [y, x];
}

export function runPostseason(season: Season): PostseasonResult {
  const seeds = playoffSeeds(season);
  const series: SeriesResult[] = [];
  const pennants: number[] = [];
  const start = season.totalDays + 2;

  seeds.forEach((s, lg) => {
    const wc1 = playSeries(season, "Wild Card Series", lg, s[2]!, s[5]!, 3, start);
    const wc2 = playSeries(season, "Wild Card Series", lg, s[3]!, s[4]!, 3, start);
    const dsStart = lastDay(wc1, wc2) + 2;
    const ds1 = playSeries(season, "Division Series", lg, s[0]!, wc2.winner, 5, dsStart);
    const ds2 = playSeries(season, "Division Series", lg, s[1]!, wc1.winner, 5, dsStart);
    const [h, l] = bySeed(s, ds1.winner, ds2.winner);
    const cs = playSeries(season, "Championship Series", lg, h, l, 7, lastDay(ds1, ds2) + 2);
    series.push(wc1, wc2, ds1, ds2, cs);
    pennants.push(cs.winner);
  });

  const [a, b] = pennants as [number, number];
  const [h, l] = season.compare(season.records[a]!, season.records[b]!) <= 0 ? [a, b] : [b, a];
  const ws = playSeries(season, "World Series", null, h, l, 7, lastDay(...series) + 2);
  series.push(ws);
  season.postseason = { seeds, series, champion: ws.winner };
  return season.postseason;
}
