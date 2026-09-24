/**
 * Calibration probe: outcome odds across an exit-velocity x launch-angle grid,
 * averaged over a realistic spray distribution, with league-average defense
 * in a neutral park. Prints "BA/SLG" per cell.
 */
import { normalCdf } from "../src/core/math";
import { generateLeague } from "../src/league/generate";
import { NEUTRAL_PARK } from "../src/league/parks";
import { battedBallOdds } from "../src/sim/battedBall";
import { averageDefense } from "../src/sim/manager";

const league = generateLeague({ seed: "probe" });
const def = averageDefense(league);
const EVS = [70, 75, 80, 85, 90, 95, 100, 105, 110];
const LAS = [-10, 0, 5, 8, 12, 16, 20, 24, 28, 32, 36, 40, 45, 55];
console.log("LA \\ EV".padEnd(8) + EVS.map((e) => String(e).padStart(11)).join(""));
for (const la of LAS) {
  const cells: string[] = [];
  for (const ev of EVS) {
    let w = 0, ba = 0, slg = 0;
    for (let spray = -44; spray <= 44; spray += 2) {
      const pw = normalCdf((spray + 1 + 1) / 22) - normalCdf((spray - 1 + 1) / 22);
      const r = battedBallOdds({ ev, la, spray }, NEUTRAL_PARK, def, 0);
      w += pw;
      ba += pw * (r.single + r.double + r.triple + r.hr);
      slg += pw * (r.single + 2 * r.double + 3 * r.triple + 4 * r.hr);
    }
    cells.push(`${(ba / w).toFixed(2)}/${(slg / w).toFixed(2)}`.padStart(11));
  }
  console.log(String(la).padEnd(8) + cells.join(""));
}
