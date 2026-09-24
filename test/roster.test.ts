import { beforeEach, describe, expect, it } from "vitest";
import { generateLeague } from "../src/league/generate";
import type { League, Team } from "../src/league/types";
import {
  activateFromIl,
  callUp,
  designateForAssignment,
  optionPlayer,
  placeOnIl,
  rosterProblems,
  type RosterContext,
} from "../src/org/roster";
import type { Player } from "../src/players/types";

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

  it("logs every move", () => {
    optionPlayer(ctx, team, optionable());
    expect(league.transactions.at(-1)?.text).toMatch(/^Optioned/);
  });
});
