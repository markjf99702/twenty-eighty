/**
 * Run expectancy (RE24) and linear weights, derived from the simulated league
 * itself - the same way FanGraphs derives each real season's wOBA constants.
 *
 * A base-out state is outs * 8 + bases, where bases is a bitmask
 * (1 = runner on first, 2 = second, 4 = third). State 24 means the inning
 * is over.
 *
 * Rather than keeping every event, the tracker aggregates transitions
 * (event type x start state x end state), which is all linear weights need
 * and keeps the state small enough to save.
 */

export const END_STATE = 24;
const STATES = 25;

export type EventCode = "BB" | "IBB" | "HBP" | "1B" | "2B" | "3B" | "HR" | "K" | "OUT" | "ROE" | "SB" | "CS" | "WP";

export const EVENT_CODES: readonly EventCode[] = ["BB", "IBB", "HBP", "1B", "2B", "3B", "HR", "K", "OUT", "ROE", "SB", "CS", "WP"];

export const baseOutState = (outs: number, bases: number): number => (outs >= 3 ? END_STATE : outs * 8 + bases);

interface PendingEvent {
  start: number;
  end: number;
  runs: number;
  code: number;
}

export interface RunTrackerState {
  reSum: number[];
  reCount: number[];
  transitions: number[][];
  runs: number[];
  events: number[];
}

export class RunTracker {
  /** Runs scored from each state to the end of the inning, and visit counts. */
  private reSum: number[] = new Array(24).fill(0);
  private reCount: number[] = new Array(24).fill(0);
  /** [event code][start * 25 + end] -> count */
  private transitions: number[][] = EVENT_CODES.map(() => new Array(24 * STATES).fill(0));
  private runs: number[] = EVENT_CODES.map(() => 0);
  private events: number[] = EVENT_CODES.map(() => 0);
  private half: PendingEvent[] = [];

  record(start: number, end: number, runs: number, code: EventCode): void {
    this.half.push({ start, end, runs, code: EVENT_CODES.indexOf(code) });
  }

  /** Close a half-inning. Only innings that reached three outs inform RE24 (walk-offs are truncated). */
  endHalf(complete: boolean): void {
    if (complete) {
      let after = 0;
      for (let i = this.half.length - 1; i >= 0; i--) {
        const e = this.half[i]!;
        after += e.runs;
        this.reSum[e.start]! += after;
        this.reCount[e.start]!++;
      }
    }
    for (const e of this.half) {
      this.transitions[e.code]![e.start * STATES + e.end]!++;
      this.runs[e.code]! += e.runs;
      this.events[e.code]!++;
    }
    this.half = [];
  }

  matrix(): number[] {
    const re: number[] = [];
    for (let s = 0; s < 24; s++) re.push(this.reCount[s]! > 0 ? this.reSum[s]! / this.reCount[s]! : 0);
    re.push(0);
    return re;
  }

  /** Average run value of each event type: RE(end) - RE(start) + runs on the play. */
  linearWeights(): Record<EventCode, number> {
    const re = this.matrix();
    const out = {} as Record<EventCode, number>;
    EVENT_CODES.forEach((code, c) => {
      const n = this.events[c]!;
      if (n === 0) {
        out[code] = 0;
        return;
      }
      let sum = this.runs[c]!;
      const t = this.transitions[c]!;
      for (let i = 0; i < t.length; i++) {
        const k = t[i]!;
        if (k > 0) sum += k * (re[i % STATES]! - re[Math.floor(i / STATES)]!);
      }
      out[code] = sum / n;
    });
    return out;
  }

  /** Number of recorded events of each type. */
  counts(): Record<EventCode, number> {
    const out = {} as Record<EventCode, number>;
    EVENT_CODES.forEach((code, c) => (out[code] = this.events[c]!));
    return out;
  }

  /** Average value of a batting out (strikeouts and batted-ball outs together). */
  outValue(): number {
    const lw = this.linearWeights();
    const n = this.counts();
    const total = n.K + n.OUT;
    return total > 0 ? (n.K * lw.K + n.OUT * lw.OUT) / total : 0;
  }

  eventCount(): number {
    return this.events.reduce((s, x) => s + x, 0);
  }

  toJSON(): RunTrackerState {
    return { reSum: this.reSum, reCount: this.reCount, transitions: this.transitions, runs: this.runs, events: this.events };
  }

  static fromJSON(s: RunTrackerState): RunTracker {
    const t = new RunTracker();
    t.reSum = [...s.reSum];
    t.reCount = [...s.reCount];
    t.transitions = s.transitions.map((x) => [...x]);
    t.runs = [...s.runs];
    t.events = [...s.events];
    return t;
  }
}
