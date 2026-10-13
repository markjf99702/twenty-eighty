import type { Rng } from "../core/rng";
import type { League, Team } from "../league/types";
import type { OffseasonState } from "../offseason/types";
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

/**
 * What an arbitration panel sees: last season's big-league line as the back of
 * a baseball card reads it, in wins. It is fit to WAR over simulated seasons
 * but hands out credit the way arbitration does, not the way WAR does: runs
 * driven in and pitchers' wins count (WAR gives them next to nothing), walks
 * and defense don't, and saves pay handsomely (WAR gives them nothing at all).
 * Totals, not rates: a player who missed half the year has half a case.
 * Null if he barely played in the majors.
 */
export interface ArbCase {
  /** His case, in wins over replacement. */
  war: number;
  /** The numbers he takes into the hearing, e.g. "34 SV, 2.41 ERA, 61.1 IP". */
  line: string;
  /** Saves he's paid for (a reliever's; a starter's odd save isn't). */
  sv: number;
}

/** Wins of an arbitration case per save. */
export const ARB_PER_SAVE = 0.06;

export function arbCase(p: Player, year: number): ArbCase | null {
  const line = p.career.find((c) => c.year === year && c.level === "MLB");
  if (!line) return null;
  if (p.pitching) {
    const q = line.pit;
    if (!q || q.outs < 90) return null;
    const ip = q.outs / 3;
    const ipText = `${Math.floor(q.outs / 3)}${q.outs % 3 ? `.${q.outs % 3}` : ""} IP`;
    const era = `${q.ERA.toFixed(2)} ERA`;
    if (q.GS >= q.G / 2) {
      const war = 0.05 + 0.012 * ip + 0.0195 * q.SO - 0.0453 * q.ER + 0.1 * q.W;
      return { war, line: `${q.W}-${q.L}, ${era}, ${ipText}, ${q.SO} K`, sv: 0 };
    }
    const war = -0.144 + 0.0074 * ip + 0.0232 * q.SO - 0.0473 * q.ER + ARB_PER_SAVE * q.SV;
    return { war, line: `${q.SV ? `${q.SV} SV, ` : ""}${era}, ${ipText}, ${q.SO} K`, sv: q.SV };
  }
  const b = line.bat;
  if (!b || b.PA < 150) return null;
  const war = -0.0142 * b.PA + 0.0567 * b.H + 0.0463 * b.HR + 0.025 * b.RBI + 0.0267 * b.SB;
  const avg = b.AB > 0 ? (b.H / b.AB).toFixed(3).replace(/^0/, "") : ".000";
  return { war, line: `${avg}, ${b.HR} HR, ${b.RBI} RBI${b.SB >= 10 ? `, ${b.SB} SB` : ""}`, sv: 0 };
}

/**
 * An arbitration award: a share of market value, judged mostly on his case
 * (last season's numbers, saves and all) and a little on his grades; on his
 * grades alone if he barely played. `withoutSaves` prices the same case with
 * the saves taken out, to show what they're worth.
 */
export function arbitrationSalary(p: Player, lastYear: number, withoutSaves = false): number {
  const n = Math.min(ARB_SHARE.length - 1, Math.max(0, serviceYears(p) - ARB_YEARS));
  const c = arbCase(p, lastYear);
  const war = c === null ? projectedWar(p) : 0.25 * projectedWar(p) + 0.75 * (c.war - (withoutSaves ? ARB_PER_SAVE * c.sv : 0));
  const award = ARB_SHARE[n]! * marketSalary(war);
  const floor = p.contract && p.contract.type !== "minor" ? p.contract.salary : MIN_SALARY;
  return money(Math.max(floor, award, MIN_SALARY + 0.3));
}

/**
 * What a club thinks a year of him is worth when deciding whether to tender
 * him: his wins above a replacement at the market rate, with a reliever's
 * counted up for the late innings he pitches (WAR doesn't weigh leverage, and
 * clubs pay for it) and measured against a smaller margin (a reliever's whole
 * season is a third of a starter's innings).
 */
export function tenderWorth(p: Player, war: number): number {
  const relief = p.pitching !== undefined && !canStart(p);
  return Math.max(0, war - (relief ? 0.1 : 0.3)) * DOLLARS_PER_WAR * (relief ? 1.8 : 1);
}

/** A club's call on an arbitration case: keep him if he's worth his award over a replacement-level player, or if it's cheap. */
export const worthTendering = (p: Player, award: number) => tenderWorth(p, seasonWar(p)) >= 0.9 * award || award <= 1.2;

export const preArbSalary = (p: Player) => money(MIN_SALARY + 0.03 * serviceYears(p));

/**
 * The winter before the tender deadline (its review and tender phases), while next season's contracts are still
 * pending: veterans whose deals are up leave at the deadline, and arbitration cases wait on their tenders.
 */
export function tenderWindow(league: League): OffseasonState | null {
  const w = league.offseason;
  return w && (w.phase === "review" || w.phase === "tenders") ? w : null;
}

/** A veteran whose contract is up: he becomes a free agent at the tender deadline. */
export const leavesAtDeadline = (league: League, p: Player): boolean => tenderWindow(league)?.expiring.includes(p.id) ?? false;

/**
 * His contract for next season while the tender deadline is ahead: none for a veteran whose deal is up, and a one-year
 * deal at his award for an arbitration case (whoever has him at the deadline decides whether to tender it). Otherwise,
 * and after the deadline, the contract he has.
 */
export function pendingContract(league: League, p: Player): Contract | null {
  const w = tenderWindow(league);
  if (!w) return p.contract;
  if (w.expiring.includes(p.id)) return null;
  const t = w.tenders.find((x) => x.playerId === p.id);
  return t ? { type: "arb", salary: t.salary, years: 1 } : p.contract;
}

/**
 * Before the tender deadline, an arbitration case who changes clubs (a trade, a waiver claim) takes his pending tender
 * along, and his new club decides it by the clubs' rule (the user can change his own on the tender table).
 */
export function followTender(league: League, p: Player): void {
  const t = tenderWindow(league)?.tenders.find((x) => x.playerId === p.id);
  if (!t || p.teamId === null || t.teamId === p.teamId) return;
  t.teamId = p.teamId;
  t.tender = worthTendering(p, t.salary);
}

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

/**
 * Off the 40-man (an outright): a pre-arbitration deal reverts to a minor
 * league contract. An arbitration salary is this season's, owed like a
 * guaranteed deal, so it stays on the books while he's in the minors (the
 * winter turns it into a minor league deal if he's still off the 40-man).
 */
export function outrightContract(p: Player): void {
  if (!p.contract || p.contract.type === "pre-arb") p.contract = minorContract();
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

/**
 * This season's payroll: every non-minor-league contract in the organization plus dead money. Before the tender
 * deadline it's next season's: veterans whose deals are up don't count, and arbitration cases count at their awards
 * when their club tenders them.
 */
export function payroll(league: League, team: Team): number {
  let total = 0;
  const w = tenderWindow(league);
  for (const p of orgPlayers(league, team)) {
    const t = w?.tenders.find((x) => x.playerId === p.id);
    if (t) total += t.tender ? t.salary : 0;
    else if (!w?.expiring.includes(p.id)) total += salaryOf(p);
  }
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
