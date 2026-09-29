import type { League, SeasonHistory } from "../../../src/league/types";
import { playerName } from "../../../src/players/types";
import { allStarIds } from "../../../src/season/allstar";
import type { Season } from "../../../src/season/season";
import type { AllStarLine, AllStarView, AwardRow, ExecutiveRow } from "../api/protocol";
import { dateLabel } from "./views";

const abbrev = (league: League, id: number | null) => (id === null ? "FA" : (league.teams[id]?.abbrev ?? "FA"));
const short = (league: League, lg: number) => league.structure.leagues[lg]!.replace(" League", "");

/** Season awards for the review and the history page. */
export function awardRows(league: League, awards: SeasonHistory["awards"]): AwardRow[] {
  return awards.map((a) => ({
    name: a.name,
    league: short(league, a.league),
    pos: a.pos ?? null,
    playerId: a.playerId,
    player: playerName(league.players[a.playerId]!),
    team: abbrev(league, a.teamId),
    note: a.note,
    mine: a.teamId === league.userTeamId,
  }));
}

export function executiveRows(league: League, h: SeasonHistory): ExecutiveRow[] {
  return (h.executives ?? []).map((e) => ({
    league: short(league, e.league),
    team: `${league.teams[e.teamId]!.city} ${league.teams[e.teamId]!.nickname}`,
    note: e.note,
    mine: e.teamId === h.userTeamId,
  }));
}

/** "Continental 5, Federal 3 in Kansas City" and the MVP, from a season's record. */
export function allStarLine(league: League, g: SeasonHistory["allStar"] | undefined): AllStarLine | null {
  if (!g) return null;
  const [a, h] = g.leagues;
  const where = league.teams[g.host]!.city;
  const mvp = g.mvp === null ? null : league.players[g.mvp]!;
  return {
    text: `${short(league, a)} ${g.score[0]}, ${short(league, h)} ${g.score[1]} in ${where}`,
    mvp: mvp ? { playerId: mvp.id, name: playerName(mvp), team: abbrev(league, mvp.teamId), note: g.note } : null,
  };
}

/** This season's All-Star Game, once it's been played. */
export function allStarView(season: Season): AllStarView | null {
  const g = season.allStar;
  if (!g) return null;
  const league = season.league;
  const user = league.userTeamId;
  const P = (id: number) => league.players[id]!;
  const mine = (id: number) => user !== null && P(id).teamId === user;
  const who = (id: number) => ({ playerId: id, name: playerName(P(id)), team: abbrev(league, P(id).teamId), mine: mine(id) });
  const host = league.teams[g.host]!;
  const sides = g.rosters.map((r, s) => {
    const starters = new Set(r.lineup.map((x) => x.id));
    const played = new Set([...g.batting[s]!.map((b) => b.id), ...g.pitching[s]!.map((p) => p.id)]);
    return {
      league: short(league, r.league),
      batting: g.batting[s]!.map((b) => ({ ...who(b.id), pos: b.pos, starter: starters.has(b.id), AB: b.AB, R: b.R, H: b.H, HR: b.HR, RBI: b.RBI, BB: b.BB, SO: b.SO })),
      pitching: g.pitching[s]!.map((p) => ({
        ...who(p.id),
        IP: `${Math.floor(p.outs / 3)}${p.outs % 3 ? `.${p.outs % 3}` : ""}`,
        H: p.H,
        R: p.R,
        ER: p.ER,
        BB: p.BB,
        SO: p.SO,
      })),
      unused: allStarIds(r)
        .filter((id) => !played.has(id))
        .map((id) => ({ ...who(id), pos: P(id).pitching ? (P(id).role ?? "P") : P(id).position })),
    };
  });
  const mvp = g.mvp === null ? null : P(g.mvp);
  return {
    year: g.year,
    day: g.day,
    date: dateLabel(season, g.day),
    where: `${host.park.name}, ${host.city}`,
    leagues: [short(league, g.leagues[0]), short(league, g.leagues[1])],
    score: g.score,
    innings: g.innings,
    lineScore: g.lineScore,
    mvp: mvp ? { playerId: mvp.id, name: playerName(mvp), team: abbrev(league, mvp.teamId), note: g.mvpNote } : null,
    sides,
    mine: g.rosters.flatMap(allStarIds).filter(mine).map((id) => ({ playerId: id, name: playerName(P(id)) })),
  };
}
