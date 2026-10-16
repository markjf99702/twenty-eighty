import { beforeEach, describe, expect, it } from "vitest";
import { generateLeague } from "../src/league/generate";
import type { League, Team } from "../src/league/types";
import { budgetRoom, payroll } from "../src/org/contracts";
import { slotValue } from "../src/org/depth";
import {
  activateFromIl,
  callUp,
  designateForAssignment,
  optionPlayer,
  placeOnIl,
  positionLabel,
  refreshDepth,
  releasePlayer,
  rosterProblems,
  type RosterContext,
} from "../src/org/roster";
import type { Tender } from "../src/offseason/types";
import { playerValue } from "../src/org/value";
import { FIELD_POSITIONS, type Player, playerName } from "../src/players/types";
import { staffCost } from "../src/scouting/scouting";

let league: League;
let team: Team;
let ctx: RosterContext;
const player = (id: number): Player => league.players[id]!;

beforeEach(() => {
  league = generateLeague({ seed: "roster-rules" });
  team = league.teams[0]!;
  ctx = { league, day: 20, expanded: false };
});

function optionable(): Player {
  return team.rosters.MLB.map(player).find((p) => p.service < 3 * 172 && p.options.used < 3 && !p.pitching)!;
}

function injure(p: Player, days: number): void {
  p.injury = { name: "Hamstring strain", days, daysLeft: days, startDay: ctx.day };
}

describe("roster rules", () => {
  it("starts every club legal", () => {
    for (const t of league.teams) expect(rosterProblems(ctx, t)).toEqual([]);
  });

  it("won't call anyone up to a full active roster", () => {
    const prospect = team.rosters.AAA.map(player).find((p) => p.onFortyMan)!;
    const result = callUp(ctx, team, prospect);
    expect(result.ok).toBe(false);
  });

  it("options a player, burning one option year, and enforces the minimum stay", () => {
    const p = optionable();
    const before = p.options.used;
    expect(optionPlayer(ctx, team, p).ok).toBe(true);
    expect(p.level).toBe("AAA");
    expect(p.options.used).toBe(before + 1);
    expect(team.rosters.MLB).toHaveLength(25);

    // Can't bring him straight back...
    expect(callUp({ ...ctx, day: ctx.day + 3 }, team, p).ok).toBe(false);
    // ...unless he's replacing an injured player, or ten days have passed.
    expect(callUp({ ...ctx, day: ctx.day + 3 }, team, p, true).ok).toBe(true);
  });

  it("uses only one option year per season no matter how often he's sent down", () => {
    const p = optionable();
    const before = p.options.used;
    optionPlayer(ctx, team, p);
    callUp({ ...ctx, day: ctx.day + 12 }, team, p);
    optionPlayer({ ...ctx, day: ctx.day + 13 }, team, p);
    expect(p.options.used).toBe(before + 1);
  });

  it("refuses to option veterans with five years of service", () => {
    const vet = team.rosters.MLB.map(player).find((p) => p.service >= 5 * 172)!;
    expect(optionPlayer(ctx, team, vet).ok).toBe(false);
  });

  it("selects a non-40-man player's contract, using a 40-man spot", () => {
    optionPlayer(ctx, team, optionable());
    const dfaTarget = team.fortyMan.map(player).find((p) => p.level === "AAA")!;
    designateForAssignment(ctx, team, dfaTarget);
    const minorLeaguer = team.rosters.AAA.map(player).find((p) => !p.onFortyMan && !p.injury)!;
    expect(callUp(ctx, team, minorLeaguer, true).ok).toBe(true);
    expect(minorLeaguer.onFortyMan).toBe(true);
    expect(team.fortyMan).toContain(minorLeaguer.id);
    expect(rosterProblems(ctx, team)).toEqual([]);
  });

  it("moves injured players to the IL and back, with the 60-day list freeing a 40-man spot", () => {
    const hurt = team.rosters.MLB.map(player)[0]!;
    injure(hurt, 80);
    expect(placeOnIl(ctx, team, hurt).ok).toBe(true);
    expect(hurt.il).toBe("IL60");
    expect(team.fortyMan).not.toContain(hurt.id);
    expect(team.rosters.MLB).not.toContain(hurt.id);

    // Too early to activate, and still hurt.
    expect(activateFromIl({ ...ctx, day: ctx.day + 30 }, team, hurt).ok).toBe(false);
    hurt.injury = null;
    const later = { ...ctx, day: ctx.day + 61 };
    expect(activateFromIl(later, team, hurt).ok).toBe(true);
    expect(team.rosters.MLB).toContain(hurt.id);
    expect(team.fortyMan).toContain(hurt.id);
  });

  it("sends an unclaimed DFA to AAA off the 40-man", () => {
    const fringe = team.fortyMan.map(player).find((p) => p.level === "AAA")!;
    designateForAssignment(ctx, team, fringe, []);
    expect(fringe.onFortyMan).toBe(false);
    expect(fringe.level).toBe("AAA");
    expect(team.fortyMan).toHaveLength(39);
  });

  it("keeps an arbitration salary on the books through an outright and back", () => {
    // Every 40-man is full on a new league, so nobody can claim him.
    expect(league.teams.every((t) => t.fortyMan.length >= 40)).toBe(true);
    const arb = team.rosters.MLB.map(player)
      .filter((p) => p.contract?.type === "arb")
      .sort((a, b) => b.contract!.salary - a.contract!.salary)[0]!;
    const salary = arb.contract!.salary;
    expect(salary).toBeGreaterThan(2);
    const before = payroll(league, team);
    expect(designateForAssignment(ctx, team, arb, league.teams).ok).toBe(true);
    expect(arb.teamId).toBe(team.id);
    expect(arb.level).toBe("AAA");
    expect(arb.contract).toMatchObject({ type: "arb", salary });
    expect(payroll(league, team)).toBe(before);
    // Selected back, he's paid what he was.
    expect(callUp(ctx, team, arb).ok).toBe(true);
    expect(arb.contract).toMatchObject({ type: "arb", salary });
    expect(payroll(league, team)).toBe(before);
  });

  it("owes the rest of an arbitration salary on a release, as on an outright", () => {
    const arb = team.rosters.MLB.map(player)
      .filter((p) => p.contract?.type === "arb")
      .sort((a, b) => b.contract!.salary - a.contract!.salary)[0]!;
    const salary = arb.contract!.salary;
    const before = payroll(league, team);
    expect(releasePlayer(ctx, team, arb).ok).toBe(true);
    expect(arb.teamId).toBeNull();
    expect(team.deadMoney).toContainEqual({ playerId: arb.id, amount: salary, years: 1 });
    // Released or outrighted, his salary stays on the payroll.
    expect(payroll(league, team)).toBe(before);
  });

  it("owes nothing on a release before the tender deadline for a case or a veteran whose deal is up", () => {
    const [pending, leaving] = team.rosters.MLB.map(player).filter((p) => !p.pitching);
    pending!.contract = { type: "arb", salary: 3.2, years: 1 };
    leaving!.contract = { type: "guaranteed", salary: 12, years: 1 };
    const tender: Tender = { playerId: pending!.id, teamId: team.id, salary: 5.4, tender: true };
    league.offseason = {
      year: league.year,
      phase: "tenders",
      development: { risers: [], fallers: [], retirements: [] },
      shift: {},
      tenders: [tender],
      expiring: [leaving!.id],
      draft: null,
      freeAgency: null,
      international: null,
    };
    expect(releasePlayer(ctx, team, pending!).ok).toBe(true);
    expect(releasePlayer(ctx, team, leaving!).ok).toBe(true);
    expect(team.deadMoney).toEqual([]);
  });

  it("turns a pre-arbitration deal into a minor league one on an outright", () => {
    const young = team.fortyMan.map(player).find((p) => p.contract?.type === "pre-arb" && p.level !== "MLB")!;
    designateForAssignment(ctx, team, young, []);
    expect(young.contract?.type).toBe("minor");
  });

  it("lets a club claim a player off waivers only if it can afford his contract", () => {
    // A good big leaguer on a big guaranteed deal, and two clubs with a 40-man spot open.
    const vet = team.rosters.MLB.map(player).reduce((a, b) => (playerValue(b) > playerValue(a) ? b : a));
    vet.contract = { type: "guaranteed", salary: 12, years: 3, signed: league.year - 1, total: 48 };
    const [broke, flush] = [league.teams[1]!, league.teams[2]!];
    for (const club of [broke, flush]) {
      const spare = club.fortyMan.map(player).find((p) => p.level !== "MLB" && !p.il)!;
      designateForAssignment(ctx, club, spare, []);
    }
    broke.budget = payroll(league, broke) + staffCost(league, broke) - 1;
    flush.budget = payroll(league, flush) + staffCost(league, flush) + 30;
    expect(budgetRoom(league, broke)).toBeLessThan(0);
    designateForAssignment(ctx, team, vet, [broke, flush]);
    expect(vet.teamId).toBe(flush.id);
    expect(league.transactions.at(-1)?.text).toMatch(/^Claimed/);
  });

  it("claims for your club only while your assistant GM runs the roster", () => {
    // Your club has a 40-man spot open, room in its budget, and the first claim.
    const yours = league.teams[1]!;
    league.userTeamId = yours.id;
    const spare = yours.fortyMan.map(player).find((p) => p.level !== "MLB" && !p.il)!;
    designateForAssignment(ctx, yours, spare, []);
    yours.budget = payroll(league, yours) + staffCost(league, yours) + 30;
    const [best, next, third] = team.rosters.MLB.map(player).sort((a, b) => playerValue(b) - playerValue(a));

    // Running the roster yourself: nobody claims him for you.
    yours.manualRoster = true;
    designateForAssignment(ctx, team, best!, [yours]);
    expect(best!.teamId).toBe(team.id);
    expect(yours.fortyMan).toHaveLength(39);

    // With the assistant on, he claims, and says so.
    yours.manualRoster = false;
    designateForAssignment(ctx, team, next!, [yours]);
    expect(next!.teamId).toBe(yours.id);
    expect(league.transactions.filter((t) => t.teamId === yours.id).at(-1)?.text).toMatch(/^Your assistant GM claimed .+ off waivers from /);

    // And only if the salary fits the budget.
    third!.contract = { type: "guaranteed", salary: 12, years: 3, signed: league.year - 1, total: 48 };
    const room = yours.fortyMan.map(player).find((p) => p.level !== "MLB" && !p.il && p.id !== next!.id)!;
    designateForAssignment(ctx, yours, room, []);
    yours.budget = payroll(league, yours) + staffCost(league, yours) - 1;
    designateForAssignment(ctx, team, third!, [yours]);
    expect(third!.teamId).toBe(team.id);
  });

  it("tells your moves who claimed the player you designated", () => {
    league.userTeamId = team.id;
    const claimer = league.teams[2]!;
    const spare = claimer.fortyMan.map(player).find((p) => p.level !== "MLB" && !p.il)!;
    designateForAssignment(ctx, claimer, spare, []);
    claimer.budget = payroll(league, claimer) + staffCost(league, claimer) + 30;
    const best = team.rosters.MLB.map(player).reduce((a, b) => (playerValue(b) > playerValue(a) ? b : a));
    designateForAssignment(ctx, team, best, [claimer]);
    expect(best.teamId).toBe(claimer.id);
    const mine = league.transactions.filter((t) => t.teamId === team.id).at(-1)!;
    expect(mine.text).toBe(`Designated ${positionLabel(best)} ${playerName(best)} for assignment; claimed off waivers by ${claimer.abbrev}`);
  });

  it("logs every move", () => {
    optionPlayer(ctx, team, optionable());
    expect(league.transactions.at(-1)?.text).toMatch(/^Optioned/);
  });

  it("patches a hand-set depth chart without playing anyone twice", () => {
    league.userTeamId = team.id;
    team.manualDepth = true;
    // Move the manager's first baseman to DH, then lose the new first baseman.
    const d = team.depth;
    const first = d.starters["1B"];
    const newFirst = d.dh;
    d.dh = first;
    d.starters["1B"] = newFirst;
    expect(optionPlayer(ctx, team, player(newFirst)).ok || designateForAssignment(ctx, team, player(newFirst)).ok).toBe(true);

    const lineup = [...FIELD_POSITIONS.map((pos) => team.depth.starters[pos]), team.depth.dh];
    expect(new Set(lineup).size).toBe(9);
    expect(team.depth.dh).toBe(first);
    const active = new Set(team.rosters.MLB);
    for (const id of [...lineup, ...team.depth.bench, ...team.depth.rotation, ...team.depth.bullpen]) expect(active.has(id)).toBe(true);
    const all = [...lineup, ...team.depth.bench, ...team.depth.rotation, ...team.depth.bullpen];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(team.rosters.MLB.length);

    // Refreshing again changes nothing.
    const before = JSON.stringify(team.depth);
    refreshDepth(league, team);
    expect(JSON.stringify(team.depth)).toBe(before);
  });

  it("fills a hole in a hand-set lineup with a player who plays the position", () => {
    // Every club: start the backup catcher, then lose the center fielder.
    let checked = 0;
    for (const club of league.teams) {
      league.userTeamId = club.id;
      club.manualDepth = true;
      const d = club.depth;
      const regular = d.starters.C;
      const backup = d.bench.find((id) => player(id).positions.includes("C"));
      if (backup === undefined) continue;
      d.starters.C = backup;
      d.bench = d.bench.map((id) => (id === backup ? regular : id));
      const kept = { ...d.starters, DH: d.dh };
      const free = d.bench.map(player);
      const centerFielders = free.filter((p) => p.positions.includes("CF"));
      const cf = player(d.starters.CF);
      injure(cf, 30);
      expect(placeOnIl(ctx, club, cf).ok).toBe(true);

      // The rest of the user's lineup stands.
      for (const pos of FIELD_POSITIONS) if (pos !== "CF") expect(club.depth.starters[pos]).toBe(kept[pos]);
      expect(club.depth.dh).toBe(kept.DH);
      if (centerFielders.length === 0) continue;
      // A center fielder from the bench takes over (the best of them by the manager's measure), not the catcher on the bench.
      const best = centerFielders.reduce((a, b) => (slotValue(b, "CF") > slotValue(a, "CF") ? b : a));
      expect(club.depth.starters.CF).toBe(best.id);
      expect(club.depth.bench).toContain(regular);
      checked++;
    }
    expect(checked).toBeGreaterThan(15);
  });
});
