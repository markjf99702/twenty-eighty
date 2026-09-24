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

> Status: **phases 1-5 of the roadmap are done**: the engine, player generation, full
> organizations with four minor league affiliates, roster rules, injuries, in-game
> substitutions, AI front offices, postseason, advanced stats, calibration, a browser
> UI, and the offseason: development and aging, contracts and payroll, the draft, free
> agency, international signings and trades. Seasons roll on indefinitely. Scouting
> uncertainty, finances and owner goals are next.

## Quick start

```bash
npm install
npm run dev                        # the game in your browser (http://localhost:5173)
npm run sim:season                 # a full season (majors + 4 affiliate levels): standings, playoffs, awards, leaders
npm run sim:season -- --team BOS   # ...plus one club's transaction log and end-of-season organization
npm run sim:game -- DEN BOS        # one game, with a box score
npm run scout -- NYE               # an organization's scouting report on the 20-80 scale
npm run grade-chart                # what each grade means in stats (see below)
npm run calibrate                  # compare a simulated season to real MLB
npm run sim:years -- --years 10    # many seasons, offseasons included, watching for drift
npm test                           # vitest suite
```

Every universe is generated from a seed (`--seed my-league`), so the same seed always
produces the same players and the same season.

## Playing in the browser

`npm run dev` starts the game; `npm run build:web` builds a static site into `web/dist`
that any web server can host. Pick a seed and a club, and you're the GM:

- **Scoreboard sims**: play a day, a week, a month or the rest of the season, then the
  postseason. A full season with all four affiliates takes about 15-20 seconds, running in
  a Web Worker so the page stays responsive.
- **Front office**: record, division race, recent games, club leaders, injuries, your top
  prospects, and the transaction wire.
- **My club**: the active roster, injured list and every affiliate, with each player's
  present grades, overall and future value (FV), 40-man status, options left and service
  time. Switch the tables between the scouting report, this season's stats (AVG/OBP/SLG,
  wRC+, xwOBA, fielding runs and WAR for hitters; ERA, ERA-, FIP, K%, BB%, WHIP and WAR
  for pitchers) and last season's, sortable, with standout numbers tinted and small
  samples faded. Every legal roster move (call up, select a contract, option, DFA,
  injured list, promote or demote within the farm, release) is a click away, and moves
  that aren't allowed say why.
- **Depth chart**: set the lineup, rotation and bullpen order yourself, or leave it to
  the manager. An assistant GM can handle injuries and call-ups until you turn him off.
- **Player pages**: the scouting report as present/future 20-80 bars, pitch mix, defense
  by position, and stats by level.
- **Stats**: sortable leaderboards for every level, with qualified/club/position filters
  and the season's own run environment (wOBA weights, FIP constant, runs per win).
- **Scores and box scores**, **standings** with the wild-card race, and the **postseason**
  bracket.
- **The offseason**, a phase at a time: the season in review (awards, who developed,
  who retired), the tender deadline for your arbitration cases, the draft (pick when
  you're on the clock), eight weeks of free agency (make offers; players take the best
  one that clears their price), international signings against your bonus pool, and
  spring training. Then the next season starts.
- **Trades** at any time before the July 31 deadline or in the winter: pick players from
  both sides and the other club tells you whether it would say yes (and roughly how much
  more it wants if not). **Payroll** shows every contract, your budget and future
  commitments; **History** keeps champions and award winners.

The game autosaves to the browser (IndexedDB) after every sim and roster move, and a save
can be exported to a file and imported again from the League office page. Saves resume
exactly: the same seed and the same moves play out the same way.

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

## Organizations

Every club runs a full organization: the 26-man active roster (28 from September 1), a
40-man reserve list, and four affiliates (AAA, AA, High-A, Single-A) of about 26 players
each. That comes to roughly 4,000 players, each with present/future grades, an age,
MLB service time, option years, and a hidden durability trait. The affiliates play their
own 162-game seasons on the same calendar, with their own standings, stats and parks
(some Triple-A parks sit at altitude). Minor leaguers are graded on the same
major-league scale, so an A-ball prospect might be a `40/60`.

The roster rules are the ones a GM has to work around:

- Only 40-man players can be active; selecting a minor leaguer's contract uses a 40-man spot.
- Optioning a player burns one of his three option years (once per season). He has to
  stay down 10 days (15 for pitchers) unless he's replacing an injured player. Veterans
  with five years of service can't be optioned.
- Injured list: 10-day (position players), 15-day (pitchers), 60-day (frees a 40-man spot).
- Designating a player for assignment exposes him to waivers. Other clubs claim him if he
  beats their weakest 40-man player; otherwise he's outrighted to AAA.

**Injuries** strike during games. Pitchers face a per-pitch and per-appearance risk,
hitters a per-plate-appearance risk, and both scale with age and the durability trait.
Durations come from a catalog that runs from a day-to-day bruise to Tommy John surgery.

**In-game substitutions**: pinch hitters in close late games (for a platoon or talent
edge), pinch runners for slow runners representing the tying or winning run, defensive
replacements protecting a late lead, and forced replacements when someone gets hurt.

**AI front offices** run every club each day. They put injured players on the IL and call
up replacements, activate players when they heal (optioning or DFA'ing someone to make
room), make weekly swaps between the majors and AAA, and promote players up the farm
system every couple of weeks. They judge players by their grades blended with actual
production, so a slumping veteran can lose his job and a hot prospect can force his way
up. A typical season has about 550 IL placements, 900 call-ups and a steady stream of
waiver claims, all in a transaction log.

## The offseason

Every winter the whole universe moves forward a year:

- **Development and aging.** Each tool has its own aging curve: speed peaks around 24
  and fades first, contact and power peak around 27 and hold for a few years, plate
  discipline and command keep improving into the 30s. Young players close part of the
  gap to their future grades every year while the projection itself drifts, so some
  prospects break out and more of them stall. Future Value (FV) is the grade of a
  player's projected peak under that model.
- **Contracts.** Players with under three years of service make near the minimum;
  three to six years go to arbitration each winter (about 22%, 38% and 58% of their
  market value); six or more can become free agents. A win costs about $8M on the
  open market, and projected WAR comes from the grades through coefficients measured
  from the engine. Each club has a payroll budget set by its market, from about $95M
  to $250M; released players' guaranteed money stays on the books as dead money.
- **The draft**: ten rounds in reverse order of the standings, high schoolers (18,
  raw, the most room to grow) and college players (21-22, closer to ready).
- **Free agency**: every free agent asks for years and salary from his projected
  WAR over the deal. Clubs with a hole he fills and budget room bid; his price
  softens week by week. Leftover veterans take minor league deals or retire.
- **International signings**: 17-year-olds with bonus asks, and bonus pools that are
  bigger for worse teams.
- **Trades** are valued by **surplus**: projected WAR over the years a club controls
  a player, priced at $8M a win and discounted 10% a year, minus salary. A cheap young
  star is worth a fortune; an aging star on a big deal can be worth less than nothing.
  AI contenders buy veterans from rebuilding clubs with prospects, too.
- **Spring training** heals most injuries, trims every 40-man roster, sets an Opening
  Day 26 and sorts each farm system by ability (with age floors).

A universe has to look the same in year 10 as in year 1, so each winter re-centers the
grades (50 stays major-league average) and `npm run sim:years` plays many seasons to
check. Over ten-year runs the run environment stays at 4.3-4.5 runs a game, home runs
near 3% of plate appearances, home run leaders in the 50s, and payrolls near budget.

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
  players/      player types, generator (value targets + tool mixes), development and aging, names, defense, injuries
  league/       fictional 30-team universe, parks, organization generation and re-centering
  org/          roster rules, AI front office, depth charts, valuation, contracts, trades
  sim/          the engine: pitch model, batted-ball physics, game state machine, substitutions
  season/       schedule, multi-level season runner, standings, pitcher workload, postseason
  stats/        stat lines, run expectancy / linear weights, advanced stats and WAR
  calibration/  MLB targets, league and spread reports, the grade chart
  report/       text renderers for the CLI
  offseason/    the winter: season history, draft, free agency, international signings, spring
  save/         save games (exact resume) and migrations
web/            browser UI: Preact pages, a simulation Web Worker, IndexedDB saves
scripts/        sim:season, sim:game, scout, grade-chart, calibrate, probe
test/           vitest suite
```

Every tunable number in the engine lives in `src/sim/constants.ts` (plate discipline,
contact, running) or at the top of `src/sim/battedBall.ts` (fielding and physics).

## Roadmap

1. ~~Pitch-by-pitch engine and calibration harness~~
2. ~~Player generator with 20-80 grades, full schedule, standings, stats~~
3. ~~Minor leagues, 40-man roster, call-ups and options, injuries, in-game substitutions,
   AI front offices~~
4. ~~A browser UI: sortable stat pages, player cards, roster management, league history~~
5. ~~Offseason loop: aging and development toward future grades, contracts (pre-arb,
   arbitration, free agency), the draft, international signings, AI trades valued by
   surplus WAR~~
6. The GM's-eye view: noisy scouting reports whose accuracy depends on your scouting
   staff, an analytics department, finances and owner goals (attendance, ticket prices,
   payroll budget)

## A note on the universe

The clubs, players and parks are fictional (real cities, invented teams). Nothing here
uses MLB or MLBPA marks, and names that collide with well-known real players are
re-drawn.
