import { describe, expect, it } from "vitest";
import { tradeAdvice, tradeAdviceOn } from "../src/advice/trades";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { orgPlayers, seasonWar } from "../src/org/contracts";
import { surplusValue } from "../src/org/trades";
import { playerName } from "../src/players/types";
import { Season } from "../src/season/season";

const USER = 6;
const league = generateLeague({ seed: "trade-advice" });
hireGm(league, USER);
const season = new Season(league, { minors: false });
season.simDays(50);
const fraction = 1 - season.day / season.totalDays;
const mine = league.teams[USER]!;
const theirs = league.teams[11]!;
const byValue = (ps: ReturnType<typeof orgPlayers>) => [...ps].sort((a, b) => surplusValue(b) - surplusValue(a));
const theirStar = byValue(orgPlayers(league, theirs).filter((p) => p.level === "MLB"))[0]!;
const myScrub = byValue(orgPlayers(league, mine).filter((p) => p.onFortyMan)).at(-1)!;
const myStar = byValue(orgPlayers(league, mine).filter((p) => p.level === "MLB"))[0]!;
const theirScrub = byValue(orgPlayers(league, theirs).filter((p) => p.onFortyMan)).at(-1)!;

describe("the staff's take on a trade", () => {
  it("says take a steal and pass on a giveaway, and explains why", () => {
    const steal = tradeAdvice(season, [myScrub.id], [theirStar.id], fraction)!;
    expect(steal.verdict).toBe("take");
    expect(steal.headline).toMatch(/^Take it/);
    const giveaway = tradeAdvice(season, [myStar.id], [theirScrub.id], fraction)!;
    expect(giveaway.verdict).toBe("pass");
    // Who's speaking, and about what.
    const from = new Set(steal.notes.map((n) => n.from));
    expect(from.has("scouting")).toBe(true);
    expect(steal.notes.length).toBeLessThanOrEqual(6);
    expect(steal.notes.some((n) => n.text.includes(playerName(theirStar)))).toBe(true);
  });

  it("counts this season's wins while the season is on", () => {
    const a = tradeAdvice(season, [myScrub.id], [theirStar.id], fraction)!;
    if (seasonWar(theirStar) > 1) expect(a.notes.some((n) => /rest of this season/.test(n.text))).toBe(true);
  });

  it("is surer about other clubs' players with a better scouting department, or on Easy", () => {
    const tiers = league.scouting.scouting;
    const before = tiers[USER]!;
    tiers[USER] = 1;
    const thin = tradeAdvice(season, [myScrub.id], [theirStar.id], fraction)!.confidence;
    tiers[USER] = 5;
    const sharp = tradeAdvice(season, [myScrub.id], [theirStar.id], fraction)!.confidence;
    tiers[USER] = 1;
    league.settings.difficulty = "easy";
    const easy = tradeAdvice(season, [myScrub.id], [theirStar.id], fraction)!.confidence;
    league.settings.difficulty = "normal";
    tiers[USER] = before;
    const rank = { high: 0, medium: 1, low: 2 };
    expect(rank[sharp]).toBeLessThan(rank[thin]);
    expect(rank[easy]).toBeLessThan(rank[thin]);
  });

  it("stays quiet with staff advice off", () => {
    expect(tradeAdviceOn(league)).toBe(true);
    league.settings.advice = false;
    expect(tradeAdviceOn(league)).toBe(false);
    league.settings.advice = true;
  });
});
