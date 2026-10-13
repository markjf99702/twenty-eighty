import { describe, expect, it } from "vitest";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { Season } from "../src/season/season";
import { allStarLine } from "../web/src/worker/allstar";
import { careerLine } from "../web/src/worker/records";
import { playerView, StatsCache, transactions } from "../web/src/worker/views";

const league = generateLeague({ seed: "player-view" });
hireGm(league, 3);
const season = new Season(league, { minors: false });
const stats = new StatsCache(() => season);
const ctx = season.rosterContext();

describe("a player's page", () => {
  it("says so when the link points at no one in this league", () => {
    // An old link, or one from another league.
    expect(() => playerView(season, stats, 999999, ctx)).toThrow("There's no player with that number in this league.");
  });

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

describe("dates", () => {
  it("put last winter's moves on their own calendar", () => {
    const l = generateLeague({ seed: "wire-dates" });
    hireGm(l, 5);
    const s = new Season(l, { minors: false });
    const team = l.teams[5]!;
    const p = l.players[team.rosters.AAA[0]!]!;
    // A spring move in the 2026-27 winter (Mar 1, 2027), read once 2027 is under way: 2028 has a Feb 29, 2027 doesn't.
    l.transactions.push({ year: l.year, day: 340, teamId: team.id, playerId: p.id, type: "promote", text: "Assigned him to AAA" });
    l.year += 1;
    expect(transactions(s, { teamId: team.id, limit: 1 })[0]!.date).toBe("Mar 1");
    expect(playerView(s, new StatsCache(() => s), p.id, s.rosterContext()).transactions[0]!.date).toBe("Mar 1 2027");
  });
});

describe("the All-Star Game's line", () => {
  it("puts the winner first, whichever league was at home", () => {
    const [a, h] = [league.structure.leagues[0]!.replace(" League", ""), league.structure.leagues[1]!.replace(" League", "")];
    const city = league.teams[3]!.city;
    expect(allStarLine(league, { leagues: [0, 1], score: [5, 8], host: 3, mvp: null, note: "" })!.text).toBe(`${h} 8, ${a} 5 in ${city}`);
    expect(allStarLine(league, { leagues: [0, 1], score: [6, 2], host: 3, mvp: null, note: "" })!.text).toBe(`${a} 6, ${h} 2 in ${city}`);
  });
});

describe("Hall of Fame plaques", () => {
  it("separate the thousands in every count", () => {
    const bat = { G: 2900, PA: 12000, AB: 10500, H: 3006, D: 500, T: 90, HR: 420, RBI: 1700, BB: 1300, SB: 1247, WAR: 110.2 };
    expect(careerLine(bat, null)).toBe(".286, 3,006 H, 420 HR, 1,700 RBI, 1,247 SB, 110.2 WAR");
    const pit = { G: 1100, GS: 0, W: 80, L: 70, SV: 1012, outs: 3600, ER: 300, SO: 1500, BB: 400, WAR: 40.5 };
    expect(careerLine(null, pit)).toBe("80-70, 2.25 ERA, 1,500 K, 1,012 SV, 40.5 WAR");
  });
});
