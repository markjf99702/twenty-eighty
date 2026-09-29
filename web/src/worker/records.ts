import type { League } from "../../../src/league/types";
import { playerName, type Player } from "../../../src/players/types";
import type { Season } from "../../../src/season/season";
import { avgOf, type CareerBat, type CareerPit, careerTotals, eraOf } from "../../../src/stats/career";
import { CAREER_STATS, careerRecords, careerTable, formatRecord, liveSeason, type RecordRow, SEASON_STATS, seasonRecords, STATS } from "../../../src/stats/records";
import type { HallPlaque, HallView, MomentView, RecordRowView, RecordsView } from "../api/protocol";
import { dateLabel } from "./views";

const abbrev = (league: League, id: number | null) => (id === null ? "—" : (league.teams[id]?.abbrev ?? "—"));
const teamName = (league: League, id: number) => `${league.teams[id]!.city} ${league.teams[id]!.nickname}`;

/** Moments, newest first. */
export function momentViews(season: Season, limit: number, boxes: ReadonlyMap<string, unknown>, teamId: number | null = null): MomentView[] {
  const league = season.league;
  return league.moments
    .filter((m) => teamId === null || m.teamId === teamId)
    .slice(-limit)
    .reverse()
    .map((m) => ({
      year: m.year,
      date: `${dateLabel(season, m.day)}${m.year !== league.year ? `, ${m.year}` : ""}`,
      kind: m.kind,
      text: m.text,
      playerId: m.playerId,
      team: abbrev(league, m.teamId),
      mine: m.teamId !== null && m.teamId === league.userTeamId,
      box: m.box && m.year === league.year && boxes.has(m.box) ? m.box : null,
    }));
}

export function recordsView(season: Season, kind: "season" | "career" | "moments", teamId: number | null, boxes: ReadonlyMap<string, unknown>): RecordsView {
  const league = season.league;
  const live = kind === "moments" ? null : liveSeason(season);
  const club = teamId ?? undefined;
  const since = league.history[0]?.year ?? league.year;
  const row = (stat: (typeof SEASON_STATS)[number], r: RecordRow): RecordRowView => ({
    value: formatRecord(stat, r.value),
    name: r.name,
    playerId: r.playerId,
    legendId: r.legendId,
    when: r.year !== null ? `${r.year}${r.live ? "*" : ""}` : (r.years ?? ""),
    team: abbrev(league, r.teamId),
    active: r.active,
    live: r.live,
    mine: r.teamId !== null && r.teamId === league.userTeamId,
  });
  const categories =
    kind === "season"
      ? SEASON_STATS.map((stat) => ({ stat, label: STATS[stat].label, pitching: STATS[stat].pitching, rows: seasonRecords(league, stat, { live, teamId: club }).map((r) => row(stat, r)) }))
      : kind === "career"
        ? careerBoards(league, live, club).map(({ stat, rows }) => ({ stat, label: STATS[stat].label, pitching: STATS[stat].pitching, rows: rows.map((r) => row(stat, r)) }))
        : [];
  const moments = kind === "moments" ? momentViews(season, 400, boxes, teamId) : [];
  return {
    scope: teamId === null ? "League" : teamName(league, teamId),
    teams: league.teams.map((t) => ({ id: t.id, name: `${t.city} ${t.nickname}` })).sort((a, b) => a.name.localeCompare(b.name)),
    since,
    categories,
    moments,
  };
}

/** Every career board, with everyone's totals added up once. */
function careerBoards(league: League, live: ReturnType<typeof liveSeason>, teamId: number | undefined) {
  const table = careerTable(league, live, teamId);
  return CAREER_STATS.map((stat) => ({ stat, rows: careerRecords(league, stat, { live, teamId, table }) }));
}

/** A career in a line, as a plaque would put it. */
export function careerLine(bat: CareerBat | null | undefined, pit: CareerPit | null | undefined): string {
  if (pit && (!bat || pit.outs > 300)) {
    const parts = [`${pit.W}-${pit.L}`, `${eraOf(pit).toFixed(2)} ERA`, `${pit.SO.toLocaleString("en-US")} K`];
    if (pit.SV >= 50) parts.push(`${pit.SV} SV`);
    parts.push(`${pit.WAR.toFixed(1)} WAR`);
    return parts.join(", ");
  }
  if (!bat) return "";
  const parts = [avgOf(bat).toFixed(3).replace(/^0/, ""), `${bat.H.toLocaleString("en-US")} H`, `${bat.HR} HR`, `${bat.RBI.toLocaleString("en-US")} RBI`];
  if (bat.SB >= 300) parts.push(`${bat.SB} SB`);
  parts.push(`${bat.WAR.toFixed(1)} WAR`);
  return parts.join(", ");
}

const posOf = (p: Player) => (p.pitching ? (p.role ?? "P") : p.position);

/** The club he played the most seasons for in the league's own years (his last club if none). */
function clubOf(p: Player): number | null {
  const seasons = new Map<number, number>();
  for (const c of p.career) if (c.level === "MLB" && c.teamId !== null) seasons.set(c.teamId, (seasons.get(c.teamId) ?? 0) + 1);
  const best = [...seasons.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : (p.career.filter((c) => c.level === "MLB").at(-1)?.teamId ?? null);
}

export function hallView(season: Season): HallView {
  const league = season.league;
  const user = league.userTeamId;
  const members: HallPlaque[] = league.hall.members
    .map((m) => {
      if (m.legendId !== undefined) {
        const l = league.legends[m.legendId]!;
        return { name: l.name, playerId: null, legendId: l.id, pos: l.pos, years: `${l.from}–${l.to}`, team: teamName(league, l.teamId), line: careerLine(l.bat, l.pit), inducted: m.year, vote: m.vote, mine: l.teamId === user };
      }
      const p = league.players[m.playerId!]!;
      const t = careerTotals(p);
      const club = clubOf(p);
      return {
        name: playerName(p),
        playerId: p.id,
        legendId: null,
        pos: posOf(p),
        years: `${t.first ?? ""}–${t.last ?? ""}`,
        team: club !== null ? teamName(league, club) : "",
        line: careerLine(t.bat, t.pit),
        inducted: m.year,
        vote: m.vote,
        mine: user !== null && p.career.some((c) => c.level === "MLB" && c.teamId === user),
      };
    })
    .sort((a, b) => b.inducted - a.inducted || b.vote - a.vote);
  const last = league.hall.ballots.at(-1);
  return {
    members,
    ballot: last
      ? {
          year: last.year,
          entries: last.entries.map((e) => {
            const p = league.players[e.playerId]!;
            const t = careerTotals(p);
            return { playerId: p.id, name: playerName(p), pos: posOf(p), line: careerLine(t.bat, t.pit), vote: e.vote, ballot: e.ballot, elected: e.elected, dropped: e.dropped };
          }),
        }
      : null,
  };
}
