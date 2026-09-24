/**
 * Simulate a full season - the majors and all four affiliate levels - and
 * print the standings, postseason, awards, leaders and organization notes.
 *
 *   npm run sim:season
 *   npm run sim:season -- --seed my-universe
 *   npm run sim:season -- --team BOS          # plus one club's transaction log and final roster
 *   npm run sim:season -- --no-minors         # big leagues only (about 4x faster)
 *   npm run sim:season -- --json out/season.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateLeague } from "../src/league/generate";
import { teamName } from "../src/league/types";
import { MINOR_LEVELS } from "../src/players/types";
import {
  formatAwards,
  formatContext,
  formatLeaders,
  formatPostseason,
  formatStandings,
  formatTeamScouting,
} from "../src/report/text";
import { runPostseason } from "../src/season/postseason";
import { Season } from "../src/season/season";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const seed = arg("seed") ?? "twenty-eighty";
const year = Number(arg("year") ?? 2026);
const minors = !args.includes("--no-minors");

const t0 = Date.now();
const league = generateLeague({ seed, year });
const season = new Season(league, { minors });
season.simToEnd((day, total) => {
  if (process.stderr.isTTY) process.stderr.write(`\rSimulating... day ${day}/${total}`);
});
if (process.stderr.isTTY) process.stderr.write("\r\x1b[K");
const post = runPostseason(season);
const stats = season.stats();
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const levels = minors ? `MLB + ${MINOR_LEVELS.length} affiliate levels` : "MLB only";

console.log(`TWENTY-EIGHTY  -  ${year} season  (universe "${seed}", ${levels}, ${secs}s)\n`);
console.log(formatStandings(season));
console.log(formatPostseason(post, season));
console.log();
console.log(formatAwards(stats, season));
console.log();
console.log(formatLeaders(stats, season));
console.log();
console.log(formatContext(stats));

// Organization notes.
const count = (type: string) => league.transactions.filter((t) => t.type === type).length;
const appeared = [...new Set([...season.batting.lines.keys(), ...season.pitching.lines.keys()])];
const usedByTeam = league.teams.map((t) => appeared.filter((id) => league.players[id]!.teamId === t.id).length);
console.log(
  `\nORGANIZATIONS\n  ${count("injury")} big-league injuries, ${count("il-place")} injured-list placements, ${count("call-up")} call-ups, ${count("option")} options, ${count("dfa")} DFAs (${count("claim")} claimed off waivers)`,
);
console.log(
  `  Players used per club: ${Math.min(...usedByTeam)}-${Math.max(...usedByTeam)} (avg ${(usedByTeam.reduce((a, b) => a + b, 0) / usedByTeam.length).toFixed(1)})`,
);
if (minors) {
  for (const level of MINOR_LEVELS) {
    const ls = season.levels[level];
    const best = [...ls.records].sort((a, b) => ls.compare(a, b))[0]!;
    const t = league.teams[best.teamId]!;
    console.log(`  Best ${level} record: ${t.affiliates[level].name} ${best.w}-${best.l}`);
  }
}

const teamArg = arg("team");
if (teamArg) {
  const team = league.teams.find((t) => t.abbrev === teamArg.toUpperCase());
  if (!team) {
    console.error(`Unknown team ${teamArg}`);
  } else {
    console.log(`\n${teamName(team).toUpperCase()} - TRANSACTIONS (big-league moves and injuries)`);
    for (const t of league.transactions) {
      if (t.teamId !== team.id || t.type === "promote" || t.type === "demote") continue;
      console.log(`  ${season.dateOf(t.day).toISOString().slice(5, 10)}  ${t.text}`);
    }
    console.log();
    console.log(formatTeamScouting(team, league));
  }
}

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
        transactions: league.transactions,
      },
      null,
      1,
    ),
  );
  console.log(`\nWrote ${json}`);
}
