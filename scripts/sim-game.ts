/**
 * Simulate one game and print the box score.
 *
 *   npm run sim:game                      # first two teams
 *   npm run sim:game -- NYE BOS           # away, home by abbreviation
 *   npm run sim:game -- NYE BOS --seed x  # different universe
 */
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import { formatBoxScore } from "../src/report/text";
import { Season } from "../src/season/season";
import { simulateGame } from "../src/sim/game";

const args = process.argv.slice(2);
const seedIdx = args.indexOf("--seed");
const seed = seedIdx >= 0 ? args[seedIdx + 1]! : "twenty-eighty";
const teamsArg = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--seed");

const league = generateLeague({ seed });
const find = (abbrev: string | undefined, fallback: number) =>
  abbrev ? league.teams.find((t) => t.abbrev === abbrev.toUpperCase()) : league.teams[fallback];
const away = find(teamsArg[0], 0);
const home = find(teamsArg[1], 1);
if (!away || !home) {
  console.error(`Unknown team. Choose from: ${league.teams.map((t) => t.abbrev).join(" ")}`);
  process.exit(1);
}

const season = new Season(league);
const rng = new Rng(`${seed}:${away.abbrev}@${home.abbrev}:${Date.now()}`);
const result = simulateGame(season.env, season.gameSetup(away, rng), season.gameSetup(home, rng), rng);
console.log(`At ${home.park.name}\n`);
console.log(formatBoxScore(result, league));
