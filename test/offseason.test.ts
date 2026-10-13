import { describe, expect, it } from "vitest";
import { generateLeague } from "../src/league/generate";
import { orgPlayers, payroll, worthTendering } from "../src/org/contracts";
import { rosterProblems } from "../src/org/roster";
import { evaluateTrade, executeTrade, surplusValue, tradeValue } from "../src/org/trades";
import { extensionOptions } from "../src/org/extensions";
import { Rng } from "../src/core/rng";
import { boardValue, draftClass, onTheClock } from "../src/offseason/draft";
import { overallGrade, playerValue } from "../src/org/value";
import { bonusAsk, prospect } from "../src/offseason/international";
import { perceive } from "../src/scouting/scouting";
import { projectPlayer } from "../src/players/development";
import { advanceOffseason, beginOffseason, winterContext, winterWeek } from "../src/offseason/offseason";
import { LEVELS, playerName } from "../src/players/types";
import { deserialize, loadGame, saveGame, serialize } from "../src/save/save";
import { runPostseason } from "../src/season/postseason";
import { Season } from "../src/season/season";

// One full big-league season, then the whole winter.
const league = generateLeague({ seed: "offseason-test" });
const season = new Season(league, { minors: false });
season.simToEnd();
runPostseason(season);
const year = league.year;
const sample = league.players.find((p) => p.teamId !== null && p.age === 24)!;
const sampleAge = sample.age;
const state = beginOffseason(league, season);

describe("the offseason", () => {
  it("closes the books: careers, awards and history", () => {
    expect(league.history).toHaveLength(1);
    const h = league.history[0]!;
    expect(h.year).toBe(year);
    expect(h.champion).toBe(season.postseason!.champion);
    const count = (name: string) => h.awards.filter((a) => a.name === name).length;
    for (const name of ["MVP", "Cy Young", "Rookie of the Year", "Reliever of the Year"]) expect(count(name)).toBe(2);
    // A Gold Glove at each fielding position and a Silver Slugger at each lineup spot, in each league.
    expect(count("Gold Glove")).toBe(16);
    expect(count("Silver Slugger")).toBe(18);
    for (const a of h.awards.filter((x) => x.name === "Gold Glove")) expect(league.players[a.playerId]!.awards).toContain(`${year} ${league.structure.leagues[a.league]} Gold Glove (${a.pos})`);
    // Notes write WAR to a tenth and innings as baseball does ("58.2", not "58.7").
    for (const a of h.awards.filter((x) => /WAR$/.test(x.note))) expect(a.note).toMatch(/ -?\d+\.\d WAR$/);
    for (const a of h.awards.filter((x) => x.name === "Reliever of the Year")) expect(a.note).toMatch(/^\d+ SV, \d+\.\d\d ERA, \d+ K in \d+(\.[12])? IP$/);
    expect(h.executives).toHaveLength(2);
    expect(h.allStar?.score[0]).not.toBe(h.allStar?.score[1]);
    expect(h.allStar?.mvpTeam).toBe(season.allStar!.mvpTeam);
    expect(h.allStar?.mvpTeam).not.toBeUndefined();
    const regular = league.players.find((p) => p.career.some((c) => c.year === year && (c.bat?.PA ?? 0) > 500))!;
    expect(regular).toBeDefined();
  });

  it("ages and develops every player, and keeps the grade scale centered", () => {
    expect(sample.age).toBe(sampleAge + 1);
    for (const shift of Object.values(state.shift)) expect(Math.abs(shift)).toBeLessThan(3);
    expect(state.development.risers.length).toBeGreaterThan(0);
  });

  it("sets up arbitration and free agency", () => {
    expect(state.tenders.length).toBeGreaterThan(50);
    expect(state.expiring.length).toBeGreaterThan(20);
    for (const t of state.tenders) expect(t.salary).toBeGreaterThan(0.5);
  });

  // An arbitration case traded before the tender deadline, checked once it has passed.
  let traded: { id: number; to: number; award: number } | null = null;

  it("trades on next season's contracts until the tender deadline", () => {
    const ctx = winterContext(league, "review");
    // A case his club will tender, at an award well over last season's salary: he's valued at the award.
    const t = state.tenders.find((x) => x.tender && x.salary > league.players[x.playerId]!.contract!.salary + 2)!;
    const p = league.players[t.playerId]!;
    expect(tradeValue(league, p)).toBeLessThan(surplusValue(p));
    // Traded, he takes his tender along, and his new club decides it.
    const from = league.teams[t.teamId]!;
    const to = league.teams.find((x) => x.id !== from.id)!;
    executeTrade(ctx, to, from, [], [p.id]);
    expect(t.teamId).toBe(to.id);
    expect(t.tender).toBe(worthTendering(p, t.salary));
    traded = { id: p.id, to: to.id, award: t.salary };
    // A veteran whose deal is up can't be traded (he leaves at the deadline), and his salary is off next season's payroll.
    const leaving = league.players[state.expiring[0]!]!;
    const club = league.teams[leaving.teamId!]!;
    const other = league.teams.find((x) => x.id !== club.id)!;
    const check = evaluateTrade(league, other, club, [], [leaving.id]);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe(`${playerName(leaving)} becomes a free agent at the tender deadline.`);
    const before = payroll(league, club);
    leaving.contract!.salary += 10;
    expect(payroll(league, club)).toBe(before);
    leaving.contract!.salary -= 10;
  });

  it("runs the draft in reverse order of the standings", () => {
    advanceOffseason(league, season); // review -> tenders
    advanceOffseason(league, season); // tenders -> draft
    const d = league.offseason!.draft!;
    const worst = [...season.records].sort((a, b) => a.w - b.w)[0]!;
    expect(onTheClock(d)!.teamId).toBe(d.order[0]);
    expect(season.records[d.order[0]!]!.w).toBeLessThanOrEqual(worst.w + 1);
    for (const id of state.expiring) expect(league.freeAgents).toContain(id);
  });

  it("sends a case traded before the deadline to arbitration with his new club", () => {
    const p = league.players[traded!.id]!;
    expect(p.teamId).toBe(traded!.to);
    expect(p.contract).toMatchObject({ type: "arb", salary: traded!.award });
  });

  it("resumes the winter exactly from a save", () => {
    advanceOffseason(league, season); // draft -> free agency
    winterWeek(league, season);
    const text = serialize(saveGame(league, season));
    const copy = loadGame(deserialize(text));
    for (let i = 0; i < 3; i++) {
      winterWeek(league, season);
      winterWeek(copy.league, copy.season!);
    }
    expect(copy.league.offseason!.freeAgency!.signings).toEqual(league.offseason!.freeAgency!.signings);
    expect(copy.league.transactions.length).toBe(league.transactions.length);
  });

  it("signs free agents and international amateurs, then sets every club for Opening Day", () => {
    advanceOffseason(league, season); // free agency -> international
    expect(league.offseason!.freeAgency!.signings.length).toBeGreaterThan(20);
    // A veteran whose deal was up and who signed again for three years isn't up for an extension: his deal is on the books.
    const resigned = league.offseason!.freeAgency!.signings.find((x) => x.years >= 3 && state.expiring.includes(x.playerId))!;
    const talk = extensionOptions(league, league.players[resigned.playerId]!, 1);
    expect(talk.ok ? null : talk.reason).toMatch(/^He's signed through/);
    advanceOffseason(league, season); // international -> spring
    expect(league.offseason!.international!.signings.length).toBeGreaterThan(60);
    const ctx = winterContext(league, "spring");
    for (const t of league.teams) {
      expect(rosterProblems(ctx, t)).toEqual([]);
      expect(t.rosters.MLB).toHaveLength(26);
      const seen = new Set<number>();
      for (const level of LEVELS) {
        for (const id of t.rosters[level]) {
          expect(seen.has(id)).toBe(false);
          seen.add(id);
          const p = league.players[id]!;
          expect(p.teamId).toBe(t.id);
          expect(p.retired).toBeUndefined();
          expect(p.contract).not.toBeNull();
          if (p.onFortyMan) expect(p.contract!.type).not.toBe("minor");
        }
      }
      expect(payroll(league, t)).toBeGreaterThan(40);
    }
  });

  it("starts the next season", () => {
    const next = advanceOffseason(league, season)!;
    expect(next).toBeInstanceOf(Season);
    expect(league.year).toBe(year + 1);
    expect(league.offseason).toBeNull();
    next.simDays(5);
    expect(next.games.length).toBeGreaterThan(50);
  });
});

describe("trades", () => {
  const l = generateLeague({ seed: "trade-test" });
  const [a, b] = [l.teams[0]!, l.teams[1]!];
  const best = (t: typeof a) => orgPlayers(l, t).sort((x, y) => surplusValue(y) - surplusValue(x));

  it("values cheap young stars far above expensive veterans", () => {
    const young = orgPlayers(l, a).filter((p) => p.contract?.type === "pre-arb" && p.level === "MLB");
    const paid = orgPlayers(l, a).filter((p) => p.contract?.type === "guaranteed");
    const top = Math.max(...young.map((p) => surplusValue(p)));
    const vet = Math.min(...paid.map((p) => surplusValue(p)));
    expect(top).toBeGreaterThan(vet + 20);
  });

  it("turns down lopsided offers and accepts overpays", () => {
    const theirStar = best(b)[0]!;
    const myScrub = best(a).at(-1)!;
    expect(evaluateTrade(l, a, b, [myScrub.id], [theirStar.id]).ok).toBe(false);
    const myStar = best(a)[0]!;
    const theirScrub = best(b).filter((p) => !p.onFortyMan).at(-1)!;
    expect(evaluateTrade(l, a, b, [myStar.id], [theirScrub.id]).ok).toBe(true);
  });

  it("moves players between organizations and logs the deal", () => {
    const give = best(a).filter((p) => !p.onFortyMan)[0]!;
    const get = best(b).filter((p) => !p.onFortyMan)[0]!;
    executeTrade({ league: l, day: 10, expanded: false }, a, b, [give.id], [get.id]);
    expect(give.teamId).toBe(b.id);
    expect(get.teamId).toBe(a.id);
    expect(LEVELS.some((lv) => b.rosters[lv].includes(give.id))).toBe(true);
    expect(l.transactions.filter((t) => t.type === "trade")).toHaveLength(2);
  });
});

describe("international signings", () => {
  it("price amateurs from the market's read of them, not from who they truly are", () => {
    const l = generateLeague({ seed: "intl-asks" });
    const rng = new Rng("intl-asks");
    const kids = Array.from({ length: 110 }, (_, i) => prospect(rng.fork(`kid${i}`), -(i + 1)));
    const fv = (p: (typeof kids)[number]) => overallGrade(p, true);
    const mean = (ps: typeof kids) => ps.reduce((s, p) => s + fv(p), 0) / ps.length;
    // Sorting by the asks is a league-average scout's board, not a list of the truly best.
    const byAsk = [...kids].sort((a, b) => bonusAsk(l, b) - bonusAsk(l, a) || fv(a) - fv(b)).slice(0, 10);
    const best = [...kids].sort((a, b) => fv(b) - fv(a)).slice(0, 10);
    expect(mean(byAsk)).toBeLessThan(mean(best) - 3);
    // The kids the market reads as the best still ask the most.
    const market = (p: (typeof kids)[number]) => overallGrade(perceive(l, null, p), true);
    const top = [...kids].sort((a, b) => market(b) - market(a))[0]!;
    expect(bonusAsk(l, top)).toBe(Math.max(...kids.map((p) => bonusAsk(l, p))));
  });
});

describe("old saves", () => {
  it("load with contracts assigned", () => {
    const l = generateLeague({ seed: "migrate-test" });
    const save = saveGame(l, null);
    const old = JSON.parse(serialize(save));
    old.version = 1;
    delete old.league.history;
    delete old.league.freeAgents;
    for (const p of old.league.players) {
      delete p.contract;
      delete p.career;
      delete p.awards;
    }
    for (const t of old.league.teams) delete t.budget;
    const { league: migrated } = loadGame(old);
    expect(migrated.history).toEqual([]);
    const regular = migrated.players.find((p) => p.onFortyMan)!;
    expect(regular.contract).not.toBeNull();
    expect(migrated.teams[0]!.budget).toBeGreaterThan(80);
  });
});

describe("development", () => {
  const cls = draftClass(new Rng("development-test"), 450)
    .sort((a, b) => boardValue(b) - boardValue(a))
    .slice(0, 300);

  it("gets draftees most of the way to their projection in their early twenties", () => {
    // College hitters (21-22): after three winters little of the hit tool's projected growth is left.
    const college = cls.filter((p) => p.age >= 21 && !p.pitching && p.hitting.hit.future - p.hitting.hit.present >= 5);
    const left = college.map((p) => {
      const q = projectPlayer(p, 3);
      return (q.hitting.hit.future - q.hitting.hit.present) / (p.hitting.hit.future - p.hitting.hit.present);
    });
    expect(college.length).toBeGreaterThan(30);
    expect(left.reduce((a, b) => a + b, 0) / left.length).toBeLessThan(0.25);
  });

  it("turns a draft class into big leaguers on time", () => {
    const atLine = (years: number) => cls.filter((p) => playerValue(projectPlayer(p, years)) >= -5).length;
    expect(atLine(5)).toBeGreaterThan(30);
    // Nearly everyone who'll make it is there within five years of the draft.
    expect(atLine(5)).toBeGreaterThanOrEqual(0.9 * atLine(7));
  });
});
