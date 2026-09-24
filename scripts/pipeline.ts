/**
 * The talent pipeline at a glance: what one year's intake (a 300-pick draft
 * plus an international class) becomes as it develops and ages, against the
 * age profile of a freshly generated league. For the universe to stay the
 * same year after year, one intake followed through its career has to look
 * like one league's cross-section: about as many players above the big-league
 * line (the 830th best player), in about the same age mix (25 and under,
 * 26-30, 31 and up), with about as many stars.
 *
 *   npm run pipeline
 *   npm run pipeline -- --classes 8     # average more classes
 */
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import { boardValue, draftClass } from "../src/offseason/draft";
import { prospect } from "../src/offseason/international";
import { peakValue, playerValue } from "../src/org/value";
import { developPlayer } from "../src/players/development";
import type { Player } from "../src/players/types";

const args = process.argv.slice(2);
const classes = Number(args[args.indexOf("--classes") + 1] ?? 5) || 5;

type Row = { age: number; v: number };
const league: Row[] = [];
const SEEDS = ["pipeline-a", "pipeline-b"];
for (const seed of SEEDS) {
  for (const p of generateLeague({ seed }).players) if (p.teamId !== null) league.push({ age: p.age, v: playerValue(p) });
}
const line = league.map((x) => x.v).sort((a, b) => b - a)[830 * SEEDS.length - 1]!;

const intake: Row[] = [];
const fv = { f60: 0, f55: 0, f50: 0 };
for (let c = 0; c < classes; c++) {
  const rng = new Rng(`pipeline:${c}`);
  const drafted = draftClass(rng.fork("draft"), 450)
    .sort((a, b) => boardValue(b) - boardValue(a))
    .slice(0, 300);
  const intl: Player[] = [];
  for (let i = 0; i < 110; i++) intl.push(prospect(rng.fork(`intl${i}`), -1000 - i));
  const all = [...drafted, ...intl];
  for (const p of all) {
    const g = 50 + peakValue(p) / 2;
    if (g >= 60) fv.f60 += 1 / classes;
    if (g >= 55) fv.f55 += 1 / classes;
    if (g >= 50) fv.f50 += 1 / classes;
  }
  const dev = rng.fork("dev");
  for (let y = 0; y <= 23; y++) {
    for (const p of all) {
      if (p.age <= 40) intake.push({ age: p.age, v: playerValue(p) });
      developPlayer(p, dev);
    }
  }
}

function describe(rows: Row[], weight: number, min: number): string {
  let n = 0;
  let young = 0;
  let prime = 0;
  for (const x of rows) {
    if (x.v < min) continue;
    n += weight;
    if (x.age <= 25) young += weight;
    else if (x.age <= 30) prime += weight;
  }
  const pct = (k: number) => `${Math.round((100 * k) / Math.max(1, n))}%`.padStart(4);
  return `${n.toFixed(0).padStart(5)}  (<=25 ${pct(young)}, 26-30 ${pct(prime)}, 31+ ${pct(n - young - prime)})`;
}

console.log(`Big-league line: the 830th best player, ${line.toFixed(1)} runs per 600 vs. average.\n`);
console.log("players at or above       one league's cross-section              one intake over its career");
for (const d of [-15, 0, 15, 30, 45]) {
  const label = `line ${d >= 0 ? "+" : "-"} ${Math.abs(d)}`.padEnd(24);
  console.log(`${label}  ${describe(league, 1 / SEEDS.length, line + d)}    ${describe(intake, 1 / classes, line + d)}`);
}
console.log(`\nOne intake's FV at signing: ${fv.f60.toFixed(1)} at 60+, ${fv.f55.toFixed(1)} at 55+, ${fv.f50.toFixed(1)} at 50+.`);
