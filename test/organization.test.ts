import { describe, expect, it } from "vitest";
import { generateLeague } from "../src/league/generate";
import { rosterProblems } from "../src/org/roster";
import { LEVELS } from "../src/players/types";
import { Season } from "../src/season/season";

// Forty days of the full organization: majors plus four affiliate levels,
// injuries, and the AI front offices making moves.
const league = generateLeague({ seed: "test-orgs" });
const season = new Season(league);
const violations: string[] = [];
const serviceBefore = new Map(league.teams[0]!.rosters.MLB.map((id) => [id, league.players[id]!.service]));
for (let d = 0; d < 40; d++) {
  season.simDay();
  for (const t of league.teams) {
    for (const problem of rosterProblems(season.rosterContext(), t)) violations.push(`day ${d} ${t.abbrev}: ${problem}`);
  }
}

describe("a season of organizations", () => {
  it("keeps every club's rosters legal every day", () => {
    expect(violations).toEqual([]);
  });

  it("assigns every organizational player to exactly one place", () => {
    for (const t of league.teams) {
      const seen = new Map<number, string>();
      for (const level of LEVELS) {
        for (const id of t.rosters[level]) {
          expect(seen.has(id), `${id} listed twice`).toBe(false);
          seen.set(id, level);
          const p = league.players[id]!;
          expect(p.teamId).toBe(t.id);
          expect(p.level).toBe(level);
          expect(p.il).toBeNull();
        }
      }
      for (const id of t.injured) {
        expect(seen.has(id)).toBe(false);
        seen.set(id, "IL");
        expect(league.players[id]!.il).not.toBeNull();
      }
    }
  });

  it("keeps the 40-man list and each player's flag in sync", () => {
    for (const t of league.teams) {
      for (const id of t.fortyMan) expect(league.players[id]!.onFortyMan).toBe(true);
      const flagged = league.players.filter((p) => p.teamId === t.id && p.onFortyMan).map((p) => p.id);
      expect(new Set(flagged)).toEqual(new Set(t.fortyMan));
      for (const id of t.injured) {
        if (league.players[id]!.il === "IL60") expect(t.fortyMan).not.toContain(id);
      }
    }
  });

  it("plays every level and makes roster moves along the way", () => {
    for (const level of LEVELS) expect(season.levels[level].games.length).toBeGreaterThan(400);
    const types = new Set(league.transactions.map((t) => t.type));
    for (const type of ["injury", "il-place", "call-up", "il-activate"]) expect(types.has(type as never)).toBe(true);
  });

  it("accrues service time for big leaguers", () => {
    const gained = [...serviceBefore].map(([id, before]) => league.players[id]!.service - before);
    expect(Math.max(...gained)).toBe(40);
  });

  it("heals injuries over time", () => {
    const healed = league.transactions.filter((t) => t.type === "il-activate").length;
    expect(healed).toBeGreaterThan(0);
    for (const id of season.injured) expect(league.players[id]!.injury!.daysLeft).toBeGreaterThan(0);
  });
});
