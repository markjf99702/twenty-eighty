import { beforeAll, describe, expect, it } from "vitest";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { answerOffer, offerLive, RECENTLY_ASKED, refreshOffers } from "../src/org/offers";
import { rosterProblems } from "../src/org/roster";
import { TRADE_DEADLINE_DAY } from "../src/org/trades";
import { warShift } from "../src/scouting/analytics";
import { deserialize, loadGame, saveGame, serialize } from "../src/save/save";
import { Season } from "../src/season/season";

const USER = 5;
const league = generateLeague({ seed: "trade-season" });
hireGm(league, USER);
const season = new Season(league, { minors: false });
const seen = (viewer: number, p: (typeof league.players)[number]) => warShift(season, viewer, p);
const fraction = () => Math.max(0, 1 - season.day / season.totalDays);

// Play until a club makes the user an offer.
while (!league.tradeOffers.some((o) => o.status === "open") && season.day < TRADE_DEADLINE_DAY) season.simDay();
const first = league.tradeOffers.find((o) => o.status === "open")!;
const midSave = serialize(saveGame(league, season));

describe("trade offers", () => {
  it("come from other clubs, for the user's players and theirs", () => {
    expect(first).toBeDefined();
    expect(first.teamId).not.toBe(USER);
    expect(first.give.length).toBeGreaterThan(0);
    expect(first.get.length).toBeGreaterThan(0);
    for (const id of first.give) expect(league.players[id]!.teamId).toBe(USER);
    for (const id of first.get) expect(league.players[id]!.teamId).toBe(first.teamId);
    expect(first.pitch.length).toBeGreaterThan(20);
    expect(offerLive(league, first, season.day)).toBe(true);
  });

  it("save and resume with the league", () => {
    const back = loadGame(deserialize(midSave)).league;
    expect(back.tradeOffers).toEqual(league.tradeOffers);
    const old = JSON.parse(midSave);
    old.version = 4;
    delete old.league.tradeOffers;
    expect(loadGame(old).league.tradeOffers).toEqual([]);
  });

  it("expire after a few days", () => {
    const copy = loadGame(deserialize(midSave));
    const s = copy.season!;
    const o = copy.league.tradeOffers.find((x) => x.id === first.id)!;
    s.simDays(o.expires - s.day + 1);
    refreshOffers(copy.league, s.day);
    expect(o.status).toBe("expired");
    const res = answerOffer(s.rosterContext(), o.id, true, s.day, 0.5, () => 0);
    expect(res.ok).toBe(false);
  });

  it("make the trade when accepted", () => {
    const res = answerOffer(season.rosterContext(), first.id, true, season.day, fraction(), seen);
    expect(res).toEqual({ ok: true });
    expect(first.status).toBe("accepted");
    for (const id of first.give) expect(league.players[id]!.teamId).toBe(first.teamId);
    for (const id of first.get) expect(league.players[id]!.teamId).toBe(USER);
    expect(league.transactions.filter((t) => t.type === "trade" && t.day === season.day).length).toBe(first.give.length + first.get.length);
    // Answering twice doesn't trade twice.
    expect(answerOffer(season.rosterContext(), first.id, true, season.day, fraction(), seen).ok).toBe(false);
  });
});

describe("the trade market", () => {
  // Play through the deadline and a little past it (after the offer tests above).
  beforeAll(() => {
    while (season.day < TRADE_DEADLINE_DAY + 14) season.simDay();
  });
  const trades = () => league.transactions.filter((t) => t.type === "trade" && t.year === league.year);

  it("has AI clubs dealing with each other up to the deadline, and not after", () => {
    const between = trades().filter((t) => t.teamId !== USER && league.players[t.playerId]!.teamId !== USER);
    expect(between.length).toBeGreaterThanOrEqual(6);
    for (const t of trades()) expect(t.day).toBeLessThanOrEqual(TRADE_DEADLINE_DAY);
  });

  it("leaves every AI club's roster legal", () => {
    const ctx = season.rosterContext();
    for (const t of league.teams) if (t.id !== USER) expect(rosterProblems(ctx, t)).toEqual([]);
  });

  it("spreads clubs' interest around the user's roster", () => {
    const offers = league.tradeOffers;
    expect(offers.length).toBeGreaterThanOrEqual(2);
    for (const a of offers) {
      for (const b of offers) {
        if (a === b || Math.abs(a.made - b.made) >= RECENTLY_ASKED) continue;
        const shared = [...a.give, ...a.get].filter((id) => b.give.includes(id) || b.get.includes(id));
        expect(shared).toEqual([]);
      }
    }
  });

  it("stops making offers once the deadline passes", () => {
    for (const o of league.tradeOffers) expect(o.made).toBeLessThan(TRADE_DEADLINE_DAY);
    expect(refreshOffers(league, season.day)).toEqual([]);
  });
});
