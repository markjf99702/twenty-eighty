import type { Award, ExecutiveAward, League, SeasonHistory } from "../league/types";
import { payroll } from "../org/contracts";
import { defenseGrade } from "../players/defense";
import { FIELD_POSITIONS, LEVELS, playerName, type Player } from "../players/types";
import { mainPosition } from "../season/allstar";
import type { Season } from "../season/season";

/**
 * The permanent record of a finished season: each player's line at every
 * level, the awards, and the final standings and postseason results.
 */

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
const round3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0);

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
          OBP: round3(h.OBP),
          SLG: round3(h.SLG),
          Kpct: round3(h.Kpct),
          BBpct: round3(h.BBpct),
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
          Kpct: round3(x.Kpct),
          BBpct: round3(x.BBpct),
          WHIP: round2(x.WHIP),
          ERAminus: Math.round(x.ERAminus),
        },
      });
    }
  }
}

/**
 * The season's awards in each league, as the voters see it: WAR first, with
 * the traditional numbers and a contender's glow tipping close calls. MVP, Cy
 * Young, Rookie of the Year, Reliever of the Year (saves count), and a Gold
 * Glove and a Silver Slugger at each position (DH included for the bats).
 */
export function seasonAwards(league: League, season: Season): Award[] {
  const stats = season.stats("MLB");
  const awards: Award[] = [];
  const teamOf = (id: number) => league.players[id]!.teamId ?? -1;
  const inLeague = (id: number, lg: number) => league.teams[teamOf(id)]?.league === lg;
  // Rookies: under 45 days of big-league service before this season.
  const rookie = (id: number) => league.players[id]!.service - (season.seasonService.get(id) ?? 0) < 45;
  const f3 = (x: number) => x.toFixed(3).replace(/^0/, "");
  const contenders = new Set(season.postseason?.seeds?.flat() ?? []);
  const glow = (id: number) => (contenders.has(teamOf(id)) ? 0.5 : 0);
  const at = new Map(stats.hitters.map((h) => [h.id, mainPosition(season.fielding.lines.get(h.id), league.players[h.id]!)]));

  league.structure.leagues.forEach((_name, lg) => {
    const hitters = stats.hitters.filter((h) => inLeague(h.id, lg) && !league.players[h.id]!.pitching);
    const pitchers = stats.pitchers.filter((p) => inLeague(p.id, lg));
    const slash = (h: (typeof hitters)[number]) => `${f3(h.AVG)}/${f3(h.OBP)}/${f3(h.SLG)}`;
    const hitterNote = (h: (typeof hitters)[number]) => `${slash(h)}, ${h.line.HR} HR, ${round1(h.WAR)} WAR`;
    const pitcherNote = (p: (typeof pitchers)[number]) => `${p.line.W}-${p.line.L}, ${p.ERA.toFixed(2)} ERA, ${p.line.SO} K, ${round1(p.WAR)} WAR`;
    const push = (name: Award["name"], id: number, note: string, pos?: Award["pos"]) =>
      awards.push({ name, league: lg, ...(pos ? { pos } : {}), playerId: id, teamId: teamOf(id), note });
    const top = <T,>(rows: T[], score: (r: T) => number) => [...rows].sort((a, b) => score(b) - score(a))[0];

    // MVP: WAR, a little for the homers and RBI the voters love, and for playing on a contender.
    const hitVote = (h: (typeof hitters)[number]) => h.WAR + h.line.HR / 40 + h.line.RBI / 200 + glow(h.id);
    const bestHitter = top(hitters, hitVote);
    const bestPitcher = top(pitchers, (p) => p.WAR + glow(p.id));
    if (bestHitter && !(bestPitcher && bestPitcher.WAR + glow(bestPitcher.id) > hitVote(bestHitter) + 1)) push("MVP", bestHitter.id, hitterNote(bestHitter));
    else if (bestPitcher) push("MVP", bestPitcher.id, pitcherNote(bestPitcher));

    // Cy Young voters weigh run prevention: WAR plus a nudge for innings and ERA.
    const cy = top(
      pitchers.filter((p) => p.IP >= 100),
      (p) => p.WAR + (4 - p.ERA) * 0.3,
    );
    if (cy) push("Cy Young", cy.id, pitcherNote(cy));

    const rookies = [
      ...hitters.filter((h) => rookie(h.id) && h.PA >= 150).map((h) => ({ id: h.id, war: h.WAR, note: hitterNote(h) })),
      ...pitchers.filter((p) => rookie(p.id) && p.IP >= 40).map((p) => ({ id: p.id, war: p.WAR, note: pitcherNote(p) })),
    ];
    const roy = top(rookies, (r) => r.war);
    if (roy) push("Rookie of the Year", roy.id, roy.note);

    // Reliever of the Year: the voters count saves.
    const relievers = pitchers.filter((p) => p.line.GS < p.line.G / 2 && p.IP >= 40);
    const rel = top(relievers, (p) => p.WAR + p.line.SV * 0.08 + (3 - p.ERA) * 0.3);
    if (rel) push("Reliever of the Year", rel.id, `${rel.line.SV} SV, ${rel.ERA.toFixed(2)} ERA, ${rel.line.SO} K in ${rel.IP.toFixed(1)} IP`);

    // Gold Gloves: the most fielding runs among regulars at each position, with a little for reputation.
    for (const pos of FIELD_POSITIONS) {
      const regulars = hitters.filter((h) => at.get(h.id) === pos && ((season.fielding.lines.get(h.id)?.[`outs${pos}`] as number | undefined) ?? 0) >= 1800);
      const gg = top(regulars, (h) => h.fieldingRuns + (defenseGrade(league.players[h.id]!, pos) - 50) * 0.15);
      if (gg) push("Gold Glove", gg.id, `${gg.fieldingRuns >= 0 ? "+" : ""}${Math.round(gg.fieldingRuns)} fielding runs`, pos);
    }
    // Silver Sluggers: the best bat at each position, homers weighing a little extra.
    for (const pos of [...FIELD_POSITIONS, "DH"] as const) {
      const regulars = hitters.filter((h) => at.get(h.id) === pos && h.PA >= 350);
      const ss = top(regulars, (h) => h.battingRuns + h.line.HR / 5);
      if (ss) push("Silver Slugger", ss.id, `${slash(ss)}, ${ss.line.HR} HR, ${ss.line.RBI} RBI`, pos);
    }
  });

  for (const a of awards) {
    const p = league.players[a.playerId]!;
    p.awards.push(`${league.year} ${league.structure.leagues[a.league]} ${a.name}${a.pos ? ` (${a.pos})` : ""}`);
  }
  return awards;
}

/**
 * Executive of the Year: the front office whose club most outran its payroll
 * and last season, with a bonus for reaching October.
 */
export function executiveAwards(league: League, season: Season): ExecutiveAward[] {
  const last = league.history.at(-1);
  const pay = new Map(league.teams.map((t) => [t.id, payroll(league, t)]));
  const avgPay = [...pay.values()].reduce((a, b) => a + b, 0) / Math.max(1, pay.size);
  const october = new Set(season.postseason?.seeds?.flat() ?? []);
  const lastWins = (id: number) => last?.standings.find((s) => s.teamId === id)?.w;
  const score = (r: { teamId: number; w: number }) => {
    const before = lastWins(r.teamId);
    return (r.w - 81) + (before === undefined ? 0 : 0.6 * (r.w - before)) - 0.12 * (pay.get(r.teamId)! - avgPay) + (october.has(r.teamId) ? 4 : 0);
  };
  return league.structure.leagues.map((_name, lg) => {
    const rows = season.records.filter((r) => league.teams[r.teamId]!.league === lg);
    const best = [...rows].sort((a, b) => score(b) - score(a))[0]!;
    const before = lastWins(best.teamId);
    const change = before === undefined ? "" : `, ${best.w - before >= 0 ? "up" : "down"} ${Math.abs(best.w - before)} from last year`;
    return { league: lg, teamId: best.teamId, note: `${best.w}-${best.l}${change}, on a $${Math.round(pay.get(best.teamId)!)}M payroll` };
  });
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
    executives: executiveAwards(league, season),
    userTeamId: league.userTeamId,
  };
  const g = season.allStar;
  if (g) entry.allStar = { leagues: g.leagues, score: g.score, host: g.host, mvp: g.mvp, note: g.mvpNote };
  league.history.push(entry);
  return entry;
}

export const awardText = (league: League, a: Award): string => {
  const p: Player = league.players[a.playerId]!;
  return `${league.structure.leagues[a.league]} ${a.name}${a.pos ? ` (${a.pos})` : ""}: ${playerName(p)} (${league.teams[a.teamId]?.abbrev ?? "FA"}), ${a.note}`;
};
