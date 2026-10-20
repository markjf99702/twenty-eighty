import { describe, expect, it } from "vitest";
import { seasonAdvice, winterAdvice } from "../src/advice/advice";
import { tenth } from "../src/core/text";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { FREE_AGENT_YEARS, serviceYears } from "../src/org/contracts";
import { TRADE_DEADLINE_DAY } from "../src/org/trades";
import { createDraft } from "../src/offseason/draft";
import { winterRng } from "../src/offseason/offseason";
import { playerName } from "../src/players/types";
import { Season } from "../src/season/season";
import { emptyPitching, type PitchingLine } from "../src/stats/lines";

const USER = 6;

describe("the analysts' word on a pitcher's ERA", () => {
  const league = generateLeague({ seed: "advice-luck" });
  hireGm(league, USER);
  // Only the better departments look at luck.
  league.scouting.analytics[USER] = 5;
  const season = new Season(league, { minors: false });
  // A couple of weeks: a league to compare with, and nobody else on the club near 50 innings or 200 PA.
  season.simDays(15);
  const p = league.teams[USER]!.rosters.MLB.map((id) => league.players[id]!).find((x) => x.pitching)!;

  /** Sixty innings with this ERA and, by the league's FIP constant, about this FIP. */
  const line = (era: number, fip: number): PitchingLine => {
    const ip = 60;
    const SO = 45;
    // 13 HR + 3 BB, the rest of the FIP formula, split between homers and walks.
    const rest = Math.round((fip - season.context().fipConstant) * ip) + 2 * SO;
    const HR = Math.max(0, Math.round((0.55 * rest) / 13));
    const BB = Math.max(0, Math.round((rest - 13 * HR) / 3));
    const H = 65;
    return { ...emptyPitching(), G: 11, GS: 11, outs: 3 * ip, BF: 3 * ip + H + BB, H, HR, BB, SO, ER: Math.round((era * ip) / 9), R: Math.round((era * ip) / 9) };
  };
  /** The analysts' monthly note about him, with his line this season set to `l`. */
  const noteWith = (l: PitchingLine) => {
    season.pitching.lines.set(p.id, l);
    const row = season.stats().pitchers.find((x) => x.id === p.id)!;
    league.advice = [];
    season.day = 55;
    seasonAdvice(season);
    return { row, note: league.advice.find((a) => a.key === `luck:${p.id}:${league.year}`) };
  };

  it("doesn't tell us to keep faith in a pitcher whose FIP is bad too", () => {
    const { row, note } = noteWith(line(7.3, 6.0));
    expect(row.ERA).toBeCloseTo(7.35, 2);
    expect(Math.abs(row.FIP - 6.0)).toBeLessThan(0.05);
    expect(row.FIP).toBeGreaterThan(season.context().lgEra + 1);
    expect(note).toBeUndefined();
  });

  it("does when his FIP says he's pitched well", () => {
    const { row, note } = noteWith(line(5.9, 3.1));
    expect(Math.abs(row.FIP - 3.1)).toBeLessThan(0.05);
    expect(note?.title).toBe(`${playerName(p)} has pitched better than his ERA`);
    expect(note?.text).toBe(`${playerName(p)}'s 5.85 ERA hides how well he's pitched: a ${row.FIP.toFixed(2)} FIP. He should turn it around, so it's no time to give up on him.`);
  });

  it("still says when an ERA is running ahead of a pitcher, however good it is", () => {
    const { note } = noteWith(line(2.1, 3.9));
    expect(note?.title).toBe(`${playerName(p)}'s ERA is running ahead of him`);
  });
});

describe("the staff's numbers", () => {
  it("never give a player -0.0 wins", () => {
    expect(tenth(-0.04)).toBe("0.0");
    expect(tenth(0.04)).toBe("0.0");
    expect(tenth(-0.06)).toBe("-0.1");
    expect(tenth(2.34)).toBe("2.3");
  });
});

describe("the assistant GM's extension note", () => {
  const league = generateLeague({ seed: "advice-extend" });
  hireGm(league, USER);
  const season = new Season(league, { minors: false });
  const team = league.teams[USER]!;
  // A 40-man of veterans, so the note is about one of them.
  team.fortyMan = team.fortyMan.filter((id) => serviceYears(league.players[id]!) >= FREE_AGENT_YEARS);
  /** The note in the winter review, with these veterans' deals up. */
  const noteIn = (expiring: number[]) => {
    league.offseason = {
      year: league.year,
      phase: "review",
      development: { risers: [], fallers: [], retirements: [] },
      shift: {},
      tenders: [],
      expiring,
      draft: null,
      freeAgency: null,
      international: null,
    };
    league.advice = [];
    winterAdvice(league, season, 1030);
    return league.advice.find((a) => a.key === `extend:${league.year}:review`)?.text;
  };

  it("weighs a deal for a player whose contract is up against losing him to free agency", () => {
    expect(noteIn([...team.fortyMan])).toMatch(/By our read that's worth \$[\d.]+M more than letting him go to free agency\. The risk is ours/);
  });

  it("weighs a deal for a player under contract against going year to year", () => {
    expect(noteIn([])).toMatch(/By our read that's worth \$[\d.]+M more than going year to year\. The risk is ours/);
  });
});

describe("the scouting director's draft note", () => {
  const league = generateLeague({ seed: "advice-draft" });
  hireGm(league, USER);
  const season = new Season(league, { minors: false });
  /** The note as the draft opens, with the user's club finishing at w-l and everyone else at .500. */
  const noteAfter = (w: number, l: number) => {
    for (const r of season.records) Object.assign(r, { w: 81, l: 81 });
    Object.assign(season.records[USER]!, { w, l });
    league.offseason = {
      year: league.year,
      phase: "draft",
      development: { risers: [], fallers: [], retirements: [] },
      shift: {},
      tenders: [],
      expiring: [],
      draft: createDraft(league, season, winterRng(league, "draft")),
      freeAgency: null,
      international: null,
    };
    league.advice = [];
    winterAdvice(league, season, 1060);
    return league.advice.find((a) => a.key === `draft:${league.year}`)!.text;
  };

  it("gives FVs in the scouts' 5-point steps, as the board does", () => {
    const fvs = [...noteAfter(81, 81).matchAll(/FV (\d+)/g)].map((m) => Number(m[1]));
    expect(fvs).toHaveLength(3);
    for (const fv of fvs) expect(fv % 5).toBe(0);
  });

  it("says when the top of our board will be gone before our first pick", () => {
    expect(noteAfter(100, 62)).toMatch(/ We pick #30 and #60 overall; most of these will be gone by then\.$/);
    expect(noteAfter(55, 107)).toMatch(/ We pick #1 and #31 overall\.$/);
  });
});

describe("the weakest spot", () => {
  it("names a pitcher by the slot he fills, not his role", () => {
    const league = generateLeague({ seed: "advice-slot" });
    hireGm(league, USER);
    const season = new Season(league, { minors: false });
    const team = league.teams[USER]!;
    // A reliever by trade, starting for us, and not well.
    const p = league.players[team.depth.rotation[0]!]!;
    p.role = "RP";
    const poor = { present: 20, future: 20 };
    for (const x of p.pitching!.pitches) x.grade = { ...poor };
    p.pitching!.control = { ...poor };
    p.pitching!.command = { ...poor };
    for (const t of league.teams.filter((x) => x.league === team.league)) Object.assign(season.records[t.id]!, { w: 60, l: 55 });
    season.day = TRADE_DEADLINE_DAY - 7;
    seasonAdvice(season);
    expect(league.advice.find((a) => a.key.startsWith("buy"))!.text).toContain(`the weakest spot on the club is the rotation: SP ${playerName(p)} (about `);
  });
});
