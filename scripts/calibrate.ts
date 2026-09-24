/**
 * Calibration harness: simulate full seasons and compare the league to MLB.
 *
 *   npm run calibrate                 # one season, default seed
 *   npm run calibrate -- --seasons 3  # average over three universes
 *   npm run calibrate -- --seed abc
 */
import { formatLeagueReport, formatSpreadReport, leagueMetrics, spreadMetrics } from "../src/calibration/report";
import { generateLeague } from "../src/league/generate";
import { Season } from "../src/season/season";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const seasons = Number(arg("seasons", "1"));
const seed = arg("seed", "calibration");

const t0 = Date.now();
const done: Season[] = [];
for (let i = 0; i < seasons; i++) {
  const league = generateLeague({ seed: seasons === 1 ? seed : `${seed}-${i}` });
  // The minors don't affect big-league calibration; skip them for speed.
  const season = new Season(league, { minors: false });
  season.simToEnd();
  done.push(season);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`Simulated ${seasons} season(s), ${done.reduce((n, s) => n + s.games.length, 0)} games in ${secs}s\n`);

const report = formatLeagueReport(leagueMetrics(done));
console.log(report.text);
console.log(`\n${report.misses} metric(s) outside 2x tolerance\n`);
console.log("Player and team spread (first season):");
console.log(formatSpreadReport(spreadMetrics(done[0]!)));
