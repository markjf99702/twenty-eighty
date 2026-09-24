import { describe, expect, it } from "vitest";
import { generateLeague } from "../src/league/generate";
import { orgPlayers, payroll } from "../src/org/contracts";
import { rosterProblems } from "../src/org/roster";
import { evaluateTrade, executeTrade, surplusValue } from "../src/org/trades";
import { onTheClock } from "../src/offseason/draft";
import { advanceOffseason, beginOffseason, winterContext, winterWeek } from "../src/offseason/offseason";
import { LEVELS } from "../src/players/types";
import { deserialize, loadGame, saveGame, serialize } from "../src/save/save";
import { runPostseason } from "../src/season/postseason";
import { Season } from "../src/season/season";

// One full big-league season, then the whole winter.
const league = generateLeague({ seed: "offseason-test" });
const season = new Season(league, { minors: false });
season.simToEnd();
runPostseason(season);
const year = league.year;
const sample = league.players.find((p) => p.teamId !== null && p.age === 24)!;
const sampleAge = sample.age;
const state = beginOffseason(league, season);

describe("the offseason", () => {
  it("closes the books: careers, awards and history", () => {
    expect(league.history).toHaveLength(1);
    const h = league.history[0]!;
    expect(h.year).toBe(year);
    expect(h.champion).toBe(season.postseason!.champion);
    expect(h.awards.map((a) => a.name).sort()).toEqual(["Cy Young", "Cy Young", "MVP", "MVP", "Rookie of the Year", "Rookie of the Year"]);
    const regular = league.players.find((p) => p.career.some((c) => c.year === year && (c.bat?.PA ?? 0) > 500))!;
    expect(regular).toBeDefined();
  });

  it("ages and develops every player, and keeps the grade scale centered", () => {
    expect(sample.age).toBe(sampleAge + 1);
    for (const shift of Object.values(state.shift)) expect(Math.abs(shift)).toBeLessThan(3);
    expect(state.development.risers.length).toBeGreaterThan(0);
  });

  it("sets up arbitration and free agency", () => {
    expect(state.tenders.length).toBeGreaterThan(50);
    expect(state.expiring.length).toBeGreaterThan(20);
    for (const t of state.tenders) expect(t.salary).toBeGreaterThan(0.5);
  });

  it("runs the draft in reverse order of the standings", () => {
    advanceOffseason(league, season); // review -> tenders
    advanceOffseason(league, season); // tenders -> draft
    const d = league.offseason!.draft!;
    const worst = [...season.records].sort((a, b) => a.w - b.w)[0]!;
    expect(onTheClock(d)!.teamId).toBe(d.order[0]);
    expect(season.records[d.order[0]!]!.w).toBeLessThanOrEqual(worst.w + 1);
    for (const id of state.expiring) expect(league.freeAgents).toContain(id);
  });

  it("resumes the winter exactly from a save", () => {
    advanceOffseason(league, season); // draft -> free agency
    winterWeek(league, season);
    const text = serialize(saveGame(league, season));
    const copy = loadGame(deserialize(text));
    for (let i = 0; i < 3; i++) {
      winterWeek(league, season);
      winterWeek(copy.league, copy.season!);
    }
    expect(copy.league.offseason!.freeAgency!.signings).toEqual(league.offseason!.freeAgency!.signings);
    expect(copy.league.transactions.length).toBe(league.transactions.length);
  });

  it("signs free agents and international amateurs, then sets every club for Opening Day", () => {
    advanceOffseason(league, season); // free agency -> international
    expect(league.offseason!.freeAgency!.signings.length).toBeGreaterThan(20);
    advanceOffseason(league, season); // international -> spring
    expect(league.offseason!.international!.signings.length).toBeGreaterThan(60);
    const ctx = winterContext(league, "spring");
    for (const t of league.teams) {
      expect(rosterProblems(ctx, t)).toEqual([]);
      expect(t.rosters.MLB).toHaveLength(26);
      const seen = new Set<number>();
      for (const level of LEVELS) {
        for (const id of t.rosters[level]) {
          expect(seen.has(id)).toBe(false);
          seen.add(id);
          const p = league.players[id]!;
          expect(p.teamId).toBe(t.id);
          expect(p.retired).toBeUndefined();
          expect(p.contract).not.toBeNull();
          if (p.onFortyMan) expect(p.contract!.type).not.toBe("minor");
        }
      }
      expect(payroll(league, t)).toBeGreaterThan(40);
    }
  });

  it("starts the next season", () => {
    const next = advanceOffseason(league, season)!;
    expect(next).toBeInstanceOf(Season);
    expect(league.year).toBe(year + 1);
    expect(league.offseason).toBeNull();
    next.simDays(5);
    expect(next.games.length).toBeGreaterThan(50);
  });
});

describe("trades", () => {
  const l = generateLeague({ seed: "trade-test" });
  const [a, b] = [l.teams[0]!, l.teams[1]!];
  const best = (t: typeof a) => orgPlayers(l, t).sort((x, y) => surplusValue(y) - surplusValue(x));

  it("values cheap young stars far above expensive veterans", () => {
    const young = orgPlayers(l, a).filter((p) => p.contract?.type === "pre-arb" && p.level === "MLB");
    const paid = orgPlayers(l, a).filter((p) => p.contract?.type === "guaranteed");
    const top = Math.max(...young.map((p) => surplusValue(p)));
    const vet = Math.min(...paid.map((p) => surplusValue(p)));
    expect(top).toBeGreaterThan(vet + 20);
  });

  it("turns down lopsided offers and accepts overpays", () => {
    const theirStar = best(b)[0]!;
    const myScrub = best(a).at(-1)!;
    expect(evaluateTrade(l, a, b, [myScrub.id], [theirStar.id]).ok).toBe(false);
    const myStar = best(a)[0]!;
    const theirScrub = best(b).filter((p) => !p.onFortyMan).at(-1)!;
    expect(evaluateTrade(l, a, b, [myStar.id], [theirScrub.id]).ok).toBe(true);
  });

  it("moves players between organizations and logs the deal", () => {
    const give = best(a).filter((p) => !p.onFortyMan)[0]!;
    const get = best(b).filter((p) => !p.onFortyMan)[0]!;
    executeTrade({ league: l, day: 10, expanded: false }, a, b, [give.id], [get.id]);
    expect(give.teamId).toBe(b.id);
    expect(get.teamId).toBe(a.id);
    expect(LEVELS.some((lv) => b.rosters[lv].includes(give.id))).toBe(true);
    expect(l.transactions.filter((t) => t.type === "trade")).toHaveLength(2);
  });
});

describe("old saves", () => {
  it("load with contracts assigned", () => {
    const l = generateLeague({ seed: "migrate-test" });
    const save = saveGame(l, null);
    const old = JSON.parse(serialize(save));
    old.version = 1;
    delete old.league.history;
    delete old.league.freeAgents;
    for (const p of old.league.players) {
      delete p.contract;
      delete p.career;
      delete p.awards;
    }
    for (const t of old.league.teams) delete t.budget;
    const { league: migrated } = loadGame(old);
    expect(migrated.history).toEqual([]);
    const regular = migrated.players.find((p) => p.onFortyMan)!;
    expect(regular.contract).not.toBeNull();
    expect(migrated.teams[0]!.budget).toBeGreaterThan(80);
  });
});
