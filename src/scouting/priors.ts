/**
 * What scouts expect of a player before they see him, measured from generated
 * leagues and amateur classes by scripts/scout-priors.ts (don't edit by hand).
 * Each tool's [present, future] average by group, and each tool's spread.
 */

export const SCOUT_TOOLS = ["hit", "power", "eye", "speed", "field", "arm", "stuff", "control", "command", "stamina"] as const;
export type ScoutTool = (typeof SCOUT_TOOLS)[number];

/** Unsigned amateurs (under 21, and college age) and players at each level. */
export const PRIOR_GROUPS = ["young", "college", "A", "A+", "AA", "AAA", "MLB"] as const;
export type PriorGroup = (typeof PRIOR_GROUPS)[number];

export const PRIOR_MEANS: Record<PriorGroup, Record<ScoutTool, [number, number]>> = {
  young: { hit: [35, 45], power: [37, 46], eye: [38, 53], speed: [45, 48], field: [55, 60], arm: [55, 59], stuff: [28, 35], control: [36, 52], command: [44, 52], stamina: [49, 52] },
  college: { hit: [38, 44], power: [41, 47], eye: [41, 51], speed: [47, 49], field: [54, 57], arm: [55, 57], stuff: [33, 37], control: [40, 51], command: [46, 51], stamina: [49, 51] },
  A: { hit: [39, 46], power: [41, 47], eye: [40, 53], speed: [47, 49], field: [53, 57], arm: [54, 56], stuff: [34, 39], control: [38, 52], command: [46, 52], stamina: [41, 44] },
  "A+": { hit: [41, 46], power: [42, 47], eye: [42, 52], speed: [47, 48], field: [53, 55], arm: [53, 55], stuff: [37, 41], control: [40, 50], command: [46, 51], stamina: [41, 43] },
  AA: { hit: [43, 46], power: [44, 47], eye: [44, 51], speed: [48, 49], field: [53, 55], arm: [54, 55], stuff: [40, 43], control: [43, 51], command: [47, 51], stamina: [41, 43] },
  AAA: { hit: [45, 47], power: [45, 47], eye: [46, 50], speed: [48, 48], field: [53, 54], arm: [54, 54], stuff: [43, 45], control: [46, 49], command: [48, 50], stamina: [41, 41] },
  MLB: { hit: [49, 50], power: [49, 50], eye: [50, 50], speed: [50, 50], field: [53, 53], arm: [53, 54], stuff: [50, 51], control: [50, 51], command: [50, 51], stamina: [41, 41] },
};

/** How widely each tool's true grades spread within a group (grade points). */
export const TOOL_SPREAD: Record<ScoutTool, number> = { hit: 10, power: 12, eye: 9.5, speed: 12.5, field: 9.5, arm: 9.5, stuff: 8.5, control: 8, command: 7.5, stamina: 13 };
