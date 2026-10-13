import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import { acceptBar, FREE_AGENCY_WEEKS, freeAgencyWeek, openFreeAgency, signFreeAgent } from "../src/offseason/freeAgency";
import { MIN_SALARY, seasonWar } from "../src/org/contracts";
import { releasePlayer } from "../src/org/roster";
import { canStart } from "../src/org/value";

describe("free agency", () => {
  it("never pays anyone less than the league minimum, however late in the winter", () => {
    const league = generateLeague({ seed: "free-agency" });
    const ctx = { league, day: 0, expanded: false };
    // A market full of cheap relievers, and pens with holes to fill.
    for (const team of league.teams) {
      for (const p of team.rosters.MLB.map((id) => league.players[id]!)) {
        if (p.pitching && !canStart(p) && seasonWar(p) < 0.4) releasePlayer(ctx, team, p);
      }
    }
    const state = openFreeAgency(league);
    expect(state.asks.filter((a) => a.salary === MIN_SALARY).length).toBeGreaterThan(20);
    // The second half of the winter, when demands have softened most.
    state.week = FREE_AGENCY_WEEKS / 2;
    while (state.week < FREE_AGENCY_WEEKS) freeAgencyWeek(ctx, state, new Rng(`late-winter-${state.week}`), league.teams);
    expect(state.signings.length).toBeGreaterThan(2);
    expect(state.signings.filter((s) => s.salary < MIN_SALARY)).toEqual([]);
    // What a minimum-salary player will take (the free-agent list's "Takes now") stays at the minimum too.
    expect(acceptBar({ playerId: 0, years: 1, salary: MIN_SALARY }, FREE_AGENCY_WEEKS)).toBeGreaterThanOrEqual(MIN_SALARY);
  });

  it("writes an 8-year deal with 'an'", () => {
    const league = generateLeague({ seed: "free-agency" });
    const ctx = { league, day: 0, expanded: false };
    const [from, to] = [league.teams[0]!, league.teams[1]!];
    const star = league.players[from.rosters.MLB[0]!]!;
    releasePlayer(ctx, from, star);
    releasePlayer(ctx, to, league.players[to.fortyMan.find((id) => league.players[id]!.level !== "MLB")!]!);
    expect(signFreeAgent(ctx, to, star, 8, 25).ok).toBe(true);
    expect(league.transactions.at(-1)!.text).toMatch(/ to an 8-year, \$200\.0M deal$/);
  });
});
