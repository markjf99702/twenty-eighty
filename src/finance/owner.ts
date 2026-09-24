import { hashNormal, seedHash } from "../core/hash";
import { clamp } from "../core/math";
import { Rng } from "../core/rng";
import type { League, Team } from "../league/types";
import { orgPlayers } from "../org/contracts";
import { teamStrength } from "../org/trades";
import { randomName } from "../players/names";
import type { Season } from "../season/season";
import { bestTicketPrice, expectedGate, formFactor, profitOf } from "./finance";
import type { GmReview, GmState, GoalKind, GoalResult, Owner, OwnerGoal, OwnerMessage, OwnerStyle } from "./types";

/**
 * Owners. Every club has one, with a style that sets how much of the club's
 * money goes to baseball and what the owner asks of the general manager. For
 * the user's club, the owner sets two or three goals each spring (measured
 * against a preseason projection, so a rebuilding club isn't asked to win
 * the pennant), reviews the season after the World Series, and adjusts the
 * owner's confidence in the GM. Let it fall too far and the owner finds a new
 * GM; other clubs with openings will call.
 */

const STYLES: [OwnerStyle, number][] = [
  ["balanced", 0.4],
  ["win-now", 0.2],
  ["frugal", 0.2],
  ["patient", 0.2],
];

/** How forgiving each kind of owner is of a disappointing season (losses of confidence are divided by this). */
export const OWNER_PATIENCE: Record<OwnerStyle, number> = { "win-now": 0.75, balanced: 1, frugal: 1, patient: 1.3 };

export const STYLE_LABEL: Record<OwnerStyle, string> = {
  "win-now": "Win now",
  balanced: "Balanced",
  frugal: "Frugal",
  patient: "Patient builder",
};

export const STARTING_CONFIDENCE = 60;
export const FIRING_LINE = 20;
/** A young regular: 25 or younger with this much big-league work in a season. */
export const YOUTH_PA = 150;
export const YOUTH_OUTS = 120;
const MESSAGES_KEPT = 30;

export function createOwner(rng: Rng): Owner {
  const style = STYLES[rng.weightedIndex(STYLES.map((s) => s[1]))]![0];
  const n = randomName(rng);
  return { name: rng.chance(0.3) ? `The ${n.last} family` : `${n.first} ${n.last}`, style };
}

/** The owner's confidence in a word. */
export function mood(confidence: number): string {
  if (confidence >= 80) return "Delighted";
  if (confidence >= 62) return "Pleased";
  if (confidence >= 45) return "Satisfied";
  if (confidence >= 30) return "Uneasy";
  return "On the hot seat";
}

/** "I" for a person, "we" for a family. */
const family = (o: Owner) => o.name.startsWith("The ");

/**
 * The preseason projection: wins from the club's projected strength against
 * the league's (fit on simulated seasons), plus the forecaster's own error.
 */
export function expectedWins(league: League, teamId: number): number {
  const s = league.teams.map((t) => teamStrength(league, t));
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const year = league.offseason ? league.year + 1 : league.year;
  const miss = 1.5 * hashNormal(seedHash(league.seed), year, teamId, 57);
  return Math.round(clamp(81 + 0.811 * (s[teamId]! - mean) + miss, 55, 105));
}

function say(gm: GmState, m: OwnerMessage): void {
  gm.messages.push(m);
  if (gm.messages.length > MESSAGES_KEPT) gm.messages.splice(0, gm.messages.length - MESSAGES_KEPT);
}

/** Put the user in charge of a club. */
export function hireGm(league: League, teamId: number, confidence = STARTING_CONFIDENCE, day = 0): GmState {
  const team = league.teams[teamId]!;
  const year = league.offseason ? league.year + 1 : league.year;
  const gm: GmState = {
    teamId,
    confidence,
    hired: year,
    seasons: 0,
    expectedWins: null,
    goals: [],
    goalYear: year,
    messages: [],
    reviews: [],
    fired: false,
    offers: [],
    midseason: null,
  };
  league.gm = gm;
  league.userTeamId = teamId;
  const o = team.owner;
  const voice = family(o) ? "We're" : "I'm";
  say(gm, {
    year: league.offseason ? league.year : year,
    day,
    tone: "neutral",
    text: `${voice} glad to have you running the ${team.nickname}. ${STYLE_PITCH[o.style]}`,
  });
  if (!league.offseason) setGoals(league, day);
  return gm;
}

const STYLE_PITCH: Record<OwnerStyle, string> = {
  "win-now": "This city has waited long enough. Spend what it takes and bring home a winner.",
  balanced: "Win games, fill the ballpark, and don't lose money doing it.",
  frugal: "Run a tight ship. Every dollar you spend has to earn its keep.",
  patient: "Build something that lasts. Develop our own players and I'll give you time to do it.",
};

export function goalLabel(g: OwnerGoal): string {
  switch (g.kind) {
    case "wins":
      return `Win ${g.target} games`;
    case "playoffs":
      return "Reach the postseason";
    case "profit":
      return g.target > 0 ? `Turn a profit of $${g.target}M` : "Don't lose money";
    case "attendance":
      return `Draw ${(g.target / 1e6).toFixed(2)} million fans`;
    case "youth":
      return `Give ${g.target} players 25 or younger regular big-league work`;
    case "budget":
      return `Stay within the $${g.target}M budget`;
  }
}

/** The spring goals, set once the roster is in place (after spring training, or on hiring before Opening Day). */
export function setGoals(league: League, day = 0): void {
  const gm = league.gm;
  if (!gm || gm.fired) return;
  const team = league.teams[gm.teamId]!;
  const year = league.offseason ? league.year + 1 : league.year;
  const e = expectedWins(league, team.id);
  const goals: OwnerGoal[] = [];
  const add = (kind: GoalKind, target: number, weight: number) => goals.push({ kind, target, weight });
  const fans = () => {
    const form = formFactor(e, 162 - e);
    const projected = expectedGate(team, bestTicketPrice(team), form).fans;
    return Math.round((projected * 1.01) / 10_000) * 10_000;
  };
  switch (team.owner.style) {
    case "win-now":
      add("wins", e + 3, 1.5);
      if (e >= 83) add("playoffs", 1, 1.2);
      add("attendance", fans(), 0.6);
      break;
    case "balanced":
      add("wins", e + 1, 1.2);
      if (e >= 88) add("playoffs", 1, 1);
      else add("attendance", fans(), 0.6);
      add("profit", 0, 0.6);
      break;
    case "patient":
      add("youth", e < 75 ? 3 : 2, 1.2);
      add("wins", e - 3, 0.8);
      add("attendance", fans(), 0.5);
      break;
    case "frugal":
      add("profit", 10, 1.3);
      add("budget", team.budget, 1);
      add("wins", e - 1, 0.7);
      break;
  }
  gm.expectedWins = e;
  gm.goals = goals;
  gm.goalYear = year;
  const lines = goals.map((g) => goalLabel(g)).join("; ");
  say(gm, {
    year: league.offseason ? league.year : year,
    day,
    tone: "neutral",
    text: `The forecasters have us at ${e} wins this year. Here's what I want from ${year}: ${lines}.`,
  });
}

/** Young players who got real big-league work for the club this season. */
export function youngRegulars(league: League, season: Season, team: Team): number[] {
  return orgPlayers(league, team)
    .filter((p) => p.age <= 25)
    .filter((p) => (season.batting.lines.get(p.id)?.PA ?? 0) >= YOUTH_PA || (season.pitching.lines.get(p.id)?.outs ?? 0) >= YOUTH_OUTS)
    .map((p) => p.id);
}

/** How the club is doing on each goal so far (or at the end). */
export function goalProgress(league: League, season: Season): { goal: OwnerGoal; actual: number; met: boolean }[] {
  const gm = league.gm;
  if (!gm || gm.goalYear !== league.year) return [];
  const team = league.teams[gm.teamId]!;
  const rec = season.records[team.id]!;
  const l = team.finance.ledger;
  return gm.goals.map((goal) => {
    let actual: number;
    switch (goal.kind) {
      case "wins":
        actual = rec.w;
        break;
      case "playoffs":
        actual = season.postseason?.seeds.flat().includes(team.id) ? 1 : 0;
        break;
      case "profit":
        actual = Math.round(profitOf(l) * 10) / 10;
        break;
      case "attendance":
        actual = l.attendance;
        break;
      case "youth":
        actual = youngRegulars(league, season, team).length;
        break;
      case "budget":
        actual = Math.round((l.payroll + l.deadMoney + l.staff) * 10) / 10;
        break;
    }
    const met = goal.kind === "budget" ? actual <= goal.target : actual >= goal.target;
    return { goal, actual, met };
  });
}

/** How far short a missed goal fell, 0 (barely) to 1 (badly). */
function shortfall(league: League, season: Season, g: OwnerGoal, actual: number, teamId: number): number {
  switch (g.kind) {
    case "wins":
      return (g.target - actual) / 10;
    case "playoffs": {
      const team = league.teams[teamId]!;
      const last = season.postseason?.seeds[team.league]?.at(-1);
      const behind = last === undefined ? 8 : season.records[last]!.w - season.records[teamId]!.w;
      return clamp(behind / 8, 0.2, 1);
    }
    case "profit":
      return (g.target - actual) / 30;
    case "attendance":
      return (g.target - actual) / (0.15 * g.target);
    case "youth":
      return (g.target - actual) / g.target;
    case "budget":
      return (actual - g.target) / (0.1 * g.target);
  }
}

/**
 * The owner's review after the World Series (before the books close): each
 * goal, wins against the projection, the postseason, spending and losses.
 * Returns the review, or null when the user runs no club.
 */
export function reviewSeason(league: League, season: Season): GmReview | null {
  const gm = league.gm;
  if (!gm || gm.fired) return null;
  const team = league.teams[gm.teamId]!;
  const owner = team.owner;
  const rec = season.records[team.id]!;
  const l = team.finance.ledger;
  const before = gm.confidence;
  // A new GM gets some rope in the first season.
  const patience = OWNER_PATIENCE[owner.style] * (gm.seasons === 0 ? 1.6 : 1);
  const scale = (d: number) => (d < 0 ? d / patience : d);

  const goals: GoalResult[] = goalProgress(league, season).map(({ goal, actual, met }) => {
    const f = clamp(shortfall(league, season, goal, actual, team.id), 0, 1);
    const delta = met ? 4 * goal.weight : -goal.weight * (2 + 6 * f);
    return { ...goal, actual, met, delta: Math.round(scale(delta) * 10) / 10 };
  });

  const notes: { text: string; delta: number }[] = [];
  const note = (text: string, delta: number) => notes.push({ text, delta: Math.round(scale(delta) * 10) / 10 });
  const expected = gm.goalYear === league.year ? gm.expectedWins : null;
  if (expected !== null) {
    const diff = rec.w - expected;
    const text =
      diff === 0 ? `Won ${rec.w}, right on the projection` : `Won ${rec.w}, ${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than the ${expected} projected`;
    note(text, clamp(0.4 * diff, -6, 6));
  }
  const post = season.postseason;
  if (post?.seeds.flat().includes(team.id)) {
    if (post.champion === team.id) note("Won the World Series", 18);
    else if (post.series.some((s) => s.round === "Championship Series" && s.winner === team.id)) note("Won the pennant", 9);
    else note("Reached the postseason", 3);
  }
  const spent = l.payroll + l.deadMoney + l.staff;
  if (spent > team.budget * 1.03) {
    note(`Spent $${spent.toFixed(1)}M against a $${team.budget}M budget`, -Math.min(10, 50 * (spent / team.budget - 1)));
  }
  const profit = profitOf(l);
  if (profit < -40) note(`Lost $${(-profit).toFixed(1)}M`, -Math.min(8, (-profit - 40) / 8) * (owner.style === "frugal" ? 1.5 : 1));

  const total = goals.reduce((s, g) => s + g.delta, 0) + notes.reduce((s, n) => s + n.delta, 0);
  gm.confidence = Math.round(clamp(before + total, 0, 100));
  gm.seasons++;
  const review: GmReview = { year: league.year, goals, expectedWins: expected, wins: rec.w, notes, before, after: gm.confidence };
  gm.reviews.push(review);

  const met = goals.filter((g) => g.met).length;
  const day = season.totalDays + 30;
  const tally = goals.length ? `You met ${met} of ${goals.length} goal${goals.length === 1 ? "" : "s"}. ` : "";
  const fired = gm.confidence < FIRING_LINE && (gm.seasons >= 2 || gm.confidence < 10);
  if (fired) {
    gm.fired = true;
    gm.offers = jobOffers(league, season, team.id);
    say(gm, { year: league.year, day, tone: "bad", text: `${tally}This isn't working. ${family(owner) ? "We've" : "I've"} decided to go in a different direction; thank you for your work.` });
  } else {
    const verdict =
      total >= 8
        ? "That's the kind of season I hoped for. Keep it going."
        : total >= 0
          ? "A solid year. Let's build on it."
          : gm.confidence < 35
            ? "I'm running out of patience. Next season has to be better."
            : "Not what I wanted. I expect more next year.";
    say(gm, { year: league.year, day, tone: total >= 0 ? "good" : "bad", text: `${league.year} is in the books. ${tally}${verdict}` });
  }
  return review;
}

/** Clubs that call a fired GM: three of the ten worst, by a fixed draw. */
function jobOffers(league: League, season: Season, formerTeam: number): number[] {
  const rng = new Rng(`${league.seed}:${league.year}:jobs`);
  const worst = [...season.records]
    .sort((a, b) => season.compare(b, a))
    .map((r) => r.teamId)
    .filter((id) => id !== formerTeam)
    .slice(0, 10);
  return rng.shuffle(worst).slice(0, 3);
}

/** Take one of the jobs offered after a firing. */
export function acceptJob(league: League, teamId: number): GmState {
  const gm = league.gm;
  if (!gm || !gm.fired || !gm.offers.includes(teamId)) throw new Error("That club hasn't offered you a job.");
  const old = league.teams[gm.teamId]!;
  old.manualRoster = false;
  old.manualDepth = false;
  old.finance.autoPrice = true;
  // Your scouts' looks stay with your old club.
  league.scouting.looks = {};
  const next = hireGm(league, teamId, 55, gm.messages.at(-1)?.day ?? 0);
  next.reviews = gm.reviews;
  return next;
}

/** Halfway through the season the owner checks in on the pace. */
export function ownerCheckIn(season: Season): void {
  const league = season.league;
  const gm = league.gm;
  if (!gm || gm.fired || gm.goalYear !== league.year || gm.midseason === league.year) return;
  if (season.day < Math.floor(season.totalDays / 2)) return;
  gm.midseason = league.year;
  const team = league.teams[gm.teamId]!;
  const rec = season.records[team.id]!;
  const games = rec.w + rec.l;
  if (games === 0) return;
  const pace = Math.round((rec.w / games) * 162);
  const winGoal = gm.goals.find((g) => g.kind === "wins");
  const target = winGoal?.target ?? gm.expectedWins ?? 81;
  const diff = pace - target;
  const text =
    diff >= 4
      ? `We're on pace for ${pace} wins. The whole city is talking about this club. Keep it up.`
      : diff >= -2
        ? `We're on pace for ${pace} wins, about where I hoped. The second half decides it.`
        : `We're on pace for ${pace} wins. That's well short of ${target}. I expect a better second half.`;
  say(gm, { year: league.year, day: season.day, tone: diff >= 4 ? "good" : diff >= -2 ? "neutral" : "bad", text });
}
