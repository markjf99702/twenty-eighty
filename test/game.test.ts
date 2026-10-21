import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import { Season } from "../src/season/season";
import { StaffTracker } from "../src/season/staff";
import { chooseReliever, freshestNearMiddle, relieverComesOut, simulateGame, starterComesOut, type GameResult } from "../src/sim/game";

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
    for (let i = 0; i < 2000; i++) {
      const home = l.teams[2 + (i % 28)]!;
      const r = simulateGame(s.env, s.gameSetup(weak, rng, i), s.gameSetup(home, rng, i), rng);
      if (r.hits[0] === 0) {
        if (r.pitchersUsed[1].length === 1) solo++;
        else combined++;
      }
    }
    // About seven in ten are his alone. Managers used to go to the bullpen at the usual pitch counts, and 23 of 31
    // no-hitters in a thousand of these games were combined.
    expect(solo + combined).toBeGreaterThanOrEqual(20);
    expect(solo).toBeGreaterThan(combined);
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

  it("lets four-in-seven sit a closer for everything but a save, and the other rules sit him for that too", () => {
    const week = new StaffTracker();
    for (const day of [1, 3, 5, 7]) week.record(new Map([[9, 12]]), day);
    expect(week.isRested(9, 8)).toBe(false);
    expect(week.restedForSave(9, 8)).toBe(true);
    // A third day running, 30 pitches yesterday, 50 in one outing lately, or 60 in three days.
    const outings: [number, number][][] = [[[6, 12], [7, 12]], [[7, 30]], [[5, 50]], [[5, 31], [7, 29]]];
    for (const list of outings) {
      const t = new StaffTracker();
      for (const [day, pitches] of list) t.record(new Map([[9, pitches]]), day);
      expect(t.restedForSave(9, 8)).toBe(false);
    }
  });

  it("brings in a closer whom only four-in-seven sits to close out a save, and for nothing else", () => {
    // A nine-man pen, the closer (1) and the top setup man (2) first, with the club's other four starters after it.
    const bullpen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 21, 22, 23, 24];
    const spare = new Set([21, 22, 23, 24]);
    const kept = { bullpen, spare, unavailable: new Set([1, ...spare]), closerForSaves: 1 };
    // A save from the 9th inning on: a lead of one to three, or the tying run on deck.
    expect(chooseReliever(kept, bullpen, 9, 1, 0)).toBe(1);
    expect(chooseReliever(kept, bullpen, 9, 3, 2)).toBe(1);
    expect(chooseReliever(kept, bullpen, 9, 5, 3)).toBe(1);
    expect(chooseReliever(kept, bullpen, 11, 2, 1)).toBe(1);
    // Not in the 8th, not with four runs to spare, a tie or a run down, and not twice.
    expect(chooseReliever(kept, bullpen, 8, 2, 0)).toBe(2);
    expect(chooseReliever(kept, bullpen, 9, 4, 0)).not.toBe(1);
    expect(chooseReliever(kept, bullpen, 9, 0, 0)).toBe(2);
    expect(chooseReliever(kept, bullpen, 10, 0, 0)).toBe(2);
    expect(chooseReliever(kept, bullpen, 9, -1, 0)).toBe(2);
    expect(chooseReliever(kept, bullpen.slice(1), 9, 2, 0)).toBe(2);
    // A rested closer works the 9th of a close game too, as before; one sat by another rule isn't kept for saves.
    const rested = { bullpen, spare, unavailable: spare };
    expect(chooseReliever(rested, bullpen, 9, 2, 0)).toBe(1);
    expect(chooseReliever(rested, bullpen, 10, 0, 0)).toBe(1);
    expect(chooseReliever({ ...kept, closerForSaves: undefined }, bullpen, 9, 2, 0)).toBe(2);
  });

  it("keeps a closer whom only four-in-seven sits for the saves in his club's games", () => {
    const l = generateLeague({ seed: "kept-closer" });
    const s = new Season(l, { minors: false });
    const team = l.teams[3]!;
    const closer = team.depth.bullpen.find((id) => !s.isOut(id))!;
    // Every other day on a dozen pitches: on the 8th only four-in-seven sits him, and on the 9th he's rested.
    for (const day of [1, 3, 5, 7]) s.staff.record(new Map([[closer, 12]]), day);
    const rng = new Rng("kept closer");
    const today = s.gameSetup(team, rng, 8);
    expect(today.unavailable!.has(closer)).toBe(true);
    expect(today.closerForSaves).toBe(closer);
    const rested = s.gameSetup(team, rng, 9);
    expect(rested.unavailable!.has(closer)).toBe(false);
    expect(rested.closerForSaves).toBeUndefined();
    let saves = 0;
    let checked = 0;
    for (let i = 0; i < 150; i++) {
      // The same day over and over (nothing recorded), against the other clubs in turn.
      const away = s.gameSetup(l.teams[i % 30 === 3 ? 4 : i % 30]!, rng, 8);
      const home = s.gameSetup(team, rng, 8);
      const r = simulateGame(s.env, away, home, rng, 8);
      if (!r.pitchersUsed[1].includes(closer)) continue;
      if (r.savePitcher === closer) saves++;
      // Once every other reliever has pitched, a tired one has to go, as always. Before that, at home, he can only
      // close out a save in the top of the 9th, so his club led after eight.
      const unused = home.bullpen.filter((id) => !home.unavailable!.has(id) && !r.pitchersUsed[1].includes(id));
      if (unused.length === 0) continue;
      const afterEight = (side: 0 | 1) => r.lineScore[side].slice(0, 8).reduce((a, b) => a + b, 0);
      expect(afterEight(1)).toBeGreaterThan(afterEight(0));
      checked++;
    }
    // He used to go only once every other reliever had pitched: four times in these games, one of them a save.
    expect(checked).toBeGreaterThan(10);
    expect(saves).toBeGreaterThan(10);
    // A third day running sits him for saves too.
    s.staff.record(new Map([[closer, 12]]), 8);
    const third = s.gameSetup(team, rng, 9);
    expect(third.unavailable!.has(closer)).toBe(true);
    expect(third.closerForSaves).toBeUndefined();
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

  it("counts the long men from the end of the relievers, not of the club's other starters after them", () => {
    // Two innings in with pitches to spare, in a nine-man pen with the club's four other starters after it.
    const two = { pitches: 24, limit: 35, runs: 0, outs: 6 };
    expect(relieverComesOut(two, 7, 9, 8, true, 6)).toBe(false);
    expect(relieverComesOut(two, 8, 9, 8, true, -5)).toBe(false);
    // Not in a close game, and not the seventh reliever or a starter pressed into relief.
    expect(relieverComesOut(two, 8, 9, 8, true, 2)).toBe(true);
    expect(relieverComesOut(two, 6, 9, 8, true, 6)).toBe(true);
    expect(relieverComesOut(two, 9, 9, 8, true, 6)).toBe(true);
    expect(relieverComesOut(two, 12, 9, 8, true, 6)).toBe(true);
    // Never the closer or the top setup man, however small the pen.
    expect(relieverComesOut(two, 1, 3, 8, true, 6)).toBe(true);
  });

  it("keeps a long reliever on through a blowout", () => {
    const l = generateLeague({ seed: "long-men" });
    const s = new Season(l, { minors: false });
    const rng = new Rng("long men");
    let long = 0;
    for (let i = 0; i < 400; i++) {
      const sides = [s.gameSetup(l.teams[(2 * i) % 30]!, rng, i), s.gameSetup(l.teams[(2 * i + 1) % 30]!, rng, i)] as const;
      const r = simulateGame(s.env, sides[0], sides[1], rng, i);
      s.staff.record(r.pitchCounts, i);
      for (const k of [0, 1] as const) {
        const setup = sides[k];
        const relievers = setup.bullpen.filter((id) => !setup.spare!.has(id));
        for (const id of r.pitchersUsed[k].slice(1)) {
          // Three innings in relief: anyone but a long man in a blowout comes out within two (eight outs at most).
          if (r.pitching.lines.get(id)!.outs < 9) continue;
          expect(relievers.slice(-2)).toContain(id);
          long++;
        }
      }
    }
    // Every game bullpen ends with the club's other starters, so the rule used to reach only them, never a reliever.
    expect(long).toBeGreaterThan(0);
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
