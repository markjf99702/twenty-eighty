/**
 * Measures what scouts expect of a player before they see him: the average
 * present and future grade of each tool for amateurs and at each level, and
 * how widely each tool spreads. Prints src/scouting/priors.ts; rerun it after
 * changing the player generator or development.
 *
 *   npx tsx scripts/scout-priors.ts > src/scouting/priors.ts
 */
import { Rng } from "../src/core/rng";
import { generateLeague } from "../src/league/generate";
import { draftClass } from "../src/offseason/draft";
import { prospect } from "../src/offseason/international";
import type { Player, ToolGrade } from "../src/players/types";

import { PRIOR_GROUPS, type PriorGroup, SCOUT_TOOLS, type ScoutTool } from "../src/scouting/priors";

const samples = new Map<string, number[]>();
const add = (key: string, x: number) => (samples.get(key) ?? samples.set(key, []).get(key)!).push(x);

function record(group: PriorGroup, p: Player) {
  const tools: [ScoutTool, ToolGrade][] = p.pitching
    ? [
        ...p.pitching.pitches.map((x): [ScoutTool, ToolGrade] => ["stuff", x.grade]),
        ["control", p.pitching.control],
        ["command", p.pitching.command],
        ["stamina", p.pitching.stamina],
      ]
    : SCOUT_TOOLS.slice(0, 6).map((k): [ScoutTool, ToolGrade] => [k, p.hitting[k as keyof Player["hitting"]]]);
  for (const [k, t] of tools) {
    add(`${group}:${k}:p`, t.present);
    add(`${group}:${k}:f`, t.future);
  }
}

for (const seed of ["priors-1", "priors-2", "priors-3"]) {
  const league = generateLeague({ seed });
  for (const p of league.players) if (p.teamId !== null) record(p.level, p);
  const rng = new Rng(seed);
  for (const p of draftClass(rng, 450)) record(p.age >= 21 ? "college" : "young", p);
  for (let i = 0; i < 110; i++) record("young", prospect(rng, -(i + 1)));
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
const r = (x: number) => Math.round(x);

const lines: string[] = [];
lines.push("/**");
lines.push(" * What scouts expect of a player before they see him, measured from generated");
lines.push(" * leagues and amateur classes by scripts/scout-priors.ts (don't edit by hand).");
lines.push(" * Each tool's [present, future] average by group, and each tool's spread.");
lines.push(" */");
lines.push("");
lines.push(`export const SCOUT_TOOLS = [${SCOUT_TOOLS.map((k) => `"${k}"`).join(", ")}] as const;`);
lines.push("export type ScoutTool = (typeof SCOUT_TOOLS)[number];");
lines.push("");
lines.push("/** Unsigned amateurs (under 21, and college age) and players at each level. */");
lines.push(`export const PRIOR_GROUPS = [${PRIOR_GROUPS.map((g) => `"${g}"`).join(", ")}] as const;`);
lines.push("export type PriorGroup = (typeof PRIOR_GROUPS)[number];");
lines.push("");
lines.push("export const PRIOR_MEANS: Record<PriorGroup, Record<ScoutTool, [number, number]>> = {");
for (const g of PRIOR_GROUPS) {
  const cells = SCOUT_TOOLS.map((k) => `${k}: [${r(mean(samples.get(`${g}:${k}:p`)!))}, ${r(mean(samples.get(`${g}:${k}:f`)!))}]`);
  lines.push(`  ${g.includes("+") ? `"${g}"` : g}: { ${cells.join(", ")} },`);
}
lines.push("};");
lines.push("");
lines.push("/** How widely each tool's true grades spread within a group (grade points). */");
const spread = SCOUT_TOOLS.map((k) => {
  const sds = PRIOR_GROUPS.flatMap((g) => [sd(samples.get(`${g}:${k}:p`)!), sd(samples.get(`${g}:${k}:f`)!)]);
  return `${k}: ${Math.round(mean(sds) * 2) / 2}`;
});
lines.push(`export const TOOL_SPREAD: Record<ScoutTool, number> = { ${spread.join(", ")} };`);
console.log(lines.join("\n"));

