/**
 * Maximum-weight assignment (Hungarian algorithm, O(n^3)). `value[i][j]` is
 * the value of giving row i column j; rows and columns must be equal in
 * number. Returns, for each row, the column it is assigned.
 */
export function maxAssignment(value: number[][]): number[] {
  const n = value.length;
  if (n === 0) return [];
  let max = -Infinity;
  for (const row of value) for (const v of row) if (v > max) max = v;
  // Convert to a cost-minimization problem with non-negative costs.
  const cost = value.map((row) => row.map((v) => max - v));

  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]! > 0) result[p[j]! - 1] = j - 1;
  return result;
}
