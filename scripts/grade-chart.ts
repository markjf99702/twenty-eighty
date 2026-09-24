/**
 * The 20-80 translation chart: what each grade means in stats, measured by
 * simulating plate appearances against this universe's real pitchers
 * (or hitters). Every other tool is held at 50.
 *
 *   npm run grade-chart
 *   npm run grade-chart -- --pa 40000
 */
import { averageBatter, averagePitcher, batterRates, pitcherRates, type RateLine } from "../src/calibration/gradeChart";
import { gradeToZ } from "../src/core/grades";
import { generateLeague } from "../src/league/generate";
import { NEUTRAL_PARK } from "../src/league/parks";
import { averageDefense } from "../src/sim/manager";
import type { BatterProfile, PitcherProfile } from "../src/sim/profiles";

const args = process.argv.slice(2);
const paArg = args.indexOf("--pa");
const PA = paArg >= 0 ? Number(args[paArg + 1]) : 20000;
const GRADES = [20, 30, 40, 45, 50, 55, 60, 70, 80];

const league = generateLeague({ seed: "grade-chart" });
const def = averageDefense(league);

const f3 = (x: number) => x.toFixed(3).replace(/^0/, "");
const row = (g: number, r: RateLine) =>
  `${String(g).padStart(5)}  ${f3(r.AVG).padStart(5)} ${f3(r.OBP).padStart(5)} ${f3(r.SLG).padStart(5)}  ${f3(r.ISO).padStart(5)}  ${(100 * r.Kpct).toFixed(1).padStart(5)} ${(100 * r.BBpct).toFixed(1).padStart(5)}  ${r.HRper600.toFixed(1).padStart(5)}  ${f3(r.BABIP).padStart(5)}  ${(r.runsPer600 - base.runsPer600 >= 0 ? "+" : "") + (r.runsPer600 - base.runsPer600).toFixed(1).padStart(5)}`;
const header = "grade    AVG   OBP   SLG    ISO     K%   BB%  HR/600 BABIP  runs/600 vs 50";

const base = batterRates(averageBatter(), league, NEUTRAL_PARK, def, PA, "base");

const hitterTools: [string, keyof BatterProfile][] = [
  ["Hit (contact)", "contact"],
  ["Raw power", "power"],
  ["Eye (discipline)", "eye"],
  ["Run (speed)", "speed"],
];
for (const [label, key] of hitterTools) {
  console.log(`\n${label} - hitter with every other tool at 50, ${PA} PA per grade`);
  console.log(header);
  for (const g of GRADES) {
    const b = { ...averageBatter(), [key]: gradeToZ(g) };
    console.log(row(g, batterRates(b, league, NEUTRAL_PARK, def, PA, `${key}${g}`)));
  }
}

const pitcherTools: [string, (p: PitcherProfile, z: number) => PitcherProfile][] = [
  ["Stuff (every pitch graded the same)", (p, z) => ({ ...p, pitches: p.pitches.map((x) => ({ ...x, z })) })],
  ["Control", (p, z) => ({ ...p, control: z })],
  ["Command", (p, z) => ({ ...p, command: z })],
];
for (const [label, set] of pitcherTools) {
  console.log(`\n${label} - pitcher with everything else at 50, opponent line (${PA} batters faced per grade)`);
  console.log(header);
  for (const g of GRADES) {
    console.log(row(g, pitcherRates(set(averagePitcher(), gradeToZ(g)), league, NEUTRAL_PARK, def, PA, `${label}${g}`)));
  }
}
