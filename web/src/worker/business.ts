/**
 * View models for the business side: a club's books and ticket prices, and
 * the owner's goals, confidence and messages.
 */
import {
  bestTicketPrice,
  expectedGate,
  formFactor,
  operations,
  profitOf,
  projectedRevenue,
  referencePrice,
  revenueOf,
  expensesOf,
} from "../../../src/finance/finance";
import { goalLabel, goalProgress, mood, OWNER_PATIENCE, STYLE_LABEL } from "../../../src/finance/owner";
import type { FinanceYear, GoalResult, Ledger, Owner } from "../../../src/finance/types";
import type { League, Team } from "../../../src/league/types";
import { WINTER_DAYS } from "../../../src/offseason/offseason";
import { payroll } from "../../../src/org/contracts";
import { overallGrade } from "../../../src/org/value";
import { MINOR_LEVELS } from "../../../src/players/types";
import { staffCost } from "../../../src/scouting/scouting";
import { playoffSeeds } from "../../../src/season/postseason";
import type { Season } from "../../../src/season/season";
import type { FinanceView, FinanceYearView, GoalView, LedgerView, OwnerCard, OwnerView, ReviewView } from "../api/protocol";
import { dateLabel, teamRef } from "./views";

const m1 = (x: number) => Math.round(x * 10) / 10;

const PITCH: Record<Owner["style"], string> = {
  "win-now": "Spends freely and wants to win this year.",
  balanced: "Wants a winner and a full ballpark without losing money.",
  frugal: "Watches every dollar; wants a profit and a budget kept.",
  patient: "Will wait for a winner if you're building one from within.",
};

export const ownerCard = (o: Owner): OwnerCard => ({ name: o.name, style: o.style, styleLabel: STYLE_LABEL[o.style], pitch: PITCH[o.style] });

function ledgerView(l: Ledger): LedgerView {
  return {
    year: l.year,
    revenue: {
      gate: m1(l.gate),
      concessions: m1(l.concessions),
      media: m1(l.media),
      sponsorship: m1(l.sponsorship),
      national: m1(l.national),
      postseason: m1(l.postseason),
      total: m1(revenueOf(l)),
    },
    expenses: {
      payroll: m1(l.payroll),
      deadMoney: m1(l.deadMoney),
      staff: m1(l.staff),
      operations: m1(l.operations),
      bonuses: m1(l.bonuses),
      total: m1(expensesOf(l)),
    },
    profit: m1(profitOf(l)),
    homeGames: l.homeGames,
    attendance: l.attendance,
    perGame: l.homeGames ? Math.round(l.attendance / l.homeGames) : 0,
  };
}

const yearView = (y: FinanceYear): FinanceYearView => ({
  ...ledgerView(y),
  wins: y.wins,
  losses: y.losses,
  budget: y.budget,
  interest: y.interest,
  distribution: m1(y.distribution),
  cash: m1(y.cash),
});

export function financeView(season: Season, team: Team): FinanceView {
  const league = season.league;
  const f = team.finance;
  const inSeason = !league.offseason && season.day < season.totalDays;
  const rec = season.records[team.id]!;
  const form = inSeason ? formFactor(rec.w, rec.l) : 1;
  const ref = referencePrice(team);
  const curve: FinanceView["ticket"]["curve"] = [];
  const lo = Math.max(5, Math.round(ref * 0.5));
  const hi = Math.round(ref * 1.8);
  for (let p = lo; p <= hi; p++) {
    const g = expectedGate(team, p, form);
    curve.push({ price: p, perGame: Math.round(g.fans / 81), money: m1(g.money) });
  }
  const mine = team.id === league.userTeamId;
  return {
    team: teamRef(team),
    mine,
    owner: ownerCard(team.owner),
    market: team.market,
    capacity: f.capacity,
    interest: f.interest,
    cash: m1(f.cash),
    budget: team.budget,
    payroll: payroll(league, team),
    staff: staffCost(league, team),
    current: ledgerView(f.ledger),
    played: league.offseason ? 0 : Math.min(1, season.day / season.totalDays),
    projectedRevenue: m1(projectedRevenue(team)),
    operations: m1(operations(team)),
    ticket: {
      price: f.ticketPrice,
      auto: f.autoPrice,
      reference: ref,
      best: bestTicketPrice(team),
      gouge: Math.round(ref * 1.1),
      curve,
      editable: mine,
    },
    history: f.history.map(yearView).reverse(),
    league: league.teams
      .map((t) => {
        const last = t.finance.history.at(-1);
        const l = inSeason || !last ? t.finance.ledger : last;
        return {
          team: teamRef(t),
          market: t.market,
          perGame: l.homeGames ? Math.round(l.attendance / l.homeGames) : 0,
          revenue: m1(revenueOf(l)),
          payroll: payroll(league, t),
          budget: t.budget,
          interest: t.finance.interest,
          mine: t.id === league.userTeamId,
        };
      })
      .sort((a, b) => b.revenue - a.revenue),
  };
}

const fans = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}K`);

function actualText(kind: string, actual: number): string {
  switch (kind) {
    case "wins":
      return `${actual} wins`;
    case "playoffs":
      return actual ? "Made it" : "Missed";
    case "profit":
      return `${actual < 0 ? "-" : ""}$${Math.abs(actual).toFixed(1)}M`;
    case "attendance":
      return `${fans(actual)} fans`;
    case "youth":
      return `${actual} young regular${actual === 1 ? "" : "s"}`;
    case "budget":
      return `$${actual.toFixed(1)}M spent`;
    default:
      return String(actual);
  }
}

/** Goals for the season in progress (or just finished), with pace where there's a season to pace. */
function goalViews(league: League, season: Season): GoalView[] {
  const gm = league.gm!;
  const team = league.teams[gm.teamId]!;
  if (league.offseason) {
    // Last season's goals have been reviewed; next season's come in the spring.
    if (gm.goalYear <= league.year) return [];
    return gm.goals.map((g) => ({ kind: g.kind, label: goalLabel(g), weight: g.weight, status: "not started", progress: "Starts on Opening Day" }));
  }
  if (gm.goalYear !== league.year) return [];
  const done = season.done;
  const frac = Math.max(season.day / season.totalDays, 1e-6);
  const rec = season.records[team.id]!;
  const l = team.finance.ledger;
  return goalProgress(league, season).map(({ goal, actual, met }) => {
    const base = { kind: goal.kind, label: goalLabel(goal), weight: goal.weight };
    if (season.day === 0) return { ...base, status: "not started" as const, progress: "Starts on Opening Day" };
    let pace: number;
    let progress: string;
    switch (goal.kind) {
      case "wins": {
        pace = rec.w + rec.l ? Math.round((rec.w / (rec.w + rec.l)) * 162) : 0;
        progress = done ? `${rec.w} wins` : `${rec.w}-${rec.l}, on pace for ${pace}`;
        break;
      }
      case "playoffs": {
        const inPosition = done ? actual === 1 || playoffSeeds(season).flat().includes(team.id) : playoffSeeds(season).flat().includes(team.id);
        pace = inPosition ? 1 : 0;
        progress = season.postseason ? (actual ? "Made the postseason" : "Missed the postseason") : inPosition ? "In a playoff spot" : "Out of a playoff spot";
        if (!season.postseason && done) return { ...base, status: inPosition ? "met" : "missed", progress };
        break;
      }
      case "profit": {
        // Season-long money accrues evenly; winter bonuses are already on the books.
        pace = done ? actual : m1((actual + l.bonuses) / frac - l.bonuses);
        progress = done ? `${actualText("profit", actual)} profit` : `${actualText("profit", actual)} so far, on pace for ${actualText("profit", pace)}`;
        break;
      }
      case "attendance": {
        pace = l.homeGames ? Math.round((l.attendance / l.homeGames) * 81) : 0;
        progress = done ? `${fans(actual)} fans` : `${fans(actual)} so far, on pace for ${fans(pace)}`;
        break;
      }
      case "youth": {
        pace = actual;
        progress = `${actual} so far`;
        break;
      }
      case "budget": {
        const rate = payroll(league, team) + staffCost(league, team);
        pace = done ? actual : m1(actual + rate * (1 - Math.min(1, season.day / season.totalDays)));
        progress = done ? `$${actual.toFixed(1)}M spent` : `On pace to spend $${pace.toFixed(1)}M`;
        break;
      }
    }
    const status = done ? (met ? "met" : "missed") : goal.kind === "budget" ? (pace <= goal.target ? "on track" : "behind") : pace >= goal.target ? "on track" : "behind";
    return { ...base, status, progress };
  });
}

function reviewView(r: { year: number; wins: number; expectedWins: number | null; goals: GoalResult[]; notes: { text: string; delta: number }[]; before: number; after: number }): ReviewView {
  return {
    year: r.year,
    wins: r.wins,
    expectedWins: r.expectedWins,
    goals: r.goals.map((g) => ({ label: goalLabel(g), met: g.met, delta: g.delta, actual: actualText(g.kind, g.actual) })),
    notes: r.notes,
    before: r.before,
    after: r.after,
  };
}

export function ownerView(season: Season): OwnerView | null {
  const league = season.league;
  const gm = league.gm;
  if (!gm) return null;
  const team = league.teams[gm.teamId]!;
  const hist = league.history.at(-1);
  const patience = OWNER_PATIENCE[team.owner.style];
  // In the winter, before the spring goals, the projection on file is last season's.
  const stale = league.offseason !== null && gm.goalYear <= league.year;
  return {
    team: teamRef(team),
    owner: ownerCard(team.owner),
    patience: patience > 1.1 ? "Patient" : patience < 0.9 ? "Impatient" : "Fair",
    confidence: gm.confidence,
    mood: mood(gm.confidence),
    hired: gm.hired,
    seasons: gm.seasons,
    expectedWins: stale ? null : gm.expectedWins,
    goalYear: stale ? league.year + 1 : gm.goalYear,
    goals: goalViews(league, season),
    messages: [...gm.messages].reverse().map((m) => ({
      date:
        m.day >= WINTER_DAYS.spring
          ? `Spring ${m.year + 1}`
          : m.day >= season.totalDays
            ? `Winter ${m.year}-${String(m.year + 1).slice(2)}`
            : `${dateLabel(season, m.day)}, ${m.year}`,
      tone: m.tone,
      text: m.text,
    })),
    reviews: [...gm.reviews].reverse().map(reviewView),
    fired: gm.fired,
    offers: gm.offers.map((id) => {
      const t = league.teams[id]!;
      const row = hist?.standings.find((r) => r.teamId === id);
      const farm = MINOR_LEVELS.flatMap((lv) => t.rosters[lv])
        .map((pid) => overallGrade(league.players[pid]!, true))
        .sort((a, b) => b - a)
        .slice(0, 10);
      return {
        team: teamRef(t),
        record: row ? `${row.w}-${row.l}` : "",
        market: t.market,
        budget: t.budget,
        owner: ownerCard(t.owner),
        farm: Math.round((10 * farm.reduce((a, b) => a + b, 0)) / Math.max(1, farm.length)) / 10,
      };
    }),
  };
}
