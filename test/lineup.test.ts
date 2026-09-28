import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import { buildLineup } from "../src/sim/manager";

describe("the day's lineup", () => {
  const league = generateLeague({ seed: "lineup" });

  it("fills a rested or injured regular's spot from the bench, never with a pitcher", () => {
    let benchStarts = 0;
    for (const team of league.teams) {
      const d = team.depth;
      const hurt = new Set([d.starters.C, d.starters.SS, d.dh]);
      for (let k = 0; k < 40; k++) {
        const lineup = buildLineup(league, d, new Rng(`lineup:${team.id}:${k}`), { unavailable: (id) => hurt.has(id) });
        expect(lineup).toHaveLength(9);
        expect(new Set(lineup.map((s) => s.id)).size).toBe(9);
        for (const s of lineup) {
          expect(league.players[s.id]!.pitching).toBeFalsy();
          expect(hurt.has(s.id)).toBe(false);
          if (d.bench.includes(s.id)) benchStarts++;
        }
      }
    }
    expect(benchStarts).toBeGreaterThan(30 * 40 * 3);
  });
});
