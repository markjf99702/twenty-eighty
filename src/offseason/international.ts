import type { Rng } from "../core/rng";
import { bookBonus } from "../finance/finance";
import type { League } from "../league/types";
import { logTransaction } from "../org/roster";
import { overallGrade } from "../org/value";
import { rawness } from "../league/generate";
import { generateHitter, generatePitcher } from "../players/generate";
import { type FieldPosition, playerName, type Player } from "../players/types";
import type { Season } from "../season/season";
import { valueShift } from "../scouting/scouting";
import { boardValue, signAmateur } from "./draft";
import type { InternationalState } from "./types";

/**
 * International amateur signings. Each club gets a bonus pool (bigger for
 * worse teams) and signs 17-year-olds from a shared pool, each asking a bonus
 * that tracks his projection. They're years away, but this is where a lot of
 * stars come from.
 */

export const INTERNATIONAL_POOL_SIZE = 110;
export const MAX_INTERNATIONAL_SIGNINGS = 5;
const SPOTS: FieldPosition[] = ["C", "2B", "3B", "SS", "CF", "RF", "LF", "1B"];
const SPOT_WEIGHTS = [10, 10, 10, 26, 18, 12, 8, 6];

export const INTERNATIONAL_TALENT = { age: 17, hitter: [-66, 12], pitcher: [-62, 10] } as const;

function prospect(rng: Rng, id: number): Player {
  const T = INTERNATIONAL_TALENT;
  const pitcher = rng.chance(0.4);
  const [mean, sd] = pitcher ? T.pitcher : T.hitter;
  const value = mean + rng.normal(0, sd);
  const p = pitcher
    ? generatePitcher(rng, { id, role: rng.chance(0.75) ? "SP" : "RP", value, age: T.age })
    : generateHitter(rng, { id, position: rng.weighted(SPOTS, SPOT_WEIGHTS), value, age: T.age });
  rawness(p, "A");
  return p;
}

/** Asking bonus ($M) from the prospect's projected peak: a future 60 wants about $5M. */
export function bonusAsk(p: Player): number {
  const fv = overallGrade(p, true);
  return Math.round(Math.min(5.5, Math.max(0.1, 0.1 + 0.26 * (fv - 40))) * 20) / 20;
}

export function openInternational(league: League, season: Season, rng: Rng): InternationalState {
  const pool: Player[] = [];
  for (let i = 0; i < INTERNATIONAL_POOL_SIZE; i++) pool.push(prospect(rng, -(i + 1)));
  // Worse teams get bigger pools: $5.0M to $7.5M.
  const worstFirst = [...season.records].sort((a, b) => a.w - a.l - (b.w - b.l)).map((r) => r.teamId);
  const pools = league.teams.map((t) => {
    const rank = worstFirst.indexOf(t.id);
    return Math.round((7.5 - (2.5 * rank) / Math.max(1, league.teams.length - 1)) * 20) / 20;
  });
  return { pool, asks: pool.map((p) => ({ playerId: p.id, bonus: bonusAsk(p) })), pools, signings: [] };
}

export function signInternational(league: League, s: InternationalState, teamId: number, poolId: number, day: number): { ok: boolean; reason?: string } {
  const i = s.pool.findIndex((p) => p.id === poolId);
  if (i < 0) return { ok: false, reason: "He has already signed." };
  const ask = s.asks.find((a) => a.playerId === poolId)!;
  if (ask.bonus > s.pools[teamId]! + 1e-9) return { ok: false, reason: "That's more than your remaining bonus pool." };
  if (s.signings.filter((x) => x.teamId === teamId).length >= MAX_INTERNATIONAL_SIGNINGS) {
    return { ok: false, reason: `Clubs can sign ${MAX_INTERNATIONAL_SIGNINGS} players in this game's signing period.` };
  }
  const [p] = s.pool.splice(i, 1);
  s.asks = s.asks.filter((a) => a.playerId !== poolId);
  s.pools[teamId] = Math.round((s.pools[teamId]! - ask.bonus) * 100) / 100;
  const team = league.teams[teamId]!;
  signAmateur(league, team, p!);
  s.signings.push({ playerId: p!.id, teamId, bonus: ask.bonus });
  bookBonus(league, teamId, ask.bonus);
  const pos = p!.pitching ? (p!.throws === "L" ? "LHP" : "RHP") : p!.position;
  logTransaction(league, day, team, p!, "sign", `Signed international free agent ${pos} ${playerName(p!)} ($${ask.bonus.toFixed(2)}M bonus)`);
  return { ok: true };
}

/** AI clubs spend their pools: round by round, each takes the best prospect it can afford. */
export function finishInternational(league: League, s: InternationalState, day: number, skip: number | null): void {
  for (let round = 0; round < MAX_INTERNATIONAL_SIGNINGS; round++) {
    const clubs = league.teams.filter((t) => t.id !== skip).sort((a, b) => s.pools[b.id]! - s.pools[a.id]!);
    for (const team of clubs) {
      const affordable = s.pool.filter((p) => s.asks.find((a) => a.playerId === p.id)!.bonus <= s.pools[team.id]!);
      if (affordable.length === 0) continue;
      const seen = (p: Player) => boardValue(p) + valueShift(league, team.id, p, true);
      const best = affordable.reduce((a, b) => (seen(b) > seen(a) ? b : a));
      signInternational(league, s, team.id, best.id, day);
    }
  }
  s.pool = [];
  s.asks = [];
}
