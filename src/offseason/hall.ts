import type { Rng } from "../core/rng";
import type { Legend } from "../league/legends";
import type { League } from "../league/types";
import type { Player } from "../players/types";
import { careerTotals, type CareerTotals } from "../stats/career";

/**
 * The Hall of Fame. Each winter the writers vote on players who retired at
 * least two winters before (a quicker wait than the real five, so a league
 * gets its first ballots within a few seasons): ten or more big-league
 * seasons and a real case to be on it, 75% of the vote to get in, under 5%
 * or ten years on the ballot and he's off. The legends were in before the
 * league's first season.
 */

export const HALL_WAIT = 2;
export const ELECT_AT = 75;
export const DROP_BELOW = 5;
export const MAX_BALLOTS = 10;

export interface HallMember {
  year: number;
  vote: number;
  playerId?: number;
  legendId?: number;
}

export interface BallotEntry {
  playerId: number;
  vote: number;
  /** His year on the ballot (1 = first). */
  ballot: number;
  elected: boolean;
  /** Fell off: under 5%, or his tenth year. */
  dropped: boolean;
}

export interface HallOfFame {
  members: HallMember[];
  ballots: { year: number; entries: BallotEntry[] }[];
}

export const foundingHall = (legends: Legend[]): HallOfFame => ({
  members: legends.map((l) => ({ year: l.inducted, vote: l.vote, legendId: l.id })).sort((a, b) => a.year - b.year),
  ballots: [],
});

const count = (p: Player, what: RegExp) => p.awards.filter((a) => what.test(a)).length;

/** How strong a career looks to the voters: WAR, the hardware, and the round numbers they love. */
export function hallCase(p: Player, t: CareerTotals = careerTotals(p)): number {
  const b = t.bat;
  const q = t.pit;
  let score = (b?.WAR ?? 0) + (q?.WAR ?? 0);
  score += 6 * count(p, /League MVP$/) + 4 * count(p, /Cy Young$/) + 2 * count(p, /Reliever of the Year$/);
  score += 0.8 * Math.min(12, count(p, /All-Star$/)) + 0.3 * count(p, /Gold Glove/) + 0.3 * count(p, /Silver Slugger/);
  if (b) {
    if (b.HR >= 500) score += 12;
    if (b.HR >= 600) score += 8;
    if (b.H >= 3000) score += 12;
    if (b.SB >= 700) score += 6;
  }
  if (q) {
    if (q.W >= 250) score += 10;
    if (q.W >= 300) score += 8;
    if (q.SO >= 3000) score += 8;
    // The writers have come around on closers.
    score += q.SV / 14;
  }
  return score;
}

/** Whether a retired player makes the ballot at all: ten seasons and a case worth a look. */
export function ballotWorthy(p: Player, t: CareerTotals): boolean {
  return t.seasons >= 10 && hallCase(p, t) >= 30;
}

/** This winter's vote. Returns the players elected. */
export function holdHallVote(league: League, rng: Rng): number[] {
  const year = league.year;
  const hall = league.hall;
  const inHall = new Set(hall.members.map((m) => m.playerId).filter((id): id is number => id !== undefined));
  const history = new Map<number, BallotEntry[]>();
  for (const b of hall.ballots) for (const e of b.entries) history.set(e.playerId, [...(history.get(e.playerId) ?? []), e]);

  const entries: BallotEntry[] = [];
  for (const p of league.players) {
    if (p.retired === undefined || p.retired > year - HALL_WAIT || inHall.has(p.id)) continue;
    const past = history.get(p.id) ?? [];
    if (past.some((e) => e.dropped || e.elected)) continue;
    const t = careerTotals(p);
    if (past.length === 0 && (p.retired < year - HALL_WAIT || !ballotWorthy(p, t))) continue;
    const ballot = past.length + 1;
    const base = 100 / (1 + Math.exp(-(hallCase(p, t) - 62) / 7));
    // Support builds over the years on the ballot.
    const vote = Math.round(Math.max(0, Math.min(99.6, base + 2.5 * (ballot - 1) + rng.normal(0, 3))) * 10) / 10;
    const elected = vote >= ELECT_AT;
    entries.push({ playerId: p.id, vote, ballot, elected, dropped: !elected && (vote < DROP_BELOW || ballot >= MAX_BALLOTS) });
  }
  entries.sort((a, b) => b.vote - a.vote);
  if (entries.length) hall.ballots.push({ year, entries });
  const elected = entries.filter((e) => e.elected).map((e) => e.playerId);
  for (const e of entries.filter((x) => x.elected)) {
    hall.members.push({ year, vote: e.vote, playerId: e.playerId });
    league.players[e.playerId]!.awards.push(`${year} Hall of Fame`);
  }
  return elected;
}
