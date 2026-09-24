/**
 * Tracks pitcher workload across the season (by player, so it follows him up
 * and down the organization): who's next in each rotation and which relievers
 * can go today.
 */

interface Outing {
  day: number;
  pitches: number;
}

export interface StaffState {
  outings: [number, Outing[]][];
  rotationIndex: [string, number][];
}

const STARTER_REST_DAYS = 5; // pitch on day d, available again on d + 5 (four days of rest)
const HISTORY_DAYS = 4;

export class StaffTracker {
  private outings = new Map<number, Outing[]>();
  private rotationIndex = new Map<string, number>();

  private recent(id: number, day: number): Outing[] {
    return (this.outings.get(id) ?? []).filter((o) => day - o.day <= HISTORY_DAYS && o.day < day);
  }

  private lastOuting(id: number): Outing | undefined {
    const list = this.outings.get(id);
    return list && list.length > 0 ? list[list.length - 1] : undefined;
  }

  /**
   * Next rested starter in a rotation (falls back to the most-rested arm).
   * `key` identifies the rotation, e.g. "3:MLB".
   */
  nextStarter(key: string, rotation: number[], day: number, isAvailable: (id: number) => boolean = () => true): number {
    const rot = rotation.filter(isAvailable);
    if (rot.length === 0) return rotation[0]!;
    const start = (this.rotationIndex.get(key) ?? 0) % rot.length;
    for (let k = 0; k < rot.length; k++) {
      const i = (start + k) % rot.length;
      const id = rot[i]!;
      const last = this.lastOuting(id);
      if (!last || day - last.day >= STARTER_REST_DAYS) {
        this.rotationIndex.set(key, (i + 1) % rot.length);
        return id;
      }
    }
    const rested = [...rot].sort((a, b) => (this.lastOuting(a)?.day ?? -99) - (this.lastOuting(b)?.day ?? -99));
    const id = rested[0]!;
    this.rotationIndex.set(key, (rot.indexOf(id) + 1) % rot.length);
    return id;
  }

  /** Days since a pitcher last appeared (Infinity if never). */
  daysSince(id: number, day: number): number {
    const last = this.lastOuting(id);
    return last ? day - last.day : Infinity;
  }

  isRested(id: number, day: number): boolean {
    const recent = this.recent(id, day);
    const yesterday = recent.find((o) => o.day === day - 1);
    const twoAgo = recent.find((o) => o.day === day - 2);
    if (yesterday && twoAgo) return false; // no three days in a row
    if (yesterday && yesterday.pitches >= 30) return false;
    // Starters (and long men) who threw a lot recently need their days.
    const last = this.lastOuting(id);
    if (last && last.pitches >= 50 && day - last.day < 4) return false;
    const lastThree = recent.filter((o) => day - o.day <= 3).reduce((s, o) => s + o.pitches, 0);
    return lastThree < 60;
  }

  /** Relievers who should not pitch today. */
  unavailable(bullpen: number[], day: number): Set<number> {
    return new Set(bullpen.filter((id) => !this.isRested(id, day)));
  }

  /** Lingering fatigue (z) from recent work. */
  fatigue(id: number, day: number): number {
    let f = 0;
    for (const o of this.recent(id, day)) {
      const ago = day - o.day;
      f += (o.pitches / 100) * (ago === 1 ? 1 : ago === 2 ? 0.5 : 0.2);
    }
    return Math.min(0.6, f);
  }

  fatigueMap(bullpen: number[], day: number): Map<number, number> {
    const m = new Map<number, number>();
    for (const id of bullpen) {
      const f = this.fatigue(id, day);
      if (f > 0) m.set(id, f);
    }
    return m;
  }

  record(pitchCounts: ReadonlyMap<number, number>, day: number): void {
    for (const [id, pitches] of pitchCounts) {
      let list = this.outings.get(id);
      if (!list) {
        list = [];
        this.outings.set(id, list);
      }
      list.push({ day, pitches });
      if (list.length > 8) list.shift();
    }
  }

  toJSON(): StaffState {
    return { outings: [...this.outings], rotationIndex: [...this.rotationIndex] };
  }

  static fromJSON(s: StaffState): StaffTracker {
    const t = new StaffTracker();
    t.outings = new Map(s.outings.map(([id, list]) => [id, list.map((o) => ({ ...o }))]));
    t.rotationIndex = new Map(s.rotationIndex);
    return t;
  }
}
