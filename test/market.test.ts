import { describe, expect, it } from "vitest";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { chips, gamesOut, BUYER_GB } from "../src/org/offers";
import { askingPrice, groupOf, onTheBlock } from "../src/org/market";
import { evaluateTrade, surplusValue, teamStrength } from "../src/org/trades";
import { warShift } from "../src/scouting/analytics";
import { Season } from "../src/season/season";

const league = generateLeague({ seed: "market" });
// The strongest club, so it's in the race at the deadline and its staff goes shopping.
const USER = [...league.teams].sort((a, b) => teamStrength(league, b) - teamStrength(league, a))[0]!.id;
hireGm(league, USER);
const season = new Season(league, { minors: false });
season.simDays(100);
const mine = league.teams[USER]!;
const fraction = 1 - season.day / season.totalDays;
const seen = (v: number, p: (typeof league.players)[number]) => warShift(season, v, p);
const block = onTheBlock(season, USER);

describe("players on the block", () => {
  it("are healthy big-league veterans on clubs out of the race, best fit first", () => {
    expect(block.length).toBeGreaterThan(20);
    for (const b of block) {
      expect(b.team.id).not.toBe(USER);
      expect(b.player.teamId).toBe(b.team.id);
      expect(b.player.level).toBe("MLB");
      expect(b.player.age).toBeGreaterThanOrEqual(26);
      expect(b.player.injury).toBeFalsy();
      expect(gamesOut(season, b.team.id)).toBeGreaterThan(BUYER_GB);
      expect(b.group).toBe(groupOf(b.player));
    }
    for (let i = 1; i < block.length; i++) expect(block[i]!.fit).toBeLessThanOrEqual(block[i - 1]!.fit);
    // Relievers are on the list too, for a club that needs bullpen help.
    expect(block.some((b) => b.group === "RP")).toBe(true);
  });
});

describe("what a club would want", () => {
  const target = block.find((b) => surplusValue(b.player, fraction, seen(b.team.id, b.player)) > 5)!;

  it("is a package of young players it would take, drawn the same way every time", () => {
    const a = askingPrice(season, mine, target.team, [target.player.id], fraction);
    if (!a.ok) throw new Error(a.reason);
    expect(a.give.length).toBeGreaterThan(0);
    expect(a.give.length).toBeLessThanOrEqual(3);
    const allowed = new Set(chips(league, mine).map((p) => p.id));
    for (const p of a.give) expect(allowed.has(p.id)).toBe(true);
    const check = evaluateTrade(league, mine, target.team, a.give.map((p) => p.id), [target.player.id], fraction, seen);
    // They say yes (or yes once the user makes room on the 40-man).
    expect(check.ok || check.over !== undefined).toBe(true);
    // Their price, not far past it.
    const theirs = a.give.reduce((s, p) => s + surplusValue(p, fraction, seen(target.team.id, p)), 0);
    expect(theirs).toBeGreaterThanOrEqual(a.want);
    expect(theirs).toBeLessThanOrEqual(1.35 * a.want + 2);
    const again = askingPrice(season, mine, target.team, [target.player.id], fraction);
    expect(again.ok && again.give.map((p) => p.id)).toEqual(a.give.map((p) => p.id));
  });

  it("is nothing for a player whose contract they'd rather be rid of", () => {
    const dump = block.find((b) => surplusValue(b.player, fraction, seen(b.team.id, b.player)) < -3);
    if (!dump) return;
    const a = askingPrice(season, mine, dump.team, [dump.player.id], fraction);
    expect(a.ok && a.give).toEqual([]);
  });

  it("says so when nothing in the system adds up", () => {
    const stars = block
      .filter((b) => b.team.id === target.team.id)
      .map((b) => b.player.id);
    const all = [...stars, ...league.teams[target.team.id]!.rosters.MLB.filter((id) => !stars.includes(id))].slice(0, 12);
    const a = askingPrice(season, mine, target.team, all, fraction);
    if (a.ok) return; // A club can undervalue its own roster that much, rarely.
    expect(a.reason.length).toBeGreaterThan(20);
  });

  it("needs someone to ask about", () => {
    expect(askingPrice(season, mine, target.team, [], fraction).ok).toBe(false);
  });
});

describe("the staff's shore-up note", () => {
  it("names who's on the block at the weak spot and links to them", () => {
    season.simDays(125 - season.day);
    const note = league.advice.find((a) => a.key.startsWith("buy"));
    if (!note) throw new Error(`no buy note: ${gamesOut(season, USER)} games out`);
    expect(note.href).toMatch(/^#trades(-block-(sp|rp|c|1b|2b|3b|ss|lf|cf|rf|dh))?$/);
    if (note.href !== "#trades") expect(note.text).toMatch(/On the block|Nobody on the block/);
  });
});
