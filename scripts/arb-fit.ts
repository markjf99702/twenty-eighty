/**
 * Fit the arbitration case (src/org/contracts.ts arbCase) to WAR over three
 * simulated seasons: least squares of WAR on the counting stats, then refit
 * with RBI and pitcher wins held at the weights arbitration gives them.
 *
 *   npx tsx scripts/arb-fit.ts
 */
import { generateLeague } from "../src/league/generate";
import { beginOffseason } from "../src/offseason/offseason";
import { canStart } from "../src/org/value";
import { runPostseason } from "../src/season/postseason";
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
const r2 = (X: number[][], y: number[], w: number[]) => {
  const m = y.reduce((a, b) => a + b, 0) / y.length;
  let ss = 0, sr = 0;
  X.forEach((x, i) => { const p = x.reduce((s, v, j) => s + v * w[j]!, 0); ss += (y[i]! - m) ** 2; sr += (y[i]! - p) ** 2; });
  return 1 - sr / ss;
};

const H: number[][] = [], Hy: number[] = [], S: number[][] = [], Sy: number[] = [], R: number[][] = [], Ry: number[] = [];
for (const seed of ["arb-a", "arb-b", "arb-c"]) {
  const league = generateLeague({ seed });
  const season = new Season(league, {});
  season.simToEnd();
  runPostseason(season);
  const year = league.year;
  beginOffseason(league, season);
  for (const p of league.players) {
    const line = p.career.find((c) => c.year === year && c.level === "MLB");
    if (!line) continue;
    if (line.bat && line.bat.PA >= 150 && !p.pitching) {
      const b = line.bat;
      H.push([1, b.PA / 100, b.H / 10, b.HR / 10, b.RBI / 10, b.SB / 10]);
      Hy.push(b.WAR);
    }
    if (line.pit && line.pit.outs >= 90) {
      const q = line.pit;
      const ip = q.outs / 3;
      if (q.GS >= q.G / 2) { S.push([1, ip / 10, q.W, q.SO / 10, q.ER / 10]); Sy.push(q.WAR); }
      else { R.push([1, ip / 10, q.SV, q.SO / 10, q.ER / 10]); Ry.push(q.WAR); }
    }
  }
}
for (const [name, X, y] of [["hit [1,PA/100,H/10,HR/10,RBI/10,SB/10]", H, Hy], ["sp [1,IP/10,W,SO/10,ER/10]", S, Sy], ["rp [1,IP/10,SV,SO/10,ER/10]", R, Ry]] as const) {
  const w = lstsq(X as number[][], y as number[]);
  console.log(name, (X as number[][]).length, w.map((v) => v.toFixed(3)).join(" "), "r2", r2(X as number[][], y as number[], w).toFixed(2));
}
const rpNoSv = lstsq(R.map((x) => [x[0]!, x[1]!, x[3]!, x[4]!]), Ry);
console.log("rp no SV", rpNoSv.map((v) => v.toFixed(3)).join(" "));
const sv = R.map((x) => x[2]!).filter((v) => v > 0).sort((a, b) => b - a);
console.log("top saves", sv.slice(0, 12).join(","), "count with 20+", sv.filter((v) => v >= 20).length);
const w = S.map((x) => x[2]!).sort((a, b) => b - a);
console.log("top wins", w.slice(0, 10).join(","));
// Constrained: RBI 0.25 per 10, W 0.10 each; refit the rest.
const hc = lstsq(H.map((x) => [x[0]!, x[1]!, x[2]!, x[3]!, x[5]!]), Hy.map((y, i) => y - 0.25 * H[i]![4]!));
console.log("hit fixed RBI .25/10: [1,PA,H,HR,SB]", hc.map((v) => v.toFixed(3)).join(" "));
const sc = lstsq(S.map((x) => [x[0]!, x[1]!, x[3]!, x[4]!]), Sy.map((y, i) => y - 0.1 * S[i]![2]!));
console.log("sp fixed W .1: [1,IP,SO,ER]", sc.map((v) => v.toFixed(3)).join(" "));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log("mean WAR hit", mean(Hy).toFixed(2), "sp", mean(Sy).toFixed(2), "rp", mean(Ry).toFixed(2));
const closers = R.filter((x) => x[2]! >= 20);
console.log("closers mean WAR", mean(R.map((x, i) => (x[2]! >= 20 ? Ry[i]! : NaN)).filter(Number.isFinite)).toFixed(2), "n", closers.length, "mean SV", mean(closers.map((x) => x[2]!)).toFixed(1));
