import { describe, expect, it } from "vitest";
import { generateLeague } from "../src/league/generate";
import { arbCase, arbitrationSalary, tenderWorth } from "../src/org/contracts";
import { canStart } from "../src/org/value";
import type { CareerBatting, CareerPitching, Player } from "../src/players/types";
import { SERVICE_DAYS_PER_YEAR } from "../src/players/types";

// Arbitration reads the back of the card: counting stats, and saves above all.
const league = generateLeague({ seed: "arbitration-test" });
const year = league.year;
const reliever = league.players.find((p) => p.teamId !== null && p.pitching && !canStart(p))!;
const hitter = league.players.find((p) => p.teamId !== null && !p.pitching && p.level === "MLB")!;

const pit = (over: Partial<CareerPitching>): CareerPitching => ({
  G: 65, GS: 0, W: 4, L: 3, SV: 0, outs: 195, H: 50, ER: 20, HR: 6, BB: 20, SO: 75, ERA: 2.77, FIP: 3.1, WAR: 1.2, ...over,
});
const bat = (over: Partial<CareerBatting>): CareerBatting => ({
  G: 150, PA: 620, AB: 550, H: 150, D: 30, T: 2, HR: 20, R: 80, RBI: 75, BB: 55, SO: 130, SB: 5, wRCplus: 110, WAR: 2.5, ...over,
} as CareerBatting);
const withLine = (p: Player, line: { pit?: CareerPitching; bat?: CareerBatting }): Player =>
  ({ ...p, service: 3 * SERVICE_DAYS_PER_YEAR + 10, contract: null, career: [{ year, level: "MLB", teamId: p.teamId, ...line }] }) as Player;

describe("arbitration", () => {
  it("pays a closer for his saves", () => {
    const setup = withLine(reliever, { pit: pit({}) });
    const closer = withLine(reliever, { pit: pit({ SV: 35 }) });
    expect(arbCase(closer, year)!.line).toMatch(/^35 SV, 2\.77 ERA, 65 IP/);
    expect(arbitrationSalary(closer, year)).toBeGreaterThan(arbitrationSalary(setup, year) + 1);
    // Without the saves, the two cases are the same.
    expect(arbitrationSalary(closer, year, true)).toBe(arbitrationSalary(setup, year));
  });

  it("pays hitters for homers and RBI, and reads their line", () => {
    const table = withLine(hitter, { bat: bat({}) });
    const slugger = withLine(hitter, { bat: bat({ HR: 38, RBI: 115 }) });
    expect(arbCase(table, year)!.line).toBe(".273, 20 HR, 75 RBI");
    expect(arbitrationSalary(slugger, year)).toBeGreaterThan(arbitrationSalary(table, year));
  });

  it("judges a player who barely played on his grades", () => {
    const hurt = withLine(hitter, { bat: bat({ PA: 80, AB: 70, H: 20 }) });
    expect(arbCase(hurt, year)).toBeNull();
    expect(arbitrationSalary(hurt, year)).toBeGreaterThan(0);
  });

  it("weighs a reliever's wins for the late innings", () => {
    expect(tenderWorth(reliever, 0.6)).toBeGreaterThan(tenderWorth(hitter, 0.6));
  });
});
