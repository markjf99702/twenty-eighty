import { describe, expect, it } from "vitest";
import { generateLeague } from "../src/league/generate";
import { overallGrade, playerValue } from "../src/org/value";
import { draftClass } from "../src/offseason/draft";
import { Rng } from "../src/core/rng";
import { analyticsRead, belief } from "../src/scouting/analytics";
import { perceive, takeLook, uncertainty, valueShift } from "../src/scouting/scouting";
import { deserialize, loadGame, saveGame, serialize } from "../src/save/save";
import { Season } from "../src/season/season";

const league = generateLeague({ seed: "scouting-test" });
const mlb = league.players.filter((p) => p.level === "MLB" && p.teamId !== null);
const star = [...mlb].sort((a, b) => playerValue(b) - playerValue(a))[0]!;

describe("scouting reports", () => {
  it("are stable: the same club sees the same player the same way", () => {
    const a = perceive(league, 3, star);
    const b = perceive(league, 3, star);
    expect(a.hitting).toEqual(b.hitting);
    expect(a.pitching).toEqual(b.pitching);
  });

  it("differ from club to club, and never touch the real player", () => {
    const before = JSON.stringify(star);
    const grades = new Set(league.teams.map((t) => overallGrade(perceive(league, t.id, star))));
    expect(grades.size).toBeGreaterThan(1);
    expect(JSON.stringify(star)).toBe(before);
  });

  it("are sharper for better departments, familiar players and more looks", () => {
    const other = mlb.find((p) => p.teamId !== 0)!;
    league.scouting.scouting[0] = 1;
    const cold = uncertainty(league, 0, other);
    league.scouting.scouting[0] = 5;
    const elite = uncertainty(league, 0, other);
    expect(elite).toBeLessThan(cold);

    const own = mlb.find((p) => p.teamId === 0)!;
    expect(uncertainty(league, 0, own)).toBeLessThan(uncertainty(league, 0, other));

    const amateurs = draftClass(new Rng("class"), 20);
    expect(uncertainty(league, 0, amateurs[0]!)).toBeGreaterThan(uncertainty(league, 0, other));

    league.userTeamId = 0;
    const before = uncertainty(league, 0, other);
    expect(takeLook(league, 0, other).ok).toBe(true);
    expect(uncertainty(league, 0, other)).toBeLessThan(before);
    expect(takeLook(league, 0, own).ok).toBe(false);
  });

  it("miss by about what the department's level says", () => {
    const miss = (tier: number) => {
      league.scouting.scouting[1] = tier;
      const others = mlb.filter((p) => p.teamId !== 1).slice(0, 300);
      return others.reduce((s, p) => s + Math.abs(valueShift(league, 1, p)), 0) / others.length;
    };
    const bad = miss(1);
    const good = miss(5);
    expect(good).toBeLessThan(bad * 0.6);
    // A thin department misses a big leaguer's value by several runs on average.
    expect(bad).toBeGreaterThan(3);
  });
});

describe("analytics", () => {
  const l = generateLeague({ seed: "analytics-test" });
  const season = new Season(l, { minors: false });
  season.simDays(40);
  const regular = l.players.find((p) => p.level === "MLB" && !p.pitching && (season.batting.lines.get(p.id)?.PA ?? 0) > 120)!;

  it("reads players from their stats, more reliably with better methods", () => {
    l.scouting.analytics[2] = 1;
    const basic = analyticsRead(season, 2, regular)!;
    l.scouting.analytics[2] = 5;
    const best = analyticsRead(season, 2, regular)!;
    expect(basic.sample).toBeGreaterThan(120);
    expect(best.reliability).toBeGreaterThan(basic.reliability);
    // Forty days is a small sample: any one read can miss, but on average they land near the truth.
    const regulars = l.players.filter((p) => p.level === "MLB" && !p.pitching && (season.batting.lines.get(p.id)?.PA ?? 0) > 120);
    const miss = regulars.reduce((s, p) => s + Math.abs(analyticsRead(season, 2, p)!.value - playerValue(p)), 0) / regulars.length;
    expect(regulars.length).toBeGreaterThan(100);
    expect(miss).toBeLessThan(20);
  });

  it("blends into the club's belief, leaning on analytics as the sample grows", () => {
    const b = belief(season, 2, regular);
    expect(b.weight).toBeGreaterThan(0);
    expect(b.weight).toBeLessThan(1);
    expect(b.value).toBeCloseTo((1 - b.weight) * b.scouts + b.weight * b.analytics!.value, 6);
  });
});

describe("saves", () => {
  it("keep departments and looks, and older saves get departments", () => {
    const l = generateLeague({ seed: "scouting-save" });
    l.userTeamId = 4;
    l.scouting.scouting[4] = 5;
    const target = l.players.find((p) => p.teamId === 7)!;
    takeLook(l, 0, target);
    const back = loadGame(deserialize(serialize(saveGame(l, null)))).league;
    expect(back.scouting.scouting[4]).toBe(5);
    expect(back.scouting.looks[target.id]).toBe(1);

    const old = JSON.parse(serialize(saveGame(generateLeague({ seed: "v2" }), null)));
    old.version = 2;
    delete old.league.scouting;
    const budget = old.league.teams[0].budget;
    const migrated = loadGame(old).league;
    expect(migrated.scouting.scouting).toHaveLength(30);
    expect(migrated.teams[0]!.budget).toBe(budget + 10);
  });
});
