/**
 * View models for October: the bracket, the user's series game by game, the
 * next game's probable starters, and the playoff roster and rotation.
 */
import { teamName } from "../../../src/league/types";
import type { Team } from "../../../src/league/types";
import { playerName } from "../../../src/players/types";
import {
  type Bracket,
  currentRound,
  defaultPlayoffRoster,
  defaultPlayoffRotation,
  type LiveSeries,
  type PostseasonResult,
  type Round,
  nextHome,
  PLAYOFF_PITCHERS,
  PLAYOFF_ROSTER,
  probableStarter,
  seriesOf,
  stillAlive,
} from "../../../src/season/postseason";
import type { Season } from "../../../src/season/season";
import type { BoxScoreView, PlayoffPlanView, PostseasonView, SeriesView, StarterView, Status } from "../api/protocol";
import { dateLabel, gameKey, playerSummary, type StatsCache } from "./views";

const nick = (season: Season, id: number) => season.team(id).nickname;

/** "Forge lead 2-1", "Tied 1-1", "Forge win 3-1". */
function seriesState(season: Season, s: LiveSeries, wins: [number, number], over: boolean): string {
  const [h, l] = wins;
  if (h === l) return `Tied ${h}-${l}`;
  const [lead, a, b] = h > l ? [s.higher, h, l] : [s.lower, l, h];
  return `${nick(season, lead)} ${over ? "win" : "lead"} ${a}-${b}`;
}

function seriesView(season: Season, s: LiveSeries, boxes: Map<string, BoxScoreView>): SeriesView {
  const league = season.league;
  const b = season.bracket!;
  const user = league.userTeamId;
  const seedOf = (id: number) => {
    const lg = b.seeds.findIndex((x) => x.includes(id));
    return lg >= 0 ? b.seeds[lg]!.indexOf(id) + 1 : null;
  };
  const side = (id: number) => ({ id, abbrev: season.team(id).abbrev, name: teamName(season.team(id)), seed: seedOf(id) });
  const need = s.round === "Wild Card Series" ? 2 : s.round === "Division Series" ? 3 : 4;
  const running: [number, number] = [0, 0];
  const games = s.games.map((g, i) => {
    const winner = g.score[1] > g.score[0] ? g.homeId : g.awayId;
    running[winner === s.higher ? 0 : 1]++;
    const key = gameKey(g.day, g.homeId);
    return {
      n: i + 1,
      date: dateLabel(season, g.day),
      key,
      hasBox: boxes.has(key),
      away: season.team(g.awayId).abbrev,
      home: season.team(g.homeId).abbrev,
      score: g.score,
      innings: g.innings,
      recap: g.recap,
      winner: season.team(winner).abbrev,
      after: seriesState(season, s, [running[0], running[1]], running[0] === need || running[1] === need),
    };
  });
  return {
    round: s.round,
    league: s.league === null ? "" : league.structure.leagues[s.league]!,
    higher: side(s.higher),
    lower: side(s.lower),
    wins: s.wins,
    winner: s.winner === null ? null : season.team(s.winner).abbrev,
    status: s.games.length === 0 ? "Game 1 to come" : seriesState(season, s, s.wins, s.winner !== null),
    games,
    next: s.next === null ? null : { n: s.games.length + 1, date: dateLabel(season, s.next), home: season.team(nextHome(s)).abbrev },
    mvp: s.mvp ? { playerId: s.mvp.playerId, name: playerName(league.players[s.mvp.playerId]!), team: season.team(league.players[s.mvp.playerId]!.teamId ?? s.winner!).abbrev, line: s.mvp.line } : null,
    mine: user !== null && (s.higher === user || s.lower === user),
  };
}

function starterView(season: Season, id: number | null): StarterView | null {
  if (id === null) return null;
  const p = season.league.players[id]!;
  const l = season.levels.MLB.pitching.lines.get(id);
  const line = l && l.outs > 0 ? `${l.W}-${l.L}, ${((27 * l.ER) / l.outs).toFixed(2)} ERA` : "";
  return { id, name: playerName(p), line };
}

/** A postseason played all at once (saves from before it was played game by game), as a finished bracket. */
function bracketFrom(post: PostseasonResult): Bracket {
  return {
    seeds: post.seeds,
    series: post.series.map((s) => ({
      round: s.round as Round,
      league: s.league,
      higher: s.higher,
      lower: s.lower,
      wins: s.wins,
      games: s.games.map((g) => ({ ...g, recap: "", starters: [-1, -1] as [number, number] })),
      next: null,
      winner: s.winner,
      mvp: null,
      tally: {},
    })),
    day: 0,
    champion: post.champion,
    plan: { roster: null, rotation: null },
  };
}

export function postseasonView(season: Season, boxes: Map<string, BoxScoreView>): PostseasonView | null {
  if (!season.bracket && season.postseason) season.bracket = bracketFrom(season.postseason);
  const b = season.bracket;
  if (!b) return null;
  const league = season.league;
  const user = league.userTeamId;
  const round = currentRound(b);
  const upcoming = b.series.filter((s) => s.next !== null).map((s) => s.next!);
  let mine: PostseasonView["user"] = null;
  if (user !== null) {
    const lg = b.seeds.findIndex((x) => x.includes(user));
    const alive = stillAlive(b, user);
    const current = seriesOf(b, user);
    const theirs = b.series.filter((s) => s.higher === user || s.lower === user).map((s) => seriesView(season, s, boxes));
    let next: NonNullable<PostseasonView["user"]>["next"] = null;
    if (alive && current && current.next !== null) {
      const opp = current.higher === user ? current.lower : current.higher;
      next = {
        n: current.games.length + 1,
        round: current.round,
        date: dateLabel(season, current.next),
        home: nextHome(current) === user,
        opponent: teamName(season.team(opp)),
        starter: starterView(season, probableStarter(season, current, user)),
        theirStarter: starterView(season, probableStarter(season, current, opp)),
      };
    }
    const plan = b.plan;
    const roster = plan.roster ?? season.team(user).rosters.MLB;
    mine = {
      seed: lg >= 0 ? b.seeds[lg]!.indexOf(user) + 1 : null,
      alive,
      series: theirs,
      next,
      plan: {
        roster: roster.length,
        pitchers: roster.filter((id) => league.players[id]!.pitching).length,
        rotation: (plan.rotation ?? []).map((id) => ({ id, name: playerName(league.players[id]!) })),
      },
    };
  }
  return {
    started: true,
    over: b.champion !== null,
    seeds: b.seeds.map((lg) => lg.map((id) => ({ teamId: id, abbrev: season.team(id).abbrev, name: teamName(season.team(id)) }))),
    leagues: league.structure.leagues,
    series: b.series.map((s) => seriesView(season, s, boxes)),
    round,
    date: upcoming.length ? dateLabel(season, Math.min(...upcoming)) : null,
    champion: b.champion === null ? null : season.team(b.champion).abbrev,
    user: mine,
  };
}

/** For the scoreboard: whether October has started and whether the user's club is still playing. */
export function octoberStatus(season: Season): Status["october"] {
  const b = season.bracket;
  const user = season.league.userTeamId;
  if (!b || b.champion !== null) return b ? { started: true, alive: false, next: null } : { started: false, alive: false, next: null };
  const alive = user !== null && stillAlive(b, user);
  const s = user !== null ? seriesOf(b, user) : null;
  // Waiting on a bye or the other series of a round: play on to the next opponent.
  return { started: true, alive, next: !alive ? null : s && s.next !== null ? `Play Game ${s.games.length + 1}` : "Play to your next series" };
}

export function playoffPlanView(season: Season, stats: StatsCache, team: Team): PlayoffPlanView | null {
  const b = season.bracket;
  if (!b || !b.seeds.flat().includes(team.id)) return null;
  const league = season.league;
  const roster = b.plan.roster ?? defaultPlayoffRoster(season, team);
  const rotation = b.plan.rotation ?? defaultPlayoffRotation(season, team, roster);
  const pool = [...new Set([...team.rosters.MLB, ...team.rosters.AAA, ...team.rosters.AA, ...team.rosters["A+"], ...team.rosters.A])]
    .map((id) => league.players[id]!)
    .filter((p) => p.onFortyMan || p.level === "MLB");
  return {
    editable: stillAlive(b, team.id),
    players: pool.map((p) => playerSummary(p, season, stats)),
    roster,
    rotation,
    limits: { roster: PLAYOFF_ROSTER, pitchers: PLAYOFF_PITCHERS },
  };
}
