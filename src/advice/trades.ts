import { clamp } from "../core/math";
import type { League, Team } from "../league/types";
import { budgetRoom, FREE_AGENT_YEARS, serviceYears } from "../org/contracts";
import { gamesOut } from "../org/offers";
import { surplusValue } from "../org/trades";
import { isProspect, overallGrade } from "../org/value";
import { FIELD_POSITIONS, type FieldPosition, type Level, playerName, type Player } from "../players/types";
import { belief, believedWar, warShift } from "../scouting/analytics";
import { ANALYTICS_TIERS, perceive, uncertainty } from "../scouting/scouting";
import type { Season } from "../season/season";
import { hitterAdvanced, pitcherAdvanced } from "../stats/advanced";
import type { StaffRole } from "./advice";

/**
 * What the user's staff makes of a trade: the assistant GM's verdict and why
 * (value, this season, fit, money), the scouting director on how well they
 * know the players, and the analytics director on numbers that disagree with
 * the scouts. Everything comes from the club's own beliefs, so it's only as
 * good as its scouting and analytics departments, and it says how sure it is.
 */

export type Confidence = "high" | "medium" | "low";

export interface TradeNote {
  from: StaffRole;
  text: string;
}

export interface TradeAdvice {
  verdict: "take" | "consider" | "pass";
  headline: string;
  /** How sure the staff is about the players coming in. */
  confidence: Confidence;
  notes: TradeNote[];
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
const LEVEL_WORDS: Record<Level, string> = { MLB: "the majors", AAA: "Triple-A", AA: "Double-A", "A+": "High-A", A: "Single-A" };

const money = (x: number) => (Math.abs(x) >= 10 ? `$${Math.abs(x).toFixed(1)}M` : `$${Math.abs(x).toFixed(2)}M`);
const wins = (x: number) => `${Math.abs(x).toFixed(1)} win${Math.abs(x).toFixed(1) === "1.0" ? "" : "s"}`;
const tag = (p: Player) => `${p.pitching ? (p.role === "SP" ? "SP" : "RP") : p.position} ${playerName(p)}`;
/** Scouting confidence from the typical error in grade points (as on the player page). */
const confidenceOf = (sigma: number): Confidence => (sigma <= 2.5 ? "high" : sigma <= 4.5 ? "medium" : "low");
const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

export function tradeAdvice(season: Season, give: number[], get: number[], fraction: number): TradeAdvice | null {
  const league = season.league;
  const user = league.userTeamId;
  if (user === null || give.length + get.length === 0) return null;
  const team = league.teams[user]!;
  const P = (id: number) => league.players[id]!;
  const ins = get.map(P);
  const outs = give.map(P);
  const war = (p: Player) => believedWar(season, user, p);
  const surplus = (p: Player) => surplusValue(p, fraction, warShift(season, user, p));
  const notes: TradeNote[] = [];

  // Value, by our read.
  const getV = ins.reduce((s, p) => s + surplus(p), 0);
  const giveV = outs.reduce((s, p) => s + surplus(p), 0);
  const net = getV - giveV;
  const scale = Math.max(Math.abs(getV), Math.abs(giveV), 5);
  const edge = Math.max(2, 0.1 * scale);
  let verdict: TradeAdvice["verdict"] = net >= edge ? "take" : net <= -edge ? "pass" : "consider";

  // This season: wins over what's left of it, from big leaguers healthy enough to play.
  const inSeason = !league.offseason && season.day < season.totalDays;
  const left = (p: Player) => (p.level === "MLB" ? Math.max(0, fraction - (p.injury?.daysLeft ?? 0) / season.totalDays) : 0);
  const now = inSeason ? ins.reduce((s, p) => s + war(p) * left(p), 0) - outs.reduce((s, p) => s + war(p) * left(p), 0) : 0;
  const gb = inSeason ? gamesOut(season, user) : 0;
  const contending = inSeason && gb <= 4;
  // In a race, this season counts: a contender can pay a little for help now, and shouldn't give it away for a little.
  let race: "helps" | "hurts" | null = null;
  if (contending && verdict === "pass" && now >= 0.6 && net > -0.25 * scale) [verdict, race] = ["consider", "helps"];
  else if (contending && verdict === "consider" && now <= -0.6) [verdict, race] = ["pass", "hurts"];

  const headline =
    race === "helps"
      ? `Short by our read (about ${money(net)} their way), but it makes us about ${wins(now)} better while we're in the race.`
      : race === "hurts"
        ? `Pass for now. It's close by our read, but it costs us about ${wins(now)} while we're in the race.`
        : verdict === "take"
      ? `Take it. By our read you get about ${money(net)} more in value than you give.`
      : verdict === "pass"
        ? `Pass. By our read you'd give up about ${money(net)} more than you get.`
        : net >= 0
          ? `Close to even by our read (about ${money(net)} our way). It comes down to what we need.`
          : `A little short by our read (about ${money(net)} their way), but close enough to think about.`;

  if (inSeason && Math.abs(now) >= 0.2) {
    const race = gb <= 0 ? "we're holding a playoff spot" : gb <= 4 ? `we're ${gb} game${gb === 1 ? "" : "s"} out of a playoff spot` : "";
    const why = race ? `, and ${race}` : gb >= 8 ? `, but at ${gb} games out the seasons after this one matter more` : "";
    notes.push({ from: "assistant", text: `For the rest of this season it makes us about ${wins(now)} ${now > 0 ? "better" : "worse"}${why}.` });
  }

  // Where the newcomers fit, and who fills in for the players leaving.
  const depth = team.depth;
  const going = new Set(give);
  for (const p of [...ins].filter((q) => q.level === "MLB" || war(q) >= 1).sort((a, b) => war(b) - war(a)).slice(0, 2)) {
    const fit = fitOf(season, team, p, going, war);
    if (fit) notes.push({ from: "assistant", text: fit });
  }
  for (const o of outs) {
    const pos = startingSpot(depth, o.id);
    if (!pos) continue;
    const next = nextUp(season, team, pos, new Set([...give, o.id]), war);
    notes.push({
      from: "assistant",
      text: `Trading ${playerName(o)} opens ${pos === "rotation" ? "a rotation spot" : POS_NAMES[pos]}; ${
        next ? `next up is ${tag(next)}, ${fillIn(war(next))}` : "we'd need someone from outside"
      }.`,
    });
    break;
  }
  for (const p of ins) {
    if (p.injury && p.injury.daysLeft > 0) notes.push({ from: "assistant", text: `${playerName(p)} is hurt (${p.injury.name.toLowerCase()}, about ${p.injury.daysLeft} days to go).` });
    else if (inSeason && rental(p)) notes.push({ from: "assistant", text: `${playerName(p)} can be a free agent after the season, so he's a rental.` });
  }

  // Money.
  const thisYear = inSeason ? fraction : 1;
  const salary = (p: Player) => (p.contract && p.contract.type !== "minor" ? p.contract.salary : 0);
  const payroll = (ins.reduce((s, p) => s + salary(p), 0) - outs.reduce((s, p) => s + salary(p), 0)) * thisYear;
  const future = (ps: Player[]) => ps.reduce((s, p) => s + (p.contract?.type === "guaranteed" ? p.contract.salary * Math.max(0, p.contract.years - 1) : 0), 0);
  const later = future(ins) - future(outs);
  if (Math.abs(payroll) >= 0.25 || Math.abs(later) >= 1) {
    const room = budgetRoom(league, team);
    const parts: string[] = [];
    const over = room <= 0.05 ? ", and we're already at the budget" : payroll > room ? `, more than the ${money(room)} of room in the budget` : "";
    if (payroll >= 0.25) parts.push(`It adds about ${money(payroll)} to ${inSeason ? "what's left of this year's" : "next year's"} payroll${over}`);
    else if (payroll <= -0.25) parts.push(`It saves about ${money(payroll)} ${inSeason ? "over the rest of this year" : "next year"}`);
    if (Math.abs(later) >= 1) parts.push(`${parts.length ? "and" : "It"} ${later > 0 ? "adds" : "takes"} ${money(later)} ${later > 0 ? "to" : "off"} what we owe in later years`);
    notes.push({ from: "business", text: `${parts.join(" ")}.` });
  }

  // Scouting: how well we know who's coming.
  let confidence: Confidence = "high";
  const looks = league.scouting.looks;
  for (const p of [...ins].sort((a, b) => surplus(b) - surplus(a)).slice(0, 2)) {
    const sigma = uncertainty(league, user, p);
    const c = confidenceOf(sigma);
    if (RANK[c] > RANK[confidence]) confidence = c;
    // A prospect in grades (what he'll become); anyone established in wins a season.
    let read: string;
    if (isProspect(p)) {
      const nowGrade = Math.round(clamp(50 + belief(season, user, p).value / 2, 20, 80));
      const fv = Math.max(nowGrade, overallGrade(perceive(league, user, p), true));
      const where = p.level === "MLB" ? "" : ` in ${LEVEL_WORDS[p.level]}`;
      read = `${nowGrade} now and ${fv} at his peak${where}`;
    } else read = `about ${believedWar(season, user, p).toFixed(1)} WAR a season`;
    const seen = looks[p.id] ?? 0;
    const text =
      c === "high"
        ? `We know ${playerName(p)} well: ${read}.`
        : c === "medium"
          ? `We've seen enough of ${playerName(p)} to be fairly sure: ${read}.`
          : `Our read on ${playerName(p)} is thin (${seen ? `${seen} look${seen === 1 ? "" : "s"}` : "we haven't sent anyone"}): we have him at ${read}, give or take a lot. A look from a scout would firm it up.`;
    notes.push({ from: "scouting", text });
  }

  // Analytics: numbers that disagree with the scouts.
  if (inSeason) {
    const tier = league.scouting.analytics[user]!;
    for (const p of [...ins, ...outs]) {
      const note = tier >= 3 ? luck(season, p) : null;
      if (note) {
        notes.push({ from: "analytics", text: note });
        break;
      }
      const b = belief(season, user, p);
      if (tier < 3 && b.analytics && b.analytics.reliability >= 0.3 && Math.abs(b.analytics.value - b.scouts) >= 8) {
        notes.push({
          from: "analytics",
          text: `By ${ANALYTICS_TIERS[tier - 1]!.basis}, ${playerName(p)} has played ${b.analytics.value > b.scouts ? "better" : "worse"} than our scouts rate him. We're a small group, so we can't tell how much of that is luck.`,
        });
        break;
      }
    }
  }

  return { verdict, headline, confidence, notes: notes.slice(0, 6) };
}

/** A contract that runs out after this season. */
function rental(p: Player): boolean {
  const c = p.contract;
  if (!c || c.type === "minor") return false;
  return c.type === "guaranteed" ? c.years <= 1 : serviceYears(p) >= FREE_AGENT_YEARS - 1;
}

type Spot = FieldPosition | "DH" | "rotation";

/** The lineup spot or rotation turn a player holds on the depth chart, if any. */
function startingSpot(depth: Team["depth"], id: number): Spot | null {
  for (const pos of FIELD_POSITIONS) if (depth.starters[pos] === id) return pos;
  if (depth.dh === id) return "DH";
  if (depth.rotation.includes(id)) return "rotation";
  return null;
}

/** Where a newcomer would play, against who's there now. */
function fitOf(season: Season, team: Team, p: Player, going: Set<number>, war: (p: Player) => number): string | null {
  const league = season.league;
  const d = team.depth;
  const others = (ids: number[]) => ids.filter((id) => id >= 0 && !going.has(id)).map((id) => league.players[id]!);
  if (p.pitching) {
    if (p.role === "SP") {
      const weakest = others(d.rotation).sort((a, b) => war(a) - war(b))[0];
      if (!weakest) return `${tag(p)} would go straight into the rotation.`;
      return war(p) > war(weakest) + 0.3
        ? `${tag(p)} would take ${playerName(weakest)}'s turn in the rotation.`
        : `${tag(p)} wouldn't beat out ${playerName(weakest)} for a rotation spot.`;
    }
    const pen = others(d.bullpen.slice(0, 4)).sort((a, b) => war(a) - war(b))[0];
    if (!pen) return null;
    return war(p) > war(pen) + 0.2
      ? `${tag(p)} would pitch late in games ahead of ${playerName(pen)}.`
      : `${tag(p)} would be a middle reliever for us.`;
  }
  const pos = p.position as FieldPosition;
  const incumbentId = FIELD_POSITIONS.includes(pos) ? d.starters[pos] : d.dh;
  const incumbent = incumbentId >= 0 && !going.has(incumbentId) ? league.players[incumbentId]! : null;
  const where = POS_NAMES[pos] ?? "designated hitter";
  if (!incumbent) return `${tag(p)} would start at ${where}.`;
  return war(p) > war(incumbent) + 0.4
    ? `${tag(p)} would start at ${where} over ${playerName(incumbent)}.`
    : `${tag(p)} would be behind ${playerName(incumbent)} at ${where}.`;
}

/** Who'd take over a spot: the best healthy player in the upper levels who can play it. */
/** How much a fill-in would give us, in words when it isn't much. */
function fillIn(w: number): string {
  if (w < 0.2) return "and we don't think he's an everyday answer";
  return `worth about ${w.toFixed(1)} wins a season by our read`;
}

function nextUp(season: Season, team: Team, spot: Spot, gone: Set<number>, war: (p: Player) => number): Player | null {
  const league = season.league;
  const pool = [...team.rosters.MLB, ...team.rosters.AAA]
    .filter((id) => !gone.has(id))
    .map((id) => league.players[id]!)
    .filter((p) => !(p.injury && p.injury.daysLeft > 0));
  const fits = pool.filter((p) =>
    spot === "rotation" ? p.pitching && p.role === "SP" && !team.depth.rotation.includes(p.id) : !p.pitching && (spot === "DH" || p.position === spot || p.positions.includes(spot)) && startingSpot(team.depth, p.id) === null,
  );
  return fits.sort((a, b) => war(b) - war(a))[0] ?? null;
}

/** An ERA far from FIP, or a wOBA far from xwOBA: the analysts' warning that luck is in the numbers. */
function luck(season: Season, p: Player): string | null {
  if (p.level !== "MLB") return null;
  const ctx = season.context(p.level);
  if (p.pitching) {
    const line = season.levels[p.level].pitching.lines.get(p.id);
    if (!line || line.outs < 60) return null;
    const a = pitcherAdvanced(line, 1, ctx);
    if (a.ERA < a.FIP - 0.8) return `${playerName(p)}'s ${a.ERA.toFixed(2)} ERA is well ahead of his ${a.FIP.toFixed(2)} FIP: expect some of that to come back.`;
    if (a.ERA > a.FIP + 0.8) return `${playerName(p)}'s ${a.ERA.toFixed(2)} ERA hides a ${a.FIP.toFixed(2)} FIP: he's pitched better than it looks.`;
    return null;
  }
  const line = season.levels[p.level].batting.lines.get(p.id);
  if (!line || line.PA < 100) return null;
  const a = hitterAdvanced(line, undefined, 1, ctx);
  const f = (x: number) => x.toFixed(3).replace(/^0/, "");
  if (a.wOBA > a.xwOBA + 0.03) return `${playerName(p)}'s ${f(a.wOBA)} wOBA is ahead of his ${f(a.xwOBA)} xwOBA: some of that hitting is luck.`;
  if (a.wOBA < a.xwOBA - 0.03) return `${playerName(p)} has hit into bad luck: a ${f(a.wOBA)} wOBA on a ${f(a.xwOBA)} xwOBA.`;
  return null;
}

/** Whether the staff has anything to say at all. */
export const tradeAdviceOn = (league: League) => league.userTeamId !== null && league.settings?.advice !== false && !league.gm?.fired;
