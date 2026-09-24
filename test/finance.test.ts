import { describe, expect, it } from "vitest";
import {
  BUDGET_CEILING,
  BUDGET_FLOOR,
  bestTicketPrice,
  CASH_RESERVE,
  expectedGate,
  NATIONAL_REVENUE,
  referencePrice,
  revenueOf,
} from "../src/finance/finance";
import { acceptJob, FIRING_LINE, hireGm, reviewSeason } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { advanceOffseason, beginOffseason } from "../src/offseason/offseason";
import { deserialize, loadGame, saveGame, serialize } from "../src/save/save";
import { runPostseason } from "../src/season/postseason";
import { Season } from "../src/season/season";

const USER = 5;
const league = generateLeague({ seed: "finance-test" });
hireGm(league, USER);
const goalsAtHire = league.gm!.goals.length;
const season = new Season(league, { minors: false });
season.simDays(30);
const early = league.teams.map((t) => ({ ...t.finance.ledger }));
const midSave = serialize(saveGame(league, season));
season.simToEnd();
runPostseason(season);
const year = league.year;
const closing = league.teams.map((t) => ({ ...t.finance.ledger }));

describe("the gate", () => {
  it("draws crowds every home game, never more than the ballpark holds, and sells out the opener", () => {
    for (const t of league.teams) {
      const home = season.games.filter((g) => g.homeId === t.id);
      expect(home[0]!.attendance).toBe(t.finance.capacity);
      for (const g of home) expect(g.attendance!).toBeLessThanOrEqual(t.finance.capacity);
      expect(closing[t.id]!.homeGames).toBe(home.length);
      expect(closing[t.id]!.attendance).toBe(home.reduce((s, g) => s + g.attendance!, 0));
    }
    const perGame = closing.map((l) => l.attendance / l.homeGames);
    expect(Math.min(...perGame)).toBeGreaterThan(12_000);
    expect(Math.max(...perGame)).toBeLessThan(48_000);
  });

  it("prices at the going rate when the park has room, and higher when it doesn't", () => {
    const small = league.teams.reduce((a, b) => (a.market < b.market ? a : b));
    small.finance.interest = 1;
    expect(bestTicketPrice(small)).toBe(referencePrice(small));
    const hot = league.teams.reduce((a, b) => (a.market > b.market ? a : b));
    const saved = { ...hot.finance };
    hot.finance.interest = 1.4;
    hot.finance.capacity = 36_000;
    expect(bestTicketPrice(hot)).toBeGreaterThan(referencePrice(hot));
    // Cheaper seats draw more fans.
    expect(expectedGate(hot, 30).fans).toBeGreaterThan(expectedGate(hot, 70).fans);
    Object.assign(hot.finance, saved);
  });
});

describe("the books", () => {
  it("accrue season-long money day by day", () => {
    const share = 30 / season.totalDays;
    for (const l of early) expect(l.national).toBeCloseTo(NATIONAL_REVENUE * share, 6);
    for (const l of closing) expect(l.national).toBeCloseTo(NATIONAL_REVENUE, 6);
  });

  it("make big markets richer than small ones", () => {
    const byMarket = [...league.teams].sort((a, b) => a.market - b.market);
    const small = revenueOf(closing[byMarket[0]!.id]!);
    const big = revenueOf(closing[byMarket.at(-1)!.id]!);
    expect(big).toBeGreaterThan(small * 1.4);
    for (const l of closing) {
      expect(revenueOf(l)).toBeGreaterThan(200);
      expect(revenueOf(l)).toBeLessThan(700);
    }
  });

  it("pay postseason hosts a sold-out playoff gate", () => {
    const hosts = new Set(season.postseason!.series.flatMap((s) => s.games.map((g) => g.homeId)));
    for (const t of league.teams) {
      if (hosts.has(t.id)) expect(closing[t.id]!.postseason).toBeGreaterThan(0);
      else expect(closing[t.id]!.postseason).toBe(0);
    }
    for (const g of season.postseason!.series.flatMap((s) => s.games)) expect(g.attendance).toBe(league.teams[g.homeId]!.finance.capacity);
  });
});

describe("the winter", () => {
  const conf = league.gm!.confidence;
  const state = beginOffseason(league, season);

  it("closes the books, pays the owner and sets new budgets", () => {
    for (const t of league.teams) {
      const h = t.finance.history;
      expect(h).toHaveLength(1);
      expect(h[0]!.year).toBe(year);
      expect(t.finance.cash).toBeLessThanOrEqual(CASH_RESERVE);
      expect(t.finance.ledger.year).toBe(year + 1);
      expect(t.finance.ledger.homeGames).toBe(0);
      expect(t.budget).toBeGreaterThanOrEqual(BUDGET_FLOOR);
      expect(t.budget).toBeLessThanOrEqual(BUDGET_CEILING);
    }
    expect(state.phase).toBe("review");
  });

  it("has the owner review the season against the goals", () => {
    expect(goalsAtHire).toBeGreaterThanOrEqual(2);
    const review = league.gm!.reviews[0]!;
    expect(review.year).toBe(year);
    expect(review.goals).toHaveLength(goalsAtHire);
    expect(review.before).toBe(conf);
    expect(league.gm!.confidence).toBe(review.after);
    expect(league.gm!.seasons).toBe(1);
  });

  it("books draft bonuses to next season, and sets new goals in the spring", () => {
    advanceOffseason(league, season); // tenders
    advanceOffseason(league, season); // draft
    advanceOffseason(league, season); // draft done
    const picks = league.offseason!.draft!.picks;
    const mine = picks.filter((p) => p.teamId === USER).reduce((s, p) => s + p.bonus!, 0);
    expect(picks[0]!.bonus).toBeGreaterThan(picks.at(-1)!.bonus!);
    expect(league.teams[USER]!.finance.ledger.bonuses).toBeCloseTo(mine, 6);
    while (league.offseason!.phase !== "spring") advanceOffseason(league, season);
    expect(league.gm!.goalYear).toBe(year + 1);
    expect(league.gm!.goals.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the owner", () => {
  it("fires a GM who has lost the owner's confidence, and other clubs call", () => {
    const l = generateLeague({ seed: "firing-test" });
    hireGm(l, 3);
    const s = new Season(l, { minors: false });
    s.simDays(20);
    s.day = s.totalDays; // close enough: review what's there
    l.gm!.seasons = 2;
    l.gm!.confidence = FIRING_LINE - 15;
    l.gm!.goals = [{ kind: "wins", target: 150, weight: 2 }];
    l.teams[3]!.manualRoster = true;
    reviewSeason(l, s);
    expect(l.gm!.fired).toBe(true);
    expect(l.gm!.offers).toHaveLength(3);
    expect(l.gm!.offers).not.toContain(3);
    const next = l.gm!.offers[0]!;
    acceptJob(l, next);
    expect(l.userTeamId).toBe(next);
    expect(l.gm!.fired).toBe(false);
    expect(l.gm!.teamId).toBe(next);
    expect(l.teams[3]!.manualRoster).toBe(false);
    expect(l.gm!.reviews).toHaveLength(1);
  });
});

describe("saves", () => {
  it("keep the books, and older saves get owners and a backfilled ledger", () => {
    const back = loadGame(deserialize(midSave));
    expect(back.league.teams[0]!.finance.ledger).toEqual(early[0]);
    expect(back.league.gm!.teamId).toBe(USER);

    const old = JSON.parse(midSave);
    old.version = 3;
    for (const t of old.league.teams) {
      delete t.finance;
      delete t.owner;
    }
    delete old.league.gm;
    const migrated = loadGame(old);
    for (const t of migrated.league.teams) {
      expect(t.owner.name.length).toBeGreaterThan(0);
      expect(t.finance.ledger.homeGames).toBe(early[t.id]!.homeGames);
      expect(t.finance.ledger.national).toBeCloseTo(early[t.id]!.national, 6);
    }
    expect(migrated.league.gm!.teamId).toBe(USER);
  });
});
