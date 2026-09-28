import { describe, expect, it } from "vitest";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import {
  defaultPlayoffRoster,
  defaultPlayoffRotation,
  planProblem,
  playPostseason,
  seriesOf,
  startPostseason,
  stillAlive,
} from "../src/season/postseason";
import { deserialize, loadGame, saveGame, serialize } from "../src/save/save";
import { Season } from "../src/season/season";
import type { GameResult } from "../src/sim/game";

const league = generateLeague({ seed: "october" });
const season = new Season(league, { minors: false });
season.simToEnd();
const bracket = startPostseason(season);
// The user runs the 2 seed (a bye) in the first league.
const USER = bracket.seeds[0]![1]!;
hireGm(league, USER);
const team = season.team(USER);
const roster = defaultPlayoffRoster(season, team);
const rotation = defaultPlayoffRotation(season, team, roster);
bracket.plan = { roster, rotation };

const seen: GameResult[] = [];
season.onGame = (_level, r) => {
  seen.push(r);
};

describe("a playoff roster", () => {
  it("is 26 from the 40-man, at most 13 pitchers, with a catcher", () => {
    expect(roster).toHaveLength(26);
    expect(roster.filter((id) => league.players[id]!.pitching).length).toBeLessThanOrEqual(13);
    expect(planProblem(season, team, { roster, rotation })).toBeNull();
    expect(rotation.length).toBeGreaterThanOrEqual(3);
    for (const id of rotation) expect(roster).toContain(id);
  });

  it("has to follow the rules", () => {
    expect(planProblem(season, team, { roster: roster.slice(1), rotation })).toMatch(/26 players/);
    const pitchers = league.players.filter((p) => p.teamId === USER && p.pitching && p.onFortyMan).map((p) => p.id);
    const hitters = roster.filter((id) => !league.players[id]!.pitching);
    const armHeavy = [...new Set([...pitchers, ...hitters])].slice(0, 26);
    if (armHeavy.filter((id) => league.players[id]!.pitching).length > 13) {
      expect(planProblem(season, team, { roster: armHeavy, rotation: null })).toMatch(/pitchers/);
    }
    const hitter = hitters[0]!;
    expect(planProblem(season, team, { roster, rotation: [hitter, ...rotation.slice(1)] })).toMatch(/pitchers/);
    const outsider = league.players.find((p) => p.teamId !== USER && p.level === "MLB")!.id;
    expect(planProblem(season, team, { roster: [...roster.slice(1), outsider], rotation })).toMatch(/40-man/);
  });
});

describe("October, a game at a time", () => {
  it("waits out the bye, then stops before Game 1 of the Division Series", () => {
    expect(stillAlive(bracket, USER)).toBe(true);
    expect(seriesOf(bracket, USER)).toBeNull();
    const games = playPostseason(season, "game", USER);
    expect(games.length).toBeGreaterThan(0);
    expect(games.every((g) => g.awayId !== USER && g.homeId !== USER)).toBe(true);
    const s = seriesOf(bracket, USER)!;
    expect(s.round).toBe("Division Series");
    expect(s.games).toHaveLength(0);
  });

  it("plays the user's series one game per step", () => {
    const s = seriesOf(bracket, USER)!;
    const games = playPostseason(season, "game", USER);
    expect(games.filter((g) => g.awayId === USER || g.homeId === USER)).toHaveLength(1);
    expect(s.games).toHaveLength(1);
    expect(s.games[0]!.recap).toMatch(/^\S.*\d+, .*\d+/);
  });

  it("uses the user's playoff roster and rotation", () => {
    const mine = seen.filter((r) => r.awayId === USER || r.homeId === USER);
    expect(mine.length).toBeGreaterThan(0);
    for (const r of mine) {
      const side = r.homeId === USER ? 1 : 0;
      const used = [...r.battingOrder[side].flat().map((e) => e.id), ...r.pitchersUsed[side]];
      for (const id of used) expect(roster).toContain(id);
      expect(rotation).toContain(r.starters[side]);
    }
  });

  it("saves and resumes mid-series, playing out the same way", () => {
    const back = loadGame(deserialize(serialize(saveGame(league, season)))).season!;
    expect(back.bracket!.series.length).toBe(bracket.series.length);
    playPostseason(season, "all");
    playPostseason(back, "all");
    expect(season.postseason!.champion).toBe(back.postseason!.champion);
    const scores = (s: Season) => s.bracket!.series.flatMap((x) => x.games.map((g) => g.score.join("-")));
    expect(scores(back)).toEqual(scores(season));
  });

  it("ends with a full bracket, a champion and series MVPs", () => {
    const post = season.postseason!;
    expect(post.series).toHaveLength(11);
    const need: Record<string, number> = { "Wild Card Series": 2, "Division Series": 3, "Championship Series": 4, "World Series": 4 };
    for (const s of post.series) {
      expect(Math.max(...s.wins)).toBe(need[s.round]);
      expect(s.games).toHaveLength(s.wins[0] + s.wins[1]);
    }
    expect(post.series.at(-1)!.round).toBe("World Series");
    expect(post.champion).toBe(post.series.at(-1)!.winner);
    const late = bracket.series.filter((s) => s.round === "Championship Series" || s.round === "World Series");
    for (const s of late) {
      expect(s.mvp).not.toBeNull();
      expect(league.players[s.mvp!.playerId]!.teamId).toBe(s.winner);
    }
    // October is October.
    const first = season.dateOf(bracket.series[0]!.games[0]!.day);
    expect(first.getUTCMonth()).toBe(9);
  });
});
