import { describe, expect, it } from "vitest";
import { article, withArticle } from "../src/core/text";
import { generateLeague } from "../src/league/generate";
import { seasonAdvice } from "../src/advice/advice";
import { tradeAdvice } from "../src/advice/trades";
import { hireGm } from "../src/finance/owner";
import { injuryName, injuryPhrase } from "../src/players/injuries";
import { playerName } from "../src/players/types";
import { Season } from "../src/season/season";

describe("names", () => {
  it("are unique across a new league, and never a famous real player's", () => {
    // This universe once had a Nolan Ryan pitching for St. Louis.
    const league = generateLeague({ seed: "twenty-eighty" });
    const names = league.players.map(playerName);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("Nolan Ryan");
  });
});

describe("injury wording", () => {
  it("takes an article only where English does", () => {
    expect(injuryPhrase("Hamstring strain")).toBe("a hamstring strain");
    expect(injuryPhrase("Oblique strain")).toBe("an oblique strain");
    expect(injuryPhrase("Back spasms")).toBe("back spasms");
    expect(injuryPhrase("Arm fatigue")).toBe("arm fatigue");
    expect(injuryPhrase("Elbow inflammation")).toBe("elbow inflammation");
    expect(injuryPhrase("Torn UCL (Tommy John surgery)")).toBe("a torn UCL (Tommy John surgery)");
  });

  it("keeps an injury's capitals inside a sentence", () => {
    const tj = "Torn UCL (Tommy John surgery)";
    expect(injuryName(tj)).toBe("torn UCL (Tommy John surgery)");
    const l = generateLeague({ seed: "injury-words" });
    hireGm(l, 2);
    const s = new Season(l, { minors: false });
    const [mine, theirs] = [l.teams[2]!, l.teams[7]!];
    // The assistant GM's note on a player hurt but still on the active roster.
    mine.manualRoster = true;
    const hurt = l.players[mine.rosters.MLB[0]!]!;
    hurt.injury = { name: tj, days: 369, daysLeft: 369, startDay: 0 };
    seasonAdvice(s);
    expect(l.advice.find((a) => a.key.startsWith("il:"))!.text).toContain("is out about 369 days (torn UCL (Tommy John surgery))");
    // The staff's take on a trade for a hurt player.
    const theirsHurt = l.players[theirs.rosters.MLB[0]!]!;
    theirsHurt.injury = { name: tj, days: 320, daysLeft: 320, startDay: 0 };
    const take = tradeAdvice(s, [mine.rosters.MLB[1]!], [theirsHurt.id], 1)!.notes.map((n) => n.text).join(" ");
    expect(take).toContain("is hurt (torn UCL (Tommy John surgery), about 320 days to go)");
  });
});

describe("numbers in text", () => {
  it("take the article they're read with", () => {
    expect(["8", "11", "18", "80", "85", "89", "800", "8.31", "11.25", "18.00", "8,000", "11,500"].map(withArticle)).toEqual(
      ["an 8", "an 11", "an 18", "an 80", "an 85", "an 89", "an 800", "an 8.31", "an 11.25", "an 18.00", "an 8,000", "an 11,500"],
    );
    expect(["1", "3", "10", "12", "79", "90", "105", "180", "4.50", "0.85", "1,800", ".312"].map(withArticle)).toEqual(
      ["a 1", "a 3", "a 10", "a 12", "a 79", "a 90", "a 105", "a 180", "a 4.50", "a 0.85", "a 1,800", "a .312"],
    );
    expect(article(8)).toBe("an");
  });
});
