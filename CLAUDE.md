# twenty-eighty: notes for working in this repo

Baseball GM simulation (TypeScript, Node 20+, ESM, no runtime dependencies). See
README.md for the design.

## Commands

- `npm run check`: typecheck + tests. Run before every commit.
- `npm run calibrate [-- --seasons 3]`: full-season league metrics vs. MLB targets,
  plus player/team spread. Aim for "0 metric(s) outside 2x tolerance".
- `npm run grade-chart [-- --pa 30000]`: what each 20-80 grade produces, per tool.
- `npm run probe`: batted-ball BA/SLG grid by exit velocity x launch angle.
- `npm run sim:season`, `npm run sim:game -- AWAY HOME`, `npm run scout -- ABBR`.

## Conventions

- All randomness goes through `Rng` (`src/core/rng.ts`). Never use `Math.random`.
  Derive child streams with `rng.fork(label)` so adding a feature doesn't reshuffle
  unrelated outcomes.
- The engine works in z-scores (`(grade - 50) / 10`). Grades exist for players and the
  UI; convert once in `src/sim/profiles.ts`.
- Engine tunables live in `src/sim/constants.ts` (`ENGINE`) and in `FIELD` at the top
  of `src/sim/battedBall.ts`. Don't scatter magic numbers through the game loop.
- Stat lines (`src/stats/lines.ts`) are flat number records so they sum generically.
  Add a counting stat by adding a key to the interface and the key list.
- Advanced-stat constants come from the simulated season itself
  (`Season.context()`), never hard-coded MLB values.

## Calibration workflow

Any change to the engine or the generator can move league-wide numbers. After such a
change:

1. `npm run calibrate`: league averages and spread.
2. `npm run grade-chart`: per-grade effects (Hit is roughly ±.020 AVG per 10 points,
   Power runs 60 ≈ 26 HR / 70 ≈ 34 per 600 PA, and so on).
3. If you retune effect sizes, update `OFFENSE_WEIGHTS` / `PITCHING_WEIGHTS` in
   `src/players/generate.ts` to match the chart. The generator uses them to hit its
   talent targets.

Targets and tolerances are in `src/calibration/targets.ts`.
