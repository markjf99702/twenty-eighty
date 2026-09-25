import { beforeAll, describe, expect, it } from "vitest";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { MIN_SALARY, orgPlayers, payroll, seasonWar, serviceYears } from "../src/org/contracts";
import { extensionCandidates, extensionGain, extensionOptions, serviceClock, signExtension } from "../src/org/extensions";
import { controlYears, serviceAt } from "../src/org/trades";
import { SERVICE_DAYS_PER_YEAR } from "../src/players/types";
import { advanceOffseason, beginOffseason, winterContext } from "../src/offseason/offseason";
import type { Player } from "../src/players/types";
import { deserialize, loadGame, saveGame, serialize } from "../src/save/save";
import { runPostseason } from "../src/season/postseason";
import { Season } from "../src/season/season";

const USER = 3;
const league = generateLeague({ seed: "extensions" });
hireGm(league, USER);
const season = new Season(league, { minors: false });
const team = league.teams[USER]!;
const mine = () => orgPlayers(league, team).filter((p) => p.onFortyMan && p.contract && p.contract.type !== "minor");
const best = (ps: Player[]) => [...ps].sort((a, b) => seasonWar(b) - seasonWar(a))[0]!;

describe("extension asks", () => {
  const star = best(mine().filter((p) => serviceYears(p) < 3 && p.level === "MLB"));
  const offer = extensionOptions(league, star, 1, 0);

  it("price each length from what he'd earn without one", () => {
    expect(offer.ok).toBe(true);
    if (!offer.ok) return;
    let last = 0;
    for (const t of offer.options) {
      expect(t.covers.preArb + t.covers.arb + t.covers.free).toBe(t.years);
      // Every deal buys at least one season that would have cost more than the minimum.
      expect(t.covers.arb + t.covers.free).toBeGreaterThan(0);
      expect(t.salary).toBeGreaterThanOrEqual(MIN_SALARY);
      expect(t.total).toBeGreaterThan(last);
      last = t.total;
      expect(t.through).toBe(league.year + t.years - 1);
    }
  });

  it("come from his side's read of him", () => {
    const rosy = extensionOptions(league, star, 1, 1.5);
    if (!offer.ok || !rosy.ok) throw new Error("no offer");
    expect(rosy.options.at(-1)!.salary).toBeGreaterThan(offer.options.at(-1)!.salary);
  });

  it("look like a good deal to a club that sees him as he is, and a bad one to a club that doubts him", () => {
    if (!offer.ok) throw new Error("no offer");
    const t = offer.options.at(-1)!;
    expect(extensionGain(league, star, t, 1, 0)).toBeGreaterThan(0);
    expect(extensionGain(league, star, t, 1, -2)).toBeLessThan(0);
  });

  it("aren't on the table for players deep into a long deal or off the 40-man", () => {
    const signed = orgPlayers(league, league.teams[7]!).find((p) => p.contract?.type === "guaranteed" && p.contract.years > 3)!;
    const res = extensionOptions(league, signed, 1, 0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("signed through");
    const farmhand = orgPlayers(league, team).find((p) => !p.onFortyMan)!;
    expect(extensionOptions(league, farmhand, 1, 0).ok).toBe(false);
  });

  it("keep a player's arbitration years after a deal that ends before free agency", () => {
    if (!offer.ok) throw new Error("no offer");
    const short = { ...star, contract: { type: "guaranteed" as const, salary: 3, years: 2 } };
    const years = controlYears(short);
    expect(years.length).toBeGreaterThan(2);
    expect(years.slice(0, 2).every((y) => y.guaranteed)).toBe(true);
    expect(years.slice(2).every((y) => !y.guaranteed)).toBe(true);
  });
});

describe("the service clock", () => {
  it("counts only the service a player will have banked by each spring", () => {
    const p = { ...best(mine().filter((q) => q.level === "MLB")), service: Math.round(2.2 * SERVICE_DAYS_PER_YEAR) };
    // Midsummer at 2.2 years: about 2.7 next spring, so still pre-arbitration.
    expect(serviceAt(p, 0.5)(1)).toBe(2);
    expect(serviceAt(p, 0.5)(2)).toBe(3);
    // In the winter (a full season banked) he's at 2 for the coming season.
    expect(serviceAt({ ...p, service: Math.round(2.9 * SERVICE_DAYS_PER_YEAR) }, 1)(0)).toBe(2);
  });

  it("prices deals so a club that sees players as they are gains only a little", () => {
    const shares: number[] = [];
    for (const club of league.teams.slice(0, 8)) {
      for (const c of extensionCandidates(league, club, 1, () => 0)) {
        if (!c.best) continue;
        expect(c.best.gain).toBeLessThan(25);
        shares.push(c.best.gain / c.best.terms.total);
      }
    }
    shares.sort((a, b) => a - b);
    expect(shares.length).toBeGreaterThan(20);
    expect(shares[Math.floor(shares.length / 2)]!).toBeLessThan(0.2);
  });
});

describe("signing an extension", () => {
  let extended: Player;
  let arbCase: Player;
  let walking: Player | undefined;

  beforeAll(() => {
    season.simDays(60);
    extended = best(mine().filter((p) => serviceYears(p) < 3 && p.level === "MLB"));
  });

  it("in season makes a guaranteed deal that starts now", () => {
    const before = payroll(league, team);
    const fraction = 1 - season.day / season.totalDays;
    const offer = extensionOptions(league, extended, fraction, 0);
    if (!offer.ok) throw new Error(offer.reason);
    const terms = offer.options.find((t) => t.years === 5) ?? offer.options[0]!;
    signExtension(season.rosterContext(), team, extended, terms);
    expect(extended.contract).toMatchObject({ type: "guaranteed", years: terms.years, salary: terms.salary });
    expect(payroll(league, team)).toBeGreaterThan(before);
    expect(league.transactions.at(-1)).toMatchObject({ type: "extension", playerId: extended.id });
    expect(serviceClock(league, extended, fraction)!.freeAfter).toBeGreaterThanOrEqual(terms.through);
  });

  it("runs through the winter: years tick down and he's nobody's arbitration case", () => {
    season.simToEnd();
    runPostseason(season);
    const years = extended.contract!.years;
    const w = beginOffseason(league, season);
    expect(extended.contract!.years).toBe(years - 1);
    expect(w.tenders.some((t) => t.playerId === extended.id)).toBe(false);
    expect(w.expiring).not.toContain(extended.id);
  });

  it("in the winter settles a pending arbitration case or keeps a free agent-to-be", () => {
    const w = league.offseason!;
    const tender = w.tenders.find((t) => t.teamId === USER);
    const ctx = winterContext(league, "review");
    if (tender) {
      arbCase = league.players[tender.playerId]!;
      const offer = extensionOptions(league, arbCase, 1, 0);
      if (offer.ok) {
        signExtension(ctx, team, arbCase, offer.options[0]!);
        expect(w.tenders.some((t) => t.playerId === arbCase.id)).toBe(false);
      }
    }
    const leaving = w.expiring.map((id) => league.players[id]!).filter((p) => p.teamId === USER && p.age <= 33);
    for (const p of leaving) {
      const offer = extensionOptions(league, p, 1, 0);
      if (!offer.ok) continue;
      signExtension(ctx, team, p, offer.options[0]!);
      walking = p;
      break;
    }
    expect(arbCase?.contract?.type === "guaranteed" || walking !== undefined).toBe(true);
    // Through the tender deadline: the deals hold.
    advanceOffseason(league, season);
    advanceOffseason(league, season);
    if (arbCase?.contract?.type === "guaranteed") {
      expect(arbCase.teamId).toBe(USER);
      expect(arbCase.contract.years).toBeGreaterThanOrEqual(2);
    }
    if (walking) {
      expect(walking.teamId).toBe(USER);
      expect(walking.contract?.type).toBe("guaranteed");
      expect(league.freeAgents).not.toContain(walking.id);
    }
  });

  it("saves and resumes with the league", () => {
    const back = loadGame(deserialize(serialize(saveGame(league, season)))).league;
    expect(back.players[extended.id]!.contract).toEqual(extended.contract);
  });

  it("happens for AI clubs in spring, and never for the user's club", () => {
    let next: Season | null = null;
    while (!next) next = advanceOffseason(league, season);
    const deals = league.transactions.filter((t) => t.type === "extension" && t.year === league.year - 1);
    const theirs = deals.filter((t) => t.teamId !== USER);
    expect(theirs.length).toBeGreaterThanOrEqual(5);
    for (const t of theirs) expect(league.players[t.playerId]!.contract?.type).toBe("guaranteed");
    // Nothing is signed for the user's club in spring: its deals are the ones the user made above.
    const spring = winterContext(league, "spring").day;
    expect(theirs.every((t) => t.day === spring)).toBe(true);
    expect(deals.filter((t) => t.teamId === USER && t.day === spring)).toEqual([]);
  });
});
