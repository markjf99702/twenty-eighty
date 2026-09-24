import { formatPresentFuture, gradeLabel, scoutRound } from "../core/grades";
import type { League, Team } from "../league/types";
import { teamName } from "../league/types";
import { defenseGrade } from "../players/defense";
import { canBeOptioned } from "../org/roster";
import {
  FIELD_POSITIONS,
  MAX_OPTION_YEARS,
  MINOR_LEVELS,
  PITCH_NAMES,
  type Player,
  playerName,
  SERVICE_DAYS_PER_YEAR,
} from "../players/types";
import type { PostseasonResult } from "../season/postseason";
import type { HitterRow, PitcherRow, Season, SeasonStats } from "../season/season";
import type { GameResult } from "../sim/game";
import { inningsPitched } from "../stats/lines";

/**
 * Plain-text renderings for the CLI: standings, leaderboards, awards,
 * postseason, box scores, and scouting cards.
 */

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3).replace(/^(-?)0\./, "$1.") : "---");
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "--");
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "--");
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);

export function formatStandings(season: Season): string {
  const out: string[] = [];
  const { leagues, divisions } = season.league.structure;
  season.standings().forEach((lg, li) => {
    out.push(leagues[li]!.toUpperCase());
    lg.forEach((div, di) => {
      out.push(
        `  ${pad(divisions[di]!, 26)}${lpad("W", 4)}${lpad("L", 4)}${lpad("Pct", 6)}${lpad("GB", 6)}${lpad("RS", 5)}${lpad("RA", 5)}${lpad("Diff", 6)}${lpad("Strk", 6)}${lpad("L10", 6)}`,
      );
      const leader = div[0]!;
      for (const r of div) {
        const t = season.team(r.teamId);
        const gb = r === leader ? "-" : f1(season.gamesBehind(leader, r)).replace(/\.0$/, "");
        const diff = r.rs - r.ra;
        const strk = r.streak > 0 ? `W${r.streak}` : `L${-r.streak}`;
        const l10w = r.last10.filter(Boolean).length;
        out.push(
          `  ${pad(teamName(t), 26)}${lpad(r.w, 4)}${lpad(r.l, 4)}${lpad(f3(season.winPct(r)), 6)}${lpad(gb, 6)}${lpad(r.rs, 5)}${lpad(r.ra, 5)}${lpad((diff > 0 ? "+" : "") + diff, 6)}${lpad(strk, 6)}${lpad(`${l10w}-${r.last10.length - l10w}`, 6)}`,
        );
      }
    });
    out.push("");
  });
  return out.join("\n");
}

export function qualifiedHitters(stats: SeasonStats, season: Season): HitterRow[] {
  const perTeamGames = (2 * season.games.length) / season.league.teams.length;
  return stats.hitters.filter((h) => h.PA >= 3.1 * perTeamGames);
}

export function qualifiedPitchers(stats: SeasonStats, season: Season): PitcherRow[] {
  const perTeamGames = (2 * season.games.length) / season.league.teams.length;
  return stats.pitchers.filter((p) => p.IP >= perTeamGames);
}

function board<T>(title: string, rows: T[], value: (r: T) => number, show: (v: number) => string, label: (r: T) => string, n = 5, asc = false): string {
  const sorted = [...rows].sort((a, b) => (asc ? value(a) - value(b) : value(b) - value(a))).slice(0, n);
  const lines = sorted.map((r, i) => `    ${i + 1}. ${pad(label(r), 30)}${lpad(show(value(r)), 7)}`);
  return [`  ${title}`, ...lines].join("\n");
}

export function formatLeaders(stats: SeasonStats, season: Season): string {
  const qh = qualifiedHitters(stats, season);
  const qp = qualifiedPitchers(stats, season);
  const hl = (h: HitterRow) => `${h.name} (${h.team}, ${h.pos})`;
  const pl = (p: PitcherRow) => `${p.name} (${p.team})`;
  const n = (x: number) => String(Math.round(x));
  return [
    "BATTING LEADERS (qualified where rate-based)",
    board("Batting average", qh, (h) => h.AVG, f3, hl),
    board("Home runs", stats.hitters, (h) => h.line.HR, n, hl),
    board("Runs batted in", stats.hitters, (h) => h.line.RBI, n, hl),
    board("Stolen bases", stats.hitters, (h) => h.line.SB, n, hl),
    board("On-base plus slugging", qh, (h) => h.OPS, f3, hl),
    board("wRC+", qh, (h) => h.wRCplus, n, hl),
    board("xwOBA", qh, (h) => h.xwOBA, f3, hl),
    board("Barrel rate", qh, (h) => 100 * h.barrelPct, f1, hl),
    board("WAR (position players)", stats.hitters, (h) => h.WAR, f1, hl),
    "",
    "PITCHING LEADERS (qualified where rate-based)",
    board("Wins", stats.pitchers, (p) => p.line.W, n, pl),
    board("ERA", qp, (p) => p.ERA, f2, pl, 5, true),
    board("Strikeouts", stats.pitchers, (p) => p.line.SO, n, pl),
    board("Saves", stats.pitchers, (p) => p.line.SV, n, pl),
    board("FIP", qp, (p) => p.FIP, f2, pl, 5, true),
    board("K-BB%", qp, (p) => 100 * p.KminusBB, f1, pl),
    board("WAR (pitchers)", stats.pitchers, (p) => p.WAR, f1, pl),
  ].join("\n");
}

export function formatAwards(stats: SeasonStats, season: Season): string {
  const out = ["AWARDS (by WAR)"];
  season.league.structure.leagues.forEach((name, li) => {
    const inLeague = (abbrev: string) => season.league.teams.find((t) => t.abbrev === abbrev)?.league === li;
    const mvp = [...stats.hitters, ...stats.pitchers]
      .filter((r) => inLeague(r.team))
      .sort((a, b) => b.WAR - a.WAR)[0];
    const cy = stats.pitchers.filter((p) => inLeague(p.team)).sort((a, b) => b.WAR - a.WAR)[0];
    if (mvp) out.push(`  ${name} MVP:        ${mvp.name} (${mvp.team}) - ${f1(mvp.WAR)} WAR`);
    if (cy)
      out.push(
        `  ${name} Cy Young:   ${cy.name} (${cy.team}) - ${cy.line.W}-${cy.line.L}, ${f2(cy.ERA)} ERA, ${cy.line.SO} K, ${f1(cy.WAR)} WAR`,
      );
  });
  return out.join("\n");
}

export function formatPostseason(post: PostseasonResult, season: Season): string {
  const out = ["POSTSEASON"];
  const ab = (id: number) => season.team(id).abbrev;
  for (const s of post.series) {
    const lg = s.league === null ? "" : `${season.league.structure.leagues[s.league]} `;
    const winnerWins = s.winner === s.higher ? s.wins[0] : s.wins[1];
    const loserWins = s.winner === s.higher ? s.wins[1] : s.wins[0];
    const loser = s.winner === s.higher ? s.lower : s.higher;
    const scores = s.games.map((g) => `${ab(g.awayId)} ${g.score[0]}-${g.score[1]} ${ab(g.homeId)}`).join(", ");
    out.push(`  ${pad(lg + s.round, 42)} ${teamName(season.team(s.winner))} def. ${ab(loser)} ${winnerWins}-${loserWins}   [${scores}]`);
  }
  out.push("", `  CHAMPIONS: ${teamName(season.team(post.champion)).toUpperCase()}`);
  return out.join("\n");
}

export function formatContext(stats: SeasonStats): string {
  const c = stats.context;
  const w = c.weights;
  return [
    "LEAGUE CONSTANTS (derived from this season's own run environment)",
    `  R/G ${f2(c.runsPerGame)}   lg AVG/OBP/SLG ${f3(c.lgAvg)}/${f3(c.lgObp)}/${f3(c.lgSlg)}   lg ERA ${f2(c.lgEra)}`,
    `  wOBA weights: BB ${f3(w.BB)}  HBP ${f3(w.HBP)}  1B ${f3(w["1B"])}  2B ${f3(w["2B"])}  3B ${f3(w["3B"])}  HR ${f3(w.HR)}   (scale ${f3(c.wobaScale)}, lg wOBA ${f3(c.lgWoba)})`,
    `  FIP constant ${f2(c.fipConstant)}   HR/FB ${pct(c.lgHrPerFb)}   runs per win ${f2(c.runsPerWin)}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Box score

export function formatBoxScore(r: GameResult, league: League): string {
  const teams = [league.teams[r.awayId]!, league.teams[r.homeId]!];
  const players = league.players;
  const out: string[] = [];
  const innings = Math.max(r.lineScore[0].length, r.lineScore[1].length);
  const head = Array.from({ length: innings }, (_, i) => lpad(i + 1, 3)).join("");
  out.push(`${pad("", 26)}${head}   ${lpad("R", 3)}${lpad("H", 3)}${lpad("E", 3)}`);
  [0, 1].forEach((i) => {
    const line = r.lineScore[i]!;
    const cells = Array.from({ length: innings }, (_, k) => lpad(line[k] ?? "x", 3)).join("");
    out.push(`${pad(teamName(teams[i]!), 26)}${cells}   ${lpad(r.score[i]!, 3)}${lpad(r.hits[i]!, 3)}${lpad(r.errors[i]!, 3)}`);
  });

  [0, 1].forEach((i) => {
    out.push("", `${pad(teamName(teams[i]!), 30)}${lpad("AB", 4)}${lpad("R", 3)}${lpad("H", 3)}${lpad("RBI", 4)}${lpad("BB", 3)}${lpad("K", 3)}  ${lpad("EV", 5)}`);
    const SUB_LABEL = { PH: "PH", PR: "PR", DEF: "DEF", INJ: "sub" } as const;
    for (const slot of r.battingOrder[i]!.flat()) {
      const b = r.batting.get(slot.id);
      const p = players[slot.id]!;
      const ev = b.BBE > 0 ? f1(b.evSum / b.BBE) : "";
      const name = slot.sub ? ` ${SUB_LABEL[slot.sub]}-${playerName(p)} ${slot.pos}` : `${playerName(p)} ${slot.pos}`;
      out.push(
        `  ${pad(name, 28)}${lpad(b.AB, 4)}${lpad(b.R, 3)}${lpad(b.H, 3)}${lpad(b.RBI, 4)}${lpad(b.BB, 3)}${lpad(b.SO, 3)}  ${lpad(ev, 5)}`,
      );
    }
    const extras: string[] = [];
    for (const slot of r.battingOrder[i]!.flat()) {
      const b = r.batting.get(slot.id);
      const name = players[slot.id]!.lastName;
      if (b["2B"]) extras.push(`2B: ${name}${b["2B"] > 1 ? ` ${b["2B"]}` : ""}`);
      if (b["3B"]) extras.push(`3B: ${name}`);
      if (b.HR) extras.push(`HR: ${name}${b.HR > 1 ? ` ${b.HR}` : ""}`);
      if (b.SB) extras.push(`SB: ${name}`);
    }
    if (extras.length) out.push(`  ${extras.join("; ")}`);
  });

  if (r.injuries.length) {
    out.push("", "Injuries: " + r.injuries.map((x) => `${playerName(players[x.playerId]!)} (${x.injury.name}, ~${x.injury.days} days)`).join("; "));
  }

  [0, 1].forEach((i) => {
    out.push("", `${pad(teams[i]!.abbrev + " pitching", 30)}${lpad("IP", 5)}${lpad("H", 3)}${lpad("R", 3)}${lpad("ER", 3)}${lpad("BB", 3)}${lpad("K", 3)}${lpad("HR", 3)}${lpad("P", 5)}`);
    for (const id of r.pitchersUsed[i]!) {
      const p = r.pitching.get(id);
      let tag = "";
      if (r.winningPitcher === id) tag = " (W)";
      else if (r.losingPitcher === id) tag = " (L)";
      else if (r.savePitcher === id) tag = " (S)";
      out.push(
        `  ${pad(playerName(players[id]!) + tag, 28)}${lpad(inningsPitched(p.outs).toFixed(1), 5)}${lpad(p.H, 3)}${lpad(p.R, 3)}${lpad(p.ER, 3)}${lpad(p.BB, 3)}${lpad(p.SO, 3)}${lpad(p.HR, 3)}${lpad(p.pitches, 5)}`,
      );
    }
  });
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Scouting

const g = (x: { present: number; future: number }) => formatPresentFuture(x.present, x.future);

/** 40-man, option and service notes: "40-man, 1 option left, 3.052 service, IL (hamstring strain, 12 days)". */
export function statusNote(p: Player): string {
  const notes: string[] = [];
  if (p.onFortyMan || p.il === "IL60") notes.push("40-man");
  const years = Math.floor(p.service / SERVICE_DAYS_PER_YEAR);
  const days = p.service % SERVICE_DAYS_PER_YEAR;
  if (p.service > 0) notes.push(`${years}.${String(days).padStart(3, "0")} service`);
  if (p.onFortyMan) {
    const left = MAX_OPTION_YEARS - p.options.used;
    notes.push(canBeOptioned(p) ? `${left} option${left === 1 ? "" : "s"} left${p.options.usedThisYear ? " (+this year)" : ""}` : "out of options");
  }
  if (p.il) notes.push(`${p.il}`);
  if (p.injury) notes.push(`${p.injury.name.charAt(0).toLowerCase()}${p.injury.name.slice(1)}, ${p.injury.daysLeft}d`);
  return notes.length ? `  [${notes.join(", ")}]` : "";
}

export function formatHitterCard(p: Player): string {
  const h = p.hitting;
  const best = FIELD_POSITIONS.map((pos) => [pos, defenseGrade(p, pos)] as const)
    .filter(([pos]) => p.positions.includes(pos))
    .map(([pos, grade]) => `${pos} ${scoutRound(grade)}`)
    .join(", ");
  return [
    `${playerName(p)}  ${p.position}  age ${p.age}  B/T ${p.bats}/${p.throws}${statusNote(p)}`,
    `  Hit ${g(h.hit)}  Power ${g(h.power)}  Eye ${g(h.eye)}  Run ${g(h.speed)}  Field ${g(h.field)}  Arm ${g(h.arm)}`,
    `  Defense by position: ${best || "DH only"}   Swing: ${p.traits.launch > 0.5 ? "fly-ball" : p.traits.launch < -0.5 ? "ground-ball" : "balanced"}, ${p.traits.pull > 0.5 ? "pull" : p.traits.pull < -0.5 ? "all-fields" : "neutral"}`,
  ].join("\n");
}

export function formatPitcherCard(p: Player): string {
  const pit = p.pitching!;
  const pitches = pit.pitches.map((x) => `${PITCH_NAMES[x.type]} ${g(x.grade)}`).join(", ");
  return [
    `${playerName(p)}  ${p.role}  age ${p.age}  throws ${p.throws}  FB ${pit.velocity.toFixed(0)} mph${statusNote(p)}`,
    `  ${pitches}`,
    `  Control ${g(pit.control)}  Command ${g(pit.command)}  Stamina ${scoutRound(pit.stamina.present)}`,
  ].join("\n");
}

export function formatTeamScouting(team: Team, league: League): string {
  const P = league.players;
  const out = [`${teamName(team).toUpperCase()} - scouting report (present/future, 20-80)`, "", "LINEUP"];
  for (const pos of FIELD_POSITIONS) out.push(formatHitterCard(P[team.depth.starters[pos]]!));
  out.push(formatHitterCard(P[team.depth.dh]!), "", "BENCH");
  for (const id of team.depth.bench) out.push(formatHitterCard(P[id]!));
  out.push("", "ROTATION");
  for (const id of team.depth.rotation) out.push(formatPitcherCard(P[id]!));
  out.push("", "BULLPEN");
  for (const id of team.depth.bullpen) out.push(formatPitcherCard(P[id]!));
  if (team.injured.length) {
    out.push("", "INJURED LIST");
    for (const id of team.injured) out.push(P[id]!.pitching ? formatPitcherCard(P[id]!) : formatHitterCard(P[id]!));
  }
  for (const level of MINOR_LEVELS) {
    out.push("", `${level} - ${team.affiliates[level].name}`);
    for (const id of team.rosters[level]) {
      const p = P[id]!;
      out.push(p.pitching ? formatPitcherCard(p) : formatHitterCard(p));
    }
  }
  out.push("", `Grade key: 80 ${gradeLabel(80)}, 70 ${gradeLabel(70)}, 60 ${gradeLabel(60)}, 55 ${gradeLabel(55)}, 50 ${gradeLabel(50)}, 45 ${gradeLabel(45)}, 40 ${gradeLabel(40)}, 30 ${gradeLabel(30)}, 20 ${gradeLabel(20)}`);
  return out.join("\n");
}
