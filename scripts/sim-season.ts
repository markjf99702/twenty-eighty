/**
 * Simulate a full season and print the standings, leaders, awards and
 * postseason.
 *
 *   npm run sim:season
 *   npm run sim:season -- --seed my-universe
 *   npm run sim:season -- --seed my-universe --json out/season.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateLeague } from "../src/league/generate";
import { formatAwards, formatContext, formatLeaders, formatPostseason, formatStandings } from "../src/report/text";
import { runPostseason } from "../src/season/postseason";
import { Season } from "../src/season/season";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const seed = arg("seed") ?? "twenty-eighty";
const year = Number(arg("year") ?? 2026);

const t0 = Date.now();
const league = generateLeague({ seed, year });
const season = new Season(league);
season.simToEnd();
const post = runPostseason(season);
const stats = season.stats();
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`TWENTY-EIGHTY  -  ${year} season  (universe "${seed}", ${season.games.length} games in ${secs}s)\n`);
console.log(formatStandings(season));
console.log(formatPostseason(post, season));
console.log();
console.log(formatAwards(stats, season));
console.log();
console.log(formatLeaders(stats, season));
console.log();
console.log(formatContext(stats));

const json = arg("json");
if (json) {
  mkdirSync(dirname(json), { recursive: true });
  const { context, hitters, pitchers } = stats;
  writeFileSync(
    json,
    JSON.stringify(
      {
        seed,
        year,
        standings: season.records.map((r) => ({ ...r, team: season.team(r.teamId).abbrev })),
        postseason: post,
        context: { ...context, parkFactors: Object.fromEntries(context.parkFactors) },
        hitters,
        pitchers,
      },
      null,
      1,
    ),
  );
  console.log(`\nWrote ${json}`);
}
