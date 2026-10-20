import { beforeEach, describe, expect, it } from "vitest";
import { generateLeague } from "../src/league/generate";
import type { League, Team } from "../src/league/types";
import { budgetRoom, payroll } from "../src/org/contracts";
import { autoDepthChart, slotValue } from "../src/org/depth";
import { loadGame, type SaveGame, saveGame, serialize } from "../src/save/save";
import {
  activateFromIl,
  activePitchers,
  callUp,
  designateForAssignment,
  handSetDepth,
  optionPlayer,
  placeOnIl,
  positionLabel,
  refreshDepth,
  releasePlayer,
  rosterProblems,
  type RosterContext,
  setDepthOwners,
} from "../src/org/roster";
import { winterContext } from "../src/offseason/offseason";
import type { OffseasonPhase, Tender } from "../src/offseason/types";
import { playerValue } from "../src/org/value";
import { FIELD_POSITIONS, type Player, playerName } from "../src/players/types";
import { staffCost } from "../src/scouting/scouting";

let league: League;
let team: Team;
let ctx: RosterContext;
const player = (id: number): Player => league.players[id]!;

beforeEach(() => {
  league = generateLeague({ seed: "roster-rules" });
  team = league.teams[0]!;
  ctx = { league, day: 20, expanded: false };
});

function optionable(): Player {
  return team.rosters.MLB.map(player).find((p) => p.service < 3 * 172 && p.options.used < 3 && !p.pitching)!;
}

function injure(p: Player, days: number): void {
  p.injury = { name: "Hamstring strain", days, daysLeft: days, startDay: ctx.day };
}

describe("roster rules", () => {
  it("starts every club legal", () => {
    for (const t of league.teams) expect(rosterProblems(ctx, t)).toEqual([]);
  });

  it("won't call anyone up to a full active roster", () => {
    const prospect = team.rosters.AAA.map(player).find((p) => p.onFortyMan)!;
    const result = callUp(ctx, team, prospect);
    expect(result.ok).toBe(false);
  });

  it("options a player, burning one option year, and enforces the minimum stay", () => {
    const p = optionable();
    const before = p.options.used;
    expect(optionPlayer(ctx, team, p).ok).toBe(true);
    expect(p.level).toBe("AAA");
    expect(p.options.used).toBe(before + 1);
    expect(team.rosters.MLB).toHaveLength(25);

    // Can't bring him straight back...
    expect(callUp({ ...ctx, day: ctx.day + 3 }, team, p).ok).toBe(false);
    // ...unless he's replacing an injured player, or ten days have passed.
    expect(callUp({ ...ctx, day: ctx.day + 3 }, team, p, true).ok).toBe(true);
  });

  it("uses only one option year per season no matter how often he's sent down", () => {
    const p = optionable();
    const before = p.options.used;
    optionPlayer(ctx, team, p);
    callUp({ ...ctx, day: ctx.day + 12 }, team, p);
    optionPlayer({ ...ctx, day: ctx.day + 13 }, team, p);
    expect(p.options.used).toBe(before + 1);
  });

  it("refuses to option veterans with five years of service", () => {
    const vet = team.rosters.MLB.map(player).find((p) => p.service >= 5 * 172)!;
    expect(optionPlayer(ctx, team, vet).ok).toBe(false);
  });

  it("selects a non-40-man player's contract, using a 40-man spot", () => {
    optionPlayer(ctx, team, optionable());
    const dfaTarget = team.fortyMan.map(player).find((p) => p.level === "AAA")!;
    designateForAssignment(ctx, team, dfaTarget);
    const minorLeaguer = team.rosters.AAA.map(player).find((p) => !p.onFortyMan && !p.injury)!;
    expect(callUp(ctx, team, minorLeaguer, true).ok).toBe(true);
    expect(minorLeaguer.onFortyMan).toBe(true);
    expect(team.fortyMan).toContain(minorLeaguer.id);
    expect(rosterProblems(ctx, team)).toEqual([]);
  });

  it("moves injured players to the IL and back, with the 60-day list freeing a 40-man spot", () => {
    const hurt = team.rosters.MLB.map(player)[0]!;
    injure(hurt, 80);
    expect(placeOnIl(ctx, team, hurt).ok).toBe(true);
    expect(hurt.il).toBe("IL60");
    expect(team.fortyMan).not.toContain(hurt.id);
    expect(team.rosters.MLB).not.toContain(hurt.id);

    // Too early to activate, and still hurt.
    expect(activateFromIl({ ...ctx, day: ctx.day + 30 }, team, hurt).ok).toBe(false);
    hurt.injury = null;
    const later = { ...ctx, day: ctx.day + 61 };
    expect(activateFromIl(later, team, hurt).ok).toBe(true);
    expect(team.rosters.MLB).toContain(hurt.id);
    expect(team.fortyMan).toContain(hurt.id);
  });

  it("sends an unclaimed DFA to AAA off the 40-man", () => {
    const fringe = team.fortyMan.map(player).find((p) => p.level === "AAA")!;
    designateForAssignment(ctx, team, fringe, []);
    expect(fringe.onFortyMan).toBe(false);
    expect(fringe.level).toBe("AAA");
    expect(team.fortyMan).toHaveLength(39);
  });

  it("keeps an arbitration salary on the books through an outright and back", () => {
    // Every 40-man is full on a new league, so nobody can claim him.
    expect(league.teams.every((t) => t.fortyMan.length >= 40)).toBe(true);
    const arb = team.rosters.MLB.map(player)
      .filter((p) => p.contract?.type === "arb")
      .sort((a, b) => b.contract!.salary - a.contract!.salary)[0]!;
    const salary = arb.contract!.salary;
    expect(salary).toBeGreaterThan(2);
    const before = payroll(league, team);
    expect(designateForAssignment(ctx, team, arb, league.teams).ok).toBe(true);
    expect(arb.teamId).toBe(team.id);
    expect(arb.level).toBe("AAA");
    expect(arb.contract).toMatchObject({ type: "arb", salary });
    expect(payroll(league, team)).toBe(before);
    // Selected back, he's paid what he was.
    expect(callUp(ctx, team, arb).ok).toBe(true);
    expect(arb.contract).toMatchObject({ type: "arb", salary });
    expect(payroll(league, team)).toBe(before);
  });

  it("owes the rest of an arbitration salary on a release, as on an outright", () => {
    const arb = team.rosters.MLB.map(player)
      .filter((p) => p.contract?.type === "arb")
      .sort((a, b) => b.contract!.salary - a.contract!.salary)[0]!;
    const salary = arb.contract!.salary;
    const before = payroll(league, team);
    expect(releasePlayer(ctx, team, arb).ok).toBe(true);
    expect(arb.teamId).toBeNull();
    expect(team.deadMoney).toContainEqual({ playerId: arb.id, amount: salary, years: 1 });
    // Released or outrighted, his salary stays on the payroll.
    expect(payroll(league, team)).toBe(before);
  });

  it("owes nothing on a release before the tender deadline for a case or a veteran whose deal is up", () => {
    const [pending, leaving] = team.rosters.MLB.map(player).filter((p) => !p.pitching);
    pending!.contract = { type: "arb", salary: 3.2, years: 1 };
    leaving!.contract = { type: "guaranteed", salary: 12, years: 1 };
    const tender: Tender = { playerId: pending!.id, teamId: team.id, salary: 5.4, tender: true };
    league.offseason = {
      year: league.year,
      phase: "tenders",
      development: { risers: [], fallers: [], retirements: [] },
      shift: {},
      tenders: [tender],
      expiring: [leaving!.id],
      draft: null,
      freeAgency: null,
      international: null,
    };
    expect(releasePlayer(ctx, team, pending!).ok).toBe(true);
    expect(releasePlayer(ctx, team, leaving!).ok).toBe(true);
    expect(team.deadMoney).toEqual([]);
  });

  it("turns a pre-arbitration deal into a minor league one on an outright", () => {
    const young = team.fortyMan.map(player).find((p) => p.contract?.type === "pre-arb" && p.level !== "MLB")!;
    designateForAssignment(ctx, team, young, []);
    expect(young.contract?.type).toBe("minor");
  });

  it("lets a club claim a player off waivers only if it can afford his contract", () => {
    // A good big leaguer on a big guaranteed deal, and two clubs with a 40-man spot open.
    const vet = team.rosters.MLB.map(player).reduce((a, b) => (playerValue(b) > playerValue(a) ? b : a));
    vet.contract = { type: "guaranteed", salary: 12, years: 3, signed: league.year - 1, total: 48 };
    const [broke, flush] = [league.teams[1]!, league.teams[2]!];
    for (const club of [broke, flush]) {
      const spare = club.fortyMan.map(player).find((p) => p.level !== "MLB" && !p.il)!;
      designateForAssignment(ctx, club, spare, []);
    }
    broke.budget = payroll(league, broke) + staffCost(league, broke) - 1;
    flush.budget = payroll(league, flush) + staffCost(league, flush) + 30;
    expect(budgetRoom(league, broke)).toBeLessThan(0);
    designateForAssignment(ctx, team, vet, [broke, flush]);
    expect(vet.teamId).toBe(flush.id);
    expect(league.transactions.at(-1)?.text).toMatch(/^Claimed/);
  });

  it("claims for your club only while your assistant GM runs the roster", () => {
    // Your club has a 40-man spot open, room in its budget, and the first claim.
    const yours = league.teams[1]!;
    league.userTeamId = yours.id;
    const spare = yours.fortyMan.map(player).find((p) => p.level !== "MLB" && !p.il)!;
    designateForAssignment(ctx, yours, spare, []);
    yours.budget = payroll(league, yours) + staffCost(league, yours) + 30;
    const [best, next, third] = team.rosters.MLB.map(player).sort((a, b) => playerValue(b) - playerValue(a));

    // Running the roster yourself: nobody claims him for you.
    yours.manualRoster = true;
    designateForAssignment(ctx, team, best!, [yours]);
    expect(best!.teamId).toBe(team.id);
    expect(yours.fortyMan).toHaveLength(39);

    // With the assistant on, he claims, and says so.
    yours.manualRoster = false;
    designateForAssignment(ctx, team, next!, [yours]);
    expect(next!.teamId).toBe(yours.id);
    expect(league.transactions.filter((t) => t.teamId === yours.id).at(-1)?.text).toMatch(/^Your assistant GM claimed .+ off waivers from /);

    // And only if the salary fits the budget.
    third!.contract = { type: "guaranteed", salary: 12, years: 3, signed: league.year - 1, total: 48 };
    const room = yours.fortyMan.map(player).find((p) => p.level !== "MLB" && !p.il && p.id !== next!.id)!;
    designateForAssignment(ctx, yours, room, []);
    yours.budget = payroll(league, yours) + staffCost(league, yours) - 1;
    designateForAssignment(ctx, team, third!, [yours]);
    expect(third!.teamId).toBe(team.id);
  });

  it("tells your moves who claimed the player you designated", () => {
    league.userTeamId = team.id;
    const claimer = league.teams[2]!;
    const spare = claimer.fortyMan.map(player).find((p) => p.level !== "MLB" && !p.il)!;
    designateForAssignment(ctx, claimer, spare, []);
    claimer.budget = payroll(league, claimer) + staffCost(league, claimer) + 30;
    const best = team.rosters.MLB.map(player).reduce((a, b) => (playerValue(b) > playerValue(a) ? b : a));
    designateForAssignment(ctx, team, best, [claimer]);
    expect(best.teamId).toBe(claimer.id);
    const mine = league.transactions.filter((t) => t.teamId === team.id).at(-1)!;
    expect(mine.text).toBe(`Designated ${positionLabel(best)} ${playerName(best)} for assignment; claimed off waivers by ${claimer.abbrev}`);
  });

  it("logs every move", () => {
    optionPlayer(ctx, team, optionable());
    expect(league.transactions.at(-1)?.text).toMatch(/^Optioned/);
  });

  it("patches a hand-set depth chart without playing anyone twice", () => {
    league.userTeamId = team.id;
    // Move the manager's first baseman to DH, then lose the new first baseman.
    const d = structuredClone(team.depth);
    const first = d.starters["1B"];
    const newFirst = d.dh;
    d.dh = first;
    d.starters["1B"] = newFirst;
    handSetDepth(league, team, d);
    expect(optionPlayer(ctx, team, player(newFirst)).ok || designateForAssignment(ctx, team, player(newFirst)).ok).toBe(true);

    const lineup = [...FIELD_POSITIONS.map((pos) => team.depth.starters[pos]), team.depth.dh];
    expect(new Set(lineup).size).toBe(9);
    expect(team.depth.dh).toBe(first);
    const active = new Set(team.rosters.MLB);
    for (const id of [...lineup, ...team.depth.bench, ...team.depth.rotation, ...team.depth.bullpen]) expect(active.has(id)).toBe(true);
    const all = [...lineup, ...team.depth.bench, ...team.depth.rotation, ...team.depth.bullpen];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(team.rosters.MLB.length);

    // Refreshing again changes nothing.
    const before = JSON.stringify(team.depth);
    refreshDepth(league, team);
    expect(JSON.stringify(team.depth)).toBe(before);
  });

  it("fills a hole in a hand-set lineup with a player who plays the position", () => {
    // Every club: start the backup catcher, then lose the center fielder.
    let checked = 0;
    for (const club of league.teams) {
      league.userTeamId = club.id;
      const d = structuredClone(club.depth);
      const regular = d.starters.C;
      const backup = d.bench.find((id) => player(id).positions.includes("C"));
      if (backup === undefined) continue;
      d.starters.C = backup;
      d.bench = d.bench.map((id) => (id === backup ? regular : id));
      handSetDepth(league, club, d);
      const kept = { ...club.depth.starters, DH: club.depth.dh };
      const free = club.depth.bench.map(player);
      const centerFielders = free.filter((p) => p.positions.includes("CF"));
      const cf = player(club.depth.starters.CF);
      injure(cf, 30);
      expect(placeOnIl(ctx, club, cf).ok).toBe(true);

      // The rest of the user's lineup stands.
      for (const pos of FIELD_POSITIONS) if (pos !== "CF") expect(club.depth.starters[pos]).toBe(kept[pos]);
      expect(club.depth.dh).toBe(kept.DH);
      if (centerFielders.length === 0) continue;
      // A center fielder from the bench takes over (the best of them by the manager's measure), not the catcher on the bench.
      const best = centerFielders.reduce((a, b) => (slotValue(b, "CF") > slotValue(a, "CF") ? b : a));
      expect(club.depth.starters.CF).toBe(best.id);
      expect(club.depth.bench).toContain(regular);
      checked++;
    }
    expect(checked).toBeGreaterThan(15);
  });

  it("leaves the lineup to the manager when you change only the pitching staff", () => {
    league.userTeamId = team.id;
    const d = structuredClone(team.depth);
    [d.bullpen[0], d.bullpen[1]] = [d.bullpen[1]!, d.bullpen[0]!];
    handSetDepth(league, team, d);
    expect(team.manualPitching).toBe(true);
    expect(team.manualLineup).toBeFalsy();
    // The catcher goes on the injured list and comes back: the manager runs the lineup as he would for any club, so
    // the catcher has his job back, and your bullpen order stands throughout.
    const c = player(team.depth.starters.C);
    injure(c, 10);
    expect(placeOnIl(ctx, team, c).ok).toBe(true);
    const manager = autoDepthChart(team.rosters.MLB.map(player));
    expect(team.depth.starters).toEqual(manager.starters);
    expect(team.depth.dh).toBe(manager.dh);
    c.injury = null;
    ctx.day += 11;
    expect(activateFromIl(ctx, team, c).ok).toBe(true);
    expect(team.depth.starters.C).toBe(c.id);
    expect(team.depth.bullpen.slice(0, 2)).toEqual(d.bullpen.slice(0, 2));
  });

  it("gives a regular you placed his spot back when he returns", () => {
    league.userTeamId = team.id;
    // Swap the first baseman and the DH, then lose the new first baseman for ten days.
    const d = structuredClone(team.depth);
    const [first, dh] = [d.starters["1B"], d.dh];
    d.starters["1B"] = dh;
    d.dh = first;
    handSetDepth(league, team, d);
    const regular = player(dh);
    injure(regular, 10);
    expect(placeOnIl(ctx, team, regular).ok).toBe(true);
    const fill = team.depth.starters["1B"];
    expect(fill).not.toBe(regular.id);
    expect(team.depth.dh).toBe(first);
    // Healthy and back: he plays first again, and his fill-in goes back to the bench.
    regular.injury = null;
    ctx.day += 11;
    expect(activateFromIl(ctx, team, regular).ok).toBe(true);
    expect(team.depth.starters["1B"]).toBe(regular.id);
    expect(team.depth.dh).toBe(first);
    expect(team.depth.bench).toContain(fill);
  });

  it("puts a call-up who plays the position in the spot of a regular who's out", () => {
    const catches = (p: Player) => p.position === "C" || p.positions.includes("C");
    let checked = 0;
    for (const club of league.teams) {
      league.userTeamId = club.id;
      const d = structuredClone(club.depth);
      const backups = d.bench.filter((id) => catches(player(id)));
      const callee = club.rosters.AAA.map(player).find((p) => catches(p) && p.onFortyMan && !p.injury);
      if (backups.length !== 1 || !callee) continue;
      // Your choice: the backup catcher is the DH. Then the catcher goes on the injured list, and nobody free catches.
      const backup = backups[0]!;
      d.bench = d.bench.map((id) => (id === backup ? d.dh : id));
      d.dh = backup;
      handSetDepth(league, club, d);
      const c = player(club.depth.starters.C);
      injure(c, 30);
      expect(placeOnIl(ctx, club, c).ok).toBe(true);
      expect(club.depth.dh).toBe(backup);
      expect(catches(player(club.depth.starters.C))).toBe(false);
      // The catcher called up to replace him catches, and your DH stays.
      expect(callUp(ctx, club, callee, true).ok).toBe(true);
      expect(club.depth.starters.C).toBe(callee.id);
      expect(club.depth.dh).toBe(backup);
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });

  it("hands the depth chart back to the manager, or takes it over as it stands", () => {
    league.userTeamId = team.id;
    const manager = structuredClone(team.depth);
    setDepthOwners(league, team, { lineup: true, pitching: true });
    expect(team.depthPlan).toEqual(manager);
    expect(team.depth).toEqual(manager);
    const d = structuredClone(team.depth);
    [d.rotation[0], d.rotation[1]] = [d.rotation[1]!, d.rotation[0]!];
    handSetDepth(league, team, d);
    expect(team.depth.rotation.slice(0, 2)).toEqual(d.rotation.slice(0, 2));
    setDepthOwners(league, team, { lineup: false, pitching: false });
    expect(team.depthPlan).toBeUndefined();
    expect(team.depth).toEqual(manager);
  });

  it("reads an older save's hand-set depth chart as the plan for both parts", () => {
    league.userTeamId = team.id;
    const save = JSON.parse(serialize(saveGame(league, null))) as SaveGame;
    (save.league.teams[team.id] as Team & { manualDepth?: boolean }).manualDepth = true;
    save.version = 7;
    const back = loadGame(save).league.teams[team.id]!;
    expect(back.manualLineup).toBe(true);
    expect(back.manualPitching).toBe(true);
    expect(back.depthPlan).toEqual(back.depth);
    expect("manualDepth" in back).toBe(false);
    // And a club whose chart was the manager's stays his.
    const other = loadGame(save).league.teams[team.id === 0 ? 1 : 0]!;
    expect(other.manualLineup).toBeFalsy();
    expect(other.depthPlan).toBeUndefined();
  });
});

describe("the winter's rosters", () => {
  /** The winter in this phase, nothing else going on. */
  const winter = (phase: OffseasonPhase): RosterContext => {
    league.offseason = {
      year: league.year,
      phase,
      development: { risers: [], fallers: [], retirements: [] },
      shift: {},
      tenders: [],
      expiring: [],
      draft: null,
      freeAgency: null,
      international: null,
    };
    return winterContext(league, phase);
  };
  /** 40-man players brought up from the farm, the way the injured come back after the World Series. */
  const bringUp = (pitchers: number, hitters: number) => {
    const down = team.fortyMan.filter((id) => !team.rosters.MLB.includes(id)).map(player);
    for (const p of [...down.filter((x) => x.pitching).slice(0, pitchers), ...down.filter((x) => !x.pitching).slice(0, hitters)]) {
      team.rosters[p.level] = team.rosters[p.level].filter((id) => id !== p.id);
      p.level = "MLB";
      team.rosters.MLB.push(p.id);
    }
  };

  it("have no active-roster limit until spring training sets the Opening Day 26", () => {
    const pitchers = activePitchers(league, team);
    bringUp(15 - pitchers, 4 - (15 - pitchers));
    expect(team.rosters.MLB).toHaveLength(30);
    expect(activePitchers(league, team)).toBe(15);
    expect(rosterProblems(winter("review"), team)).toEqual([]);
    expect(rosterProblems(winter("draft"), team)).toEqual([]);
    expect(rosterProblems(winter("spring"), team)).toEqual(["Active roster has 30 (max 26).", "Carrying 15 pitchers (max 13)."]);
  });

  it("hold the 26 again in spring, and the 40-man all winter", () => {
    bringUp(0, 1);
    expect(rosterProblems(winter("spring"), team)).toEqual(["Active roster has 27 (max 26)."]);
    const extra = team.rosters.AAA.map(player).find((p) => !p.onFortyMan)!;
    team.fortyMan.push(extra.id);
    extra.onFortyMan = true;
    expect(rosterProblems(winter("review"), team)).toEqual([`40-man roster has ${team.fortyMan.length}.`]);
  });
});
