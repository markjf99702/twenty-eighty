import { describe, expect, it } from "vitest";
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import type { League, Team } from "../src/league/types";
import { springTraining } from "../src/offseason/spring";
import { manageOrganization } from "../src/org/ai";
import { seasonWar } from "../src/org/contracts";
import { canStart } from "../src/org/value";
import type { Player } from "../src/players/types";

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

describe("spring training", () => {
  it("places farm pitchers by their wins in their role, so useful starters aren't buried under relievers", () => {
    const league = generateLeague({ seed: "spring-farm" });
    springTraining({ league, day: 0, expanded: false }, league.teams);
    const buried: string[] = [];
    for (const team of league.teams) {
      const arms = (level: "AAA" | "AA" | "A+" | "A") => team.rosters[level].map((id) => league.players[id]!).filter((p) => p.pitching);
      const aaa = arms("AAA");
      const weakest = aaa.reduce((a, b) => (seasonWar(b) < seasonWar(a) ? b : a));
      for (const p of [...arms("AA"), ...arms("A+"), ...arms("A")]) {
        if (p.age >= 21 && seasonWar(p) > seasonWar(weakest) + 0.5) {
          buried.push(`${team.abbrev}: ${p.role} ${p.lastName} (${seasonWar(p).toFixed(1)} WAR) in ${p.level}, ${weakest.role} ${weakest.lastName} (${seasonWar(weakest).toFixed(1)}) in AAA`);
        }
      }
    }
    expect(buried).toEqual([]);
  });
});
