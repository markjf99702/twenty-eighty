import { describe, expect, it } from "vitest";
import { tradeAdvice, tradeAdviceOn, winsThisSeason } from "../src/advice/trades";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { orgPlayers, payroll } from "../src/org/contracts";
import { surplusValue } from "../src/org/trades";
import { type Player, playerName } from "../src/players/types";
import { believedWar } from "../src/scouting/analytics";
import { staffCost } from "../src/scouting/scouting";
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
const P = (id: number) => league.players[id]!;
const war = (p: Player) => believedWar(season, USER, p);

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
    // A left fielder well ahead of ours would start, and that shows up this season.
    const ours = P(mine.depth.starters.LF);
    const better = league.players.find((p) => p.teamId !== null && p.teamId !== USER && p.level === "MLB" && p.position === "LF" && !p.injury && war(p) > war(ours) + 1)!;
    const a = tradeAdvice(season, [myScrub.id], [better.id], fraction)!;
    expect(a.notes.some((n) => n.text.startsWith("For the rest of this season it makes us about") && n.text.includes("better"))).toBe(true);
  });

  describe("this season's wins", () => {
    const time = (p: Player) => fraction - (p.injury?.daysLeft ?? 0) / season.totalDays;

    it("count nothing for a starter who wouldn't crack the rotation", () => {
      const weakest = Math.min(...mine.depth.rotation.map((id) => war(P(id))));
      const sp = league.players
        .filter((p) => p.teamId !== null && p.teamId !== USER && p.level === "MLB" && p.role === "SP" && !p.injury && war(p) >= 0.6 && war(p) < weakest - 0.2)
        .sort((a, b) => war(b) - war(a))[0]!;
      const prospect = mine.rosters.AA.map(P).find((p) => !p.onFortyMan)!;
      expect(winsThisSeason(season, [prospect.id], [sp.id], fraction)).toBe(0);
      const take = tradeAdvice(season, [prospect.id], [sp.id], fraction)!;
      expect(take.notes.some((n) => n.text.includes("wouldn't beat out"))).toBe(true);
      expect(take.notes.some((n) => /rest of this season/.test(n.text))).toBe(false);
    });

    it("count a swap of regulars at one position as the difference between them", () => {
      const ours = P(mine.depth.starters.SS);
      const other = league.teams
        .filter((t) => t.id !== USER)
        .map((t) => P(t.depth.starters.SS))
        .find((p) => p.position === "SS" && !p.injury && war(p) > war(ours) + 1)!;
      expect(winsThisSeason(season, [ours.id], [other.id], fraction)).toBeCloseTo(war(other) * time(other) - war(ours) * time(ours), 6);
    });

    it("count a regular traded for a prospect as the drop to whoever's next up", () => {
      const cf = P(mine.depth.starters.CF);
      const starting = new Set([...Object.values(mine.depth.starters), mine.depth.dh, ...mine.depth.rotation]);
      const next = [...mine.rosters.MLB, ...mine.rosters.AAA]
        .map(P)
        .filter((p) => !p.pitching && !(p.injury && p.injury.daysLeft > 0) && !starting.has(p.id) && (p.position === "CF" || p.positions.includes("CF")))
        .sort((a, b) => war(b) - war(a))[0]!;
      const prospect = theirs.rosters.AA.map(P)[0]!;
      expect(war(next)).toBeGreaterThan(0.5);
      expect(winsThisSeason(season, [cf.id], [prospect.id], fraction)).toBeCloseTo(war(next) * fraction - war(cf) * time(cf), 6);
    });
  });

  it("says how far over the budget we already are", () => {
    const budget = mine.budget;
    mine.budget = Math.round(payroll(league, mine) + staffCost(league, mine) - 20);
    const pricey = league.players.find(
      (p) => p.teamId !== null && p.teamId !== USER && p.level === "MLB" && p.contract?.type === "guaranteed" && p.contract.salary >= 5 && p.contract.years >= 2,
    )!;
    const take = tradeAdvice(season, [myScrub.id], [pricey.id], fraction)!;
    mine.budget = budget;
    const note = take.notes.find((n) => n.from === "business")!.text;
    expect(note).toMatch(/payroll, and we're already \$20\.0M over the budget\. It also adds \$[\d.]+M to what we owe in later years\.$/);
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
