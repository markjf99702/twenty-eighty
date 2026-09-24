import { Rng } from "../core/rng";
import type { League } from "../league/types";
import { createFinance } from "../finance/finance";
import { createOwner, hireGm } from "../finance/owner";
import { assignInitialContracts, budgetFor } from "../org/contracts";
import { defaultScouting } from "../scouting/scouting";

/**
 * Bring an older save up to date. Version 1 predates contracts, careers and
 * league history: those start fresh, with contracts assigned the way a new
 * universe's are. Version 2 predates scouting departments; version 3
 * predates finances and owners; version 4, trade offers.
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
  if (fromVersion < 4) {
    // Every club gets an owner and books; the season in progress is backfilled once it's restored.
    const rng = new Rng(`${league.seed}:business`);
    const year = league.offseason ? league.year + 1 : league.year;
    for (const t of league.teams) {
      t.owner ??= createOwner(rng.fork(`owner${t.id}`));
      if (!t.finance) createFinance(t, rng.fork(`finance${t.id}`), year);
    }
    (league as Partial<League> & League).gm ??= null;
    if (league.userTeamId !== null && !league.gm) hireGm(league, league.userTeamId);
  }
  if (fromVersion < 5) {
    // Trade offers to the user arrive.
    (league as Partial<League> & League).tradeOffers ??= [];
  }
}
