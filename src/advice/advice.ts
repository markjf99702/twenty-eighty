import { clamp } from "../core/math";
import { Rng } from "../core/rng";
import { expectedGate, formFactor, referencePrice } from "../finance/finance";
import { settingsOf } from "../league/settings";
import type { AdviceNote, League, Team } from "../league/types";
import { budgetRoom, FREE_AGENT_YEARS, orgPlayers, payroll, serviceYears } from "../org/contracts";
import { gamesOut } from "../org/offers";
import { rosterProblems } from "../org/roster";
import { TRADE_DEADLINE_DAY } from "../org/trades";
import { canStart, overallGrade } from "../org/value";
import { boardValue } from "../offseason/draft";
import { IL_THRESHOLD_DAYS } from "../players/injuries";
import { randomName } from "../players/names";
import { FIELD_POSITIONS, type FieldPosition, type Level, playerName, type Player } from "../players/types";
import { belief, believedWar } from "../scouting/analytics";
import { perceive, staffCost, valueShift } from "../scouting/scouting";
import type { Season } from "../season/season";
import type { BattingLine, PitchingLine } from "../stats/lines";

/**
 * The user's staff: an assistant GM, a scouting director, an analytics
 * director and the business office, each sending a note when there's
 * something worth doing. Every judgment comes from the user's own
 * departments (their scouts' grades and their analysts' reads), not the
 * truth, so a thin scouting staff gives shakier advice. Notes are keyed so
 * the same advice isn't repeated; urgent ones can stop the sim.
 */

export type StaffRole = AdviceNote["from"];

export const STAFF_TITLES: Record<StaffRole, string> = {
  assistant: "Assistant GM",
  scouting: "Scouting director",
  analytics: "Analytics director",
  business: "Business office",
};

/** The people in those jobs for the user's club (stable for the club). */
export function staffName(league: League, role: StaffRole): string {
  const n = randomName(new Rng(`${league.seed}:staff:${league.userTeamId ?? 0}:${role}`));
  return `${n.first} ${n.last}`;
}

const MAX_NOTES = 60;

function add(league: League, now: number, n: Omit<AdviceNote, "year" | "at" | "read">): boolean {
  if (league.advice.some((a) => a.key === n.key)) return false;
  league.advice.push({ ...n, year: league.year, at: now, read: false });
  if (league.advice.length > MAX_NOTES) league.advice.splice(0, league.advice.length - MAX_NOTES);
  return true;
}

const POS_NAMES: Record<FieldPosition | "DH", string> = {
  C: "catcher",
  "1B": "first base",
  "2B": "second base",
  "3B": "third base",
  SS: "shortstop",
  LF: "left field",
  CF: "center field",
  RF: "right field",
  DH: "designated hitter",
};

const pos = (p: Player) => (p.pitching ? (p.role === "SP" ? "SP" : "RP") : p.position);
const tag = (p: Player) => `${pos(p)} ${playerName(p)}`;
const money = (x: number) => (x >= 10 ? `$${x.toFixed(1)}M` : `$${x.toFixed(2)}M`);
const names = (ps: Player[]) => (ps.length <= 2 ? ps.map(tag).join(" and ") : `${ps.slice(0, -1).map(tag).join(", ")} and ${tag(ps.at(-1)!)}`);

/** The user's read of a player now, on the 20-80 scale. */
const ourNow = (season: Season, user: number, p: Player) => Math.round(clamp(50 + belief(season, user, p).value / 2, 20, 80));
const ourFv = (league: League, user: number, p: Player) => overallGrade(perceive(league, user, p), true);

function slash(b: BattingLine | undefined): string | null {
  if (!b || b.PA < 30) return null;
  const tb = b.H + b["2B"] + 2 * b["3B"] + 3 * b.HR;
  const obpDen = b.AB + b.BB + b.HBP + b.SF;
  const f = (x: number) => x.toFixed(3).replace(/^0/, "");
  return `${f(b.H / Math.max(1, b.AB))}/${f((b.H + b.BB + b.HBP) / Math.max(1, obpDen))}/${f(tb / Math.max(1, b.AB))}`;
}

function era(l: PitchingLine | undefined): string | null {
  if (!l || l.outs < 30) return null;
  return `${((27 * l.ER) / l.outs).toFixed(2)} ERA`;
}

function lineFor(season: Season, p: Player): string | null {
  const ls = season.levels[p.level as Level];
  if (!ls) return null;
  return p.pitching ? era(ls.pitching.lines.get(p.id)) : slash(ls.batting.lines.get(p.id));
}

/** A contract that runs out after this season (he can leave as a free agent). */
function expiring(p: Player): boolean {
  const c = p.contract;
  if (!c || c.type === "minor") return false;
  return c.type === "guaranteed" ? c.years <= 1 : serviceYears(p) >= FREE_AGENT_YEARS - 1;
}

interface Spot {
  label: string;
  p: Player;
  /** Believed WAR over a full season, less what a typical regular in that role gives. */
  shortfall: number;
  hitterPos?: FieldPosition | "DH";
  pitcher?: "SP" | "RP";
}

/** Where the user's club is weakest by its own read: each lineup spot, the rotation, the back of the bullpen. */
function weakestSpot(season: Season, team: Team): Spot | null {
  const league = season.league;
  const user = team.id;
  const d = team.depth;
  const spots: Spot[] = [];
  const war = (p: Player) => believedWar(season, user, p);
  for (const position of [...FIELD_POSITIONS, "DH"] as const) {
    const id = position === "DH" ? d.dh : d.starters[position];
    if (id < 0) continue;
    const p = league.players[id]!;
    spots.push({ label: POS_NAMES[position], p, shortfall: war(p) - 2, hitterPos: position });
  }
  for (const id of d.rotation) {
    const p = league.players[id]!;
    spots.push({ label: "the rotation", p, shortfall: war(p) - 2, pitcher: "SP" });
  }
  for (const id of d.bullpen.slice(0, 4)) {
    const p = league.players[id]!;
    spots.push({ label: "the back of the bullpen", p, shortfall: 2.5 * (war(p) - 0.8), pitcher: "RP" });
  }
  return spots.sort((a, b) => a.shortfall - b.shortfall)[0] ?? null;
}

// ---------------------------------------------------------------------------
// The season

/** The end of a season day: whatever the staff has to say. */
export function seasonAdvice(season: Season): void {
  const league = season.league;
  const user = league.userTeamId;
  if (user === null || !settingsOf(league).advice || league.gm?.fired) return;
  const team = league.teams[user]!;
  const day = season.day;
  if (team.manualRoster) housekeeping(season, team, day);
  if (day % 7 === 6 && team.manualRoster) callUps(season, team, day);
  if (day >= 95 && day < TRADE_DEADLINE_DAY && (day % 7 === 6 || day === TRADE_DEADLINE_DAY - 7)) deadline(season, team, day);
  if (day >= 40 && day % 28 === 27) {
    analytics(season, team, day);
    business(season, team, day);
  }
}

/** When the user runs the roster: players hurt on the active roster, and rule problems. */
function housekeeping(season: Season, team: Team, day: number): void {
  const league = season.league;
  for (const id of team.rosters.MLB) {
    const p = league.players[id]!;
    const inj = p.injury;
    if (!inj || inj.daysLeft < IL_THRESHOLD_DAYS) continue;
    add(league, day, {
      key: `il:${p.id}:${league.year}:${inj.startDay}`,
      from: "assistant",
      urgent: true,
      title: `${playerName(p)} belongs on the injured list`,
      text: `${tag(p)} is out about ${inj.daysLeft} days (${inj.name.toLowerCase()}) but still on the active roster. Putting him on the injured list frees his spot for someone who can play.`,
      href: `#player-${p.id}`,
    });
  }
  const problems = rosterProblems(season.rosterContext(), team);
  if (problems.length) {
    add(league, day, {
      key: `roster:${league.year}:${Math.floor(day / 7)}`,
      from: "assistant",
      urgent: true,
      title: "The roster breaks the rules",
      text: `${problems.join(" ")} Fix it on the club page before the next game.`,
      href: `#team-${team.id}`,
    });
  }
}

/** A minor leaguer our read has well ahead of a big-league regular at his spot. */
function callUps(season: Season, team: Team, day: number): void {
  const league = season.league;
  const user = team.id;
  const value = (p: Player) => belief(season, user, p).value;
  const minors = [...team.rosters.AAA, ...team.rosters.AA].map((id) => league.players[id]!).filter((p) => !p.injury);
  let best: { up: Player; down: Player; gain: number } | null = null;
  const consider = (down: Player, pool: Player[]) => {
    for (const up of pool) {
      const gain = value(up) - value(down);
      if (gain >= 10 && (!best || gain > best.gain) && !league.advice.some((a) => a.key === `callup:${up.id}:${league.year}`)) best = { up, down, gain };
    }
  };
  for (const position of FIELD_POSITIONS) {
    const id = team.depth.starters[position];
    if (id < 0) continue;
    consider(league.players[id]!, minors.filter((p) => !p.pitching && (p.position === position || p.positions.includes(position))));
  }
  const rotation = team.depth.rotation.map((id) => league.players[id]!);
  if (rotation.length) {
    const weakest = rotation.reduce((a, b) => (value(a) < value(b) ? a : b));
    consider(weakest, minors.filter((p) => p.pitching && canStart(p)));
  }
  const pick = best as { up: Player; down: Player; gain: number } | null;
  if (!pick) return;
  const upLine = lineFor(season, pick.up);
  const downLine = lineFor(season, pick.down);
  add(league, day, {
    key: `callup:${pick.up.id}:${league.year}`,
    from: "assistant",
    urgent: false,
    title: `Time to call up ${playerName(pick.up)}?`,
    text:
      `Our read has ${pick.up.level === "AAA" ? "Triple-A" : "Double-A"}'s ${tag(pick.up)} (Now ${ourNow(season, user, pick.up)}${upLine ? `, ${upLine}` : ""}) ` +
      `well ahead of ${tag(pick.down)} (Now ${ourNow(season, user, pick.down)}${downLine ? `, ${downLine}` : ""}). Worth a look.`,
    href: `#player-${pick.up.id}`,
  });
}

/** Before the deadline: sell rentals when we're out of it, find the hole to fill when we're in it. */
function deadline(season: Season, team: Team, day: number): void {
  const league = season.league;
  const user = team.id;
  const gb = gamesOut(season, user);
  const lastWeek = day === TRADE_DEADLINE_DAY - 7;
  const suffix = lastWeek ? "-last" : "";
  const when = lastWeek ? "The deadline is a week away." : "The trade deadline is July 31.";
  if (gb >= 7) {
    const vets = orgPlayers(league, team)
      .filter((p) => p.level === "MLB" && !p.injury && p.age >= 26 && believedWar(season, user, p) >= 1)
      .sort((a, b) => believedWar(season, user, b) - believedWar(season, user, a));
    const rentals = vets.filter(expiring).slice(0, 2);
    const pool = rentals.length ? rentals : vets.filter((p) => p.age >= 30).slice(0, 2);
    if (pool.length === 0) return;
    add(league, day, {
      key: `sell${suffix}:${league.year}`,
      from: "scouting",
      urgent: lastWeek,
      title: "Contenders will pay for our veterans",
      text:
        `We're ${gb} games out of a playoff spot. ` +
        (rentals.length
          ? `${names(pool)} can walk as ${pool.length === 1 ? "a free agent" : "free agents"} after the season; contenders would give us young players for ${pool.length === 1 ? "him" : "them"} now. `
          : `Veterans like ${names(pool)} would bring back young players from a contender. `) +
        when,
      href: "#trades",
    });
  } else if (gb <= 3) {
    const spot = weakestSpot(season, team);
    if (!spot) return;
    add(league, day, {
      key: `buy${suffix}:${league.year}`,
      from: "scouting",
      urgent: lastWeek,
      title: `A trade could shore up ${spot.label}`,
      text: `We're ${gb <= 0 ? "in a playoff spot" : `${gb} games out`}. By our read the weakest spot on the club is ${spot.label}: ${tag(spot.p)} (Now ${ourNow(season, user, spot.p)}). That's where a trade helps most. ${when}`,
      href: "#trades",
    });
  }
}

/** The analysts' monthly look: the club's weakest unit, and a player whose results are running ahead of (or behind) how he's played. */
function analytics(season: Season, team: Team, day: number): void {
  const league = season.league;
  const user = team.id;
  const tier = league.scouting.analytics[user]!;
  const stats = season.stats();
  const abbrev = team.abbrev;
  // Units, ranked across the league.
  const byTeam = new Map<string, { pa: number; wrc: number; spIp: number; spEr: number; rpIp: number; rpFip: number }>();
  const get = (k: string) => {
    let v = byTeam.get(k);
    if (!v) byTeam.set(k, (v = { pa: 0, wrc: 0, spIp: 0, spEr: 0, rpIp: 0, rpFip: 0 }));
    return v;
  };
  for (const h of stats.hitters) {
    const t = get(h.team);
    t.pa += h.line.PA;
    t.wrc += h.wRCplus * h.line.PA;
  }
  for (const p of stats.pitchers) {
    const t = get(p.team);
    if (p.line.GS > 0) {
      t.spIp += p.IP;
      t.spEr += p.ERA * p.IP;
    } else {
      t.rpIp += p.IP;
      t.rpFip += p.FIP * p.IP;
    }
  }
  const clubs = [...byTeam.entries()].filter(([k]) => k !== "FA");
  const rank = (score: (v: { pa: number; wrc: number; spIp: number; spEr: number; rpIp: number; rpFip: number }) => number, higherBetter: boolean) => {
    const sorted = [...clubs].sort((a, b) => (higherBetter ? score(b[1]) - score(a[1]) : score(a[1]) - score(b[1])));
    return { rank: sorted.findIndex(([k]) => k === abbrev) + 1, value: score(byTeam.get(abbrev) ?? get(abbrev)) };
  };
  const units = [
    { key: "lineup", name: "lineup", ...rank((v) => v.wrc / Math.max(1, v.pa), true), fmt: (x: number) => `a ${Math.round(x)} wRC+` },
    { key: "rotation", name: "rotation", ...rank((v) => v.spEr / Math.max(1, v.spIp), false), fmt: (x: number) => `a ${x.toFixed(2)} ERA` },
    { key: "bullpen", name: "bullpen", ...rank((v) => v.rpFip / Math.max(1, v.rpIp), false), fmt: (x: number) => `a ${x.toFixed(2)} FIP` },
  ];
  const worst = units.sort((a, b) => b.rank - a.rank)[0]!;
  if (worst.rank >= 24) {
    add(league, day, {
      key: `unit:${worst.key}:${league.year}`,
      from: "analytics",
      urgent: false,
      title: `Our ${worst.name} is the weak link`,
      text: `The ${worst.name} ranks ${worst.rank}th of 30 with ${worst.fmt(worst.value)}. If we add anyone, that's where it counts most.`,
      href: `#team-${team.id}`,
    });
  }
  // Luck: a regular whose results are well off his underlying numbers (the better departments know to look).
  if (tier < 3) return;
  const mine = new Set(orgPlayers(league, team).map((p) => p.id));
  let best: { id: number; gap: number; text: string; title: string } | null = null;
  for (const p of stats.pitchers) {
    if (!mine.has(p.id) || p.IP < 50) continue;
    const gap = p.ERA - p.FIP;
    if (Math.abs(gap) < 1.1 || (best && Math.abs(gap) <= best.gap)) continue;
    const name = playerName(league.players[p.id]!);
    best =
      gap < 0
        ? { id: p.id, gap: Math.abs(gap), title: `${name}'s ERA is running ahead of him`, text: `${name} has a ${p.ERA.toFixed(2)} ERA, but he's pitched more like ${p.FIP.toFixed(2)} (FIP). Expect it to rise; his trade value may never be higher.` }
        : { id: p.id, gap: Math.abs(gap), title: `${name} has pitched better than his ERA`, text: `${name}'s ${p.ERA.toFixed(2)} ERA hides how well he's pitched: a ${p.FIP.toFixed(2)} FIP. He should turn it around, so it's no time to give up on him.` };
  }
  for (const h of stats.hitters) {
    if (!mine.has(h.id) || h.line.PA < 200) continue;
    const gap = h.wOBA - h.xwOBA;
    if (Math.abs(gap) < 0.035 || (best && Math.abs(gap) * 30 <= best.gap)) continue;
    const name = playerName(league.players[h.id]!);
    const f = (x: number) => x.toFixed(3).replace(/^0/, "");
    best =
      gap > 0
        ? { id: h.id, gap: Math.abs(gap) * 30, title: `${name} has been lucky`, text: `${name}'s ${f(h.wOBA)} wOBA is well above what his contact deserves (${f(h.xwOBA)} xwOBA). Expect him to cool off.` }
        : { id: h.id, gap: Math.abs(gap) * 30, title: `${name} has been unlucky`, text: `${name}'s ${f(h.wOBA)} wOBA is well below what his contact deserves (${f(h.xwOBA)} xwOBA). The hits should start falling.` };
  }
  if (best) add(league, day, { key: `luck:${best.id}:${league.year}`, from: "analytics", urgent: false, title: best.title, text: best.text, href: `#player-${best.id}` });
}

/** The business office's monthly note: the gate against the owner's goal, and the budget. */
function business(season: Season, team: Team, day: number): void {
  const league = season.league;
  const f = team.finance;
  const l = f.ledger;
  const gm = league.gm;
  const goal = gm?.goalYear === league.year ? gm.goals.find((g) => g.kind === "attendance") : undefined;
  if (goal && l.homeGames >= 10) {
    const pace = Math.round((l.attendance / l.homeGames) * 81);
    if (pace < goal.target * 0.97) {
      const ref = referencePrice(team);
      const over = f.ticketPrice - ref;
      const rec = season.records[team.id]!;
      // What dropping to the going rate would draw over the rest of the season.
      const cheaper = over > 2 ? Math.round(expectedGate(team, ref, formFactor(rec.w, rec.l)).fans / 81) : 0;
      add(league, day, {
        key: `gate:${league.year}`,
        from: "business",
        urgent: false,
        title: "Attendance is behind the owner's goal",
        text:
          `We're on pace for ${(pace / 1e6).toFixed(2)} million fans against the owner's ${(goal.target / 1e6).toFixed(2)} million.` +
          (over > 2 ? ` Our $${f.ticketPrice} average ticket is $${over} over the going rate; at $${ref} we'd expect about ${cheaper.toLocaleString("en-US")} a game.` : " Winning is the surest fix; a lower ticket price would help too."),
        href: "#finances",
      });
    }
  }
  const spend = payroll(league, team) + staffCost(league, team);
  if (spend > team.budget * 1.02) {
    add(league, day, {
      key: `budget:${league.year}`,
      from: "business",
      urgent: false,
      title: "We're over budget",
      text: `Payroll and the front office come to ${money(spend)} against a ${money(team.budget)} budget. The owner will hold the overage against us at season's end.`,
      href: "#finances",
    });
  }
}

// ---------------------------------------------------------------------------
// The winter

/** At the start of each winter phase, what the staff suggests. `now` is the offer clock. */
export function winterAdvice(league: League, season: Season, now: number): void {
  const user = league.userTeamId;
  const w = league.offseason;
  if (user === null || !w || !settingsOf(league).advice || league.gm?.fired) return;
  const team = league.teams[user]!;
  const war = (p: Player) => believedWar(season, user, p);

  if (w.phase === "review") {
    const mine = w.tenders.filter((t) => t.teamId === user);
    const cut = mine.filter((t) => t.tender && Math.max(0, war(league.players[t.playerId]!)) * 8 < 0.8 * t.salary).slice(0, 3);
    const keep = mine.filter((t) => !t.tender && Math.max(0, war(league.players[t.playerId]!)) * 8 > 1.3 * t.salary).slice(0, 3);
    if (cut.length || keep.length) {
      const P = (id: number) => league.players[id]!;
      const parts: string[] = [];
      if (cut.length) parts.push(`By our read, ${cut.map((t) => `${tag(P(t.playerId))} (${money(t.salary)} for about ${Math.max(0, war(P(t.playerId))).toFixed(1)} wins)`).join(", ")} ${cut.length === 1 ? "costs" : "cost"} more than ${cut.length === 1 ? "he's" : "they're"} worth in arbitration; consider non-tendering.`);
      if (keep.length) parts.push(`${keep.map((t) => tag(P(t.playerId))).join(", ")} ${keep.length === 1 ? "is" : "are"} marked to be non-tendered, but we think ${keep.length === 1 ? "he's" : "they're"} worth the raise.`);
      add(league, now, { key: `tender:${league.year}`, from: "assistant", urgent: false, title: "Arbitration decisions", text: parts.join(" "), href: "#winter" });
    }
  }

  if (w.phase === "draft" && w.draft) {
    const d = w.draft;
    const total = d.order.length * d.rounds;
    const picks: number[] = [];
    for (let n = d.picks.length; n < total && picks.length < 2; n++) if (d.order[n % d.order.length] === user) picks.push(n + 1);
    const board = [...d.pool].sort((a, b) => boardValue(b) + valueShift(league, user, b, true) - (boardValue(a) + valueShift(league, user, a, true))).slice(0, 3);
    if (board.length) {
      add(league, now, {
        key: `draft:${league.year}`,
        from: "scouting",
        urgent: false,
        title: "Our draft board",
        text: `The top of our board: ${board.map((p) => `${tag(p)} (${p.age >= 21 ? "college" : "high school"}, FV ${ourFv(league, user, p)})`).join(", ")}. ${picks.length ? `We pick ${picks.map((n) => `#${n}`).join(" and ")} overall.` : ""}`.trim(),
        href: "#winter",
      });
    }
  }

  if (w.phase === "freeAgency" && w.freeAgency) {
    const spot = weakestSpot(season, team);
    const available = new Set(league.freeAgents);
    const asks = new Map(w.freeAgency.asks.map((a) => [a.playerId, a]));
    const fits = spot
      ? w.freeAgency.asks
          .map((a) => league.players[a.playerId]!)
          .filter((p) => available.has(p.id))
          .filter((p) =>
            spot.hitterPos
              ? !p.pitching && (spot.hitterPos === "DH" || p.position === spot.hitterPos || p.positions.includes(spot.hitterPos as FieldPosition))
              : Boolean(p.pitching) && (spot.pitcher === "SP" ? canStart(p) : !canStart(p) || p.role === "RP"),
          )
          .filter((p) => war(p) > war(spot.p) + 0.5)
          .sort((a, b) => war(b) - war(a))
          .slice(0, 2)
      : [];
    const room = budgetRoom(league, team);
    if (spot) {
      add(league, now, {
        key: `fa:${league.year}`,
        from: "scouting",
        urgent: false,
        title: `Our biggest hole: ${spot.label}`,
        text:
          `By our read ${spot.label} is the weakest spot on the club (${tag(spot.p)}, Now ${ourNow(season, user, spot.p)}). ` +
          (fits.length
            ? `Best fits on the market: ${fits.map((p) => `${tag(p)} (about ${war(p).toFixed(1)} wins, asking ${money(asks.get(p.id)!.salary)} for ${asks.get(p.id)!.years} yr)`).join("; ")}. `
            : "Nobody on the market is a clear upgrade; a trade may be the way. ") +
          (room > 0 ? `We have ${money(room)} of room under the budget.` : `We're ${money(-room)} over the budget already.`),
        href: "#winter",
      });
    }
  }

  if (w.phase === "international" && w.international) {
    const s = w.international;
    const bonus = new Map(s.asks.map((a) => [a.playerId, a.bonus]));
    const pool = s.pools[user]!;
    const top = [...s.pool]
      .filter((p) => (bonus.get(p.id) ?? 99) <= pool)
      .sort((a, b) => boardValue(b) + valueShift(league, user, b, true) - (boardValue(a) + valueShift(league, user, a, true)))
      .slice(0, 2);
    if (top.length) {
      add(league, now, {
        key: `intl:${league.year}`,
        from: "scouting",
        urgent: false,
        title: "International signing period",
        text: `We have ${money(pool)} to spend. Our scouts like ${top.map((p) => `${tag(p)} (FV ${ourFv(league, user, p)}, asking ${money(bonus.get(p.id)!)})`).join(" and ")}.`,
        href: "#winter",
      });
    }
  }
}

/** Notes the user hasn't looked at yet. */
export const unreadAdvice = (league: League) => league.advice.filter((a) => !a.read).length;
