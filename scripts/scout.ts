/**
 * Scouting report for one organization: every player's tools on the 20-80
 * scale as present/future grades.
 *
 *   npm run scout -- NYE
 *   npm run scout -- DEN --seed my-universe
 */
import { generateLeague } from "../src/league/generate";
import { formatTeamScouting } from "../src/report/text";

const args = process.argv.slice(2);
const seedIdx = args.indexOf("--seed");
const seed = seedIdx >= 0 ? args[seedIdx + 1]! : "twenty-eighty";
const abbrev = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--seed");

const league = generateLeague({ seed });
const team = abbrev ? league.teams.find((t) => t.abbrev === abbrev.toUpperCase()) : league.teams[0];
if (!team) {
  console.error(`Unknown team. Choose from: ${league.teams.map((t) => t.abbrev).join(" ")}`);
  process.exit(1);
}
console.log(formatTeamScouting(team, league));
