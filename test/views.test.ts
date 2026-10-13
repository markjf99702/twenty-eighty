import { describe, expect, it } from "vitest";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { Season } from "../src/season/season";
import { playerView, StatsCache } from "../web/src/worker/views";

const league = generateLeague({ seed: "player-view" });
hireGm(league, 3);
const season = new Season(league, { minors: false });
const stats = new StatsCache(() => season);
const ctx = season.rosterContext();

describe("a player's page", () => {
  it("gives each pitch its share of what he throws", () => {
    const pitchers = league.players.filter((p) => p.pitching && p.teamId !== null).slice(0, 60);
    for (const p of pitchers) {
      const v = playerView(season, stats, p.id, ctx);
      expect(v.pitches.length).toBeGreaterThan(1);
      expect(v.pitches.reduce((s, x) => s + x.usage, 0)).toBeCloseTo(1, 6);
      // The order and proportions stay his: the fastball he leans on most is still the biggest share.
      const raw = p.pitching!.pitches;
      expect(v.pitches[0]!.usage / v.pitches[1]!.usage).toBeCloseTo(raw[0]!.usage / raw[1]!.usage, 6);
    }
  });
});

