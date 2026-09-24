import { describe, expect, it } from "vitest";
import { leagueMetrics } from "../src/calibration/report";
import { generateLeague } from "../src/league/generate";
import { runPostseason } from "../src/season/postseason";
import { Season } from "../src/season/season";

// A full 2,430-game season takes a few seconds; the realism checks below
// use generous bands so they catch broken physics, not normal variance.
const season = new Season(generateLeague({ seed: "test-season" }), { minors: false });
season.simToEnd();
const stats = season.stats();
const m = leagueMetrics([season]);

describe("a simulated season", () => {
  it("plays every scheduled game", () => {
    expect(season.games).toHaveLength(2430);
    for (const r of season.records) expect(r.w + r.l).toBe(162);
  });

  it("looks like modern MLB", () => {
    expect(m["R/G"]).toBeGreaterThan(3.9);
    expect(m["R/G"]).toBeLessThan(4.9);
    expect(m.AVG).toBeGreaterThan(0.232);
    expect(m.AVG).toBeLessThan(0.258);
    expect(m["K%"]).toBeGreaterThan(20);
    expect(m["K%"]).toBeLessThan(25);
    expect(m["BB%"]).toBeGreaterThan(7);
    expect(m["BB%"]).toBeLessThan(9.8);
    expect(m["HR%"]).toBeGreaterThan(2.5);
    expect(m["HR%"]).toBeLessThan(3.6);
    expect(m.BABIP).toBeGreaterThan(0.278);
    expect(m.BABIP).toBeLessThan(0.305);
  });

  it("derives sensible wOBA weights from its own run environment", () => {
    const w = stats.context.weights;
    expect(w.BB).toBeLessThan(w["1B"]);
    expect(w["1B"]).toBeLessThan(w["2B"]);
    expect(w["2B"]).toBeLessThan(w["3B"]);
    expect(w["3B"]).toBeLessThan(w.HR);
    expect(stats.context.lgWoba).toBeCloseTo(stats.context.lgObp, 2);
    expect(stats.context.runsPerWin).toBeGreaterThan(8.5);
    expect(stats.context.runsPerWin).toBeLessThan(11);
  });

  it("hands out 1,000 WAR per 2,430 games, 57/43 hitters/pitchers", () => {
    const hitterWar = stats.hitters.reduce((s, h) => s + h.WAR, 0);
    const pitcherWar = stats.pitchers.reduce((s, p) => s + p.WAR, 0);
    expect(hitterWar).toBeCloseTo(570, -1);
    expect(pitcherWar).toBeCloseTo(430, -1);
  });

  it("crowns a champion from the twelve-team bracket", () => {
    const post = runPostseason(season);
    expect(post.seeds.flat()).toHaveLength(12);
    expect(post.seeds.flat()).toContain(post.champion);
    const ws = post.series[post.series.length - 1]!;
    expect(ws.round).toBe("World Series");
    expect(Math.max(...ws.wins)).toBe(4);
  });
});
