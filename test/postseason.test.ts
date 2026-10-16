import { describe, expect, it } from "vitest";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { placeOnIl } from "../src/org/roster";
import { playerValue } from "../src/org/value";
import type { Player } from "../src/players/types";
import {
  defaultPlayoffRoster,
  defaultPlayoffRotation,
  planProblem,
  playoffDepth,
  playoffSeeds,
  playPostseason,
  seriesOf,
  startPostseason,
  stillAlive,
} from "../src/season/postseason";
import { deserialize, loadGame, saveGame, serialize } from "../src/save/save";
import { Season } from "../src/season/season";
import type { GameResult } from "../src/sim/game";
import { playoffPlanView, postseasonView } from "../web/src/worker/october";
import { StatsCache } from "../web/src/worker/views";

const league = generateLeague({ seed: "october" });
const season = new Season(league, { minors: false });
season.simToEnd();
// The user runs the 2 seed (a bye) in the first league.
const USER = playoffSeeds(season)[0]![1]!;
const team = season.team(USER);

// Hurt as the regular season ends: the user's best hitter on the 10-day injured
// list with two days to go, a regular hurt in the last game for two days, and
// the top seed's best starter on the 15-day list with eight to go.
const LAST = season.totalDays - 1;
const hurt = (p: Player, daysLeft: number, startDay = LAST) => {
  p.injury = { name: "Hamstring strain", days: daysLeft + LAST - startDay, daysLeft, startDay };
  season.injured.add(p.id);
};
const regulars = team.rosters.MLB.map((id) => league.players[id]!)
  .filter((p) => !p.pitching && !season.isOut(p.id))
  .sort((a, b) => playerValue(b) - playerValue(a));
const onIl = regulars[0]!;
hurt(onIl, 2, LAST - 8);
placeOnIl(season.rosterContext(), team, onIl);
const lastGame = regulars[1]!;
hurt(lastGame, 2);
const topSeed = season.team(playoffSeeds(season)[0]![0]!);
const ace = topSeed.depth.rotation.map((id) => league.players[id]!).find((p) => !season.isOut(p.id))!;
hurt(ace, 8);
placeOnIl(season.rosterContext(), topSeed, ace);

const bracket = startPostseason(season);
hireGm(league, USER);
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

describe("every club in October", () => {
  it("carries 26, at most 13 pitchers", () => {
    for (const id of bracket.seeds.flat()) {
      const d = playoffDepth(season, season.team(id), bracket.plan);
      const carried = new Set([...Object.values(d.starters), d.dh, ...d.bench, ...d.rotation, ...d.bullpen].filter((x) => x >= 0));
      expect(carried.size).toBe(26);
      expect([...carried].filter((x) => league.players[x]!.pitching).length).toBeLessThanOrEqual(13);
    }
  });

  it("carries 12 or 13 pitchers when its manager picks the roster, as October staffs do", () => {
    for (const id of bracket.seeds.flat()) {
      const picked = defaultPlayoffRoster(season, season.team(id));
      const arms = picked.filter((x) => league.players[x]!.pitching).length;
      expect(picked).toHaveLength(26);
      expect(arms).toBeGreaterThanOrEqual(12);
      expect(arms).toBeLessThanOrEqual(13);
    }
  });
});

describe("injuries in October", () => {
  it("keep healing from the last game of the season to the first of the postseason", () => {
    expect(lastGame.injury).toBeNull();
    expect(season.isOut(lastGame.id)).toBe(false);
    // Three days on, from the last regular-season game to the Wild Card Series.
    expect(ace.injury?.daysLeft).toBe(5);
    expect(onIl.injury).toBeNull();
    expect(onIl.il).toBe("IL10");
  });

  it("let a player healthy again on the injured list onto the playoff roster", () => {
    expect(roster).toContain(onIl.id);
    expect(planProblem(season, team, { roster, rotation: null })).toBeNull();
    const view = playoffPlanView(season, new StatsCache(() => season), team)!;
    expect(view.players.map((p) => p.id)).toContain(onIl.id);
    expect(view.roster).toContain(onIl.id);
    // And he has his place in the lineup again.
    const depth = playoffDepth(season, team, { roster, rotation: null });
    expect([...Object.values(depth.starters), depth.dh]).toContain(onIl.id);
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
    // Every day from the last game of the season to the next day of games has healed a day, off days and all.
    expect(bracket.day).toBeGreaterThan(LAST + 4);
    expect(ace.injury?.daysLeft ?? 0).toBe(Math.max(0, 8 - (bracket.day - LAST)));
    expect(season.isOut(ace.id)).toBe(bracket.day - LAST < 8);
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
    // The top seed's ace healed on the injured list, and his manager put him back in the rotation.
    expect(ace.injury).toBeNull();
    expect(playoffDepth(season, topSeed, bracket.plan).rotation).toContain(ace.id);
    const late = bracket.series.filter((s) => s.round === "Championship Series" || s.round === "World Series");
    for (const s of late) {
      expect(s.mvp).not.toBeNull();
      expect(league.players[s.mvp!.playerId]!.teamId).toBe(s.winner);
    }
    // October is October: it opens Sep 30 and the World Series is over before the winter opens (Oct 30).
    const first = season.dateOf(bracket.series[0]!.games[0]!.day);
    expect([first.getUTCMonth(), first.getUTCDate()]).toEqual([8, 30]);
    const last = season.dateOf(bracket.series.at(-1)!.games.at(-1)!.day);
    expect(last.getUTCMonth()).toBe(9);
    expect(last.getTime()).toBeLessThanOrEqual(season.dateOf(218).getTime());
    expect([season.dateOf(218).getUTCMonth(), season.dateOf(218).getUTCDate()]).toEqual([9, 30]);
  });

  it("names the round on the game that ends a series", () => {
    const view = postseasonView(season, new Map())!;
    expect(view.series).toHaveLength(11);
    for (const s of view.series) {
      const last = s.games.at(-1)!;
      expect(last.after).toBe(`${season.team(s.winner === s.higher.abbrev ? s.higher.id : s.lower.id).nickname} win the ${s.round} ${Math.max(...s.wins)}-${Math.min(...s.wins)}`);
      for (const g of s.games.slice(0, -1)) expect(g.after).not.toMatch(/ win /);
    }
  });
});
