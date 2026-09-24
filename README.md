# twenty-eighty

A baseball front-office simulation in the spirit of *Baseball Mogul*: you're the GM
(and a little bit the owner), you build the roster and the farm system, and the seasons
play out in a simulation.

Two things are different from the late-90s version:

- **Every player is graded the way modern scouts grade them: on the 20-80 scale**, as
  present/future grades (`45/60`), with a hidden "true" talent underneath.
- **The stats are modern**: wOBA, xwOBA, wRC+, OPS+, FIP, xFIP, SIERA, ERA-, exit
  velocity, barrels, whiff and chase rates, and FanGraphs-style WAR. The constants behind
  them (wOBA weights, FIP constant, runs per win, park factors) are re-derived every
  season from the simulated league's own run environment.

> Status: **phases 1-2 of the roadmap are done**. The engine, player generation,
> full-season simulation, postseason, advanced stats and calibration all work from the
> command line. The GM layer (roster moves, contracts, trades, finances) and a UI are next.

## Quick start

```bash
npm install
npm run sim:season                 # simulate a full season: standings, playoffs, awards, leaders
npm run sim:game -- DEN BOS        # one game, with a box score
npm run scout -- NYE               # an organization's scouting report on the 20-80 scale
npm run grade-chart                # what each grade means in stats (see below)
npm run calibrate                  # compare a simulated season to real MLB
npm test                           # vitest suite
```

Every universe is generated from a seed (`--seed my-league`), so the same seed always
produces the same players and the same season.

## The 20-80 scale

50 is major-league average, and every 10 points is one standard deviation of MLB talent.
The engine works in those standard deviations (`z = (grade - 50) / 10`), and the UI shows
grades. Scouts report in 5-point steps.

Grades are *causes* in the simulation, not labels pasted on afterward. `npm run grade-chart`
takes a hitter with every tool at 50, changes one tool, and plays 30,000 plate
appearances against the league's real pitchers. It's the same kind of translation table
scouts carry around:

| Grade | Hit: AVG / K% | Raw power: HR per 600 PA / ISO | Eye: BB% | Run: BABIP |
|------:|--------------:|-------------------------------:|---------:|-----------:|
| 80 | .302 / 13.8% | 47 / .328 | 11.9% | .341 |
| 70 | .284 / 16.5% | 34 / .253 | 11.1% | .323 |
| 60 | .267 / 19.2% | 26 / .200 | 9.6% | .307 |
| 50 | .243 / 23.3% | 18 / .143 | 8.2% | .303 |
| 40 | .223 / 27.6% | 11 / .100 | 6.8% | .290 |
| 30 | .189 / 34.1% | 8 / .071 | 5.2% | .279 |
| 20 | .163 / 40.8% | 4 / .046 | 3.9% | .277 |

Pitchers work the same way. Each pitch in the arsenal gets its own grade (a 70 slider is
a whiff pitch). **Control** is throwing strikes: walk rate runs from about 20% at a 20 to
4% at an 80. **Command** is hitting spots within the zone: fewer middle-middle mistakes,
more painted corners. **Stamina** sets how deep a pitcher can go.

Hitters have six tools: Hit, (raw) Power, Eye, Run, Field and Arm. Swing path
(ground-ball vs. fly-ball) and pull tendency are traits rather than grades. Defense is
graded per position from the glove, arm and speed tools, with a penalty for playing
out of position.

## How a game is simulated

Every pitch is simulated:

1. **Pitch and location.** The pitcher picks a pitch from his arsenal, weighted by the
   count, then a location from the Statcast "attack regions": heart, shadow (edges),
   chase, or waste. Control and command shape that distribution; so does the count
   (behind 3-0 he comes in; ahead 0-2 he expands).
2. **Swing decision.** The hitter's Eye governs chasing. The count matters: take on
   3-0, protect with two strikes.
3. **Contact.** Whiff probability depends on the hitter's Hit tool against the pitch's
   grade and type. Contact can be fouled off or put in play.
4. **Batted ball.** Exit velocity (raw power, squared-up contact, pitch quality,
   location) and launch angle (swing path, pitch type) produce a batted ball with a
   spray angle.
5. **Physics-lite fielding.** Carry distance and hang time are checked against the park's
   fences and wall heights, and altitude helps (hello, Denver). Nine fielders with real
   positions and acceleration-limited range try to make the play, and an uncaught ball
   becomes a race between the batter and the relay throw.
6. **Everything else.** Baserunning decisions, steals against the catcher's arm, wild
   pitches, errors, double plays, sac flies, and a manager who handles lineups, rest
   days, a five-man rotation and a bullpen with roles and fatigue.

Because every batted ball comes with *probabilities* for each outcome, the same model
yields **expected stats** (xwOBA from exit velocity and launch angle) and **defensive
runs** (this fielder vs. a league-average fielder on the same ball).

## Calibration

`npm run calibrate` simulates full seasons and compares the league with rounded
2024-25 MLB numbers. Current results (three simulated seasons, 7,290 games):

| | Sim | MLB | | Sim | MLB |
|---|---:|---:|---|---:|---:|
| Runs/game | 4.44 | 4.40 | Avg exit velo | 89.3 | 88.7 |
| AVG / OBP / SLG | .249/.320/.403 | .244/.313/.401 | Hard-hit % | 39.4 | 38.5 |
| K% / BB% | 22.4 / 8.5 | 22.4 / 8.3 | Barrel % | 7.7 | 7.8 |
| HR% of PA | 3.07 | 3.00 | GB / LD / FB % | 43.8 / 24.9 / 22.5 | 43 / 24.5 / 24.5 |
| BABIP | .298 | .291 | SB per game / SB% | 0.65 / 77% | 0.72 / 79% |
| Pitches per PA | 3.99 | 3.90 | Errors per game | 0.51 | 0.52 |
| Swing % / CSW % | 48.1 / 27.7 | 47.3 / 28.2 | SP innings per start | 5.0 | 5.3 |

It also checks the *spread*, which is what makes the 20-80 scale honest. A typical
season has a 50-56 HR leader, a batting champion around .330, a 250-strikeout ace, a
top position player around 8-9 WAR, and team records from about 60 to 100 wins.

The wOBA weights the sim derives from its own run environment (BB 0.73, 1B 0.85,
2B 1.25, 3B 1.70, HR 2.11) land close to FanGraphs' real ones.

## Modern stats

- **Hitting:** AVG/OBP/SLG, ISO, BABIP, K%, BB%, wOBA, xwOBA, wRC+, OPS+, chase%,
  whiff%, zone contact%, average exit velocity, hard-hit%, barrel%, sweet-spot%.
- **Pitching:** ERA, FIP, xFIP, SIERA, ERA-, FIP-, WHIP, K%, BB%, K-BB%, whiff%, CSW%,
  chase%, zone%, GB%, EV/hard-hit/barrels allowed, xwOBA allowed.
- **WAR:** position players get batting runs (park-adjusted wRAA), baserunning (wSB),
  fielding (range plus errors vs. an average fielder, catcher framing, catcher arm),
  a positional adjustment, a league adjustment and replacement level. Pitchers get
  FIP-based WAR with dynamic runs per win. Totals follow the FanGraphs convention of
  1,000 WAR per 2,430 games, split 57/43.
- **Run expectancy:** a 24-state RE matrix from every plate appearance, which also
  supplies the linear weights.

## Project layout

```
src/
  core/         seeded RNG, 20-80 grade helpers, math
  players/      player types, generator (value targets + tool mixes), names, defense
  league/       fictional 30-team universe, parks, league generation and re-centering
  sim/          the engine: pitch model, batted-ball physics, game state machine, manager AI
  season/       schedule, season runner, standings, pitcher workload, postseason
  stats/        stat lines, run expectancy / linear weights, advanced stats and WAR
  calibration/  MLB targets, league and spread reports, the grade chart
  report/       text renderers for the CLI
scripts/        sim:season, sim:game, scout, grade-chart, calibrate, probe
test/           vitest suite
```

Every tunable number in the engine lives in `src/sim/constants.ts` (plate discipline,
contact, running) or at the top of `src/sim/battedBall.ts` (fielding and physics).

## Roadmap

1. ~~Pitch-by-pitch engine and calibration harness~~
2. ~~Player generator with 20-80 grades, full schedule, standings, stats~~
3. Minor leagues (AAA to Rookie ball), 40-man roster, call-ups and options, injuries,
   in-game substitutions
4. Offseason loop: aging and development toward future grades, contracts (pre-arb,
   arbitration, free agency), the draft, international signings, AI trades valued by
   surplus WAR
5. The GM's-eye view: noisy scouting reports whose accuracy depends on your scouting
   staff, an analytics department, finances and owner goals (attendance, ticket prices,
   payroll budget)
6. A browser UI: sortable stat pages, player cards, league history, awards, Hall of Fame

## A note on the universe

The clubs, players and parks are fictional (real cities, invented teams). Nothing here
uses MLB or MLBPA marks, and names that collide with well-known real players are
re-drawn.
