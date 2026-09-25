# twenty-eighty: notes for working in this repo

Baseball GM simulation (TypeScript, Node 20+, ESM). The engine in src/ has no runtime
dependencies; the browser UI in web/ uses Preact and Vite. See README.md for the design.

## Commands

- `npm run check`: typecheck (engine and web) + tests. Run before every commit.
- `npm run dev` / `npm run build:web`: the browser UI (Vite, root `web/`).
- `npm run calibrate [-- --seasons 3]`: full-season league metrics vs. MLB targets,
  plus player/team spread. Aim for "0 metric(s) outside 2x tolerance".
- `npm run grade-chart [-- --pa 30000]`: what each 20-80 grade produces, per tool.
- `npm run sim:years [-- --years 10 --verbose]`: many seasons with offseasons; watch the
  run environment, star counts, payrolls and the winter re-centering shifts for drift.
- `npm run pipeline`: one year's draft and international intake over its career vs. a
  generated league's age profile (the development tuning target).
- `npm run probe`: batted-ball BA/SLG grid by exit velocity x launch angle.
- `npm run sim:season [-- --team ABBR] [-- --no-minors]`, `npm run sim:game -- AWAY HOME`,
  `npm run scout -- ABBR`.

## Architecture in one breath

`League` (plain JSON: teams, players, transactions) is mutated by `Season`, which each
day heals injuries, runs `manageOrganization` (src/org/ai.ts) for every club, then plays
every level's games through `simulateGame` (src/sim/game.ts). Roster changes go through
the rule-checked functions in src/org/roster.ts, never by editing arrays directly, so
the transaction log and 40-man/IL bookkeeping stay consistent. `new Season(league,
{ minors: false })` skips affiliate games (calibration and most tests use this).

After the postseason, `beginOffseason` (src/offseason/offseason.ts) records careers,
awards and history, develops and ages everyone (src/players/development.ts), retires
some, re-centers the grades and rolls contracts; `advanceOffseason` then steps through
tenders, the draft, free agency (`winterWeek`), international signings and spring
training, and returns the next `Season`. `runOffseason` does the whole winter with the AI
deciding everything. The winter state lives in `league.offseason`, so it saves and
resumes like everything else; each step draws randomness from `winterRng(league, label)`.

Grades on a `Player` are the truth, and the simulation only ever uses the truth.
Decisions use beliefs (src/scouting/): `perceive(league, viewer, p)` is a player as a
club's scouts see him, `belief`/`believedWar` blend in the analytics read, and
`valueShift`/`warShift` are fast versions for AI loops over hundreds of players. The
AI's draft, international, free-agent and trade decisions take a club's beliefs; its
day-to-day roster moves and depth charts still use true grades (a club knows its own
players well). The UI always shows the user's view. Errors are deterministic hashes, so
nothing about beliefs is saved except department levels and the user's looks.

Money (src/finance/): each `Team` has an `owner` and `finance` (capacity, ticket price,
fan interest, cash, the open `ledger` and closed years). `Season.simDay` books each MLB
home crowd (`crowdFor`, computed before the game from the record going in) and a day's
share of annual items (`accrueDay`); `runPostseason` books playoff gates; the draft and
international signings book bonuses. `beginOffseason` runs `reviewSeason` (the owner's
verdict on the user, from `league.gm`) and then `closeBooks` (cash, the owner's
distribution, interest, next budgets) before contracts roll. `league.gm` is null unless
the user runs a club; `hireGm` creates it, spring goals come from `setGoals`, and a
firing leaves `gm.fired` with `offers` until `acceptJob`.

Trades during the season (src/org/offers.ts): `Season.simDay` ends with `tradeDay`,
which runs the AI market between contenders and sellers by the standings (weekly from
late May, more near `TRADE_DEADLINE_DAY`) and now and then proposes a deal to the user
(`proposeToUser`; winter weeks call `winterOffer`). Offers live in `league.tradeOffers`
on one clock (`offerClock`: season days, then 1000 plus the winter day) and are only
made if the club would accept them as a proposal. After a trade the AI trims active
rosters the next morning (`trimActiveRoster`). Sim stop triggers are checked in the
worker after each day.

Settings (src/league/settings.ts): `league.settings` holds the difficulty, stat view
and advice switch. Difficulty is a table of dials read through `dials(league)` where
they apply (scouting error in `uncertainty`, the AI's trade margin, the user's budget,
owner patience, grace seasons, win goals, starting confidence), so a new dial is a field
there plus one read at its point of use. The stat view is UI-only (`useBasics()`).

Staff advice (src/advice/advice.ts): `seasonAdvice` runs at the end of `simDay` and
`winterAdvice` when a winter phase opens (`advanceOffseason`, `beginOffseason`). Notes
go into `league.advice` through `add`, which dedupes by `key` (so re-running a day adds
nothing) and keeps the latest 60. Advice reads the user's beliefs, never the truth.
Urgent notes can stop the sim (the worker's `staff` stop).

The browser UI never touches the engine from the page: `web/src/worker/sim.worker.ts`
owns the League and Season and answers typed requests (`web/src/api/protocol.ts`) with
plain view models built in `web/src/worker/views.ts`. Pages call it through `useApi`
(`web/src/api/client.ts`), which refetches whenever `bump()` signals a change. Adding a
screen means: a request/response pair in protocol.ts, a handler in the worker, a page.

## Conventions

- All randomness goes through `Rng` (`src/core/rng.ts`). Never use `Math.random`.
  Derive child streams with `rng.fork(label)` so adding a feature doesn't reshuffle
  unrelated outcomes.
- The engine works in z-scores (`(grade - 50) / 10`). Grades exist for players and the
  UI; convert once in `src/sim/profiles.ts`.
- Engine tunables live in `src/sim/constants.ts` (`ENGINE`) and in `FIELD` at the top
  of `src/sim/battedBall.ts`. Don't scatter magic numbers through the game loop.
- Stat lines (`src/stats/lines.ts`) are flat number records. Add a counting stat to the
  interface, its literal factory (`emptyBatting` etc.) and its explicit adder
  (`addBatting` etc.); saves pick the key up automatically.
- Advanced-stat constants come from the simulated season itself
  (`Season.context()`), never hard-coded MLB values.
- Hot paths matter (a full organizational season is ~130k games of pitches): stat lines
  use literal factories and explicit adders in src/stats/lines.ts; profile with
  `node --cpu-prof` on an esbuild bundle before optimizing.

- Money is in millions of dollars. Anything that puts a player on the 40-man goes
  through `ensureMajorContract`; releases go through `releasePlayer` (dead money, free
  agency or retirement). Bump `SAVE_VERSION` and add a step to src/save/migrate.ts
  when the saved shape changes. Anything an AI decision reads must round-trip through a
  save exactly (the winter-resume test catches it); caches must key on state that changes
  when the answer would (the day stands still all winter; `levelShift` keys on the
  transaction count too).
- Night-to-night noise that must not disturb the season's `Rng` stream (crowds,
  forecasters' misses, scouting errors) comes from `hashNormal`/`hashUniform` in
  src/core/hash.ts, keyed on the seed and the things it depends on.

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

Changes to development, aging, contracts or the draft can make the universe drift over
years rather than seasons: check `npm run sim:years -- --years 10` (and a second seed)
for trends in R/G, HR%, the HR and WAR leaders, 70+ players, MLB age, young players
with big-league time (`<=25`), farm FV60+, payroll vs. budget, and the re-centering
shifts (which should hover near zero). `npm run pipeline` is the fast check: one
intake followed through its career should match a generated league's cross-section at
the big-league line (count, age mix, stars). The generated league is the target; the
development and amateur-talent numbers are tuned to it, not the other way around.
