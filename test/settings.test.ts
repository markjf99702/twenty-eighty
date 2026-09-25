import { describe, expect, it } from "vitest";
import { seasonAdvice, winterAdvice } from "../src/advice/advice";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { DIFFICULTY } from "../src/league/settings";
import { evaluateTrade, surplusValue } from "../src/org/trades";
import { advanceOffseason, beginOffseason, offerClock } from "../src/offseason/offseason";
import { deserialize, loadGame, saveGame, serialize } from "../src/save/save";
import { uncertainty } from "../src/scouting/scouting";
import { runPostseason } from "../src/season/postseason";
import { Season } from "../src/season/season";

describe("difficulty", () => {
  const league = generateLeague({ seed: "difficulty-test" });
  const other = league.players.find((p) => p.teamId === 9 && p.level === "MLB")!;

  it("sharpens or blurs the user's scouts, and sharpens rivals on Hard", () => {
    league.userTeamId = 2;
    const at = (d: "easy" | "normal" | "hard") => {
      league.settings.difficulty = d;
      return { mine: uncertainty(league, 2, other), rival: uncertainty(league, 4, other) };
    };
    const easy = at("easy");
    const normal = at("normal");
    const hard = at("hard");
    expect(easy.mine).toBeLessThan(normal.mine * 0.5);
    expect(hard.mine).toBeGreaterThan(normal.mine);
    expect(hard.rival).toBeLessThan(normal.rival);
    expect(easy.rival).toBeCloseTo(normal.rival, 9);
  });

  it("makes trade partners easier or harder to deal with", () => {
    league.userTeamId = 2;
    const mine = league.teams[2]!;
    const theirs = league.teams[9]!;
    const org = (t: typeof mine) => [...t.rosters.MLB, ...t.rosters.AAA, ...t.rosters.AA].map((id) => league.players[id]!);
    // One of ours for one of theirs, ours worth 6-9% more: fair enough on Easy, not enough on Hard.
    let pair: [number, number] | null = null;
    for (const a of org(mine)) {
      const va = surplusValue(a);
      if (va < 30) continue;
      const b = org(theirs).find((x) => x.onFortyMan === a.onFortyMan && va / surplusValue(x) > 1.06 && va / surplusValue(x) < 1.09);
      if (b) {
        pair = [a.id, b.id];
        break;
      }
    }
    expect(pair).not.toBeNull();
    const verdict = (d: "easy" | "hard") => {
      league.settings.difficulty = d;
      return evaluateTrade(league, mine, theirs, [pair![0]], [pair![1]]).ok;
    };
    expect(verdict("easy")).toBe(true);
    expect(verdict("hard")).toBe(false);
  });

  it("sets the user's budget and the owner's starting faith", () => {
    const easy = generateLeague({ seed: "difficulty-budget" });
    const hard = generateLeague({ seed: "difficulty-budget" });
    easy.settings.difficulty = "easy";
    hard.settings.difficulty = "hard";
    const base = easy.teams[6]!.budget;
    hireGm(easy, 6);
    hireGm(hard, 6);
    expect(easy.teams[6]!.budget).toBe(Math.round(base * 1.15));
    expect(hard.teams[6]!.budget).toBe(Math.round(base * 0.9));
    expect(easy.gm!.confidence).toBeGreaterThan(hard.gm!.confidence);
  });

  it("saves with the league, and older saves play on Normal", () => {
    const l = generateLeague({ seed: "settings-save" });
    l.settings = { difficulty: "hard", statView: "basics", advice: false };
    const back = loadGame(deserialize(serialize(saveGame(l, null)))).league;
    expect(back.settings).toEqual({ difficulty: "hard", statView: "basics", advice: false });
    const old = JSON.parse(serialize(saveGame(l, null)));
    old.version = 5;
    delete old.league.settings;
    delete old.league.advice;
    const migrated = loadGame(old).league;
    expect(migrated.settings.difficulty).toBe("normal");
    expect(migrated.advice).toEqual([]);
  });
});

describe("staff advice", () => {
  const league = generateLeague({ seed: "advice" });
  hireGm(league, 4);
  const season = new Season(league, { minors: false });
  season.simToEnd();

  it("comes during the season from the user's staff, without repeating itself", () => {
    expect(league.advice.length).toBeGreaterThan(0);
    const keys = league.advice.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of league.advice) {
      expect(a.title.length).toBeGreaterThan(5);
      expect(a.text.length).toBeGreaterThan(20);
    }
    // Running the day's advice again adds nothing new.
    const before = league.advice.length;
    seasonAdvice(season);
    expect(league.advice.length).toBe(before);
  });

  it("covers the winter's decisions", () => {
    runPostseason(season);
    beginOffseason(league, season);
    while (league.offseason!.phase !== "freeAgency") advanceOffseason(league, season);
    winterAdvice(league, season, offerClock(league, season));
    expect(league.advice.some((a) => a.key.startsWith("draft:"))).toBe(true);
    expect(league.advice.some((a) => a.key.startsWith("fa:"))).toBe(true);
  });

  it("stays quiet when advice is off", () => {
    const quiet = generateLeague({ seed: "advice" });
    quiet.settings.advice = false;
    hireGm(quiet, 4);
    const s = new Season(quiet, { minors: false });
    s.simDays(60);
    expect(quiet.advice).toEqual([]);
  });
});
