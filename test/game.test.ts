import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import { Season } from "../src/season/season";
import { StaffTracker } from "../src/season/staff";
import { freshestNearMiddle, relieverComesOut, simulateGame, starterComesOut, type GameResult } from "../src/sim/game";

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

describe("a starter with a no-hitter going", () => {
  // Through eight innings at 105 pitches, five past his limit.
  const outing = { pitches: 105, limit: 100, runs: 0, battersFaced: 25 };

  it("starts the 9th, where two hits allowed would have ended his night", () => {
    expect(starterComesOut(outing, 9, true, 0, 1, 0)).toBe(false);
    expect(starterComesOut(outing, 9, true, 0, 1, 2)).toBe(true);
  });

  it("finishes an inning he starts, and comes out once he's well past his limit", () => {
    expect(starterComesOut({ ...outing, pitches: 138 }, 9, false, 2, 1, 0)).toBe(false);
    expect(starterComesOut({ ...outing, pitches: 125 }, 9, true, 0, 1, 0)).toBe(true);
    expect(starterComesOut({ ...outing, pitches: 135, limit: 118 }, 9, true, 0, 1, 0)).toBe(true);
    // Before the 6th the usual hooks apply.
    expect(starterComesOut(outing, 5, true, 0, 1, 0)).toBe(true);
  });

  it("finishes most no-hitters himself", () => {
    const l = generateLeague({ seed: "no-hit-bids" });
    const s = new Season(l);
    // The weakest lineup there could be: the other side's starter is often hitless deep into the game.
    const weak = l.teams[1]!;
    for (const id of weak.rosters.MLB) {
      const p = l.players[id]!;
      if (!p.pitching) for (const tool of ["hit", "power", "eye", "speed"] as const) p.hitting[tool].present = 20;
    }
    const rng = new Rng("no-hit bids");
    let solo = 0;
    let combined = 0;
    for (let i = 0; i < 1000; i++) {
      const home = l.teams[2 + (i % 28)]!;
      const r = simulateGame(s.env, s.gameSetup(weak, rng, i), s.gameSetup(home, rng, i), rng);
      if (r.hits[0] === 0) {
        if (r.pitchersUsed[1].length === 1) solo++;
        else combined++;
      }
    }
    // Managers used to go to the bullpen at the usual pitch counts, and 23 of these 31 no-hitters were combined.
    expect(solo + combined).toBeGreaterThanOrEqual(10);
    expect(solo).toBeGreaterThan(2 * combined);
  });
});

describe("a manager's bullpen", () => {
  it("sits a reliever who's pitched four times in a week, however lightly", () => {
    const week = new StaffTracker();
    // Every other day on a dozen pitches: never back to back, never many pitches.
    for (const day of [1, 3, 5, 7]) week.record(new Map([[9, 12]]), day);
    expect(week.isRested(9, 8)).toBe(false);
    // Once the first of them is more than a week back, he can go again.
    expect(week.isRested(9, 9)).toBe(true);
    const three = new StaffTracker();
    for (const day of [1, 3, 5]) three.record(new Map([[9, 12]]), day);
    expect(three.isRested(9, 7)).toBe(true);
  });

  it("lets a middle reliever who breezed through an inning work another before the late innings", () => {
    const easy = { pitches: 12, limit: 35, runs: 0, outs: 3 };
    // The fourth man in a nine-man pen, at the top of the 6th or the 7th with a two-run lead.
    expect(relieverComesOut(easy, 3, 9, 6, true, 2)).toBe(false);
    expect(relieverComesOut(easy, 3, 9, 7, true, 2)).toBe(false);
    // Not into the 8th, after a long inning or a run, or for a third inning, and never the closer or the top setup man.
    expect(relieverComesOut(easy, 3, 9, 8, true, 2)).toBe(true);
    expect(relieverComesOut({ ...easy, pitches: 19 }, 3, 9, 6, true, 2)).toBe(true);
    expect(relieverComesOut({ ...easy, runs: 1 }, 3, 9, 6, true, 2)).toBe(true);
    expect(relieverComesOut({ ...easy, outs: 6, pitches: 24 }, 3, 9, 7, true, 2)).toBe(true);
    expect(relieverComesOut(easy, 0, 9, 6, true, 2)).toBe(true);
    expect(relieverComesOut(easy, 1, 9, 6, true, 2)).toBe(true);
    // A long man in a blowout stays on while he has pitches to spare, as before.
    expect(relieverComesOut({ ...easy, outs: 6, pitches: 24 }, 8, 9, 7, true, 6)).toBe(false);
    // In the middle of an inning he stays unless he's been hit hard.
    expect(relieverComesOut({ ...easy, outs: 1 }, 3, 9, 6, false, 2)).toBe(false);
    expect(relieverComesOut({ ...easy, outs: 1, runs: 3, pitches: 20 }, 3, 9, 6, false, 2)).toBe(true);
  });

  it("goes to the freshest middle reliever, nearest the middle of the pen", () => {
    const pool = [11, 12, 13, 14, 15];
    expect(freshestNearMiddle(pool)).toBe(13);
    expect(freshestNearMiddle(pool, new Map([[13, 0.3]]))).toBe(14);
    expect(freshestNearMiddle(pool, new Map([[13, 0.3], [14, 0.2]]))).toBe(12);
    expect(freshestNearMiddle(pool, new Map([[13, 0.3], [14, 0.2], [12, 0.1]]))).toBe(15);
  });

  it("goes to a tired reliever before another starter", () => {
    const l = generateLeague({ seed: "tired-pen" });
    const s = new Season(l, { minors: false });
    const rng = new Rng("tired pen");
    let relieved = 0;
    for (let i = 0; i < 20; i++) {
      const home = s.gameSetup(l.teams[1]!, rng, i);
      const relievers = home.bullpen.filter((id) => !home.spare!.has(id));
      // Nobody is rested, and the relievers have worked more lately than the club's other starters.
      const worn = { ...home, unavailable: new Set(home.bullpen), fatigue: new Map(relievers.map((id) => [id, 0.3])) };
      const first = simulateGame(s.env, s.gameSetup(l.teams[2]!, rng, i), worn, rng).pitchersUsed[1][1];
      if (first === undefined) continue;
      relieved++;
      expect(relievers).toContain(first);
    }
    expect(relieved).toBeGreaterThan(10);
  });
});
