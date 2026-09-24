import type { Park } from "./types";

/** A symmetrical, sea-level-ish reference park used for expected stats. */
export const NEUTRAL_PARK: Park = {
  name: "Neutral Park",
  dims: [330, 375, 400, 375, 330],
  walls: [8, 8, 8, 8, 8],
  altitude: 500,
};
