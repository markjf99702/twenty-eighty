/**
 * The business side: every club's books, its owner, and the owner's view of
 * the user's general manager. All money is millions of dollars except ticket
 * prices, which are dollars. Everything here is plain JSON and saves with the
 * league.
 */

/** One season's books, accumulating as it happens. */
export interface Ledger {
  year: number;
  // Revenue
  gate: number;
  concessions: number;
  /** Local television and radio rights. */
  media: number;
  sponsorship: number;
  /** The league's national contracts, shared equally. */
  national: number;
  postseason: number;
  // Expenses
  payroll: number;
  deadMoney: number;
  /** Scouting and analytics departments. */
  staff: number;
  /** Everything else: the minor leagues, the ballpark, travel, the business office. */
  operations: number;
  /** Draft and international signing bonuses. */
  bonuses: number;
  // Turnstile
  homeGames: number;
  attendance: number;
}

/** A closed season's books with the context that went with them. */
export interface FinanceYear extends Ledger {
  wins: number;
  losses: number;
  /** The baseball-operations budget that season. */
  budget: number;
  /** Fan interest going into the season. */
  interest: number;
  /** Paid out to the owner from reserves above what the club keeps on hand. */
  distribution: number;
  /** Cash on hand once the books closed (after the distribution). */
  cash: number;
}

export interface TeamFinance {
  /** Seats in the ballpark. */
  capacity: number;
  /** Average ticket price, dollars. */
  ticketPrice: number;
  /** The business office sets ticket prices (the user can take over for their club). */
  autoPrice: boolean;
  /** How much the city cares about the club: 1 is typical, 0.6 is apathy, 1.4 is a craze. */
  interest: number;
  /** Cash reserves: every season's profit or loss adds up here (the owner takes anything above the reserve). */
  cash: number;
  ledger: Ledger;
  history: FinanceYear[];
}

export type OwnerStyle = "win-now" | "balanced" | "frugal" | "patient";

export interface Owner {
  name: string;
  style: OwnerStyle;
}

export type GoalKind = "wins" | "playoffs" | "profit" | "attendance" | "youth" | "budget";

export interface OwnerGoal {
  kind: GoalKind;
  /** Wins, a postseason berth (1), profit $M, fans, young regulars, or budget $M. */
  target: number;
  /** How much the owner cares about it. */
  weight: number;
}

export interface GoalResult extends OwnerGoal {
  actual: number;
  met: boolean;
  /** Confidence gained or lost on this goal. */
  delta: number;
}

export interface OwnerMessage {
  year: number;
  /** Season day (winter messages run past the regular season). */
  day: number;
  tone: "good" | "bad" | "neutral";
  text: string;
}

export interface GmReview {
  year: number;
  goals: GoalResult[];
  expectedWins: number | null;
  wins: number;
  /** Other things the owner weighed, with their effect on confidence. */
  notes: { text: string; delta: number }[];
  before: number;
  after: number;
}

/** The user's standing with the owner of the club they run. */
export interface GmState {
  teamId: number;
  /** 0-100. Below 20 the owner starts looking for a new GM. */
  confidence: number;
  /** Season the user took the job. */
  hired: number;
  /** Seasons completed in this job. */
  seasons: number;
  /** The preseason projection the owner holds the club to. */
  expectedWins: number | null;
  goals: OwnerGoal[];
  /** Season the goals are for. */
  goalYear: number;
  messages: OwnerMessage[];
  reviews: GmReview[];
  fired: boolean;
  /** Clubs offering the user a job after a firing. */
  offers: number[];
  /** Year the mid-season note went out. */
  midseason: number | null;
}
