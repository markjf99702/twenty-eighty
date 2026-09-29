import { describe, expect, it } from "vitest";
import { leagueMetrics } from "../src/calibration/report";
import { generateLeague } from "../src/league/generate";
import { allStarIds } from "../src/season/allstar";
import { runPostseason } from "../src/season/postseason";
import { ALL_STAR_BREAK } from "../src/season/schedule";
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

  it("breaks for the All-Star Game in mid-July, with no series across the break", () => {
    const { start, days } = ALL_STAR_BREAK;
    expect(season.schedule.allStarDay).toBe(start + 1);
    for (let d = start; d < start + days; d++) expect(season.schedule.days[d]).toHaveLength(0);
    expect(season.dateOf(start).toISOString().slice(5, 10)).toBe("07-14");
    // Every series ends before the break: nobody plays the same club on both sides of it.
    const last = new Map(season.schedule.days[start - 1]!.map((g) => [g.home, g.away]));
    for (const g of season.schedule.days[start + days]!) expect(last.get(g.home)).not.toBe(g.away);
  });

  it("plays the All-Star Game at the break without touching anyone's stats", () => {
    const g = season.allStar!;
    expect(g).not.toBeNull();
    const league = season.league;
    for (const r of g.rosters) {
      const ids = allStarIds(r);
      expect(r.lineup).toHaveLength(9);
      expect(new Set(r.lineup.map((s) => s.pos)).size).toBe(9);
      // Every club in the league sends someone.
      const clubs = new Set(ids.map((id) => league.players[id]!.teamId));
      expect(clubs.size).toBe(league.teams.filter((t) => t.league === r.league).length);
      for (const id of ids) expect(league.players[id]!.awards.some((a) => a.endsWith("All-Star"))).toBe(true);
    }
    // Pitchers work an inning or two; the reserves get in.
    for (const side of g.pitching) for (const p of side) expect(p.outs).toBeLessThanOrEqual(6);
    for (const side of g.batting) expect(side.length).toBeGreaterThan(9);
    expect(g.score[0]).not.toBe(g.score[1]);
    expect(g.mvp).not.toBeNull();
  });

  it("notices the season's moments", () => {
    const league = season.league;
    const moments = league.moments.filter((m) => m.year === league.year);
    expect(moments.length).toBeGreaterThan(5);
    for (const m of moments) {
      expect(m.text).toContain(league.players[m.playerId]!.lastName);
      expect(m.day).toBeLessThan(season.totalDays);
    }
    // A no-hitter is nine innings without a hit.
    for (const m of moments.filter((x) => x.kind === "no-hitter" || x.kind === "perfect-game")) {
      const g = season.games.find((x) => x.day === m.day && `${m.day}-${x.homeId}` === m.box)!;
      expect(g.hits).toContain(0);
    }
    // Streaks still going at the end of the season were closed out.
    expect(season.streaks.size).toBe(0);
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
