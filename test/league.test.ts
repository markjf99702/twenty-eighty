import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import { buildSchedule } from "../src/season/schedule";

const league = generateLeague({ seed: "test-league" });

describe("league generation", () => {
  it("builds 30 clubs with 26-man rosters", () => {
    expect(league.teams).toHaveLength(30);
    for (const t of league.teams) {
      expect(t.active).toHaveLength(26);
      expect(new Set(t.active).size).toBe(26);
      expect(t.depth.rotation).toHaveLength(5);
      expect(t.depth.bullpen).toHaveLength(8);
    }
  });

  it("is reproducible from its seed", () => {
    const again = generateLeague({ seed: "test-league" });
    expect(again.players.map((p) => p.lastName)).toEqual(league.players.map((p) => p.lastName));
  });

  it("keeps every grade on the 20-80 scale with future >= present", () => {
    for (const p of league.players) {
      const tools = [...Object.values(p.hitting), ...(p.pitching ? [p.pitching.control, p.pitching.command, ...p.pitching.pitches.map((x) => x.grade)] : [])];
      for (const t of tools) {
        expect(t.present).toBeGreaterThanOrEqual(20);
        expect(t.present).toBeLessThanOrEqual(80);
        expect(t.future).toBeGreaterThanOrEqual(t.present);
      }
    }
  });

  it("centers hitting grades so 50 is the playing-time-weighted average", () => {
    let sum = 0;
    let w = 0;
    for (const t of league.teams) {
      for (const id of [...Object.values(t.depth.starters), t.depth.dh]) {
        sum += league.players[id]!.hitting.hit.present;
        w += 1;
      }
      for (const id of t.depth.bench) {
        sum += 0.3 * league.players[id]!.hitting.hit.present;
        w += 0.3;
      }
    }
    expect(sum / w).toBeCloseTo(50, 0);
  });
});

describe("schedule", () => {
  const schedule = buildSchedule(league, new Rng("sched"));
  const games = schedule.days.flat();

  it("gives every team 162 games and 81 at home", () => {
    const total = new Map<number, number>();
    const home = new Map<number, number>();
    for (const g of games) {
      total.set(g.home, (total.get(g.home) ?? 0) + 1);
      total.set(g.away, (total.get(g.away) ?? 0) + 1);
      home.set(g.home, (home.get(g.home) ?? 0) + 1);
    }
    for (const t of league.teams) {
      expect(total.get(t.id)).toBe(162);
      expect(home.get(t.id)).toBe(81);
    }
  });

  it("never books a team twice on one day", () => {
    for (const day of schedule.days) {
      const seen = new Set<number>();
      for (const g of day) {
        expect(seen.has(g.home) || seen.has(g.away)).toBe(false);
        seen.add(g.home);
        seen.add(g.away);
      }
    }
  });

  it("plays division rivals 14 times", () => {
    const a = league.teams[0]!;
    const rival = league.teams.find((t) => t.id !== a.id && t.league === a.league && t.division === a.division)!;
    const n = games.filter((g) => (g.home === a.id && g.away === rival.id) || (g.home === rival.id && g.away === a.id)).length;
    expect(n).toBe(14);
  });

  it("fits in a realistic calendar", () => {
    expect(schedule.days.length).toBeGreaterThan(165);
    expect(schedule.days.length).toBeLessThan(215);
  });
});
