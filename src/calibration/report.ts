import { percentile } from "../core/math";
import type { Season } from "../season/season";
import { emptyBatting, emptyPitching, sumLines } from "../stats/lines";
import { LEAGUE_TARGETS, SPREAD_TARGETS, type SpreadTarget, type Target } from "./targets";

/**
 * Measure a simulated season (or several) against MLB targets.
 */

export type Metrics = Record<string, number>;

const pct = (n: number, d: number) => (d > 0 ? (100 * n) / d : 0);

export function leagueMetrics(seasons: Season[]): Metrics {
  const B = sumLines(seasons.map((s) => s.batting.total()), emptyBatting);
  const P = sumLines(seasons.map((s) => s.pitching.total()), emptyPitching);
  let runs = 0;
  let teamGames = 0;
  let games = 0;
  let extra = 0;
  let errors = 0;
  let spOuts = 0;
  let spPitches = 0;
  let spStarts = 0;
  const run = { s2: 0, s2n: 0, f3: 0, f3n: 0, f1: 0, f1n: 0 };

  for (const s of seasons) {
    for (const r of s.records) runs += r.rs;
    teamGames += 2 * s.games.length;
    games += s.games.length;
    for (const g of s.games) {
      if (g.innings > 9) extra++;
      errors += g.errors[0] + g.errors[1];
    }
    const c = s.env.running!;
    run.s2 += c.scoredFromSecond;
    run.s2n += c.secondOnSingle;
    run.f3 += c.firstToThird;
    run.f3n += c.firstOnSingle;
    run.f1 += c.scoredFromFirst;
    run.f1n += c.firstOnDouble;
    // Starter workload from pitchers who only started (no relief outings mixed in).
    for (const line of s.pitching.lines.values()) {
      if (line.GS > 0 && line.GS === line.G) {
        spOuts += line.outs;
        spPitches += line.pitches;
        spStarts += line.GS;
      }
    }
  }

  const pa = B.PA;
  const swings = B.zoneSwings + B.outSwings;
  return {
    "R/G": runs / teamGames,
    AVG: B.H / B.AB,
    OBP: (B.H + B.BB + B.HBP) / (B.AB + B.BB + B.HBP + B.SF),
    SLG: (B["1B"] + 2 * B["2B"] + 3 * B["3B"] + 4 * B.HR) / B.AB,
    BABIP: (B.H - B.HR) / (B.AB - B.SO - B.HR + B.SF),
    "K%": pct(B.SO, pa),
    "BB%": pct(B.BB, pa),
    "HBP%": pct(B.HBP, pa),
    "HR%": pct(B.HR, pa),
    "2B%": pct(B["2B"], pa),
    "3B%": pct(B["3B"], pa),
    "Pitches/PA": B.pitches / pa,
    "Swing%": pct(swings, B.pitches),
    "Whiff%": pct(P.whiffs, P.swings),
    "CSW%": pct(P.whiffs + P.calledStrikes, P.pitches),
    "Chase%": pct(B.outSwings, B.outPitches),
    "GB%": pct(B.GB, B.BBE),
    "LD%": pct(B.LD, B.BBE),
    "FB%": pct(B.FB, B.BBE),
    "PU%": pct(B.PU, B.BBE),
    "Avg EV": B.evSum / B.BBE,
    "HardHit%": pct(B.hardHit, B.BBE),
    "Barrel%": pct(B.barrels, B.BBE),
    "SB/G": B.SB / teamGames,
    "SB%": pct(B.SB, B.SB + B.CS),
    "GIDP/G": B.GIDP / teamGames,
    "Score from 2nd on 1B%": pct(run.s2, run.s2n),
    "1st to 3rd on 1B%": pct(run.f3, run.f3n),
    "Score from 1st on 2B%": pct(run.f1, run.f1n),
    "E/G": errors / teamGames,
    "SP IP/GS": spOuts / 3 / Math.max(1, spStarts),
    "SP pitches/GS": spPitches / Math.max(1, spStarts),
    "Extra-inning games%": pct(extra, games),
  };
}

export function spreadMetrics(season: Season): Record<string, [number, number, number]> {
  const stats = season.stats();
  const games = 162;
  const hitters = stats.hitters.filter((h) => h.PA >= 3.1 * games * (season.games.length / 2430));
  const pitchers = stats.pitchers.filter((p) => p.IP >= 1.0 * games * (season.games.length / 2430));
  const q = (xs: number[]): [number, number, number] => [percentile(xs, 0.1), percentile(xs, 0.5), percentile(xs, 0.9)];
  const wins = season.records.map((r) => r.w);
  const max = (xs: number[]) => Math.max(...xs);
  const min = (xs: number[]) => Math.min(...xs);
  const lead = (x: number): [number, number, number] => [x, x, x];
  return {
    "Hitters AVG": q(hitters.map((h) => h.AVG)),
    "Hitters OBP": q(hitters.map((h) => h.OBP)),
    "Hitters ISO": q(hitters.map((h) => h.ISO)),
    "Hitters K%": q(hitters.map((h) => 100 * h.Kpct)),
    "Hitters BB%": q(hitters.map((h) => 100 * h.BBpct)),
    "Hitters HR": q(hitters.map((h) => h.line.HR)),
    "Hitters wRC+": q(hitters.map((h) => h.wRCplus)),
    "Hitters WAR": q(hitters.map((h) => h.WAR)),
    "Pitchers ERA": q(pitchers.map((p) => p.ERA)),
    "Pitchers K%": q(pitchers.map((p) => 100 * p.Kpct)),
    "Pitchers BB%": q(pitchers.map((p) => 100 * p.BBpct)),
    "Pitchers WAR": q(pitchers.map((p) => p.WAR)),
    "Teams Wins": q(wins),
    "Leaders HR leader": lead(max(stats.hitters.map((h) => h.line.HR))),
    "Leaders Batting title AVG": lead(max(hitters.map((h) => h.AVG))),
    "Leaders SO leader (pitcher)": lead(max(stats.pitchers.map((p) => p.line.SO))),
    "Leaders Best ERA (qualified)": lead(min(pitchers.map((p) => p.ERA))),
    "Leaders Top position-player WAR": lead(max(stats.hitters.map((h) => h.WAR))),
  };
}

function status(delta: number, tol: number): string {
  const a = Math.abs(delta);
  return a <= tol ? "ok" : a <= 2 * tol ? "~" : "OFF";
}

export function formatLeagueReport(m: Metrics, targets: Target[] = LEAGUE_TARGETS): { text: string; misses: number } {
  const lines: string[] = [];
  let group = "";
  let misses = 0;
  lines.push(`${"metric".padEnd(26)}${"sim".padStart(9)}${"MLB".padStart(9)}${"delta".padStart(9)}  status`);
  for (const t of targets) {
    if (t.group !== group) {
      group = t.group;
      lines.push(`-- ${group}`);
    }
    const v = m[t.key] ?? NaN;
    const d = v - t.mlb;
    const st = status(d, t.tol);
    if (st === "OFF") misses++;
    const delta = `${d >= 0 ? "+" : ""}${d.toFixed(t.digits)}`;
    lines.push(
      `${t.key.padEnd(26)}${v.toFixed(t.digits).padStart(9)}${t.mlb.toFixed(t.digits).padStart(9)}${delta.padStart(9)}  ${st}`,
    );
  }
  return { text: lines.join("\n"), misses };
}

export function formatSpreadReport(s: Record<string, [number, number, number]>, targets: SpreadTarget[] = SPREAD_TARGETS): string {
  const lines: string[] = [];
  let group = "";
  lines.push(`${"metric".padEnd(30)}${"sim p10 / p50 / p90".padStart(26)}   ${"MLB (approx.)".padStart(24)}`);
  for (const t of targets) {
    if (t.group !== group) {
      group = t.group;
      lines.push(`-- ${group}${group === "Leaders" ? " (sim value vs. typical MLB range)" : ""}`);
    }
    const v = s[`${t.group} ${t.key}`];
    if (!v) continue;
    const f = (x: number) => x.toFixed(t.digits);
    const sim = t.group === "Leaders" ? f(v[0]) : `${f(v[0])} / ${f(v[1])} / ${f(v[2])}`;
    const mlb = t.group === "Leaders" ? `${f(t.mlb[0])}-${f(t.mlb[2])}` : `${f(t.mlb[0])} / ${f(t.mlb[1])} / ${f(t.mlb[2])}`;
    lines.push(`${t.key.padEnd(30)}${sim.padStart(26)}   ${mlb.padStart(24)}`);
  }
  return lines.join("\n");
}
