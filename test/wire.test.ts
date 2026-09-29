import { describe, expect, it } from "vitest";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { Season } from "../src/season/season";
import { condenseAwards, transactions } from "../web/src/worker/views";

const league = generateLeague({ seed: "wire" });
hireGm(league, 5);
const season = new Season(league, { minors: false });
season.simDays(110);

describe("the wire's headlines", () => {
  const all = transactions(season, { majorOnly: true, limit: 100000 });
  const heads = transactions(season, { headlines: true, limit: 100000 });

  it("are a small share of the big-league moves: news, not shuffles", () => {
    expect(heads.length).toBeGreaterThan(10);
    expect(heads.length).toBeLessThan(all.length / 10);
    const kinds = new Set(heads.map((h) => h.type));
    for (const k of kinds) expect(["trade", "extension", "claim", "sign", "draft", "injury", "call-up", "retire"]).toContain(k);
    expect(kinds.has("option")).toBe(false);
    expect(kinds.has("il-activate")).toBe(false);
  });

  it("carry every trade, and a call-up only the first time", () => {
    expect(heads.filter((h) => h.type === "trade").length).toBe(all.filter((h) => h.type === "trade").length);
    const callUps = heads.filter((h) => h.type === "call-up").map((h) => h.playerId);
    expect(new Set(callUps).size).toBe(callUps.length);
  });

  it("keep injuries to the ones that change a season", () => {
    for (const h of heads.filter((x) => x.type === "injury")) {
      const days = Number(/out about (\d+) day/.exec(h.text)![1]);
      expect(days).toBeGreaterThanOrEqual(21);
    }
  });
});

describe("a player's honors", () => {
  it("fold into one line per award, biggest first", () => {
    const awards = ["2026 Federal League All-Star", "2027 Federal League All-Star", "2027 All-Star Game MVP", "2027 Federal League Gold Glove (SS)", "2028 Federal League MVP"];
    expect(condenseAwards(awards)).toEqual([
      "2028 Federal League MVP",
      "2027 All-Star Game MVP",
      "2027 Federal League Gold Glove (SS)",
      "2× Federal League All-Star (2026, 2027)",
    ]);
  });
});
