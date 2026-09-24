import { Rng } from "../core/rng";
import type { League } from "../league/types";
import { assignInitialContracts, budgetFor } from "../org/contracts";
import { defaultScouting } from "../scouting/scouting";

/**
 * Bring an older save up to date. Version 1 predates contracts, careers and
 * league history: those start fresh, with contracts assigned the way a new
 * universe's are. Version 2 predates scouting departments.
 */
export function migrateLeague(league: League, fromVersion: number): void {
  if (fromVersion < 2) {
    const l = league as Partial<League> & League;
    l.history ??= [];
    l.freeAgents ??= [];
    l.offseason ??= null;
    for (const t of league.teams) {
      t.budget ??= budgetFor(t.market);
      t.deadMoney ??= [];
    }
    for (const p of league.players) {
      p.career ??= [];
      p.awards ??= [];
      p.contract ??= null;
    }
    for (const tx of league.transactions) tx.year ??= league.year;
    assignInitialContracts(league, new Rng(`${league.seed}:contracts`));
  }
  if (fromVersion < 3) {
    // Scouting and analytics departments arrive, and budgets grow to pay for them.
    for (const t of league.teams) t.budget += 10;
    (league as Partial<League> & League).scouting ??= defaultScouting(league, new Rng(`${league.seed}:scouting`));
  }
}
