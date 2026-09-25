import { describe, expect, it } from "vitest";
import { generateLeague } from "../src/league/generate";
import { orgPlayers } from "../src/org/contracts";
import { answerOffer } from "../src/org/offers";
import { addToFortyMan, canOption, FORTY_MAN_LIMIT, type RosterContext } from "../src/org/roster";
import { evaluateTrade, executeTrade, makeRoom, roomMoveProblem, rostersAfter, surplusValue } from "../src/org/trades";

// The user's club with a full 40-man, trading a prospect who isn't on it for a
// big leaguer who is: the deal only works if someone comes off.
const league = generateLeague({ seed: "trade-room" });
const [me, them] = [league.teams[0]!, league.teams[1]!];
league.userTeamId = me.id;
const ctx: RosterContext = { league, day: 40, expanded: false };
for (const p of orgPlayers(league, me).filter((q) => !q.onFortyMan && q.level === "AAA")) {
  if (me.fortyMan.length >= FORTY_MAN_LIMIT) break;
  addToFortyMan(ctx, me, p);
}
const prospect = orgPlayers(league, me)
  .filter((p) => !p.onFortyMan)
  .sort((a, b) => surplusValue(b) - surplusValue(a))[0]!;
const vet = orgPlayers(league, them)
  .filter((p) => p.onFortyMan && them.rosters.MLB.includes(p.id) && surplusValue(p) < surplusValue(prospect) / 1.2 - 1)
  .sort((a, b) => surplusValue(b) - surplusValue(a))[0]!;
const fortyMen = () => me.fortyMan.map((id) => league.players[id]!).filter((p) => !p.il);
const cut = fortyMen().sort((a, b) => surplusValue(a) - surplusValue(b))[0]!;
const sendDown = fortyMen().find((p) => p.id !== cut.id && canOption(ctx, me, p).ok)!;

describe("making room in a trade", () => {
  it("sets up a full 40-man and a deal the other club likes", () => {
    expect(me.fortyMan.length).toBe(FORTY_MAN_LIMIT);
    expect(prospect).toBeDefined();
    expect(vet).toBeDefined();
    expect(sendDown).toBeDefined();
  });

  it("holds the deal up only for the 40-man, and says by how much", () => {
    const check = evaluateTrade(league, me, them, [prospect.id], [vet.id]);
    expect(check.ok).toBe(false);
    expect(check.over).toBe(1);
    expect(check.reason).toContain("41");
    expect(rostersAfter(league, me, [prospect.id], [vet.id])).toEqual({ fortyMan: 41, active: me.rosters.MLB.length + 1 });
  });

  it("goes through with a player designated along with it", () => {
    const moves = [{ playerId: cut.id, move: "dfa" as const }];
    expect(roomMoveProblem(ctx, me, [prospect.id], moves)).toBeNull();
    expect(evaluateTrade(league, me, them, [prospect.id], [vet.id], 1, () => 0, moves)).toMatchObject({ ok: true });
    const opt = [...moves, { playerId: sendDown.id, move: "option" as const }];
    const active = me.rosters.MLB.length + 1 - [cut.id, sendDown.id].filter((id) => me.rosters.MLB.includes(id)).length;
    expect(rostersAfter(league, me, [prospect.id], [vet.id], opt)).toEqual({ fortyMan: FORTY_MAN_LIMIT, active });
  });

  it("refuses moves that don't make sense", () => {
    const farmhand = orgPlayers(league, me).find((p) => !p.onFortyMan && p.id !== prospect.id)!;
    expect(roomMoveProblem(ctx, me, [prospect.id], [{ playerId: prospect.id, move: "dfa" }])).toContain("in the deal");
    expect(roomMoveProblem(ctx, me, [], [{ playerId: farmhand.id, move: "dfa" }])).toContain("40-man");
    expect(roomMoveProblem(ctx, me, [], [{ playerId: farmhand.id, move: "option" }])).not.toBeNull();
    expect(roomMoveProblem(ctx, me, [], [{ playerId: vet.id, move: "dfa" }])).toContain("your own players");
    const twice = [
      { playerId: cut.id, move: "dfa" as const },
      { playerId: cut.id, move: "dfa" as const },
    ];
    expect(roomMoveProblem(ctx, me, [], twice)).toContain("one move");
  });

  it("keeps an offer open when only room is short", () => {
    league.tradeOffers.push({
      id: 1,
      teamId: them.id,
      give: [prospect.id],
      get: [vet.id],
      kind: "sell",
      pitch: "A veteran for a prospect.",
      year: league.year,
      made: 38,
      expires: 45,
      status: "open",
    });
    const res = answerOffer(ctx, 1, true, 40, 1, () => 0);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("Adjust");
    expect(league.tradeOffers[0]!.status).toBe("open");
    expect(vet.teamId).toBe(them.id);
  });

  it("makes the trade and then the moves", () => {
    const moves = [
      { playerId: cut.id, move: "dfa" as const },
      { playerId: sendDown.id, move: "option" as const },
    ];
    const expected = rostersAfter(league, me, [prospect.id], [vet.id], moves);
    executeTrade(ctx, me, them, [prospect.id], [vet.id]);
    const notes = makeRoom(ctx, me, moves, league.teams);
    expect(vet.teamId).toBe(me.id);
    expect(me.fortyMan.length).toBe(FORTY_MAN_LIMIT);
    expect(me.fortyMan).not.toContain(cut.id);
    expect(cut.onFortyMan).toBe(cut.teamId !== me.id);
    expect(sendDown.level).toBe("AAA");
    expect(me.rosters.MLB.length).toBe(expected.active);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/claimed|outrighted/);
    expect(notes[1]).toContain("optioned to AAA");
  });
});
