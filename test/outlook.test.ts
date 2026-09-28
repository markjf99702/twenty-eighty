import { describe, expect, it } from "vitest";
import { tradeAdvice } from "../src/advice/trades";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { orgPlayers, seasonWar } from "../src/org/contracts";
import { surplusValue } from "../src/org/trades";
import { canStart, isProspect, measuredInWins, overallGrade, ROOKIE_DAYS } from "../src/org/value";
import { playerName } from "../src/players/types";
import { Season } from "../src/season/season";

const league = generateLeague({ seed: "outlook" });
const USER = 2;
hireGm(league, USER);
const season = new Season(league, { minors: false });
season.simDays(40);
const everyone = league.teams.flatMap((t) => orgPlayers(league, t));

describe("which number leads for a player", () => {
  it("is wins for big leaguers, anyone at AAA and anyone who's been up; FV for prospects", () => {
    for (const p of everyone) {
      expect(isProspect(p)).toBe(p.service < ROOKIE_DAYS);
      if (p.level === "MLB" || p.level === "AAA" || p.service >= ROOKIE_DAYS) expect(measuredInWins(p)).toBe(true);
      else expect(measuredInWins(p)).toBe(false);
    }
    const veterans = everyone.filter((p) => p.level === "MLB" && p.age >= 28);
    expect(veterans.length).toBeGreaterThan(100);
    expect(veterans.filter(isProspect).length).toBeLessThan(veterans.length / 10);
    const lowMinors = everyone.filter((p) => p.level === "A" || p.level === "A+");
    expect(lowMinors.every((p) => !measuredInWins(p) || p.service >= ROOKIE_DAYS)).toBe(true);
  });

  it("separates relievers that the 20-80 grade lumps together", () => {
    const pen = everyone.filter((p) => p.level === "MLB" && p.pitching && !canStart(p));
    const grades = pen.map((p) => overallGrade(p));
    const wars = pen.map(seasonWar).sort((a, b) => a - b);
    const q = (xs: number[], f: number) => xs[Math.floor(f * (xs.length - 1))]!;
    // Most relievers sit within a grade step or so of 50...
    const sorted = [...grades].sort((a, b) => a - b);
    expect(q(sorted, 0.9) - q(sorted, 0.1)).toBeLessThanOrEqual(8);
    // ...while their wins a season run from replacement level to a real closer.
    expect(q(wars, 0.9) - q(wars, 0.1)).toBeGreaterThan(0.5);
  });
});

describe("the staff's read in a trade", () => {
  it("talks about an established player in wins and a prospect in grades", () => {
    const theirs = league.teams[9]!;
    const byValue = (ps: ReturnType<typeof orgPlayers>) => [...ps].sort((a, b) => surplusValue(b) - surplusValue(a));
    const vet = byValue(orgPlayers(league, theirs).filter((p) => p.level === "MLB" && !isProspect(p)))[0]!;
    const kid = byValue(orgPlayers(league, theirs).filter((p) => p.level !== "MLB" && p.level !== "AAA" && isProspect(p)))[0]!;
    const mine = orgPlayers(league, league.teams[USER]!).find((p) => p.onFortyMan)!;
    const fraction = 1 - season.day / season.totalDays;
    const aboutVet = tradeAdvice(season, [mine.id], [vet.id], fraction)!.notes.find((n) => n.from === "scouting" && n.text.includes(playerName(vet)));
    expect(aboutVet?.text).toMatch(/WAR a season/);
    const aboutKid = tradeAdvice(season, [mine.id], [kid.id], fraction)!.notes.find((n) => n.from === "scouting" && n.text.includes(playerName(kid)));
    expect(aboutKid?.text).toMatch(/at his peak/);
  });
});
