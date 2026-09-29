/**
 * View models for the offseason, trades and league history.
 */
import type { League, Team } from "../../../src/league/types";
import { arbCase, arbitrationSalary, orgPlayers, payroll } from "../../../src/org/contracts";
import type { RosterContext } from "../../../src/org/roster";
import { askingPrice, onTheBlock } from "../../../src/org/market";
import { offerLive } from "../../../src/org/offers";
import { evaluateTrade, surplusValue } from "../../../src/org/trades";
import { offerClock } from "../../../src/offseason/offseason";
import { overallGrade } from "../../../src/org/value";
import { boardValue, onTheClock } from "../../../src/offseason/draft";
import { acceptBar, offerScore } from "../../../src/offseason/freeAgency";
import { MAX_INTERNATIONAL_SIGNINGS } from "../../../src/offseason/international";
import { playerName, type Player } from "../../../src/players/types";
import { believedWar, warShift } from "../../../src/scouting/analytics";
import { staffCost, valueShift } from "../../../src/scouting/scouting";
import type { Season } from "../../../src/season/season";
import type { AskingView, BlockRow, DevRow, HistoryView, OffseasonView, OfferView, TradeAdviceView, TradeSide } from "../api/protocol";
import { dateLabel, playerSummary, rosterActions, type StatsCache, teamRef } from "./views";
import { allStarLine, awardRows, executiveRows } from "./allstar";
import { STAFF_TITLES, staffName } from "../../../src/advice/advice";
import { tradeAdvice, tradeAdviceOn } from "../../../src/advice/trades";

const abbrev = (league: League, id: number | null) => (id === null ? "FA" : (league.teams[id]?.abbrev ?? "FA"));

export function offseasonView(season: Season, stats: StatsCache): OffseasonView | null {
  const league = season.league;
  const w = league.offseason;
  if (!w) return null;
  const user = league.userTeamId;
  const team = user !== null ? league.teams[user]! : null;
  const summary = (id: number) => playerSummary(league.players[id]!, season, stats);
  const view: OffseasonView = {
    phase: w.phase,
    year: w.year,
    payroll: team
      ? { payroll: payroll(league, team), staff: staffCost(league, team), budget: team.budget, fortyMan: team.fortyMan.length }
      : { payroll: 0, staff: 0, budget: 0, fortyMan: 0 },
  };

  if (w.phase === "review") {
    const h = league.history.at(-1)!;
    const mine = user !== null ? h.standings.find((r) => r.teamId === user) : undefined;
    const dev = (rows: typeof w.development.risers): DevRow[] =>
      rows
        .filter((r) => league.players[r.playerId]!.teamId !== null)
        .map((r) => ({ player: summary(r.playerId), team: abbrev(league, r.teamId), before: r.before, after: r.after }));
    view.review = {
      champion: h.champion >= 0 ? `${league.teams[h.champion]!.city} ${league.teams[h.champion]!.nickname}` : null,
      awards: awardRows(league, h.awards),
      executives: executiveRows(league, h),
      allStar: allStarLine(league, h.allStar),
      finish: mine?.finish ?? null,
      record: mine ? `${mine.w}-${mine.l}` : null,
      risers: dev(w.development.risers),
      fallers: dev(w.development.fallers),
      retirements: w.development.retirements.map((r) => ({
        playerId: r.playerId,
        name: playerName(league.players[r.playerId]!),
        team: abbrev(league, r.teamId),
        age: r.age,
      })),
      shift: w.shift,
    };
  }

  if (w.phase === "tenders" || w.phase === "review") {
    view.tenders = {
      rows: w.tenders
        .filter((t) => t.teamId === user)
        .map((t) => {
          const p = league.players[t.playerId]!;
          const c = arbCase(p, league.year);
          return {
            player: summary(t.playerId),
            salary: t.salary,
            war: Math.round(believedWar(season, user, p) * 10) / 10,
            tender: t.tender,
            line: c?.line ?? null,
            saves: c && c.sv > 0 ? Math.max(0, t.salary - arbitrationSalary(p, league.year, true)) : 0,
          };
        }),
      expiring: w.expiring.filter((id) => league.players[id]!.teamId === user).map(summary),
    };
  }

  if (w.phase === "draft" && w.draft) {
    const d = w.draft;
    const clock = onTheClock(d);
    const total = d.order.length * d.rounds;
    const myPicks: number[] = [];
    for (let n = d.picks.length; n < total; n++) if (d.order[n % d.order.length] === user) myPicks.push(n + 1);
    // Your board: the class as your scouts see it.
    const seen = (p: Player) => boardValue(p) + valueShift(league, user, p, true);
    const board = [...d.pool]
      .sort((a, b) => seen(b) - seen(a))
      .slice(0, 60)
      .map((p) => ({ ...playerSummary(p, season, stats), school: p.age >= 21 ? ("College" as const) : ("High school" as const) }));
    view.draft = {
      onClock: clock ? { round: clock.round, pick: clock.pick, team: abbrev(league, clock.teamId), mine: clock.teamId === user } : null,
      myPicks,
      board,
      picks: d.picks
        .slice(-40)
        .reverse()
        .map((pk) => {
          const p = league.players[pk.playerId]!;
          return {
            pick: pk.pick,
            round: pk.round,
            team: abbrev(league, pk.teamId),
            playerId: pk.playerId,
            name: playerName(p),
            pos: p.pitching ? (p.role === "SP" ? "SP" : "RP") : p.position,
            fv: overallGrade(p, true),
            mine: pk.teamId === user,
          };
        }),
    };
  }

  if (w.phase === "freeAgency" && w.freeAgency) {
    const fa = w.freeAgency;
    const available = new Set(league.freeAgents);
    view.freeAgency = {
      week: fa.week,
      weeks: fa.weeks,
      agents: fa.asks
        .filter((a) => available.has(a.playerId))
        .map((a) => {
          const p = league.players[a.playerId]!;
          const floor = acceptBar(a, fa.week) / (offerScore({ years: a.years, salary: 1 }));
          return {
            player: summary(a.playerId),
            // What your front office believes he'll be worth.
            war: Math.round(believedWar(season, user, p) * 10) / 10,
            askYears: a.years,
            askSalary: a.salary,
            floor: Math.round(floor * 20) / 20,
          };
        })
        .sort((a, b) => b.war - a.war),
      offers: fa.offers,
      signings: fa.signings
        .slice()
        .reverse()
        .map((x) => ({ playerId: x.playerId, name: playerName(league.players[x.playerId]!), team: abbrev(league, x.teamId), years: x.years, salary: x.salary, week: x.week })),
    };
  }

  if (w.phase === "international" && w.international) {
    const s = w.international;
    const asks = new Map(s.asks.map((a) => [a.playerId, a.bonus]));
    view.international = {
      pool: user !== null ? s.pools[user]! : 0,
      signed: s.signings.filter((x) => x.teamId === user).length,
      maxSignings: MAX_INTERNATIONAL_SIGNINGS,
      prospects: [...s.pool]
        .sort((a, b) => boardValue(b) + valueShift(league, user, b, true) - (boardValue(a) + valueShift(league, user, a, true)))
        .map((p) => ({ ...playerSummary(p, season, stats), bonus: asks.get(p.id) ?? 0 })),
      signings: s.signings
        .slice()
        .reverse()
        .map((x) => ({ playerId: x.playerId, name: playerName(league.players[x.playerId]!), team: abbrev(league, x.teamId), bonus: x.bonus })),
    };
  }
  return view;
}

/** One club's side of the trade desk; with `ctx`, each player carries the roster moves open to him. */
export function tradeSide(season: Season, stats: StatsCache, team: Team, ctx?: RosterContext): TradeSide {
  const league = season.league;
  const players = orgPlayers(league, team)
    .map((p) => ({
      ...playerSummary(p, season, stats, ctx ? rosterActions(p, team, ctx) : undefined),
      surplus: surplusValue(p, 1, warShift(season, league.userTeamId, p)),
    }))
    .sort((a, b) => b.surplus - a.surplus);
  return { team: teamRef(team), players };
}

/** Who clubs out of the race are shopping, best fit for the user's club first. */
export function blockView(season: Season, stats: StatsCache): BlockRow[] {
  const league = season.league;
  const user = league.userTeamId;
  if (user === null) return [];
  return onTheBlock(season, user).map((b) => ({
    ...playerSummary(b.player, season, stats),
    surplus: surplusValue(b.player, 1, warShift(season, user, b.player)),
    club: teamRef(b.team),
    gamesOut: b.gamesOut,
    group: b.group,
    fit: Math.round(b.fit * 10) / 10,
  }));
}

const labeled = (p: Player) => `${p.pitching ? (p.role === "SP" ? "SP" : "RP") : p.position} ${playerName(p)}`;
const listOf = (ps: Player[]) => {
  const names = ps.map(labeled);
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

/** What a club would want from the user's system for these players of theirs. */
export function askingView(season: Season, partnerId: number, get: number[], fraction: number): AskingView {
  const league = season.league;
  const user = league.userTeamId;
  if (user === null) return { ok: false, reason: "Trades are for the club you run." };
  const partner = league.teams[partnerId]!;
  const a = askingPrice(season, league.teams[user]!, partner, get, fraction);
  if (!a.ok) return a;
  const who = get.length === 1 ? playerName(league.players[get[0]!]!) : "them";
  const club = `The ${partner.nickname}`;
  if (a.give.length === 0) {
    return { ok: true, give: [], text: `${club} would let ${who} go for nothing: by their read his contract costs more than he's worth.` };
  }
  return { ok: true, give: a.give.map((p) => p.id), text: `${club} would want ${listOf(a.give)} for ${who}.` };
}

/** The staff's take on a trade, with each note signed by the person in the job (null with staff advice off). */
export function tradeAdviceView(season: Season, give: number[], get: number[], fraction: number): TradeAdviceView | null {
  const league = season.league;
  if (!tradeAdviceOn(league)) return null;
  const a = tradeAdvice(season, give, get, fraction);
  if (!a) return null;
  // One bullet per turn: a staff member's back-to-back points read as one paragraph.
  const notes: TradeAdviceView["notes"] = [];
  let last: string | null = null;
  for (const n of a.notes) {
    const who = `${staffName(league, n.from)}, ${STAFF_TITLES[n.from]}`;
    if (who === last) notes.at(-1)!.text += ` ${n.text}`;
    else notes.push({ who, text: n.text });
    last = who;
  }
  return { ...a, notes };
}

/** Trade offers waiting on the user, with every player as the user's scouts see him. */
export function offerViews(season: Season, stats: StatsCache): OfferView[] {
  const league = season.league;
  const user = league.userTeamId;
  if (user === null) return [];
  const now = offerClock(league, season);
  const fraction = league.offseason ? 1 : Math.max(0, 1 - season.day / season.totalDays);
  const seen = (viewer: number, p: Player) => warShift(season, viewer, p);
  const row = (id: number) => {
    const p = league.players[id]!;
    return { ...playerSummary(p, season, stats), surplus: surplusValue(p, fraction, seen(user, p)) };
  };
  return league.tradeOffers
    .filter((o) => offerLive(league, o, now))
    .map((o) => {
      const partner = league.teams[o.teamId]!;
      const check = evaluateTrade(league, league.teams[user]!, partner, o.give, o.get, fraction, seen);
      return {
        id: o.id,
        team: teamRef(partner),
        kind: o.kind,
        pitch: o.pitch,
        expires: o.expires >= 1000 ? "Until next week" : `Through ${dateLabel(season, o.expires)}`,
        give: o.give.map(row),
        get: o.get.map(row),
        value: { give: check.give, get: check.get },
        ...(check.over ? { over: check.over } : {}),
        advice: tradeAdviceView(season, o.give, o.get, fraction),
      };
    });
}

export function historyView(league: League): HistoryView {
  const user = league.userTeamId;
  const name = (id: number) => `${league.teams[id]!.city} ${league.teams[id]!.nickname}`;
  return {
    seasons: [...league.history].reverse().map((h) => {
      const ws = h.standings.find((r) => r.finish === "Lost World Series");
      const mine = user !== null ? h.standings.find((r) => r.teamId === user) : undefined;
      return {
        year: h.year,
        champion: h.champion >= 0 ? name(h.champion) : "",
        runnerUp: ws ? name(ws.teamId) : null,
        mine: mine ? { record: `${mine.w}-${mine.l}`, finish: mine.finish } : null,
        awards: awardRows(league, h.awards),
        executives: executiveRows(league, h),
        allStar: allStarLine(league, h.allStar),
      };
    }),
  };
}
