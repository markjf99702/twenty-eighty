import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notesSince, seasonAdvice } from "../src/advice/advice";
import { tradeAdvice } from "../src/advice/trades";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import type { Contract } from "../src/players/types";
import { gamesOut, pitch } from "../src/org/offers";
import { freeAfterSeason, TRADE_DEADLINE_DAY } from "../src/org/trades";
import { type Player, SERVICE_DAYS_PER_YEAR } from "../src/players/types";
import { believedWar } from "../src/scouting/analytics";
import { playoffSeeds } from "../src/season/postseason";
import { Season } from "../src/season/season";

const USER = 4;
const league = generateLeague({ seed: "deadline-notes" });
hireGm(league, USER);
const season = new Season(league, { minors: false });
const left = (day: number) => 1 - day / season.totalDays;
const mine = league.teams[USER]!;
const user = mine.league;
const sameLeague = league.teams.filter((t) => t.league === user);
const P = (id: number) => league.players[id]!;

/** The standings with the user's club `gb` games from a playoff spot (negative: in one by that much). */
function standings(gb: number): void {
  for (const t of sameLeague) Object.assign(season.records[t.id]!, { w: 60, l: 55 });
  Object.assign(season.records[USER]!, { w: 60 - gb, l: 55 + gb });
}

/** Service time `years.days` (4.150 is four years and 150 days). */
const service = (years: number, days: number) => years * SERVICE_DAYS_PER_YEAR + days;
const arb: Contract = { type: "arb", salary: 4.5, years: 1 };
/** At the deadline, a player who started the season at `years.days` and has been up all year. */
const atDeadline = (p: Player, years: number, days: number, contract = arb) => {
  p.service = service(years, days) + DEADLINE;
  p.contract = { ...contract };
  return p;
};
const DEADLINE = TRADE_DEADLINE_DAY - 5;

describe("rentals", () => {
  const theirs = league.teams.find((t) => t.id !== USER)!;
  const vet = theirs.rosters.MLB.map(P).find((p) => !p.injury && p.age >= 27)!;
  const chip = mine.rosters.AAA.map(P).find((p) => !p.injury)!;
  const pitchAt = (day: number) => pitch({ partner: theirs, give: [chip], get: [vet], kind: "sell" }, true, day, left(day));
  const takeAt = (day: number) => tradeAdvice(season, [chip.id], [vet.id], left(day))!.notes.map((n) => n.text).join(" ");

  it("are players who can leave as free agents after the season", () => {
    // Five years by spring is arbitration again; six is free agency.
    expect(freeAfterSeason(atDeadline(vet, 4, 150), left(DEADLINE))).toBe(false);
    expect(freeAfterSeason(atDeadline(vet, 5, 10), left(DEADLINE))).toBe(true);
    expect(freeAfterSeason(atDeadline(vet, 3, 10), left(DEADLINE))).toBe(false);
    // A guaranteed deal with years to go keeps him, whatever his service.
    expect(freeAfterSeason(atDeadline(vet, 8, 0, { type: "guaranteed", salary: 20, years: 2 }), left(DEADLINE))).toBe(false);
    expect(freeAfterSeason(atDeadline(vet, 8, 0, { type: "guaranteed", salary: 20, years: 1 }), left(DEADLINE))).toBe(true);
  });

  it("aren't arbitration players who'll be back for another year", () => {
    // 4.150 at Opening Day passes five years in June, but has only 5.150 or so when the season ends.
    atDeadline(vet, 4, 150);
    expect(pitchAt(DEADLINE)).not.toContain("rental");
    expect(takeAt(DEADLINE)).not.toContain("rental");
    // A first-year arbitration case never is.
    atDeadline(vet, 3, 10);
    expect(pitchAt(DEADLINE)).not.toContain("rental");
    expect(takeAt(DEADLINE)).not.toContain("rental");
    // 5.010 at Opening Day reaches six years by the end: he can walk.
    atDeadline(vet, 5, 10);
    expect(pitchAt(DEADLINE)).toContain("(a rental: his contract is up after the season)");
    expect(takeAt(DEADLINE)).toContain(`can be a free agent after the season, so he's a rental`);
  });

  it("are who the staff says to sell when the race is gone", () => {
    standings(12);
    const day = TRADE_DEADLINE_DAY - 9;
    season.day = day;
    const vets = mine.rosters.MLB.map(P).filter((p) => !p.injury && p.age >= 26);
    for (const p of vets) atDeadline(p, 4, 150);
    league.advice = [];
    seasonAdvice(season);
    const sell = league.advice.find((a) => a.key.startsWith("sell"))!;
    expect(sell.text).not.toContain("can walk");
    // Give the whole roster a sixth year by the end, and the note names who can leave.
    for (const p of vets) atDeadline(p, 5, 10);
    league.advice = [];
    seasonAdvice(season);
    expect(league.advice.find((a) => a.key.startsWith("sell"))!.text).toMatch(/can walk as free agents after the season/);
  });
});

describe("the staff's deadline notes", () => {
  const notes = (family: "buy" | "sell") => league.advice.filter((a) => a.key.startsWith(`${family}:`) || a.key.startsWith(`${family}-last:`));
  /** The staff's end of the day on each of these days. */
  const days = (...ds: number[]) => {
    for (const d of ds) {
      season.day = d;
      seasonAdvice(season);
    }
  };
  const lastWeek = TRADE_DEADLINE_DAY - 7;

  it("come once a season to buy, the last week's standing in for the one before it", () => {
    league.advice = [];
    standings(-2);
    days(lastWeek - 2, lastWeek, lastWeek + 5);
    expect(notes("buy")).toHaveLength(1);
    expect(notes("buy")[0]).toMatchObject({ key: `buy-last:${league.year}`, urgent: true, at: lastWeek });
  });

  it("come once a season to sell", () => {
    league.advice = [];
    standings(12);
    days(lastWeek - 2, lastWeek, lastWeek + 5);
    expect(notes("sell")).toHaveLength(1);
    expect(notes("sell")[0]!.urgent).toBe(true);
  });

  it("don't follow the last week's note with a plain copy", () => {
    // Out of reach of a playoff spot until the last week, then in it.
    league.advice = [];
    standings(5);
    days(lastWeek - 2);
    expect(notes("buy")).toHaveLength(0);
    standings(2);
    days(lastWeek, lastWeek + 5);
    expect(notes("buy")).toHaveLength(1);
    expect(notes("buy")[0]!.key).toBe(`buy-last:${league.year}`);
  });

  it("say how far out of a playoff spot we are the way people do", () => {
    /** The last week's note with the user's club at w-l, every other club in its league at 60-55. */
    const at = (w: number, l: number) => {
      for (const t of sameLeague) Object.assign(season.records[t.id]!, { w: 60, l: 55 });
      Object.assign(season.records[USER]!, { w, l });
      league.advice = [];
      days(lastWeek);
      return [...notes("buy"), ...notes("sell")][0]?.text ?? "";
    };
    expect(at(60, 56)).toMatch(/^We're half a game out\. /);
    expect(at(59, 56)).toMatch(/^We're a game out\. /);
    expect(at(58, 56)).toMatch(/^We're 1½ games out\. /);
    expect(at(57, 58)).toMatch(/^We're 3 games out\. /);
    expect(at(52, 62)).toMatch(/^We're 7½ games out of a playoff spot\. /);
    expect(at(52, 63)).toMatch(/^We're 8 games out of a playoff spot\. /);
  });

  describe("with the last playoff spot level", () => {
    const others = sameLeague.filter((t) => t.id !== USER);
    // Five clubs well clear, one in each division among them, so they hold the division titles and two wild cards.
    const clear = [...new Map(others.map((t) => [t.division, t])).values()];
    for (const t of others) if (clear.length < 5 && !clear.includes(t)) clear.push(t);
    const rival = others.find((t) => !clear.includes(t))!;
    /**
     * The clear clubs at 70-45 and the rest of the league at 55-60, but for the user's club at 62-53 with this run
     * differential (the tiebreak) and the rival at w-l and +20; `also` drops a clear club to 62-53 and +60.
     */
    const race = (diff: number, w = 62, l = 53, also = false) => {
      for (const t of others) Object.assign(season.records[t.id]!, clear.includes(t) ? { w: 70, l: 45 } : { w: 55, l: 60 });
      Object.assign(season.records[rival.id]!, { w, l, rs: 520, ra: 500 });
      if (also) Object.assign(season.records[clear[4]!.id]!, { w: 62, l: 53, rs: 560, ra: 500 });
      Object.assign(season.records[USER]!, { w: 62, l: 53, rs: 500 + diff, ra: 500 });
    };
    /** The last week's note to buy. */
    const buy = () => {
      league.advice = [];
      days(lastWeek);
      return notes("buy")[0]?.text ?? "";
    };
    // Our best regular, gone for nothing: the trade desk's word on this season's race.
    const war = (p: Player) => believedWar(season, USER, p);
    const best = Object.values(mine.depth.starters).map(P).sort((a, b) => war(b) - war(a))[0]!;
    const desk = () => {
      season.day = lastWeek;
      return tradeAdvice(season, [best.id], [], left(lastWeek))!.notes.find((n) => n.text.startsWith("For the rest of this season"))?.text ?? "";
    };
    let saved: (typeof season.records)[number][] = [];
    beforeAll(() => {
      saved = sameLeague.map((t) => ({ ...season.records[t.id]! }));
    });
    afterAll(() => sameLeague.forEach((t, i) => Object.assign(season.records[t.id]!, saved[i])));

    it("call us tied for it when the tiebreak leaves us out", () => {
      race(-20);
      expect(gamesOut(season, USER)).toBe(0);
      expect(playoffSeeds(season)[user]).not.toContain(USER);
      expect(playoffSeeds(season)[user]).toContain(rival.id);
      expect(buy()).toMatch(/^We're tied for the last playoff spot\. By our read/);
      expect(desk()).toMatch(/ worse, and we're tied for the last playoff spot\.$/);
    });

    it("call us tied for it when the tiebreak puts us in", () => {
      race(40);
      expect(playoffSeeds(season)[user]).toContain(USER);
      expect(playoffSeeds(season)[user]).not.toContain(rival.id);
      expect(buy()).toMatch(/^We're tied for the last playoff spot\. /);
      expect(desk()).toMatch(/, and we're tied for the last playoff spot\.$/);
    });

    it("say we're in a playoff spot when nobody outside is level with us", () => {
      race(-20, 61, 54);
      expect(buy()).toMatch(/^We're in a playoff spot\. /);
      expect(desk()).toMatch(/, and we're holding a playoff spot\.$/);
      // Level with the club in the spot ahead of ours, and a game clear of the next one.
      race(-20, 61, 54, true);
      expect(buy()).toMatch(/^We're in a playoff spot\. /);
    });
  });

  it("keep a note from weeks before alongside the last week's reminder", () => {
    league.advice = [];
    standings(-2);
    days(lastWeek - 16, lastWeek, lastWeek + 5);
    expect(notes("buy").map((a) => a.key)).toEqual([`buy:${league.year}`, `buy-last:${league.year}`]);
  });

  it("stop the sim when the last week's note replaces an earlier one", () => {
    league.advice = [];
    standings(-2);
    days(lastWeek - 2);
    const seen = new Set(league.advice.map((a) => a.key));
    const kept = league.advice.length;
    days(lastWeek);
    // The list is no longer than before (the weekly note made way), but the urgent one is new.
    expect(league.advice.length).toBe(kept);
    expect(notesSince(league, seen).find((a) => a.urgent)?.key).toBe(`buy-last:${league.year}`);
  });
});

describe("the analysts' weak link", () => {
  it("looks to the winter once the deadline has passed", () => {
    const l = generateLeague({ seed: "deadline-weak-link" });
    hireGm(l, 0);
    const s = new Season(l, { minors: false });
    s.simDays(20);
    // The analysts' monthly look, as some club whose lineup, rotation or bullpen ranks near the bottom would get it.
    const weakLink = (day: number) => {
      s.day = day;
      for (const t of l.teams) {
        l.userTeamId = t.id;
        l.advice = [];
        seasonAdvice(s);
        const note = l.advice.find((a) => a.key.startsWith("unit:"));
        if (note) return note.text;
      }
      return "";
    };
    expect(weakLink(TRADE_DEADLINE_DAY - 16)).toMatch(/ranks \d+th of 30 with .+\. If we add anyone, that's where it counts most\.$/);
    expect(weakLink(TRADE_DEADLINE_DAY + 12)).toMatch(/ranks \d+th of 30 with .+\. That's the spot to fix this winter\.$/);
  });
});

describe("the staff's urgent notes", () => {
  it("are found to stop the sim even once the list of notes is full", () => {
    // Sixty kept (the most there are): a new note pushes the oldest out, so the list is no longer than before.
    league.advice = Array.from({ length: 60 }, (_, i) => ({ key: `old:${i}`, from: "assistant" as const, urgent: false, title: "An old note", text: "From last season.", year: league.year - 1, at: 50, read: true }));
    const seen = new Set(league.advice.map((a) => a.key));
    standings(12);
    season.day = TRADE_DEADLINE_DAY - 7;
    seasonAdvice(season);
    expect(league.advice).toHaveLength(60);
    expect(notesSince(league, seen).find((a) => a.urgent)?.key).toBe(`sell-last:${league.year}`);
  });
});
