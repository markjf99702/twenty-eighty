import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import { acceptBar, FREE_AGENCY_WEEKS, freeAgencyWeek, openFreeAgency, signFreeAgent } from "../src/offseason/freeAgency";
import { budgetRoom, MIN_SALARY, payroll, seasonWar } from "../src/org/contracts";
import { releasePlayer } from "../src/org/roster";
import { canStart } from "../src/org/value";
import { staffCost } from "../src/scouting/scouting";

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

  /**
   * A market of real big leaguers (every other club lets its two best go), the user's club with `spots` open on its 40-man
   * and `room` under its budget, and the user's offers a little over the asks of two players, about $43M a year.
   */
  function userOffersOut(spots: number, room: number) {
    const league = generateLeague({ seed: "fa-room-2" });
    const ctx = { league, day: 0, expanded: false };
    const me = league.teams[0]!;
    league.userTeamId = me.id;
    for (const team of league.teams.slice(1)) {
      const best = team.rosters.MLB.map((id) => league.players[id]!).sort((a, b) => seasonWar(b) - seasonWar(a));
      for (const p of best.slice(0, 2)) releasePlayer(ctx, team, p);
    }
    for (const id of me.fortyMan.filter((id) => league.players[id]!.level !== "MLB").slice(0, spots)) releasePlayer(ctx, me, league.players[id]!);
    const state = openFreeAgency(league);
    me.budget = Math.round(payroll(league, me) + staffCost(league, me) + room);
    const asks = state.asks.filter((a) => a.salary >= 18.5 && a.salary <= 21.5).slice(0, 2);
    for (const a of asks) state.offers.push({ playerId: a.playerId, years: a.years, salary: Math.round(a.salary * 1.08 * 20) / 20 });
    const offered = state.offers.reduce((s, o) => s + o.salary, 0);
    expect(offered).toBeGreaterThan(40);
    expect(offered).toBeLessThan(budgetRoom(league, me));
    freeAgencyWeek(ctx, state, new Rng("fa-room-2"), league.teams);
    const mine = state.signings.filter((s) => s.teamId === me.id);
    return { roomAfter: budgetRoom(league, me), offered: asks.map((a) => a.playerId).sort(), byUser: mine.filter((s) => s.byUser).map((s) => s.playerId).sort(), byAssistant: mine.filter((s) => !s.byUser).length };
  }

  it("leaves the money in your offers alone when your assistant GM bids for your club", () => {
    // $70M of room: the offers and one more player the assistant GM finds with what they leave, within the budget.
    const week = userOffersOut(3, 70);
    expect(week.roomAfter).toBeGreaterThanOrEqual(0);
    expect(week.byUser).toEqual(week.offered);
    expect(week.byAssistant).toBe(1);
  });

  it("leaves the 40-man spots your offers need to them", () => {
    // Plenty of money but two open spots: both go to the user's offers, none to the assistant GM's bids.
    const week = userOffersOut(2, 120);
    expect(week.byUser).toEqual(week.offered);
    expect(week.byAssistant).toBe(0);
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
