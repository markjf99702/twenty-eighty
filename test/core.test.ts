import { describe, expect, it } from "vitest";
import { formatPresentFuture, gradeLabel, gradeToZ, scoutRound, zToGrade } from "../src/core/grades";
import { Rng } from "../src/core/rng";

describe("Rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng("seed");
    const b = new Rng("seed");
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it("resumes from a saved state", () => {
    const a = new Rng(42);
    a.next();
    const b = new Rng(a.getState());
    for (let i = 0; i < 20; i++) expect(b.next()).toBe(a.next());
  });

  it("produces standard normals", () => {
    const r = new Rng("normal");
    const xs = Array.from({ length: 50_000 }, () => r.normal());
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(mean).toBeCloseTo(0, 1);
    expect(sd).toBeCloseTo(1, 1);
  });

  it("picks by weight", () => {
    const r = new Rng("weights");
    const counts = [0, 0, 0];
    for (let i = 0; i < 30_000; i++) counts[r.weightedIndex([1, 2, 7])]!++;
    expect(counts[2]! / 30_000).toBeCloseTo(0.7, 1);
  });
});

describe("20-80 grades", () => {
  it("treats 10 points as one standard deviation around 50", () => {
    expect(gradeToZ(50)).toBe(0);
    expect(gradeToZ(70)).toBe(2);
    expect(zToGrade(-1.5)).toBe(35);
    expect(zToGrade(9)).toBe(80);
  });

  it("rounds to scouting half-grades", () => {
    expect(scoutRound(57.4)).toBe(55);
    expect(scoutRound(57.6)).toBe(60);
    expect(scoutRound(12)).toBe(20);
    expect(formatPresentFuture(41, 58)).toBe("40/60");
  });

  it("labels grades the way scouts talk", () => {
    expect(gradeLabel(80)).toBe("Elite");
    expect(gradeLabel(60)).toBe("Plus");
    expect(gradeLabel(50)).toBe("Average");
    expect(gradeLabel(40)).toBe("Fringe");
  });
});
