/**
 * What "realistic" means. League-wide numbers are rounded 2024-25 MLB
 * averages; Statcast-style batted-ball buckets are by launch angle
 * (GB < 10°, LD 10-25°, FB 25-50°, PU > 50°). Spread targets are approximate
 * percentiles among qualified players and exist to check that the 20-80
 * scale produces a believable range of stars and strugglers, not just the
 * right average.
 *
 * Tolerances are deliberately loose where real seasons vary a lot or where
 * definitions differ from the public sources (e.g. chase rate).
 */

export interface Target {
  key: string;
  group: string;
  mlb: number;
  tol: number;
  /** Number of decimals when printing. */
  digits: number;
}

export const LEAGUE_TARGETS: Target[] = [
  { group: "Scoring", key: "R/G", mlb: 4.4, tol: 0.25, digits: 2 },
  { group: "Scoring", key: "AVG", mlb: 0.244, tol: 0.008, digits: 3 },
  { group: "Scoring", key: "OBP", mlb: 0.313, tol: 0.008, digits: 3 },
  { group: "Scoring", key: "SLG", mlb: 0.401, tol: 0.012, digits: 3 },
  { group: "Scoring", key: "BABIP", mlb: 0.291, tol: 0.008, digits: 3 },
  { group: "Outcomes", key: "K%", mlb: 22.4, tol: 1.0, digits: 1 },
  { group: "Outcomes", key: "BB%", mlb: 8.3, tol: 0.6, digits: 1 },
  { group: "Outcomes", key: "HBP%", mlb: 1.1, tol: 0.3, digits: 2 },
  { group: "Outcomes", key: "HR%", mlb: 3.0, tol: 0.25, digits: 2 },
  { group: "Outcomes", key: "2B%", mlb: 4.3, tol: 0.4, digits: 2 },
  { group: "Outcomes", key: "3B%", mlb: 0.35, tol: 0.12, digits: 2 },
  { group: "Discipline", key: "Pitches/PA", mlb: 3.9, tol: 0.08, digits: 2 },
  { group: "Discipline", key: "Swing%", mlb: 47.3, tol: 1.5, digits: 1 },
  { group: "Discipline", key: "Whiff%", mlb: 24.0, tol: 1.5, digits: 1 },
  { group: "Discipline", key: "CSW%", mlb: 28.2, tol: 1.2, digits: 1 },
  { group: "Discipline", key: "Chase%", mlb: 28.5, tol: 3.0, digits: 1 },
  { group: "Batted balls", key: "GB%", mlb: 43.0, tol: 2.0, digits: 1 },
  { group: "Batted balls", key: "LD%", mlb: 24.5, tol: 2.0, digits: 1 },
  { group: "Batted balls", key: "FB%", mlb: 24.5, tol: 2.5, digits: 1 },
  { group: "Batted balls", key: "PU%", mlb: 8.0, tol: 2.0, digits: 1 },
  { group: "Batted balls", key: "Avg EV", mlb: 88.7, tol: 0.8, digits: 1 },
  { group: "Batted balls", key: "HardHit%", mlb: 38.5, tol: 1.5, digits: 1 },
  { group: "Batted balls", key: "Barrel%", mlb: 7.8, tol: 0.8, digits: 1 },
  { group: "Running", key: "SB/G", mlb: 0.72, tol: 0.12, digits: 2 },
  { group: "Running", key: "SB%", mlb: 79, tol: 3, digits: 1 },
  { group: "Running", key: "GIDP/G", mlb: 0.72, tol: 0.1, digits: 2 },
  { group: "Running", key: "Score from 2nd on 1B%", mlb: 60, tol: 6, digits: 1 },
  { group: "Running", key: "1st to 3rd on 1B%", mlb: 28, tol: 5, digits: 1 },
  { group: "Running", key: "Score from 1st on 2B%", mlb: 42, tol: 6, digits: 1 },
  { group: "Defense", key: "E/G", mlb: 0.52, tol: 0.15, digits: 2 },
  { group: "Pitching usage", key: "SP IP/GS", mlb: 5.3, tol: 0.3, digits: 2 },
  { group: "Pitching usage", key: "SP pitches/GS", mlb: 87, tol: 4, digits: 1 },
  { group: "Pitching usage", key: "Extra-inning games%", mlb: 8.5, tol: 3, digits: 1 },
];

export interface SpreadTarget {
  key: string;
  group: "Hitters" | "Pitchers" | "Teams" | "Leaders";
  /** 10th / 50th / 90th percentile among qualifiers (or [low, typical, high] for leaders). */
  mlb: [number, number, number];
  digits: number;
}

export const SPREAD_TARGETS: SpreadTarget[] = [
  { group: "Hitters", key: "AVG", mlb: [0.228, 0.259, 0.293], digits: 3 },
  { group: "Hitters", key: "OBP", mlb: [0.295, 0.327, 0.37], digits: 3 },
  { group: "Hitters", key: "ISO", mlb: [0.11, 0.17, 0.25], digits: 3 },
  { group: "Hitters", key: "K%", mlb: [13.5, 21, 28.5], digits: 1 },
  { group: "Hitters", key: "BB%", mlb: [5.3, 8.4, 12.8], digits: 1 },
  { group: "Hitters", key: "HR", mlb: [10, 21, 34], digits: 0 },
  { group: "Hitters", key: "wRC+", mlb: [85, 109, 140], digits: 0 },
  { group: "Hitters", key: "WAR", mlb: [0.6, 2.4, 5.0], digits: 1 },
  { group: "Pitchers", key: "ERA", mlb: [2.85, 3.65, 4.45], digits: 2 },
  { group: "Pitchers", key: "K%", mlb: [18.5, 23.5, 29], digits: 1 },
  { group: "Pitchers", key: "BB%", mlb: [5, 7.2, 9.3], digits: 1 },
  { group: "Pitchers", key: "WAR", mlb: [1.5, 3.0, 5.0], digits: 1 },
  { group: "Teams", key: "Wins", mlb: [69, 81, 93], digits: 0 },
  { group: "Leaders", key: "HR leader", mlb: [42, 50, 58], digits: 0 },
  { group: "Leaders", key: "Batting title AVG", mlb: [0.315, 0.33, 0.345], digits: 3 },
  { group: "Leaders", key: "SO leader (pitcher)", mlb: [220, 245, 270], digits: 0 },
  { group: "Leaders", key: "Best ERA (qualified)", mlb: [2.1, 2.45, 2.8], digits: 2 },
  { group: "Leaders", key: "Top position-player WAR", mlb: [7.5, 9, 11], digits: 1 },
];
