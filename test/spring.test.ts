import { describe, expect, it, vi } from "vitest";
import { generateLeague } from "../src/league/generate";
import { winterContext } from "../src/offseason/offseason";
import { springTraining } from "../src/offseason/spring";
import { peakValue } from "../src/org/value";
import { LEVELS } from "../src/players/types";

// Count the peak projections spring training asks for (each one projects a player's career); passed through unchanged.
vi.mock("../src/org/value", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/org/value")>();
  return { ...real, peakValue: vi.fn(real.peakValue) };
});

describe("spring training", () => {
  it("works out each player's worth once per sort, not once per comparison", () => {
    const league = generateLeague({ seed: "spring-sort" });
    const players = league.teams.reduce((n, t) => n + new Set([...LEVELS.flatMap((l) => t.rosters[l]), ...t.injured]).size, 0);
    vi.mocked(peakValue).mockClear();
    springTraining(winterContext(league, "spring"), league.teams);
    // Sorts that projected both players on every comparison asked for 43 per player here, and spring training took
    // 9 seconds (10-14 in a league's first winter); scoring each player once per sort asks for about 4.
    expect(vi.mocked(peakValue).mock.calls.length).toBeLessThan(10 * players);
  });
});
