import { describe, expect, it } from "vitest";
import { seasonAdvice } from "../src/advice/advice";
import { tradeAdvice } from "../src/advice/trades";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import type { Contract } from "../src/players/types";
import { pitch } from "../src/org/offers";
import { freeAfterSeason, TRADE_DEADLINE_DAY } from "../src/org/trades";
import { type Player, SERVICE_DAYS_PER_YEAR } from "../src/players/types";
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
