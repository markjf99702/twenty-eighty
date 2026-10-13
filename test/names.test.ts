import { describe, expect, it } from "vitest";
import { article, withArticle } from "../src/core/text";
import { generateLeague } from "../src/league/generate";
import { injuryPhrase } from "../src/players/injuries";
import { playerName } from "../src/players/types";

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
