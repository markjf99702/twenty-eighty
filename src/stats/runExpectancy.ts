/**
 * Run expectancy (RE24) and linear weights, derived from the simulated league
 * itself - the same way FanGraphs derives each real season's wOBA constants.
 *
 * A base-out state is outs * 8 + bases, where bases is a bitmask
 * (1 = runner on first, 2 = second, 4 = third). State 24 means the inning
 * is over.
 */

export const END_STATE = 24;

export type EventCode = "BB" | "IBB" | "HBP" | "1B" | "2B" | "3B" | "HR" | "K" | "OUT" | "ROE" | "SB" | "CS" | "WP";

export const EVENT_CODES: readonly EventCode[] = ["BB", "IBB", "HBP", "1B", "2B", "3B", "HR", "K", "OUT", "ROE", "SB", "CS", "WP"];

export const baseOutState = (outs: number, bases: number): number => (outs >= 3 ? END_STATE : outs * 8 + bases);

interface PendingEvent {
  start: number;
  end: number;
  runs: number;
  code: number;
}

export class RunTracker {
  /** Sum of runs scored from each state to the end of the inning, and visit counts. */
  private readonly reSum = new Float64Array(24);
  private readonly reCount = new Float64Array(24);
  private half: PendingEvent[] = [];
  private readonly starts: number[] = [];
  private readonly ends: number[] = [];
  private readonly runs: number[] = [];
  private readonly codes: number[] = [];

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
      this.starts.push(e.start);
      this.ends.push(e.end);
      this.runs.push(e.runs);
      this.codes.push(e.code);
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
    const sum = new Float64Array(EVENT_CODES.length);
    const n = new Float64Array(EVENT_CODES.length);
    for (let i = 0; i < this.codes.length; i++) {
      const c = this.codes[i]!;
      sum[c]! += re[this.ends[i]!]! - re[this.starts[i]!]! + this.runs[i]!;
      n[c]!++;
    }
    const out = {} as Record<EventCode, number>;
    EVENT_CODES.forEach((code, i) => {
      out[code] = n[i]! > 0 ? sum[i]! / n[i]! : 0;
    });
    return out;
  }

  /** Number of recorded events of each type. */
  counts(): Record<EventCode, number> {
    const out = {} as Record<EventCode, number>;
    for (const code of EVENT_CODES) out[code] = 0;
    for (const c of this.codes) out[EVENT_CODES[c]!]++;
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
    return this.codes.length;
  }
}
