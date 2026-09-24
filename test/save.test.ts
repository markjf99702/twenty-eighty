import { describe, expect, it } from "vitest";
import { generateLeague } from "../src/league/generate";
import { deserialize, loadGame, saveGame, serialize } from "../src/save/save";
import { Season } from "../src/season/season";

describe("save and load", () => {
  it("resumes a season exactly where it left off", () => {
    const league = generateLeague({ seed: "save-test" });
    const original = new Season(league);
    original.simDays(12);
    const text = serialize(saveGame(league, original));

    original.simDays(6);
    const restored = loadGame(deserialize(text)).season!;
    restored.simDays(6);

    expect(restored.day).toBe(original.day);
    expect(restored.records).toEqual(original.records);
    expect(restored.levels.AAA.records).toEqual(original.levels.AAA.records);
    // Counting stats match exactly; expected-stat sums are rounded in the save.
    const a = restored.batting.total() as unknown as Record<string, number>;
    const b = original.batting.total() as unknown as Record<string, number>;
    for (const k of Object.keys(b)) expect(a[k]).toBeCloseTo(b[k]!, 0);
    expect(a.H).toBe(b.H);
    expect(a.HR).toBe(b.HR);
    expect(restored.league.transactions.length).toBe(original.league.transactions.length);
    // Recent-form logs come back too, capped at the last 15 games per player.
    const someone = [...original.levels.MLB.recentBat.rows.keys()][0]!;
    expect(restored.levels.MLB.recentBat.rows.get(someone)).toEqual(original.levels.MLB.recentBat.rows.get(someone));
    for (const rows of original.levels.MLB.recentBat.rows.values()) expect(rows.length).toBeLessThanOrEqual(15);
    const team = original.league.teams[0]!;
    const cutoff = original.recentCutoff(team.id);
    const days = new Set(original.schedule.days.slice(cutoff, original.day).flatMap((g, i) => (g.some((x) => x.home === team.id || x.away === team.id) ? [i] : [])));
    expect(days.size).toBe(15);
  });

  it("keeps saves reasonably small", () => {
    const league = generateLeague({ seed: "save-size" });
    const season = new Season(league);
    season.simDays(20);
    const text = serialize(saveGame(league, season));
    expect(text.length).toBeLessThan(12_000_000);
  });
});
