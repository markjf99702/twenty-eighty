/**
 * Play many seasons in a row, offseasons included, and watch the league for
 * drift: the run environment, talent at the top, ages, organization sizes,
 * payrolls, and how far the grade scale had to be re-centered each winter.
 * A healthy universe looks the same in year 10 as in year 1.
 *
 *   npm run sim:years                       # 5 seasons, majors only (fast)
 *   npm run sim:years -- --years 10
 *   npm run sim:years -- --minors           # play the affiliates too
 *   npm run sim:years -- --seed my-universe
 *   npm run sim:years -- --user 12          # run club 12's owner reviews (the AI still makes the moves)
 */
import { leagueMetrics } from "../src/calibration/report";
import { profitOf, revenueOf } from "../src/finance/finance";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { payroll, seasonWar } from "../src/org/contracts";
import { overallGrade } from "../src/org/value";
import { advanceOffseason, beginOffseason } from "../src/offseason/offseason";
import { defenseGrade } from "../src/players/defense";
import { LEVELS } from "../src/players/types";
import { runPostseason } from "../src/season/postseason";
import { Season } from "../src/season/season";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const seed = arg("seed") ?? "twenty-eighty";
const years = Number(arg("years") ?? 5);
const minors = args.includes("--minors");

const league = generateLeague({ seed });
const user = arg("user");
if (user !== undefined) hireGm(league, Number(user));
let season = new Season(league, { minors });
const f = (x: number, d = 1) => x.toFixed(d);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const header = [
  "year",
  "R/G",
  "K%",
  "BB%",
  "HR%",
  "wins lo-hi",
  "HR ldr",
  "WAR ldr",
  "MLB age",
  "70+",
  "FV60+",
  "org size",
  "FAs",
  "retired",
  "signed",
  "top deal",
  "payroll/budget",
  "shift h/p/e/s | stf/ctl/cmd",
];
console.log(header.join(" | "));

for (let y = 0; y < years; y++) {
  const t0 = Date.now();
  season.simToEnd();
  runPostseason(season);
  const m = leagueMetrics([season]);
  const stats = season.stats();
  const wins = season.records.map((r) => r.w);
  const hrLeader = Math.max(...stats.hitters.map((h) => h.line.HR));
  const warLeader = Math.max(...stats.hitters.map((h) => h.WAR), ...stats.pitchers.map((p) => p.WAR));
  const mlb = league.teams.flatMap((t) => t.rosters.MLB).map((id) => league.players[id]!);
  const stars = mlb.filter((p) => overallGrade(p) >= 70).length;
  const farm = league.teams.flatMap((t) => LEVELS.slice(1).flatMap((l) => t.rosters[l])).map((id) => league.players[id]!);
  const prospects = farm.filter((p) => overallGrade(p, true) >= 60).length;
  const orgSize = mean(league.teams.map((t) => LEVELS.reduce((s, l) => s + t.rosters[l].length, 0) + t.injured.length));
  const pay = mean(league.teams.map((t) => payroll(league, t)));
  const budget = mean(league.teams.map((t) => t.budget));
  const year = league.year;

  const winter = beginOffseason(league, season);
  const books = league.teams.map((t) => t.finance.history.at(-1)!);
  const range = (xs: number[], d = 0) => `${f(mean(xs), d)} (${f(Math.min(...xs), d)}-${f(Math.max(...xs), d)})`;
  const business = [
    `revenue ${range(books.map(revenueOf))}`,
    `profit ${range(books.map(profitOf))}`,
    `att/g ${range(books.map((b) => b.attendance / Math.max(1, b.homeGames) / 1000), 1)}k`,
    `interest ${range(league.teams.map((t) => t.finance.interest), 2)}`,
    `next budget ${range(league.teams.map((t) => t.budget))}`,
    `cash ${range(league.teams.map((t) => t.finance.cash))}`,
  ];
  const review = league.gm?.reviews.at(-1);
  if (review) business.push(`owner ${review.before}->${review.after}${league.gm!.fired ? " FIRED" : ""} (goals ${review.goals.filter((g) => g.met).length}/${review.goals.length})`);
  let next: Season | null = null;
  while (!next) next = advanceOffseason(league, season);
  const retired = league.players.filter((p) => p.retired === year).length;
  if (args.includes("--verbose")) {
    const tx = league.transactions.filter((t) => t.year === year);
    const fillers = tx.filter((t) => t.type === "promote" && t.text.startsWith("Signed")).length;
    const released = tx.filter((t) => t.type === "release").length;
    const retiredAges = league.players.filter((p) => p.retired === year).map((p) => p.age);
    const young = retiredAges.filter((a) => a < 25).length;
    console.log(`    players ${league.players.length} (retired ${league.players.filter((p) => p.retired !== undefined).length}); fillers ${fillers}, releases ${released}, retired this year ${retired} (${young} under 25)`);
  }
  const signings = winter.freeAgency?.signings ?? [];
  const topDeal = Math.max(0, ...signings.map((x) => x.salary * x.years));
  if (args.includes("--verbose")) {
    const asks = winter.freeAgency?.asks ?? [];
    const signed = new Set(signings.map((x) => x.playerId));
    const unsignedGood = asks.filter((a) => !signed.has(a.playerId) && seasonWar(league.players[a.playerId]!) >= 1);
    const spent = signings.reduce((s2, x) => s2 + x.salary, 0);
    const top = winter.draft?.pool.length !== undefined ? winter.draft.picks.slice(0, 3).map((pk) => overallGrade(league.players[pk.playerId]!, true)) : [];
    const regulars = league.teams.flatMap((t) => Object.entries(t.depth.starters).map(([pos, id]) => ({ pos, p: league.players[id]! })));
    const def = mean(regulars.map((r) => defenseGrade(r.p, r.pos as never)));
    const arm = mean(regulars.map((r) => r.p.hitting.arm.present));
    const fld = mean(regulars.map((r) => r.p.hitting.field.present));
    const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
    const bats = regulars.map((r) => r.p);
    const spread = `sd hit ${f(sd(bats.map((p) => p.hitting.hit.present)))} pow ${f(sd(bats.map((p) => p.hitting.power.present)))} ovr ${f(sd(mlb.map((p) => overallGrade(p))))}`;
    const stam = mean(league.teams.flatMap((t) => t.depth.rotation).map((id) => league.players[id]!.pitching!.stamina.present));
    const kinds = { guaranteed: 0, arb: 0, "pre-arb": 0, dead: 0 };
    for (const t of league.teams) {
      for (const id of [...Object.values(t.rosters).flat(), ...t.injured]) {
        const c = league.players[id]!.contract;
        if (c && c.type !== "minor") kinds[c.type] += c.salary / league.teams.length;
      }
      for (const d of t.deadMoney) kinds.dead += d.amount / league.teams.length;
    }
    console.log(
      `    BABIP ${f(m.BABIP!, 3)} IP/GS ${f(m["SP IP/GS"]!, 2)} def ${f(def)} fld ${f(fld)} arm ${f(arm)} SP stamina ${f(stam)} ${spread} | avg payroll: guar ${f(kinds.guaranteed, 0)} arb ${f(kinds.arb, 0)} pre ${f(kinds["pre-arb"], 0)} dead ${f(kinds.dead, 0)}`,
    );
    console.log(
      `    FA pool ${asks.length}, signed ${signings.length} ($${f(spent, 0)}M/yr), unsigned with 1+ WAR: ${unsignedGood.length}; ` +
        `draft top-3 FV ${top.join("/")}; risers ${winter.development.risers.slice(0, 3).map((r) => `${r.before}->${r.after}`).join(" ")}`,
    );
  }
  const sh = winter.shift;
  console.log(
    [
      year,
      f(m["R/G"]!, 2),
      f(m["K%"]!),
      f(m["BB%"]!),
      f(m["HR%"]!, 2),
      `${Math.min(...wins)}-${Math.max(...wins)}`,
      hrLeader,
      f(warLeader),
      f(mean(mlb.map((p) => p.age))),
      stars,
      prospects,
      f(orgSize, 0),
      league.freeAgents.length,
      retired,
      signings.length,
      `$${f(topDeal, 0)}M`,
      `${f(pay, 0)}/${f(budget, 0)}`,
      `${f(sh.hit!)}/${f(sh.power!)}/${f(sh.eye!)}/${f(sh.speed!)} | ${f(sh.stuff!)}/${f(sh.control!)}/${f(sh.command!)}`,
      `(${((Date.now() - t0) / 1000).toFixed(0)}s)`,
    ].join(" | "),
  );
  console.log(`    $ ${business.join(" | ")}`);
  season = next;
}
