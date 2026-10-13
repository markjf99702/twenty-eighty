import { describe, expect, it } from "vitest";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { Season } from "../src/season/season";
import { allStarLine } from "../web/src/worker/allstar";
import { careerLine } from "../web/src/worker/records";
import { careerTotals } from "../src/stats/career";
import { liveLines, liveSeason } from "../src/stats/records";
import { evaluateTrade, tradeValue } from "../src/org/trades";
import { warShift } from "../src/scouting/analytics";
import { blockView, historyView, tradeSide } from "../web/src/worker/winter";
import { acceptJob } from "../src/finance/owner";
import { dashboardView, playerView, rosterActions, rosterMessage, StatsCache, status, transactions } from "../web/src/worker/views";
import { budgetRoom } from "../src/org/contracts";
import { callUp, designateForAssignment, optionPlayer } from "../src/org/roster";
import { playerValue } from "../src/org/value";
import { MAX_OPTION_YEARS, type Player, playerName } from "../src/players/types";

const league = generateLeague({ seed: "player-view" });
hireGm(league, 3);
const season = new Season(league, { minors: false });
const stats = new StatsCache(() => season);
const ctx = season.rosterContext();

describe("a player's page", () => {
  it("says so when the link points at no one in this league", () => {
    // An old link, or one from another league.
    expect(() => playerView(season, stats, 999999, ctx)).toThrow("There's no player with that number in this league.");
  });

  it("gives each pitch its share of what he throws", () => {
    const pitchers = league.players.filter((p) => p.pitching && p.teamId !== null).slice(0, 60);
    for (const p of pitchers) {
      const v = playerView(season, stats, p.id, ctx);
      expect(v.pitches.length).toBeGreaterThan(1);
      expect(v.pitches.reduce((s, x) => s + x.usage, 0)).toBeCloseTo(1, 6);
      // The order and proportions stay his: the fastball he leans on most is still the biggest share.
      const raw = p.pitching!.pitches;
      expect(v.pitches[0]!.usage / v.pitches[1]!.usage).toBeCloseTo(raw[0]!.usage / raw[1]!.usage, 6);
    }
  });
});

describe("a player's career", () => {
  const l = generateLeague({ seed: "career-live" });
  hireGm(l, 7);
  const s = new Season(l, { minors: false });
  s.simDays(6);
  const c = new StatsCache(() => s);
  const vet = l.players.find((p) => p.prior?.bat && p.level === "MLB" && !p.pitching && (s.stats().hitters.find((h) => h.id === p.id)?.line.PA ?? 0) > 10)!;

  it("counts this season so far, the way the record book does, until it's on his record", () => {
    const v = playerView(s, c, vet.id, s.rosterContext());
    const line = s.stats().hitters.find((h) => h.id === vet.id)!;
    expect(v.careerLive).toMatchObject({ year: l.year, level: "MLB", teamId: vet.teamId, inProgress: true, bat: { PA: line.line.PA, HR: line.line.HR } });
    const book = careerTotals(vet, liveLines(liveSeason(s), vet.id));
    expect(v.careerTotals.bat).toEqual(book.bat);
    expect(v.careerTotals.bat!.PA).toBe(vet.prior!.bat!.PA + line.line.PA);
    // Once the season is on his record (the winter), the record has it and there's no row in the making.
    l.history.push({ year: l.year, champion: -1, pennants: [], standings: [], awards: [], userTeamId: 7 });
    expect(playerView(s, c, vet.id, s.rosterContext()).careerLive).toBeNull();
    l.history.pop();
  });

  it("adds up a pitcher's pitching, whatever turns he took at the plate", () => {
    const p = l.players.find((x) => x.pitching && x.prior?.pit && x.level === "MLB")!;
    // An emergency lineup's last reliever: a batting line in the majors and no pitching that season.
    p.career.push({ year: l.year - 1, level: "MLB", teamId: p.teamId, bat: { G: 1, PA: 3, AB: 3, H: 0, D: 0, T: 0, HR: 0, R: 0, RBI: 0, BB: 0, SO: 2, SB: 0, wRCplus: -100, WAR: -0.1 } });
    const v = playerView(s, c, p.id, s.rosterContext());
    const live = s.stats().pitchers.find((x) => x.id === p.id)?.line;
    expect(v.careerTotals.pit!.G).toBe(p.prior!.pit!.G + (live?.G ?? 0));
    expect(v.careerTotals.pit!.GS).toBe(p.prior!.pit!.GS + (live?.GS ?? 0));
    p.career.pop();
  });
});

describe("the trade desk in season", () => {
  it("values players on what's left of the season, so the ones picked add up to the deal's totals", () => {
    const l = generateLeague({ seed: "desk-values" });
    hireGm(l, 2);
    const s = new Season(l, { minors: false });
    const c = new StatsCache(() => s);
    s.day = 100;
    const fraction = 1 - s.day / s.totalDays;
    const seen = (viewer: number, p: Player) => warShift(s, viewer, p);
    const [mine, partner] = [l.teams[2]!, l.teams.find((t) => t.id !== 2 && t.league === l.teams[2]!.league)!];
    const give = tradeSide(s, c, mine, s.rosterContext()).players.filter((p) => p.level === "MLB").slice(0, 2);
    const get = tradeSide(s, c, partner).players.filter((p) => p.level === "MLB").slice(0, 1);
    const check = evaluateTrade(l, mine, partner, give.map((p) => p.id), get.map((p) => p.id), fraction, seen);
    const sum = (ps: { surplus: number }[]) => ps.reduce((t, p) => t + p.surplus, 0);
    expect(Math.abs(check.give - sum(give))).toBeLessThan(0.11);
    expect(Math.abs(check.get - sum(get))).toBeLessThan(0.06);
    // The block's values, and a player's page, read the same.
    for (const t of l.teams.filter((x) => x.league === partner.league)) Object.assign(s.records[t.id]!, { w: 60, l: 55 });
    Object.assign(s.records[partner.id]!, { w: 45, l: 70 });
    const block = blockView(s, c);
    expect(block.length).toBeGreaterThan(0);
    for (const b of block) expect(b.surplus).toBe(tradeValue(l, l.players[b.id]!, fraction, seen(2, l.players[b.id]!)));
    expect(playerView(s, c, get[0]!.id, s.rosterContext()).surplus).toBe(get[0]!.surplus);
  });
});

describe("league history", () => {
  it("shows the club you ran each season, after a change of jobs", () => {
    const l = generateLeague({ seed: "history-new-job" });
    hireGm(l, 4);
    const [old, next] = [l.teams[4]!, l.teams[9]!];
    const star = l.players[old.rosters.MLB[0]!]!;
    l.history.push({
      year: l.year,
      champion: 1,
      pennants: [1, 2],
      standings: l.teams.map((t) => ({ teamId: t.id, w: 70 + t.id, l: 92 - t.id, rs: 700, ra: 700, finish: "Missed postseason" })),
      awards: [{ name: "MVP", league: old.league, playerId: star.id, teamId: old.id, note: ".300/.400/.550, 40 HR, 7.0 WAR" }],
      userTeamId: old.id,
    });
    // Fired after the season, and hired by another club.
    l.gm!.fired = true;
    l.gm!.offers = [next.id];
    acceptJob(l, next.id);
    const season = historyView(l).seasons[0]!;
    expect(season.mine).toEqual({ record: "74-88", finish: "Missed postseason", team: old.abbrev });
    expect(season.awards[0]!.mine).toBe(true);
  });
});

describe("the front office", () => {
  it("lists your top prospects in the order your scouts rank them", () => {
    const fvs = dashboardView(season, stats, new Map(), status(league, season, true)).prospects.map((p) => p.fv);
    expect(fvs).toHaveLength(8);
    expect(fvs).toEqual([...fvs].sort((a, b) => b - a));
  });
});

describe("a roster move's toast", () => {
  it("says who claimed a designated player, or that he cleared waivers", () => {
    const l = generateLeague({ seed: "dfa-toast" });
    hireGm(l, 0);
    const s = new Season(l, { minors: false });
    const c = s.rosterContext();
    const [mine, claimer] = [l.teams[0]!, l.teams[1]!];
    const spare = claimer.fortyMan.map((id) => l.players[id]!).find((p) => p.level !== "MLB" && !p.il)!;
    designateForAssignment(c, claimer, spare, []);
    claimer.budget += 40 - budgetRoom(l, claimer);
    const best = mine.rosters.MLB.map((id) => l.players[id]!).reduce((a, b) => (playerValue(b) > playerValue(a) ? b : a));
    let before = l.transactions.length;
    designateForAssignment(c, mine, best, [claimer]);
    expect(rosterMessage(l, "dfa", best, l.transactions.slice(before))).toBe(`The ${claimer.nickname} claimed ${playerName(best)} off waivers.`);
    const fringe = mine.fortyMan.map((id) => l.players[id]!).find((p) => p.level !== "MLB" && !p.il)!;
    before = l.transactions.length;
    designateForAssignment(c, mine, fringe, []);
    expect(rosterMessage(l, "dfa", fringe, l.transactions.slice(before))).toBe(`${playerName(fringe)} cleared waivers and was outrighted to AAA.`);
  });
});

describe("roster moves on Opening Day", () => {
  // Every club opens with a full active roster and a full 40-man.
  const l = generateLeague({ seed: "opening-day-moves" });
  hireGm(l, 4);
  const s = new Season(l, { minors: false });
  const c = s.rosterContext();
  const team = l.teams[4]!;
  const all = (ids: number[]) => ids.map((id) => l.players[id]!);
  const reason = (p: Player, label: RegExp) => rosterActions(p, team, c).find((a) => label.test(a.label))?.reason;

  it("say where to make room", () => {
    expect([team.rosters.MLB.length, team.fortyMan.length]).toEqual([26, 40]);
    const onForty = all(team.rosters.AAA).find((p) => p.onFortyMan && !p.pitching)!;
    expect(reason(onForty, /^Call up$/)).toBe("The active roster is full (26/26): option or designate someone on the big-league roster first.");
    const arm = all(team.rosters.AAA).find((p) => p.onFortyMan && p.pitching)!;
    expect(reason(arm, /^Call up$/)).toBe("The active roster is full (26/26): option or designate a pitcher on the big-league roster first.");
    const off = all(team.rosters.AAA).find((p) => !p.onFortyMan && !p.pitching)!;
    expect(reason(off, /^Select contract$/)).toBe(
      "The active roster (26/26) and the 40-man (40/40) are both full: designate someone on the big-league roster first, which opens a spot on both.",
    );
    expect(reason(off, /^Add to 40-man$/)).toBe("He needs a 40-man spot and the 40-man is full (40/40): designate a 40-man player first.");
  });

  it("say how to send down a veteran who can refuse an option, and when an option is his last", () => {
    const vet = all(team.rosters.MLB).find((p) => p.service >= 5 * 172)!;
    expect(reason(vet, /^Option to AAA/)).toBe(`${playerName(vet)} has 5+ years of service and can refuse an option, so designating him is the way to send him out.`);
    const young = all(team.rosters.MLB).find((p) => p.service < 5 * 172 && !p.options.usedThisYear)!;
    const used = young.options.used;
    young.options.used = MAX_OPTION_YEARS - 1;
    expect(rosterActions(young, team, c).find((a) => a.kind === "option")!.label).toBe("Option to AAA (his last option)");
    young.options.used = MAX_OPTION_YEARS - 2;
    expect(rosterActions(young, team, c).find((a) => a.kind === "option")!.label).toBe("Option to AAA");
    young.options.used = used;
  });

  it("say where a player called up plays", () => {
    // Room for a hitter and a pitcher: option one of each.
    const down = (pitcher: boolean) => all(team.rosters.MLB).find((p) => Boolean(p.pitching) === pitcher && p.service < 3 * 172 && p.options.used < MAX_OPTION_YEARS)!;
    expect(optionPlayer(c, team, down(false)).ok && optionPlayer(c, team, down(true)).ok).toBe(true);
    for (const pitcher of [false, true]) {
      const p = all(team.rosters.AAA).find((x) => x.onFortyMan && Boolean(x.pitching) === pitcher && !x.injury && x.optionedDay === null)!;
      expect(callUp(c, team, p).ok).toBe(true);
      const msg = rosterMessage(l, "callUp", p, [])!;
      const d = team.depth;
      if (pitcher) expect(msg).toBe(`${playerName(p)} is up and joins the ${d.rotation.includes(p.id) ? "rotation" : "bullpen"}.`);
      else if ([...Object.values(d.starters), d.dh].includes(p.id)) expect(msg).toMatch(new RegExp(`^${playerName(p)} is up and starts (at|in|as) .+\\.$`));
      else {
        const regular = p.position === "DH" ? d.dh : d.starters[p.position as Exclude<typeof p.position, "DH" | "P">];
        expect(msg.startsWith(`${playerName(p)} is up; the manager has him on the bench (${playerName(l.players[regular]!)} starts `)).toBe(true);
        expect(msg.endsWith(").")).toBe(true);
      }
    }
  });
});

describe("dates", () => {
  it("put last winter's moves on their own calendar", () => {
    const l = generateLeague({ seed: "wire-dates" });
    hireGm(l, 5);
    const s = new Season(l, { minors: false });
    const team = l.teams[5]!;
    const p = l.players[team.rosters.AAA[0]!]!;
    // A spring move in the 2026-27 winter (Mar 1, 2027), read once 2027 is under way: 2028 has a Feb 29, 2027 doesn't.
    l.transactions.push({ year: l.year, day: 340, teamId: team.id, playerId: p.id, type: "promote", text: "Assigned him to AAA" });
    l.year += 1;
    expect(transactions(s, { teamId: team.id, limit: 1 })[0]!.date).toBe("Mar 1");
    expect(playerView(s, new StatsCache(() => s), p.id, s.rosterContext()).transactions[0]!.date).toBe("Mar 1 2027");
  });
});

describe("the All-Star Game's line", () => {
  it("puts the winner first, whichever league was at home", () => {
    const [a, h] = [league.structure.leagues[0]!.replace(" League", ""), league.structure.leagues[1]!.replace(" League", "")];
    const city = league.teams[3]!.city;
    expect(allStarLine(league, { leagues: [0, 1], score: [5, 8], host: 3, mvp: null, note: "" })!.text).toBe(`${h} 8, ${a} 5 in ${city}`);
    expect(allStarLine(league, { leagues: [0, 1], score: [6, 2], host: 3, mvp: null, note: "" })!.text).toBe(`${a} 6, ${h} 2 in ${city}`);
  });
});

describe("Hall of Fame plaques", () => {
  it("separate the thousands in every count", () => {
    const bat = { G: 2900, PA: 12000, AB: 10500, H: 3006, D: 500, T: 90, HR: 420, RBI: 1700, BB: 1300, SB: 1247, WAR: 110.2 };
    expect(careerLine(bat, null)).toBe(".286, 3,006 H, 420 HR, 1,700 RBI, 1,247 SB, 110.2 WAR");
    const pit = { G: 1100, GS: 0, W: 80, L: 70, SV: 1012, outs: 3600, ER: 300, SO: 1500, BB: 400, WAR: 40.5 };
    expect(careerLine(null, pit)).toBe("80-70, 2.25 ERA, 1,500 K, 1,012 SV, 40.5 WAR");
  });
});
