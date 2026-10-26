import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import type { League, Team } from "../src/league/types";
import { springTraining } from "../src/offseason/spring";
import { manageOrganization } from "../src/org/ai";
import { seasonWar } from "../src/org/contracts";
import { canOption, refreshDepth } from "../src/org/roster";
import { canStart, playerValue } from "../src/org/value";
import { generateHitter, generatePitcher } from "../src/players/generate";
import { MINOR_LEVELS, type MinorLevel, type Player } from "../src/players/types";

const healthy = (p: Player) => !p.injury || p.injury.daysLeft <= 0;
const startersActive = (league: League, team: Team) =>
  team.rosters.MLB.map((id) => league.players[id]!).filter((p) => p.pitching && canStart(p) && healthy(p));
const farmStarter = (league: League, team: Team) =>
  [...team.rosters.AAA, ...team.rosters.AA].map((id) => league.players[id]!).some((p) => p.pitching && canStart(p) && healthy(p));

describe("AI rotations", () => {
  it("call up a starter when a starter goes on the injured list", () => {
    const league = generateLeague({ seed: "rotations" });
    const ctx = { league, day: 20, expanded: false };
    const misses: string[] = [];
    let checked = 0;
    for (const team of league.teams) {
      const rotation = startersActive(league, team);
      if (rotation.length !== 5 || !farmStarter(league, team)) continue;
      const hurt = rotation[0]!;
      hurt.injury = { name: "Elbow inflammation", days: 30, daysLeft: 30, startDay: ctx.day };
      const before = new Set(team.rosters.MLB);
      manageOrganization(ctx, team, { weekly: false, farmCheck: false, waiverOrder: league.teams, rng: new Rng(`rotations-${team.id}`) });
      checked++;
      const up = team.rosters.MLB.filter((id) => !before.has(id)).map((id) => league.players[id]!);
      if (startersActive(league, team).length < 5) {
        misses.push(`${team.abbrev}: lost ${hurt.lastName}, called up ${up.map((p) => `${p.lastName} (stamina ${p.pitching?.stamina.present ?? "-"})`).join(", ")}`);
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(misses).toEqual([]);
  });

  it("keep five starters when a reliever comes back from the injured list", () => {
    const league = generateLeague({ seed: "rotations" });
    const opts = (team: Team, day: number) => ({ weekly: false, farmCheck: false, waiverOrder: league.teams, rng: new Rng(`back-${team.id}-${day}`) });
    const misses: string[] = [];
    let checked = 0;
    for (const team of league.teams) {
      if (startersActive(league, team).length !== 5) continue;
      const reliever = team.rosters.MLB.map((id) => league.players[id]!).find((p) => p.pitching && !canStart(p))!;
      reliever.injury = { name: "Elbow inflammation", days: 16, daysLeft: 16, startDay: 20 };
      manageOrganization({ league, day: 20, expanded: false }, team, opts(team, 20));
      if (reliever.il === null) continue;
      reliever.injury = null;
      const down = new Set(team.rosters.MLB);
      manageOrganization({ league, day: 40, expanded: false }, team, opts(team, 40));
      if (reliever.level !== "MLB" || !team.rosters.MLB.includes(reliever.id)) continue;
      checked++;
      if (startersActive(league, team).length < 5) {
        const gone = [...down].filter((id) => !team.rosters.MLB.includes(id)).map((id) => league.players[id]!.lastName);
        misses.push(`${team.abbrev}: ${reliever.lastName} back, ${gone.join(", ")} down`);
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(misses).toEqual([]);
  });

  it("bring up a fifth starter for a club that opens with four", () => {
    const league = generateLeague({ seed: "rotation-check" });
    const short = league.teams.filter((t) => startersActive(league, t).length < 5 && farmStarter(league, t));
    expect(short.length).toBeGreaterThan(2);
    for (const team of short) {
      manageOrganization({ league, day: 1, expanded: false }, team, { weekly: false, farmCheck: false, waiverOrder: league.teams, rng: new Rng(`fifth-${team.id}`) });
    }
    expect(short.filter((t) => startersActive(league, t).length < 5).map((t) => t.abbrev)).toEqual([]);
  });
});

describe("AI farm system", () => {
  const opts = (league: League, team: Team, farmCheck: boolean) => ({ weekly: false, farmCheck, waiverOrder: league.teams, rng: new Rng(`farm-${team.id}`) });
  const arms = (league: League, team: Team, level: MinorLevel) => team.rosters[level].map((id) => league.players[id]!).filter((p) => p.pitching && healthy(p));
  const starters = (league: League, team: Team, level: MinorLevel) => arms(league, team, level).filter(canStart).length;
  const hurt = (p: Player, day: number) => (p.injury = { name: "Elbow inflammation", days: 30, daysLeft: 30, startDay: day });

  it("swap a starter for a starter and a reliever for a reliever up the ladder", () => {
    const league = generateLeague({ seed: "farm-kinds" });
    const ctx = { league, day: 14, expanded: false };
    const moved: string[] = [];
    let pitcherSwaps = 0;
    let checked = 0;
    for (const team of league.teams) {
      const mlb = team.rosters.MLB.join();
      const before = MINOR_LEVELS.map((l) => starters(league, team, l));
      const from = league.transactions.length;
      manageOrganization(ctx, team, opts(league, team, true));
      // A call-up for the big club's rotation takes a starter from the farm; only the farm's own swaps count here.
      if (team.rosters.MLB.join() !== mlb) continue;
      checked++;
      pitcherSwaps += league.transactions.slice(from).filter((t) => t.type === "promote" && league.players[t.playerId]!.pitching).length;
      const after = MINOR_LEVELS.map((l) => starters(league, team, l));
      if (after.some((n, i) => n !== before[i])) moved.push(`${team.abbrev}: starters AAA/AA/A+/A ${before.join("/")} -> ${after.join("/")}`);
    }
    expect(checked).toBeGreaterThan(20);
    expect(pitcherSwaps).toBeGreaterThan(20);
    expect(moved).toEqual([]);
  });

  it("bring up starters first for an affiliate short of arms and of starters", () => {
    const league = generateLeague({ seed: "farm-kinds" });
    const ctx = { league, day: 20, expanded: false };
    const short: string[] = [];
    let checked = 0;
    for (const team of league.teams) {
      const staff = arms(league, team, "AAA");
      const sp = staff.filter(canStart);
      const rp = staff.filter((p) => !canStart(p));
      if (sp.length < 5 || rp.length < 2 || starters(league, team, "AA") < 2) continue;
      // Two starters and two relievers hurt: nine healthy arms, three or four of them starters.
      for (const p of [sp[0]!, sp[1]!, rp[0]!, rp[1]!]) hurt(p, ctx.day);
      const mlb = team.rosters.MLB.join();
      manageOrganization(ctx, team, opts(league, team, false));
      if (team.rosters.MLB.join() !== mlb) continue;
      checked++;
      if (starters(league, team, "AAA") < 5) short.push(`${team.abbrev}: ${starters(league, team, "AAA")} healthy starters of ${arms(league, team, "AAA").length} arms`);
    }
    expect(checked).toBeGreaterThan(15);
    expect(short).toEqual([]);
  });

  it("keep every affiliate at 13 healthy arms, as a big-league staff, when injuries thin it", () => {
    const league = generateLeague({ seed: "farm-kinds" });
    const ctx = { league, day: 20, expanded: false };
    const thin: string[] = [];
    let checked = 0;
    for (const team of league.teams) {
      const pens = MINOR_LEVELS.map((level) => arms(league, team, level).filter((p) => !canStart(p)));
      if (MINOR_LEVELS.some((level, i) => arms(league, team, level).length !== 13 || pens[i]!.length < 2)) continue;
      // Two relievers hurt at every affiliate: eleven healthy arms each.
      for (const pen of pens) for (const p of pen.slice(0, 2)) hurt(p, ctx.day);
      manageOrganization(ctx, team, opts(league, team, false));
      checked++;
      for (const level of MINOR_LEVELS) {
        const n = arms(league, team, level).length;
        if (n < 13) thin.push(`${team.abbrev} ${level}: ${n} healthy arms`);
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(thin).toEqual([]);
  });

  it("trim a crowded affiliate from the kind it has too many of, not its rotation", () => {
    const league = generateLeague({ seed: "farm-kinds" });
    const ctx = { league, day: 20, expanded: false };
    const trimmed: string[] = [];
    let checked = 0;
    for (const team of league.teams) {
      // Three relievers from Double-A crowd Triple-A to 29.
      const extra = arms(league, team, "AA")
        .filter((p) => !canStart(p))
        .slice(0, 3);
      if (extra.length < 3 || team.rosters.AAA.length !== 26) continue;
      for (const p of extra) {
        team.rosters.AA = team.rosters.AA.filter((id) => id !== p.id);
        team.rosters.AAA.push(p.id);
        p.level = "AAA";
      }
      const before = starters(league, team, "AAA");
      const mlb = team.rosters.MLB.join();
      manageOrganization(ctx, team, opts(league, team, false));
      if (team.rosters.MLB.join() !== mlb) continue;
      checked++;
      expect(team.rosters.AAA.length).toBeLessThanOrEqual(28);
      if (starters(league, team, "AAA") < before) trimmed.push(`${team.abbrev}: ${before} -> ${starters(league, team, "AAA")} starters`);
    }
    expect(checked).toBeGreaterThan(20);
    expect(trimmed).toEqual([]);
  });
});

describe("spring training", () => {
  it("places farm pitchers by their wins in their role, so useful starters aren't buried under worse ones", () => {
    const league = generateLeague({ seed: "spring-farm" });
    springTraining({ league, day: 0, expanded: false }, league.teams);
    const buried: string[] = [];
    for (const team of league.teams) {
      const arms = (level: MinorLevel) => team.rosters[level].map((id) => league.players[id]!).filter((p) => p.pitching);
      // Each kind against its own: Triple-A holds its share of the starters and a bullpen of relievers.
      for (const starters of [true, false]) {
        const aaa = arms("AAA").filter((p) => canStart(p) === starters);
        if (aaa.length === 0) continue;
        const weakest = aaa.reduce((a, b) => (seasonWar(b) < seasonWar(a) ? b : a));
        for (const p of [...arms("AA"), ...arms("A+"), ...arms("A")].filter((x) => canStart(x) === starters)) {
          if (p.age >= 21 && seasonWar(p) > seasonWar(weakest) + 0.5) {
            buried.push(`${team.abbrev}: ${p.role} ${p.lastName} (${seasonWar(p).toFixed(1)} WAR) in ${p.level}, ${weakest.role} ${weakest.lastName} (${seasonWar(weakest).toFixed(1)}) in AAA`);
          }
        }
      }
    }
    expect(buried).toEqual([]);
  });

  it("opens every affiliate with a rotation and a bullpen after a winter's intake, Triple-A with the extra starters", () => {
    const league = generateLeague({ seed: "spring-farm" });
    // The draft and the international class, mostly starters, land at Single-A and crowd the farm past its room.
    const rng = new Rng("spring-intake");
    for (const team of league.teams) {
      for (let i = 0; i < 22; i++) {
        const opts = { id: league.players.length, value: -45 + rng.normal(0, 7), age: rng.int(18, 22) };
        const p = i < 8 ? generatePitcher(rng, { ...opts, role: "SP" }) : i < 12 ? generatePitcher(rng, { ...opts, role: "RP" }) : generateHitter(rng, { ...opts, position: "SS" });
        p.teamId = team.id;
        p.level = "A";
        league.players.push(p);
        team.rosters.A.push(p.id);
      }
    }
    springTraining({ league, day: 0, expanded: false }, league.teams);
    const short: string[] = [];
    for (const team of league.teams) {
      const starters = MINOR_LEVELS.map((level) => team.rosters[level].map((id) => league.players[id]!).filter((p) => p.pitching && canStart(p)).length);
      MINOR_LEVELS.forEach((level, i) => {
        const relievers = team.rosters[level].map((id) => league.players[id]!).filter((p) => p.pitching && !canStart(p)).length;
        if (starters[i]! < 5 || relievers < 4) short.push(`${team.abbrev} ${level}: ${starters[i]} starters, ${relievers} relievers`);
      });
      if (starters.some((n) => n > starters[0]!)) short.push(`${team.abbrev}: starters AAA/AA/A+/A ${starters.join("/")}`);
    }
    expect(short).toEqual([]);
  });
});

describe("AI weekly swaps", () => {
  it("send a slumping big leaguer down for a better Triple-A player, with a full active roster", () => {
    const league = generateLeague({ seed: "swaps" });
    const ctx = { league, day: 21, expanded: false };
    const misses: string[] = [];
    let checked = 0;
    for (const team of league.teams) {
      const active = team.rosters.MLB.map((id) => league.players[id]!);
      if (active.length !== 26) continue;
      // A bench bat who can be optioned has hit 80 runs below average over a season's worth of plate appearances.
      const slumping = active
        .filter((p) => !p.pitching && p.position !== "C" && canOption(ctx, team, p).ok && !Object.values(team.depth.starters).includes(p.id))
        .sort((a, b) => playerValue(a) - playerValue(b))[0];
      if (!slumping) continue;
      const performance = (p: Player) => (p.id === slumping.id ? { runs: -80, sample: 1000 } : null);
      const hitters = () => team.rosters.MLB.filter((id) => !league.players[id]!.pitching);
      const before = new Set(hitters());
      manageOrganization(ctx, team, { performance, weekly: true, farmCheck: false, waiverOrder: league.teams, rng: new Rng(`swaps-${team.id}`) });
      checked++;
      const up = hitters().filter((id) => !before.has(id));
      expect(team.rosters.MLB).toHaveLength(26);
      if (slumping.level === "MLB" || up.length !== 1) misses.push(`${team.abbrev}: ${slumping.lastName} ${slumping.level}, ${up.length} up`);
    }
    expect(checked).toBeGreaterThan(10);
    expect(misses).toEqual([]);
  });

  it("don't send a starter in the rotation down for a reliever", () => {
    const league = generateLeague({ seed: "swaps" });
    const ctx = { league, day: 21, expanded: false };
    const P = (id: number) => league.players[id]!;
    let checked = 0;
    for (const team of league.teams) {
      // Six starters active, the sixth in the bullpen, and only relievers in the upper minors.
      while (startersActive(league, team).length < 6) {
        const arm = [...team.rosters.AAA, ...team.rosters.AA].map(P).find((p) => p.pitching && canStart(p) && p.onFortyMan && healthy(p));
        const reliever = team.rosters.MLB.map(P).find((p) => p.pitching && !canStart(p));
        if (!arm || !reliever) break;
        team.rosters[arm.level] = team.rosters[arm.level].filter((id) => id !== arm.id);
        team.rosters.MLB = team.rosters.MLB.map((id) => (id === reliever.id ? arm.id : id));
        team.rosters.AAA.push(reliever.id);
        arm.level = "MLB";
        reliever.level = "AAA";
      }
      if (startersActive(league, team).length < 6) continue;
      for (const level of ["AAA", "AA"] as const) {
        for (const p of team.rosters[level].map(P).filter((x) => x.pitching && canStart(x))) {
          team.rosters[level] = team.rosters[level].filter((id) => id !== p.id);
          team.rosters.A.push(p.id);
          p.level = "A";
        }
      }
      refreshDepth(league, team);
      // The fifth starter has been awful.
      const fifth = P(team.depth.rotation[4]!);
      if (!canOption(ctx, team, fifth).ok) continue;
      const performance = (p: Player) => (p.id === fifth.id ? { runs: -150, sample: 1000 } : null);
      manageOrganization(ctx, team, { performance, weekly: true, farmCheck: false, waiverOrder: league.teams, rng: new Rng(`rotation-${team.id}`) });
      expect(fifth.level).toBe("MLB");
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });
});
