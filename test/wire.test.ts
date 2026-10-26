import { describe, expect, it } from "vitest";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { positionLabel, releasePlayer } from "../src/org/roster";
import { type Player, playerName } from "../src/players/types";
import { Season } from "../src/season/season";
import { condenseAwards, transactions } from "../web/src/worker/views";

const league = generateLeague({ seed: "wire" });
hireGm(league, 5);
const season = new Season(league, { minors: false });
season.simDays(110);

describe("the wire's headlines", () => {
  const all = transactions(season, { majorOnly: true, limit: 100000 });
  const heads = transactions(season, { headlines: true, limit: 100000 });

  it("are a small share of the big-league moves: news, not shuffles", () => {
    expect(heads.length).toBeGreaterThan(10);
    expect(heads.length).toBeLessThan(all.length / 10);
    const kinds = new Set(heads.map((h) => h.type));
    for (const k of kinds) expect(["trade", "extension", "claim", "sign", "draft", "injury", "call-up", "retire"]).toContain(k);
    expect(kinds.has("option")).toBe(false);
    expect(kinds.has("il-activate")).toBe(false);
  });

  it("carry every trade, and a call-up only the first time", () => {
    expect(heads.filter((h) => h.type === "trade").length).toBe(all.filter((h) => h.type === "trade").length);
    const callUps = heads.filter((h) => h.type === "call-up").map((h) => h.playerId);
    expect(new Set(callUps).size).toBe(callUps.length);
  });

  it("keep injuries to the ones that change a season", () => {
    for (const h of heads.filter((x) => x.type === "injury")) {
      const days = Number(/out about (\d+) day/.exec(h.text)![1]);
      expect(days).toBeGreaterThanOrEqual(21);
    }
  });
});

describe("a club's releases", () => {
  it("file a minor leaguer's with the farm's moves, his level in the text; a big-league or 40-man release stays a big-league move", () => {
    const lg = generateLeague({ seed: "farm-releases" });
    const s = new Season(lg, { minors: false });
    const club = lg.teams[3]!;
    const ctx = { league: lg, day: 30, expanded: false };
    const P = (id: number) => lg.players[id]!;
    const released = (p: Player) => `Released ${positionLabel(p)} ${playerName(p)}`;
    const farmhand = club.rosters.A.map(P).find((p) => !p.onFortyMan)!;
    const optioned = club.rosters.AAA.map(P).find((p) => p.onFortyMan)!;
    const bigLeaguer = club.rosters.MLB.map(P).find((p) => !p.pitching)!;
    for (const p of [farmhand, optioned, bigLeaguer]) expect(releasePlayer(ctx, club, p).ok).toBe(true);

    const releases = (majorOnly: boolean) => transactions(s, { teamId: club.id, majorOnly }).filter((t) => t.type === "release");
    // Everything: all three, the farmhand's with his level, as a farm signing carries it.
    expect(releases(false).map((t) => t.text)).toEqual([released(bigLeaguer), released(optioned), `${released(farmhand)} (A)`]);
    // Big-league moves (My club's list, the front office's "Your moves", the league's wire): not the farmhand's.
    expect(releases(true).map((t) => t.playerId)).toEqual([bigLeaguer.id, optioned.id]);
    expect(transactions(s, { majorOnly: true }).some((t) => t.playerId === farmhand.id)).toBe(false);
    // Never a headline.
    expect(transactions(s, { headlines: true }).some((t) => t.type === "release")).toBe(false);

    // A release logged before releases carried a level keeps its text and stays where it was filed.
    lg.transactions.push({ year: lg.year, day: 31, teamId: club.id, playerId: farmhand.id, type: "release", text: released(farmhand) });
    expect(releases(true)[0]).toMatchObject({ playerId: farmhand.id, text: released(farmhand) });
  });
});

describe("a player's honors", () => {
  it("fold into one line per award, biggest first", () => {
    const awards = ["2026 Federal League All-Star", "2027 Federal League All-Star", "2027 All-Star Game MVP", "2027 Federal League Gold Glove (SS)", "2028 Federal League MVP"];
    expect(condenseAwards(awards)).toEqual([
      "2028 Federal League MVP",
      "2027 All-Star Game MVP",
      "2027 Federal League Gold Glove (SS)",
      "2× Federal League All-Star (2026, 2027)",
    ]);
  });
});
