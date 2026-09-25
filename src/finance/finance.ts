import { hashNormal, seedHash } from "../core/hash";
import { clamp } from "../core/math";
import type { Rng } from "../core/rng";
import { dials } from "../league/settings";
import type { League, Team } from "../league/types";
import { payroll } from "../org/contracts";
import { staffCost } from "../scouting/scouting";
import type { Season } from "../season/season";
import type { FinanceYear, Ledger, OwnerStyle, TeamFinance } from "./types";

/**
 * Club finances. Money comes in from the gate and concessions (every home
 * game draws a crowd that depends on the market, how much the city cares,
 * how the club is playing, the night of the week and the ticket price), local
 * media and sponsorship (bigger in bigger markets), the league's national
 * contracts (shared equally) and postseason gates. It goes out as payroll,
 * dead money, the scouting and analytics departments, signing bonuses and
 * the cost of running everything else. Profit builds a cash reserve (the
 * owner takes what's above it). Each winter the owner sets next season's
 * budget from what the club takes in and how the owner likes to spend.
 */

/** Each club's share of the league's national TV, radio and licensing money, $M. */
export const NATIONAL_REVENUE = 130;
/** Concessions, parking and merchandise per fan, dollars. */
export const CONCESSIONS = 22;
export const HOME_GAMES = 81;
export const BUDGET_FLOOR = 95;
export const BUDGET_CEILING = 330;
/** What an owner sets aside for draft and international bonuses before budgeting payroll. */
const BONUS_ALLOWANCE = 12;
/** Cash a club keeps in reserve; the owner takes the rest each winter. */
export const CASH_RESERVE = 100;

/** Share of what the club takes in (after operations) each kind of owner spends on baseball. */
export const OWNER_SPEND: Record<OwnerStyle, number> = { "win-now": 1.0, balanced: 0.94, patient: 0.92, frugal: 0.86 };

const size = (team: Team) => Math.log2(team.market / 2);
const round = (x: number, places = 2) => Math.round(x * 10 ** places) / 10 ** places;

/** The going rate for a ticket in this market, dollars. Priced here, a club maximizes its take when the park isn't full. */
export const referencePrice = (team: Team) => round(38 + 6 * size(team), 0);
/** Fans on a typical night at the reference price when the club is .500 and interest is normal. */
const baseCrowd = (team: Team) => 42_000 * (0.52 + 0.07 * size(team));

export const localMedia = (team: Team, interest = team.finance.interest) => 40 * (team.market / 2) ** 0.55 * (0.8 + 0.2 * interest);
export const sponsorship = (team: Team, interest = team.finance.interest) => (10 + 5 * size(team)) * (0.85 + 0.15 * interest);
/** Running everything but the big-league payroll: the farm system, the ballpark, travel, the business office. */
export const operations = (team: Team) => 157 + 10 * size(team);

/** How the gate responds to price: at the reference price the club maximizes gate plus concessions. */
export function priceFactor(team: Team, price: number): number {
  const ref = referencePrice(team);
  return Math.exp(-(price - ref) / (ref + CONCESSIONS));
}

/** Sunday through Saturday. */
const DAY_FACTOR = [1.08, 0.93, 0.93, 0.93, 0.93, 1.12, 1.15];
/** By month, March through October: cold April nights, full summer weekends. */
const MONTH_FACTOR: Record<number, number> = { 2: 1, 3: 0.92, 4: 0.98, 5: 1.05, 6: 1.07, 7: 1.04, 8: 0.97, 9: 0.97 };
/** A typical home schedule's nights, for projections. */
const OCCASIONS = [3, 4, 5, 6, 7, 8].flatMap((m) => DAY_FACTOR.map((d) => d * MONTH_FACTOR[m]!));

/** The club's form as the crowd sees it: winning percentage regressed toward .500 early on. */
export function formFactor(w: number, l: number): number {
  const pct = (w + 10) / (w + l + 20);
  return 1 + 1.2 * (pct - 0.5);
}

function demand(team: Team, price: number, form: number, occasion: number): number {
  return baseCrowd(team) * team.finance.interest ** 0.8 * priceFactor(team, price) * form * occasion;
}

/** Expected fans and gate plus concessions ($M) over a home season at a price. */
export function expectedGate(team: Team, price = team.finance.ticketPrice, form = 1): { fans: number; money: number } {
  const cap = team.finance.capacity;
  let perGame = 0;
  for (const o of OCCASIONS) perGame += Math.min(cap, demand(team, price, form, o));
  const fans = (perGame / OCCASIONS.length) * HOME_GAMES;
  return { fans, money: (fans * (price + CONCESSIONS)) / 1e6 };
}

/** The business office's price: the most money from the gate, without gouging (at most 10% over the going rate). */
export function bestTicketPrice(team: Team): number {
  const ref = referencePrice(team);
  let best = ref;
  let bestMoney = -Infinity;
  for (let p = Math.round(ref * 0.6); p <= Math.round(ref * 1.1); p++) {
    const m = expectedGate(team, p).money;
    if (m > bestMoney) {
      best = p;
      bestMoney = m;
    }
  }
  return best;
}

export const emptyLedger = (year: number): Ledger => ({
  year,
  gate: 0,
  concessions: 0,
  media: 0,
  sponsorship: 0,
  national: 0,
  postseason: 0,
  payroll: 0,
  deadMoney: 0,
  staff: 0,
  operations: 0,
  bonuses: 0,
  homeGames: 0,
  attendance: 0,
});

export const revenueOf = (l: Ledger) => l.gate + l.concessions + l.media + l.sponsorship + l.national + l.postseason;
export const expensesOf = (l: Ledger) => l.payroll + l.deadMoney + l.staff + l.operations + l.bonuses;
export const profitOf = (l: Ledger) => revenueOf(l) - expensesOf(l);

/** A club's books when the universe is created: a ballpark, a fan base, some cash. */
export function createFinance(team: Team, rng: Rng, year: number): TeamFinance {
  const finance: TeamFinance = {
    capacity: Math.round((36_000 + 11_000 * rng.next()) / 100) * 100,
    ticketPrice: 0,
    autoPrice: true,
    interest: round(clamp(1 + rng.normal(0, 0.08), 0.85, 1.15), 3),
    cash: Math.round(25 + 20 * size(team) + rng.normal(0, 25)),
    ledger: emptyLedger(year),
    history: [],
  };
  team.finance = finance;
  finance.ticketPrice = bestTicketPrice(team);
  return finance;
}

/** Revenue a club can expect over a full season at its current interest and price (no postseason). */
export function projectedRevenue(team: Team, price = team.finance.ticketPrice): number {
  return NATIONAL_REVENUE + localMedia(team) + sponsorship(team) + expectedGate(team, price).money;
}

// ---------------------------------------------------------------------------
// The season

/**
 * Tonight's crowd for a home game. The home opener sells out; otherwise it's
 * the demand at tonight's price, capped by the ballpark, with a little night-
 * to-night noise that is fixed by the date (so replays and resumes agree).
 */
export function crowdFor(season: Season, teamId: number, day: number): number {
  const league = season.league;
  const team = league.teams[teamId]!;
  const f = team.finance;
  if (f.ledger.homeGames === 0) return f.capacity;
  const date = season.dateOf(day);
  const occasion = DAY_FACTOR[date.getUTCDay()]! * (MONTH_FACTOR[date.getUTCMonth()] ?? 1);
  const rec = season.records[teamId]!;
  const noise = Math.exp(0.07 * hashNormal(seedHash(league.seed), league.year, day, teamId, 41));
  return Math.round(Math.min(f.capacity, demand(team, f.ticketPrice, formFactor(rec.w, rec.l), occasion) * noise));
}

export function bookGate(team: Team, fans: number): void {
  const l = team.finance.ledger;
  l.homeGames++;
  l.attendance += fans;
  l.gate += (fans * team.finance.ticketPrice) / 1e6;
  l.concessions += (fans * CONCESSIONS) / 1e6;
}

/** A day's share of everything paid or earned over the season rather than per game. */
export function accrueDay(season: Season): void {
  const league = season.league;
  const share = 1 / season.totalDays;
  for (const team of league.teams) {
    const l = team.finance.ledger;
    const dead = team.deadMoney.reduce((s, d) => s + d.amount, 0);
    l.national += NATIONAL_REVENUE * share;
    l.media += localMedia(team) * share;
    l.sponsorship += sponsorship(team) * share;
    l.operations += operations(team) * share;
    l.staff += staffCost(league, team) * share;
    l.deadMoney += dead * share;
    l.payroll += (payroll(league, team) - dead) * share;
  }
}

/** Postseason home games sell out at premium prices. Booked (and crowds recorded) when the playoffs are played. */
export function bookPostseason(season: Season): void {
  const post = season.postseason;
  if (!post) return;
  for (const s of post.series) {
    for (const g of s.games) {
      const team = season.league.teams[g.homeId]!;
      const f = team.finance;
      const price = 2.2 * Math.max(f.ticketPrice, referencePrice(team));
      g.attendance = f.capacity;
      f.ledger.postseason += (f.capacity * (price + CONCESSIONS)) / 1e6;
    }
  }
}

export function bookBonus(league: League, teamId: number, amount: number): void {
  const team = league.teams[teamId];
  if (team) team.finance.ledger.bonuses += amount;
}

/** A draft pick's signing bonus by overall pick, $M: about $10M first overall, $150K late. */
export function slotBonus(pick: number): number {
  return Math.max(0.15, round(10 * Math.exp(-0.046 * (pick - 1))));
}

/**
 * Books for a season already under way when finances arrived (an older
 * save): the days played so far at today's payroll, and a crowd for every
 * home game played, from the club's record now.
 */
export function backfillBooks(season: Season): void {
  const days = Math.min(season.day, season.totalDays);
  for (let d = 0; d < days; d++) accrueDay(season);
  for (const g of season.games) {
    const fans = crowdFor(season, g.homeId, g.day);
    bookGate(season.league.teams[g.homeId]!, fans);
    g.attendance = fans;
  }
  bookPostseason(season);
}

// ---------------------------------------------------------------------------
// Closing the books

/**
 * The season's books close after the World Series: profit goes to cash, fan
 * interest moves with the club's season, and the owner sets next season's
 * budget. A fresh ledger opens for next season (winter bonuses go there).
 */
export function closeBooks(league: League, season: Season): void {
  const post = season.postseason;
  const made = new Set(post?.seeds.flat() ?? []);
  const pennants = new Set(post?.series.filter((s) => s.round === "Championship Series").map((s) => s.winner) ?? []);
  for (const team of league.teams) {
    const f = team.finance;
    const l = f.ledger;
    const rec = season.records[team.id]!;
    const cash = f.cash + profitOf(l);
    const distribution = round(Math.max(0, cash - CASH_RESERVE));
    f.cash = round(cash - distribution);
    const year: FinanceYear = { ...l, wins: rec.w, losses: rec.l, budget: team.budget, interest: f.interest, distribution, cash: f.cash };
    f.history.push(year);

    const pct = rec.w + rec.l > 0 ? rec.w / (rec.w + rec.l) : 0.5;
    // (Centered so the postseason bonuses below don't inflate the league's average interest.)
    let target = 0.96 + 1.6 * (pct - 0.5);
    if (made.has(team.id)) target += 0.08;
    if (pennants.has(team.id)) target += 0.07;
    if (post?.champion === team.id) target += 0.1;
    // Full houses breed fans; gouging costs goodwill.
    if (l.homeGames > 0) {
      target += 0.2 * (l.attendance / (l.homeGames * f.capacity) - 0.6);
      const avgPrice = (l.gate * 1e6) / Math.max(1, l.attendance);
      target -= 0.8 * Math.max(0, avgPrice / referencePrice(team) - 1.1);
    }
    f.interest = round(clamp(0.7 * f.interest + 0.3 * target, 0.6, 1.4), 3);
    f.ledger = emptyLedger(league.year + 1);
  }
  for (const team of league.teams) team.budget = ownerBudget(league, team);
}

/**
 * Next season's baseball budget (payroll, dead money and the front-office
 * departments): what the owner's style says to spend of what the club
 * expects to take in, eased in from this season's budget.
 */
export function ownerBudget(league: League, team: Team): number {
  const f = team.finance;
  const last = f.history.at(-1);
  const revenue = projectedRevenue(team, f.autoPrice ? bestTicketPrice(team) : f.ticketPrice) + 0.5 * (last?.postseason ?? 0);
  // The difficulty loosens or tightens the purse for the user's club.
  const scale = team.id === league.userTeamId ? dials(league).budget : 1;
  const target = scale * OWNER_SPEND[team.owner.style] * (revenue - operations(team) - BONUS_ALLOWANCE);
  let b = 0.6 * team.budget + 0.4 * target;
  // Deep in the red, the owner tightens up.
  if (f.cash < -60) b *= 0.93;
  const gm = league.gm;
  if (gm && gm.teamId === team.id && !gm.fired) {
    if (gm.confidence >= 70) b *= 1.03;
    else if (gm.confidence <= 35) b *= 0.96;
  }
  return Math.round(clamp(b, BUDGET_FLOOR, BUDGET_CEILING));
}

/** Opening a new season: the business offices reprice tickets for the fan interest they now have. */
export function priceTickets(league: League): void {
  for (const team of league.teams) if (team.finance.autoPrice) team.finance.ticketPrice = bestTicketPrice(team);
}
