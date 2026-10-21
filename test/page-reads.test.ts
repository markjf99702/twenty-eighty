import { beforeAll, describe, expect, it } from "vitest";
import { openingDayAdvice } from "../src/advice/advice";
import { hireGm } from "../src/finance/owner";
import { generateLeague } from "../src/league/generate";
import { saveGame, serialize } from "../src/save/save";
import { warShift } from "../src/scouting/analytics";
import { Season } from "../src/season/season";
import type { BoxScoreView } from "../web/src/api/protocol";
import { boxScoreView, dashboardView, playerView, StatsCache, status } from "../web/src/worker/views";
import { blockView, tradeSide } from "../web/src/worker/winter";

/**
 * While a sim holds each day on screen, the worker answers whatever the open pages ask for, between one day and
 * the next. None of it may change how the season plays: the same days from the same seed, played once with
 * nothing asked and once with the pages' reads after every day, must come out the same, down to what each club
 * believes after the day's games (when the trade market, the offers to the user and the staff's notes read it).
 */
const USER = 6;
const OTHER = 21;
const DAYS = 8;

function play(pages: boolean) {
  // As the worker starts a new game (newGame, then attach).
  const league = generateLeague({ seed: "between-days" });
  hireGm(league, USER);
  const season = new Season(league, { minors: false });
  openingDayAdvice(season);
  const stats = new StatsCache(() => season);
  const boxes = new Map<string, BoxScoreView>();
  const watched = [USER, OTHER].flatMap((id) => league.teams[id]!.rosters.MLB).map((id) => league.players[id]!);
  const beliefs: number[][] = [];
  let played = 0;
  season.onGame = (level, result, day) => {
    if (level !== "MLB") return;
    const box = boxScoreView(season, result, day);
    boxes.set(box.key, box);
    if (++played < season.schedule.days[day]!.length) return;
    played = 0;
    beliefs.push([USER, OTHER].flatMap((viewer) => watched.map((p) => warShift(season, viewer, p))));
  };
  for (let d = 0; d < DAYS; d++) {
    season.simDay();
    if (!pages) continue;
    // The front office, a player of yours and one of theirs, the trade desk and the block.
    const ctx = season.rosterContext();
    dashboardView(season, stats, boxes, status(league, season, true));
    playerView(season, stats, league.teams[USER]!.rosters.MLB[0]!, ctx);
    playerView(season, stats, league.teams[OTHER]!.rosters.MLB[0]!, ctx);
    tradeSide(season, stats, league.teams[USER]!, ctx);
    tradeSide(season, stats, league.teams[OTHER]!);
    blockView(season, stats);
  }
  const save = JSON.parse(serialize(saveGame(league, season)));
  delete save.savedAt;
  return { beliefs, save };
}

/** Where two saves first differ ("save.league.scouting.looksLeft: 0 vs 4"), or null if they don't. */
function firstDifference(a: unknown, b: unknown, path = "save"): string | null {
  if (Object.is(a, b)) return null;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

describe("the pages asked for between days", () => {
  let quiet: ReturnType<typeof play>;
  let busy: ReturnType<typeof play>;
  beforeAll(() => {
    quiet = play(false);
    busy = play(true);
  });

  it("leave what every club believes after the day's games as it would be", () => {
    expect(quiet.beliefs).toHaveLength(DAYS);
    const changed = busy.beliefs.map((day, d) => day.filter((x, i) => x !== quiet.beliefs[d]![i]).length);
    expect(changed).toEqual(Array(DAYS).fill(0));
  });

  it("leave the season to play and save the same way", () => {
    expect(firstDifference(busy.save, quiet.save)).toBeNull();
  });
});
