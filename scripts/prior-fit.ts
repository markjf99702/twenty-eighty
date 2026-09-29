/**
 * Fit the rates behind generated prior careers (src/players/prior.ts) to the
 * engine: per-PA and per-batter rates from simulated seasons, regressed on the
 * tool grades that drive them.
 *
 *   npx tsx scripts/prior-fit.ts
 */
import { generateLeague } from "../src/league/generate";
import { canStart, pitchingValue } from "../src/org/value";
import { Season } from "../src/season/season";

function lstsq(X: number[][], y: number[]): number[] {
  const k = X[0]!.length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a]![b] += X[i]![a]! * X[i]![b]!;
      A[a]![k] += X[i]![a]! * y[i]!;
    }
  }
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]) > Math.abs(A[piv]![c])) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r]![c] / A[c]![c];
      for (let j = c; j <= k; j++) A[r]![j] -= f * A[c]![j];
    }
  }
  return A.map((row, i) => row[k] / row[i]);
}
const show = (name: string, w: number[]) => console.log(name.padEnd(28), w.map((v) => v.toExponential(3)).join("  "));

const rows: Record<string, { X: number[][]; y: number[]; w: number[] }> = {};
const add = (key: string, x: number[], y: number, w = 1) => {
  const r = (rows[key] ??= { X: [], y: [], w: [] });
  // Weighted least squares by repeating the weight into the rows.
  const s = Math.sqrt(w);
  r.X.push(x.map((v) => v * s));
  r.y.push(y * s);
};
let paPerGame = 0, n = 0;
const starts: number[] = [];
for (const seed of ["prior-a", "prior-b"]) {
  const league = generateLeague({ seed });
  const season = new Season(league, { minors: false });
  season.simToEnd();
  for (const [id, b] of season.batting.lines) {
    const p = league.players[id]!;
    if (p.pitching || b.PA < 250) continue;
    const t = p.hitting;
    const x = [1, t.hit.present, t.power.present, t.eye.present, t.speed.present];
    add("HR/PA [1,hit,pow,eye,spd]", x, b.HR / b.PA, b.PA);
    add("H/AB", x, b.H / b.AB, b.AB);
    add("RBI/PA", x, b.RBI / b.PA, b.PA);
    add("SB/PA", x, b.SB / b.PA, b.PA);
    add("BB/PA", x, b.BB / b.PA, b.PA);
    add("2B/AB", x, b["2B"] / b.AB, b.AB);
    add("3B/AB", x, b["3B"] / b.AB, b.AB);
    paPerGame += b.PA / b.G; n++;
  }
  for (const [id, q] of season.pitching.lines) {
    const p = league.players[id]!;
    if (!p.pitching || q.outs < 120) continue;
    const pv = pitchingValue(p);
    const x = [1, pv, p.pitching.control.present];
    const sp = q.GS >= q.G / 2;
    const key = sp ? "SP" : "RP";
    add(`${key} SO/BF [1,pv,ctl]`, x, q.SO / q.BF, q.BF);
    add(`${key} BB/BF`, x, q.BB / q.BF, q.BF);
    add(`${key} ER/out`, x, q.ER / q.outs, q.outs);
    add(`${key} BF/out`, x, q.BF / q.outs, q.outs);
    if (sp) { add("SP W/GS", x, q.W / q.GS, q.GS); add("SP L/GS", x, q.L / q.GS, q.GS); add("SP outs/GS", [1, pv, p.pitching.stamina.present], q.outs / q.GS, q.GS); starts.push(q.GS); }
    else { add("RP W/G", x, q.W / q.G, q.G); add("RP L/G", x, q.L / q.G, q.G); add("RP outs/G", x, q.outs / q.G, q.G); }
    void canStart;
  }
}
for (const [k, r] of Object.entries(rows)) show(k, lstsq(r.X, r.y));
console.log("PA per game (regulars)", (paPerGame / n).toFixed(2), "avg GS", (starts.reduce((a, b) => a + b, 0) / starts.length).toFixed(1));
