/** Each club's scouting and analytics departments, and the user's scouting looks. */
export interface ScoutingState {
  /** Department level by team id, 1 (bare bones) to 5 (best in baseball). */
  scouting: number[];
  analytics: number[];
  /** Extra looks the user's scouts have taken, by player id (each one narrows the report). */
  looks: Record<number, number>;
  /** Looks left in the current window, and which window that is. */
  looksLeft: number;
  looksWindow: string;
}
