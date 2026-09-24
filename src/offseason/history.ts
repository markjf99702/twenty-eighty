import type { Award, League, SeasonHistory } from "../league/types";
import { LEVELS, playerName, type Player } from "../players/types";
import type { Season } from "../season/season";

/**
 * The permanent record of a finished season: each player's line at every
 * level, the awards, and the final standings and postseason results.
 */

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Add this season's lines to every player's career record. */
export function recordCareers(league: League, season: Season): void {
  const levels = season.simulateMinors ? LEVELS : (["MLB"] as const);
  for (const level of levels) {
    const stats = season.levels[level].stats();
    for (const h of stats.hitters) {
      const p = league.players[h.id]!;
      const b = h.line;
      p.career.push({
        year: league.year,
        level,
        teamId: p.teamId,
        bat: {
          G: b.G,
          PA: b.PA,
          AB: b.AB,
          H: b.H,
          D: b["2B"],
          T: b["3B"],
          HR: b.HR,
          R: b.R,
          RBI: b.RBI,
          BB: b.BB,
          SO: b.SO,
          SB: b.SB,
          wRCplus: Math.round(h.wRCplus),
          WAR: round1(h.WAR),
        },
      });
    }
    for (const x of stats.pitchers) {
      const p = league.players[x.id]!;
      const l = x.line;
      p.career.push({
        year: league.year,
        level,
        teamId: p.teamId,
        pit: {
          G: l.G,
          GS: l.GS,
          W: l.W,
          L: l.L,
          SV: l.SV,
          outs: l.outs,
          H: l.H,
          ER: l.ER,
          HR: l.HR,
          BB: l.BB,
          SO: l.SO,
          ERA: round2(x.ERA),
          FIP: round2(x.FIP),
          WAR: round1(x.WAR),
        },
      });
    }
  }
}

/** MVP (best WAR), Cy Young (best pitcher WAR) and Rookie of the Year in each league. */
export function seasonAwards(league: League, season: Season): Award[] {
  const stats = season.stats("MLB");
  const awards: Award[] = [];
  const teamOf = (id: number) => league.players[id]!.teamId ?? -1;
  const inLeague = (id: number, lg: number) => league.teams[teamOf(id)]?.league === lg;
  // Rookies: under 45 days of big-league service before this season.
  const rookie = (id: number) => league.players[id]!.service - (season.seasonService.get(id) ?? 0) < 45;
  const f3 = (x: number) => x.toFixed(3).replace(/^0/, "");

  league.structure.leagues.forEach((_name, lg) => {
    const hitters = stats.hitters.filter((h) => inLeague(h.id, lg));
    const pitchers = stats.pitchers.filter((p) => inLeague(p.id, lg));
    const hitterNote = (h: (typeof hitters)[number]) => `${f3(h.AVG)}/${f3(h.OBP)}/${f3(h.SLG)}, ${h.line.HR} HR, ${round1(h.WAR)} WAR`;
    const pitcherNote = (p: (typeof pitchers)[number]) => `${p.line.W}-${p.line.L}, ${p.ERA.toFixed(2)} ERA, ${p.line.SO} K, ${round1(p.WAR)} WAR`;

    const bestHitter = [...hitters].sort((a, b) => b.WAR - a.WAR)[0];
    const bestPitcher = [...pitchers].sort((a, b) => b.WAR - a.WAR)[0];
    const mvp = bestPitcher && bestHitter && bestPitcher.WAR > bestHitter.WAR + 1 ? bestPitcher : bestHitter;
    if (mvp) {
      const note = "PA" in mvp ? hitterNote(mvp as (typeof hitters)[number]) : pitcherNote(mvp as (typeof pitchers)[number]);
      awards.push({ name: "MVP", league: lg, playerId: mvp.id, teamId: teamOf(mvp.id), note });
    }
    // Cy Young voters weigh run prevention: WAR plus a nudge for innings and ERA.
    const cy = [...pitchers].filter((p) => p.IP >= 100).sort((a, b) => b.WAR + (4 - b.ERA) * 0.3 - (a.WAR + (4 - a.ERA) * 0.3))[0];
    if (cy) awards.push({ name: "Cy Young", league: lg, playerId: cy.id, teamId: teamOf(cy.id), note: pitcherNote(cy) });

    const rookies = [
      ...hitters.filter((h) => rookie(h.id) && h.PA >= 150).map((h) => ({ id: h.id, war: h.WAR, note: hitterNote(h) })),
      ...pitchers.filter((p) => rookie(p.id) && p.IP >= 40).map((p) => ({ id: p.id, war: p.WAR, note: pitcherNote(p) })),
    ].sort((a, b) => b.war - a.war);
    const roy = rookies[0];
    if (roy) awards.push({ name: "Rookie of the Year", league: lg, playerId: roy.id, teamId: teamOf(roy.id), note: roy.note });
  });

  for (const a of awards) {
    const p = league.players[a.playerId]!;
    p.awards.push(`${league.year} ${league.structure.leagues[a.league]} ${a.name}`);
  }
  return awards;
}

/** How each club's season ended. */
function finishes(season: Season): Map<number, string> {
  const out = new Map<number, string>();
  const post = season.postseason;
  if (!post) return out;
  const exits: Record<string, string> = {
    "Wild Card Series": "Lost Wild Card Series",
    "Division Series": "Lost Division Series",
    "Championship Series": "Lost Championship Series",
    "World Series": "Lost World Series",
  };
  for (const s of post.series) {
    const loser = s.winner === s.higher ? s.lower : s.higher;
    out.set(loser, exits[s.round] ?? "Postseason");
  }
  out.set(post.champion, "Won World Series");
  return out;
}

export function recordHistory(league: League, season: Season, awards: Award[]): SeasonHistory {
  const finish = finishes(season);
  const post = season.postseason;
  const standings = season.records.map((r) => ({
    teamId: r.teamId,
    w: r.w,
    l: r.l,
    rs: r.rs,
    ra: r.ra,
    finish: finish.get(r.teamId) ?? "Missed postseason",
  }));
  const pennants = post ? post.series.filter((s) => s.round === "Championship Series").map((s) => s.winner) : [];
  const entry: SeasonHistory = {
    year: league.year,
    champion: post?.champion ?? -1,
    pennants,
    standings,
    awards,
    userTeamId: league.userTeamId,
  };
  league.history.push(entry);
  return entry;
}

export const awardText = (league: League, a: Award): string => {
  const p: Player = league.players[a.playerId]!;
  return `${league.structure.leagues[a.league]} ${a.name}: ${playerName(p)} (${league.teams[a.teamId]?.abbrev ?? "FA"}), ${a.note}`;
};
