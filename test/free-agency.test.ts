import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import type { League, Team } from "../src/league/types";
import { acceptBar, FREE_AGENCY_WEEKS, freeAgencyWeek, openFreeAgency, signFreeAgent } from "../src/offseason/freeAgency";
import { budgetRoom, MIN_SALARY, payroll, seasonWar } from "../src/org/contracts";
import { onTheBlock } from "../src/org/market";
import { proposeToUser } from "../src/org/offers";
import { releasePlayer } from "../src/org/roster";
import { aiTradeMarket, FREE_AGENT_TRADE_DAY, freshSignings } from "../src/org/trades";
import { canStart } from "../src/org/value";
import { advanceOffseason, beginOffseason, winterContext } from "../src/offseason/offseason";
import { playerName } from "../src/players/types";
import { warShift } from "../src/scouting/analytics";
import { staffCost } from "../src/scouting/scouting";
import { Season } from "../src/season/season";

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

describe("a free agent who just signed", () => {
  it("isn't traded that winter, or until June 15", () => {
    const league = generateLeague({ seed: "flip-b" });
    const season = new Season(league, { minors: false });
    // Straight into the winter, through free agency, then many more trades between AI clubs on its last day.
    beginOffseason(league, season);
    while (league.offseason!.phase !== "international") advanceOffseason(league, season);
    const ctx = winterContext(league, "freeAgency", 56);
    aiTradeMarket(ctx, new Rng("more trades"), 60, 1, (viewer, p) => warShift(season, viewer, p));
    const winter = league.transactions.filter((t) => t.year === league.year);
    const signed = new Set(winter.filter((t) => t.type === "sign" && t.text.startsWith("Signed free agent ")).map((t) => t.playerId));
    expect(signed.size).toBeGreaterThan(30);
    const traded = winter.filter((t) => t.type === "trade");
    expect(traded.length).toBeGreaterThan(10);
    // Clubs used to flip them: here Vancouver signed Ángel Marte and traded him before spring.
    expect(traded.filter((t) => signed.has(t.playerId)).map((t) => t.text)).toEqual([]);
    expect(freshSignings(ctx)).toEqual(signed);
    // In the season that follows they stay put until June 15.
    let next: Season | null = null;
    while (!next) next = advanceOffseason(league, season);
    expect(freshSignings(next.rosterContext(FREE_AGENT_TRADE_DAY - 1))).toEqual(signed);
    expect(freshSignings(next.rosterContext(FREE_AGENT_TRADE_DAY)).size).toBe(0);
    expect(next.dateOf(FREE_AGENT_TRADE_DAY).toISOString().slice(5, 10)).toBe("06-15");
  });
});

describe("a free agent his club just signed", () => {
  const USER = 3;
  /** Free agency's line in the log for each of these players, in the winter that closes `year`. */
  const sign = (league: League, ids: Iterable<number>, year: number) => {
    for (const id of ids) {
      const p = league.players[id]!;
      league.transactions.push({ year, day: 230, teamId: p.teamId!, playerId: p.id, type: "sign", text: `Signed free agent ${playerName(p)} to a 2-year, $12.0M deal` });
    }
  };
  /** Whom a club shops to the user over thirty tries (on the offer clock `now`), with nothing else open. */
  const shopped = (season: Season, seller: Team, now: number, inSeason: boolean) => {
    const league = season.league;
    const fraction = inSeason ? 1 - season.day / season.totalDays : 1;
    const out = new Set<number>();
    for (let i = 0; i < 30; i++) {
      league.tradeOffers = [];
      const o = proposeToUser(league, new Rng(`fresh-${i}`), now, now + 3, { buyers: [], sellers: [seller] }, "contender", fraction, (v, p) => warShift(season, v, p), inSeason);
      if (o) out.add(o.get[0]!);
    }
    league.tradeOffers = [];
    return out;
  };
  /** The first club that would shop the user someone then, and whom. */
  const shopper = (season: Season, now: number, inSeason: boolean) => {
    for (const team of season.league.teams) {
      if (team.id === USER) continue;
      const got = shopped(season, team, now, inSeason);
      if (got.size > 0) return { team, got };
    }
    throw new Error("nobody shops the user anyone");
  };
  const listed = (season: Season) => new Set(onTheBlock(season, USER).map((b) => b.player.id));
  const both = (a: Set<number>, b: Set<number>) => [...a].filter((id) => b.has(id));

  it("isn't shopped to the user or put on the block until June 15", () => {
    const league = generateLeague({ seed: "fresh-shop" });
    hireGm(league, USER);
    const season = new Season(league, { minors: false });
    season.simDays(40);
    const block = onTheBlock(season, USER);
    const may = shopper(season, season.day, true);
    // Last winter, that club signed everyone it would shop us, and the three best fits for us on the block signed too.
    const fresh = new Set([...may.got, ...block.slice(0, 3).map((b) => b.player.id)]);
    sign(league, fresh, league.year - 1);
    expect(both(listed(season), fresh)).toEqual([]);
    // Everyone else stays on it.
    expect(listed(season).size).toBe(block.filter((b) => !fresh.has(b.player.id)).length);
    expect(listed(season).size).toBeGreaterThan(0);
    expect(both(shopped(season, may.team, season.day, true), fresh)).toEqual([]);
    // On June 15 they're on the block again, and whoever a club shops us then it would shop us had he signed last
    // winter, but not the day before.
    season.day = FREE_AGENT_TRADE_DAY;
    expect(both(listed(season), fresh).length).toBeGreaterThanOrEqual(3);
    const june = shopper(season, season.day, true);
    sign(league, june.got, league.year - 1);
    expect(shopped(season, june.team, season.day, true)).toEqual(june.got);
    season.day = FREE_AGENT_TRADE_DAY - 1;
    expect(both(shopped(season, june.team, season.day, true), june.got)).toEqual([]);
  });

  it("isn't shopped to the user or put on the block the winter he signs", () => {
    const league = generateLeague({ seed: "fresh-shop-winter" });
    hireGm(league, USER);
    const season = new Season(league, { minors: false });
    beginOffseason(league, season);
    const block = onTheBlock(season, USER);
    const now = 1000 + 230;
    const winter = shopper(season, now, false);
    const fresh = new Set([...winter.got, ...block.slice(0, 3).map((b) => b.player.id)]);
    // Signed last winter, they'd be fair game now; signed this winter, they aren't.
    sign(league, fresh, league.year - 1);
    expect(listed(season).size).toBe(block.length);
    sign(league, fresh, league.year);
    expect(both(listed(season), fresh)).toEqual([]);
    expect(both(shopped(season, winter.team, now, false), fresh)).toEqual([]);
  });
});
