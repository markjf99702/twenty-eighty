import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import { ELECT_AT, holdHallVote } from "../src/offseason/hall";
import { SERVICE_DAYS_PER_YEAR } from "../src/players/types";
import { deserialize, loadGame, saveGame, serialize } from "../src/save/save";
import { careerTotals } from "../src/stats/career";
import { careerRecords, SEASON_STATS, seasonRecords } from "../src/stats/records";

const league = generateLeague({ seed: "records-test" });

describe("the league's past", () => {
  it("gives veterans the careers their service time implies", () => {
    const vets = league.players.filter((p) => p.service >= 5 * SERVICE_DAYS_PER_YEAR);
    expect(vets.length).toBeGreaterThan(100);
    for (const p of vets) {
      expect(p.prior).toBeDefined();
      expect(p.prior!.seasons).toBe(Math.ceil(p.service / SERVICE_DAYS_PER_YEAR - 1e-9));
      expect(p.prior!.from + p.prior!.seasons - 1).toBe(league.year - 1);
      const line = p.pitching ? p.prior!.pit! : p.prior!.bat!;
      expect(line.G).toBeGreaterThan(0);
    }
    for (const p of league.players.filter((x) => x.service === 0)) expect(p.prior).toBeUndefined();
    // Plausible, not superhuman: a few 400-homer veterans at most.
    const big = league.players.filter((p) => (p.prior?.bat?.HR ?? 0) >= 400);
    expect(big.length).toBeLessThan(8);
    const hitters = league.players.filter((p) => p.prior?.bat && p.prior.bat.PA >= 3000);
    for (const p of hitters) {
      const avg = p.prior!.bat!.H / p.prior!.bat!.AB;
      expect(avg).toBeGreaterThan(0.175);
      expect(avg).toBeLessThan(0.34);
    }
  });

  it("has legends who hold every record and fill the Hall of Fame", () => {
    expect(league.legends.length).toBe(24);
    expect(league.hall.members.length).toBe(24);
    for (const stat of SEASON_STATS) {
      const holders = league.legends.filter((l) => l.records.some((r) => r.stat === stat));
      expect(holders.length).toBe(1);
      expect(seasonRecords(league, stat, { limit: 1 })[0]!.legendId).toBe(holders[0]!.id);
    }
    const hr = careerRecords(league, "HR", { limit: 5 });
    expect(hr[0]!.legendId).not.toBeNull();
    // Active veterans' careers from before the first season count too.
    const top = careerRecords(league, "H", { limit: 200 }).find((r) => r.playerId !== null)!;
    expect(careerTotals(league.players[top.playerId!]!).bat!.H).toBe(top.value);
  });

  it("is the same history every time for a seed", () => {
    const again = generateLeague({ seed: "records-test" });
    expect(again.legends).toEqual(league.legends);
    expect(again.players.map((p) => p.prior)).toEqual(league.players.map((p) => p.prior));
  });
});

describe("the Hall of Fame vote", () => {
  it("elects a great career, passes on an ordinary one, and remembers the ballot", () => {
    const l = generateLeague({ seed: "hall-test" });
    const [great, fine] = l.players.filter((p) => p.prior?.bat && p.prior.seasons >= 10);
    expect(great && fine).toBeTruthy();
    for (const p of [great!, fine!]) p.retired = l.year - 2;
    great!.prior!.bat = { ...great!.prior!.bat!, WAR: 90, HR: 610, H: 3100 };
    fine!.prior!.bat = { ...fine!.prior!.bat!, WAR: 12 };
    const elected = holdHallVote(l, new Rng("vote"));
    expect(elected).toContain(great!.id);
    expect(elected).not.toContain(fine!.id);
    const ballot = l.hall.ballots.at(-1)!;
    expect(ballot.entries.find((e) => e.playerId === great!.id)!.vote).toBeGreaterThanOrEqual(ELECT_AT);
    expect(ballot.entries.some((e) => e.playerId === fine!.id)).toBe(false);
    expect(great!.awards).toContain(`${l.year} Hall of Fame`);
    // Once in, never on a ballot again.
    l.year++;
    holdHallVote(l, new Rng("vote2"));
    expect(l.hall.ballots.some((b) => b.year === l.year && b.entries.some((e) => e.playerId === great!.id))).toBe(false);
  });
});

describe("older saves", () => {
  it("get a past when they're loaded", () => {
    const l = generateLeague({ seed: "old-save" });
    const expected = l.legends;
    const save = saveGame(l, null);
    const old = save.league as unknown as Record<string, unknown>;
    delete old.legends;
    delete old.hall;
    delete old.moments;
    for (const p of save.league.players) delete p.prior;
    save.version = 6;
    const { league: loaded } = loadGame(deserialize(serialize(save)));
    expect(loaded.legends).toEqual(expected);
    expect(loaded.hall.members.length).toBe(24);
    expect(loaded.moments).toEqual([]);
    expect(loaded.players.filter((p) => p.prior).length).toBeGreaterThan(100);
  });
});
