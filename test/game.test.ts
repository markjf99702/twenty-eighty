import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import { Season } from "../src/season/season";
import { simulateGame, type GameResult } from "../src/sim/game";

const league = generateLeague({ seed: "test-games" });
const season = new Season(league);

function play(n: number): GameResult[] {
  const rng = new Rng("games");
  const results: GameResult[] = [];
  for (let i = 0; i < n; i++) {
    const away = league.teams[(2 * i) % 30]!;
    const home = league.teams[(2 * i + 1) % 30]!;
    const r = simulateGame(season.env, season.gameSetup(away, rng, i), season.gameSetup(home, rng, i), rng);
    season.staff.record(r.pitchCounts, i);
    results.push(r);
  }
  return results;
}

const results = play(150);

describe("a simulated game", () => {
  it("never ends in a tie and lasts at least nine innings", () => {
    for (const r of results) {
      expect(r.score[0]).not.toBe(r.score[1]);
      expect(r.innings).toBeGreaterThanOrEqual(9);
    }
  });

  it("keeps the line score, box score and final score consistent", () => {
    for (const r of results) {
      [0, 1].forEach((side) => {
        const lineRuns = r.lineScore[side]!.reduce((s, x) => s + x, 0);
        expect(lineRuns).toBe(r.score[side]);
        const batterRuns = r.battingOrder[side]!.flat().reduce((s, slot) => s + r.batting.get(slot.id).R, 0);
        expect(batterRuns).toBe(r.score[side]);
        const allowed = r.pitchersUsed[1 - side]!.reduce((s, id) => s + r.pitching.get(id).R, 0);
        expect(allowed).toBe(r.score[side]);
      });
    }
  });

  it("records 27+ outs for the losing side's opponents and never more earned than total runs", () => {
    for (const r of results) {
      const winner = r.score[1] > r.score[0] ? 1 : 0;
      // The winning team's pitchers get at least 27 outs (the loser always bats three outs per inning).
      const winnerOuts = r.pitchersUsed[winner]!.reduce((s, id) => s + r.pitching.get(id).outs, 0);
      expect(winnerOuts).toBeGreaterThanOrEqual(27);
      for (const side of r.pitchersUsed) for (const id of side) {
        const p = r.pitching.get(id);
        expect(p.ER).toBeLessThanOrEqual(p.R);
      }
    }
  });

  it("assigns exactly one win and one loss, to pitchers who appeared", () => {
    for (const r of results) {
      const used = [...r.pitchersUsed[0], ...r.pitchersUsed[1]];
      expect(used).toContain(r.winningPitcher);
      expect(used).toContain(r.losingPitcher);
      const winner = r.score[1] > r.score[0] ? 1 : 0;
      expect(r.pitchersUsed[winner]).toContain(r.winningPitcher);
      expect(r.pitchersUsed[1 - winner]).toContain(r.losingPitcher);
      if (r.savePitcher !== null) {
        expect(r.pitchersUsed[winner]).toContain(r.savePitcher);
        expect(r.savePitcher).not.toBe(r.winningPitcher);
      }
    }
  });

  it("balances plate appearances: every PA ends as an out, a hit, a walk, HBP or reaching on error", () => {
    for (const r of results) {
      for (const lineup of r.battingOrder) {
        for (const slot of lineup.flat()) {
          const b = r.batting.get(slot.id);
          expect(b.PA).toBe(b.AB + b.BB + b.HBP + b.SF);
          expect(b.H).toBe(b["1B"] + b["2B"] + b["3B"] + b.HR);
        }
      }
    }
  });
});
