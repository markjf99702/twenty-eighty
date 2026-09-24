import type { Rng } from "../core/rng";
import type { League, Team } from "../league/types";
import { projectPlayer } from "../players/development";
import { type Contract, type Player, SERVICE_DAYS_PER_YEAR } from "../players/types";
import { staffCost } from "../scouting/scouting";
import { canStart, pitchingValue, playerValue } from "./value";

/**
 * Money: what players are worth, what they're paid, and what clubs can spend.
 * All amounts are millions of dollars per season.
 */

export const MIN_SALARY = 0.78;
/** What a win costs on the free-agent market. */
export const DOLLARS_PER_WAR = 8;
/** Arbitration pays a share of market value that rises each year of eligibility. */
export const ARB_SHARE = [0.22, 0.38, 0.58] as const;
/** Service years at which players reach arbitration and free agency. */
export const ARB_YEARS = 3;
export const FREE_AGENT_YEARS = 6;

export const serviceYears = (p: Player) => Math.floor(p.service / SERVICE_DAYS_PER_YEAR);

const money = (x: number) => Math.round(x * 20) / 20;

/**
 * Wins above replacement over a full season in his role (600 PA, a starter's
 * 180 innings or a reliever's 65), from his grades. The coefficients are
 * measured from simulated seasons: WAR regressed on grade-based value.
 */
export function seasonWar(p: Player): number {
  if (p.pitching) {
    const v = pitchingValue(p);
    return canStart(p) ? 0.9 * (2.67 + 0.0606 * v) : 0.23 + 0.0263 * v;
  }
  return 1.38 + 0.0657 * playerValue(p);
}

/** WAR for a full season in his role from a value on the `playerValue` scale (for beliefs about a player). */
export function warFromValue(p: Player, value: number): number {
  if (p.pitching) {
    const start = canStart(p);
    const pv = value / (start ? 1.25 : 0.45);
    return start ? 0.9 * (2.67 + 0.0606 * pv) : 0.23 + 0.0263 * pv;
  }
  return 1.38 + 0.0657 * value;
}

/** Projected WAR `yearsAhead` seasons from now, with expected development and aging. */
export function projectedWar(p: Player, yearsAhead = 0): number {
  return seasonWar(yearsAhead > 0 ? projectPlayer(p, yearsAhead) : p);
}

/** One season's free-agent price for a projected WAR. */
export function marketSalary(war: number): number {
  return money(Math.max(MIN_SALARY, DOLLARS_PER_WAR * war - 1.5));
}

/** His most recent big-league WAR, prorated to a full season (null if he barely played). */
export function recentWar(p: Player, year: number): number | null {
  const line = p.career.find((c) => c.year === year && c.level === "MLB");
  if (!line) return null;
  if (line.bat && line.bat.PA >= 150) return (line.bat.WAR * 600) / line.bat.PA;
  if (line.pit && line.pit.outs >= 90) {
    const full = canStart(p) ? 540 : 195;
    return (line.pit.WAR * full) / line.pit.outs;
  }
  return null;
}

/** An arbitration award: a share of market value, judged half on grades and half on last season. */
export function arbitrationSalary(p: Player, lastYear: number): number {
  const n = Math.min(ARB_SHARE.length - 1, Math.max(0, serviceYears(p) - ARB_YEARS));
  const recent = recentWar(p, lastYear);
  const war = recent === null ? projectedWar(p) : 0.5 * projectedWar(p) + 0.5 * recent;
  const award = ARB_SHARE[n]! * marketSalary(war);
  const floor = p.contract && p.contract.type !== "minor" ? p.contract.salary : MIN_SALARY;
  return money(Math.max(floor, award, MIN_SALARY + 0.3));
}

export const preArbSalary = (p: Player) => money(MIN_SALARY + 0.03 * serviceYears(p));

export const minorContract = (): Contract => ({ type: "minor", salary: 0, years: 1 });

/**
 * A player going onto the 40-man roster gets a big-league contract if he's on
 * a minor league deal: the minimum scale by service time, or for a veteran
 * who signed a minor league deal, the one-year salary written into it.
 */
export function ensureMajorContract(p: Player): void {
  if (p.contract && p.contract.type !== "minor") return;
  const yrs = serviceYears(p);
  if (yrs < ARB_YEARS) p.contract = { type: "pre-arb", salary: preArbSalary(p), years: 1 };
  else if (yrs < FREE_AGENT_YEARS) p.contract = { type: "arb", salary: money(MIN_SALARY + 0.3), years: 1 };
  else p.contract = { type: "guaranteed", salary: money(MIN_SALARY + 0.5), years: 1 };
}

/** Off the 40-man (an outright): a non-guaranteed deal reverts to a minor league contract. */
export function outrightContract(p: Player): void {
  if (!p.contract || p.contract.type !== "guaranteed") p.contract = minorContract();
}

/**
 * Baseball-operations budget from the size of the market: about $105M in the
 * smallest metro, $260M in the biggest. It covers player payroll plus the
 * scouting and analytics departments.
 */
export function budgetFor(market: number): number {
  return Math.round(Math.max(95, 105 + 48 * Math.log2(market / 2)));
}

/** What's left of the budget after payroll and the front-office departments. */
export function budgetRoom(league: League, team: Team): number {
  return team.budget - staffCost(league, team) - payroll(league, team);
}

/** This season's payroll: every non-minor-league contract in the organization plus dead money. */
export function payroll(league: League, team: Team): number {
  let total = 0;
  for (const p of orgPlayers(league, team)) total += salaryOf(p);
  for (const d of team.deadMoney) total += d.amount;
  return money(total);
}

const salaryOf = (p: Player) => (p.contract && p.contract.type !== "minor" ? p.contract.salary : 0);

/** Guaranteed money owed in a future season (0 = this one), for planning. */
export function committed(league: League, team: Team, yearsAhead: number): number {
  let total = 0;
  for (const p of orgPlayers(league, team)) {
    const c = p.contract;
    if (c && c.type === "guaranteed" && c.years > yearsAhead) total += c.salary;
  }
  for (const d of team.deadMoney) if (d.years > yearsAhead) total += d.amount;
  return money(total);
}

/**
 * Contracts for a freshly generated universe: minor league deals below the
 * 40-man, pre-arbitration and arbitration salaries by service time, and
 * multi-year deals already in progress for veterans (some of them bargains,
 * some regrettable).
 */
export function assignInitialContracts(league: League, rng: Rng): void {
  for (const p of league.players) {
    if (p.teamId === null) continue;
    if (!p.onFortyMan) {
      p.contract = minorContract();
      continue;
    }
    const yrs = serviceYears(p);
    if (yrs < ARB_YEARS) {
      p.contract = { type: "pre-arb", salary: preArbSalary(p), years: 1 };
    } else if (yrs < FREE_AGENT_YEARS) {
      p.contract = { type: "arb", salary: arbitrationSalary(p, league.year - 1), years: 1 };
    } else {
      const maxLeft = p.age <= 29 ? 6 : p.age <= 32 ? 4 : 2;
      const left = rng.int(1, maxLeft);
      const elapsed = rng.int(0, Math.max(0, 5 - left));
      const war = projectedWar(p, Math.floor(left / 2));
      const salary = money(Math.max(MIN_SALARY, marketSalary(war) * Math.exp(rng.normal(0, 0.3))));
      p.contract = { type: "guaranteed", salary, years: left, signed: league.year - elapsed, total: money(salary * (left + elapsed)) };
    }
  }
  // Big markets carry big payrolls: scale each club's veteran deals toward its budget.
  for (const team of league.teams) {
    const target = (team.budget - staffCost(league, team)) * (0.82 + 0.18 * rng.next());
    const deals = orgPlayers(league, team).filter((p) => p.contract?.type === "guaranteed");
    const guaranteed = deals.reduce((s, p) => s + p.contract!.salary, 0);
    if (guaranteed === 0) continue;
    const f = Math.min(1.5, Math.max(0.6, (target - (payroll(league, team) - guaranteed)) / guaranteed));
    for (const p of deals) {
      const c = p.contract!;
      c.salary = money(Math.max(MIN_SALARY, c.salary * f));
      c.total = money(c.salary * (c.years + league.year - (c.signed ?? league.year)));
    }
  }
}

/** Everyone in an organization: every level plus the injured list. */
export function orgPlayers(league: League, team: Team): Player[] {
  return [...Object.values(team.rosters).flat(), ...team.injured].map((id) => league.players[id]!);
}
