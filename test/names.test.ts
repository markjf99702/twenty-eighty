import { describe, expect, it } from "vitest";
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
