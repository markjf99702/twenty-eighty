import type { Team } from "../league/types";

/**
 * Tracks pitcher workload across the season: who's next in the rotation and
 * which relievers can go today.
 */

interface Outing {
  day: number;
  pitches: number;
}

const STARTER_REST_DAYS = 5; // pitch on day d, available again on d + 5 (four days of rest)
const HISTORY_DAYS = 4;

export class StaffTracker {
  private readonly outings = new Map<number, Outing[]>();
  private readonly rotationIndex = new Map<number, number>();

  private recent(id: number, day: number): Outing[] {
    return (this.outings.get(id) ?? []).filter((o) => day - o.day <= HISTORY_DAYS && o.day < day);
  }

  private lastOuting(id: number): Outing | undefined {
    const list = this.outings.get(id);
    return list && list.length > 0 ? list[list.length - 1] : undefined;
  }

  /** Next rested starter in the rotation (falls back to the most-rested arm). */
  nextStarter(team: Team, day: number): number {
    const rot = team.depth.rotation;
    const start = this.rotationIndex.get(team.id) ?? 0;
    for (let k = 0; k < rot.length; k++) {
      const i = (start + k) % rot.length;
      const id = rot[i]!;
      const last = this.lastOuting(id);
      if (!last || day - last.day >= STARTER_REST_DAYS) {
        this.rotationIndex.set(team.id, (i + 1) % rot.length);
        return id;
      }
    }
    const rested = [...rot].sort((a, b) => (this.lastOuting(a)?.day ?? -99) - (this.lastOuting(b)?.day ?? -99));
    const id = rested[0]!;
    this.rotationIndex.set(team.id, (rot.indexOf(id) + 1) % rot.length);
    return id;
  }

  /** Relievers who should not pitch today. */
  unavailableRelievers(team: Team, day: number): Set<number> {
    const avail = new Set(this.availableRelievers(team, day));
    return new Set(team.depth.bullpen.filter((id) => !avail.has(id)));
  }

  /** Relievers who can pitch today, in the team's bullpen order (best first). */
  availableRelievers(team: Team, day: number): number[] {
    return team.depth.bullpen.filter((id) => {
      const recent = this.recent(id, day);
      const yesterday = recent.find((o) => o.day === day - 1);
      const twoAgo = recent.find((o) => o.day === day - 2);
      if (yesterday && twoAgo) return false; // no three days in a row
      if (yesterday && yesterday.pitches >= 30) return false;
      const lastThree = recent.filter((o) => day - o.day <= 3).reduce((s, o) => s + o.pitches, 0);
      return lastThree < 60;
    });
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

  fatigueMap(team: Team, day: number): Map<number, number> {
    const m = new Map<number, number>();
    for (const id of team.depth.bullpen) {
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
}
