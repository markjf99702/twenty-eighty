/**
 * The simulation runs here, off the UI thread. The page sends typed requests
 * (see api/protocol.ts); this worker owns the League and Season, answers with
 * view models, and autosaves to IndexedDB.
 */
import { bestTicketPrice } from "../../../src/finance/finance";
import { acceptJob, hireGm } from "../../../src/finance/owner";
import { generateLeague } from "../../../src/league/generate";
import type { DepthChart, League, Team } from "../../../src/league/types";
import {
  activateFromIl,
  addToFortyMan,
  assignMinors,
  callUp,
  designateForAssignment,
  optionPlayer,
  placeOnIl,
  refreshDepth,
  releasePlayer,
  type RosterContext,
  type RosterResult,
} from "../../../src/org/roster";
import { payroll } from "../../../src/org/contracts";
import { evaluateTrade, executeTrade } from "../../../src/org/trades";
import { warShift } from "../../../src/scouting/analytics";
import {
  ANALYTICS_TIERS,
  FAMILIARITY,
  looksAllowance,
  looksLeft,
  SCOUTING_TIERS,
  staffCost,
  takeLook,
} from "../../../src/scouting/scouting";
import { overallGrade } from "../../../src/org/value";
import { makePick, simDraft } from "../../../src/offseason/draft";
import { validateOffer } from "../../../src/offseason/freeAgency";
import { signInternational } from "../../../src/offseason/international";
import { advanceOffseason, beginOffseason, WINTER_DAYS, winterContext, winterWeek } from "../../../src/offseason/offseason";
import { FIELD_POSITIONS, MINOR_LEVELS, type Level } from "../../../src/players/types";
import { deserialize, loadGame, saveGame, serialize } from "../../../src/save/save";
import { runPostseason } from "../../../src/season/postseason";
import { Season } from "../../../src/season/season";
import type {
  Api,
  ApiName,
  BoxScoreView,
  NewGameTeam,
  RequestMessage,
  ResponseMessage,
  ScoresView,
  ScoutingView,
  StatsView,
} from "../api/protocol";
import { clearSave, hasSave, readSave, writeSave } from "./storage";
import { financeView, ownerView } from "./business";
import { historyView, offseasonView, tradeSide } from "./winter";
import {
  boxScoreView,
  dashboardView,
  dateLabel,
  gameItems,
  playerView,
  postseasonView,
  StatsCache,
  standingsView,
  status,
  teamRef,
  teamView,
  transactions,
} from "./views";

// The DOM lib types `self` as a Window; inside this worker it's the worker scope.
declare const self: {
  postMessage(msg: ResponseMessage): void;
  onmessage: ((e: MessageEvent<RequestMessage>) => void) | null;
};

let league: League | null = null;
let season: Season | null = null;
let preview: { seed: string; league: League } | null = null;
let saveExists = false;
let simulating = false;
let stopRequested = false;

/** Box scores for the last week of MLB games, plus every game the user's club plays. */
const boxes = new Map<string, BoxScoreView>();
const BOX_DAYS = 7;
const stats = new StatsCache(() => requireSeason());

function requireSeason(): Season {
  if (!season) throw new Error("No game in progress.");
  return season;
}

/** Roster rules as of today: the season's, or the winter's (no options used, 26-man limit). */
function ctx(): RosterContext {
  const s = requireSeason();
  const w = s.league.offseason;
  return w ? winterContext(s.league, w.phase) : s.rosterContext();
}

function winter() {
  const w = requireSeason().league.offseason;
  if (!w) throw new Error("It isn't the offseason.");
  return w;
}

function userTeam(): Team {
  const s = requireSeason();
  const id = s.league.userTeamId;
  if (id === null) throw new Error("You don't manage a club.");
  return s.team(id);
}

function attach(s: Season): void {
  boxes.clear();
  stats.clear();
  let lastPruned = -1;
  s.onGame = (level, result, day) => {
    if (level !== "MLB") return;
    const box = boxScoreView(s, result, day);
    boxes.set(box.key, box);
    if (day !== lastPruned) {
      lastPruned = day;
      const user = s.league.userTeamId;
      for (const [key, b] of boxes) {
        const d = Number(key.split("-")[0]);
        const mine = b.teams.some((t) => t.id === user);
        if (d < day - BOX_DAYS && !mine) boxes.delete(key);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Saving

async function persist(): Promise<void> {
  if (!league) return;
  saveExists = await writeSave(serialize(saveGame(league, season)));
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Coalesce saves after small changes (roster moves, depth edits). */
function persistSoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 800);
}

function restore(text: string): void {
  const loaded = loadGame(deserialize(text));
  if (!loaded.season) throw new Error("That save has no season in progress.");
  league = loaded.league;
  season = loaded.season;
  attach(season);
}

const currentStatus = () => status(league, season, saveExists);

// ---------------------------------------------------------------------------
// New game

function average(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function previewTeams(l: League): NewGameTeam[] {
  return l.teams.map((t) => {
    const mlb = t.rosters.MLB.map((id) => overallGrade(l.players[id]!)).sort((a, b) => b - a);
    const farm = MINOR_LEVELS.flatMap((lv) => t.rosters[lv])
      .map((id) => overallGrade(l.players[id]!, true))
      .sort((a, b) => b - a)
      .slice(0, 10);
    return {
      ...teamRef(t),
      park: t.park.name,
      altitude: t.park.altitude,
      market: t.market,
      strength: Math.round(10 * average(mlb.slice(0, 13))) / 10,
      farm: Math.round(10 * average(farm)) / 10,
    };
  });
}

function leagueFor(seed: string): League {
  if (!preview || preview.seed !== seed) preview = { seed, league: generateLeague({ seed }) };
  return preview.league;
}

// ---------------------------------------------------------------------------
// Roster moves

function waiverOrder(s: Season): Team[] {
  return [...s.records].sort((a, b) => s.compare(b, a)).map((r) => s.team(r.teamId));
}

function applyRosterAction(req: Api["rosterAction"]["req"]): RosterResult {
  const s = requireSeason();
  const team = userTeam();
  const p = s.league.players[req.playerId];
  if (!p || p.teamId !== team.id) return { ok: false, reason: "He isn't in your organization." };
  const c = ctx();
  switch (req.kind) {
    case "callUp":
      return callUp(c, team, p);
    case "option":
      return optionPlayer(c, team, p, req.level ?? "AAA");
    case "dfa":
      return designateForAssignment(c, team, p, waiverOrder(s));
    case "placeIl":
      return placeOnIl(c, team, p);
    case "activate":
      return activateFromIl(c, team, p, "MLB");
    case "activateToMinors":
      return activateFromIl(c, team, p, req.level ?? "AAA");
    case "assign":
      return req.level ? assignMinors(c, team, p, req.level) : { ok: false, reason: "Pick a level." };
    case "add40":
      return addToFortyMan(c, team, p);
    case "release":
      return releasePlayer(c, team, p);
  }
}

function validDepth(team: Team, league: League, d: DepthChart): string | null {
  const active = new Set(team.rosters.MLB);
  const isPitcher = (id: number) => Boolean(league.players[id]?.pitching);
  const lineup = [...FIELD_POSITIONS.map((pos) => d.starters[pos]), d.dh];
  if (lineup.some((id) => !active.has(id) || isPitcher(id))) return "Every lineup spot needs an active position player.";
  if (new Set(lineup).size !== lineup.length) return "A player can only fill one lineup spot.";
  if (d.rotation.length === 0 || d.rotation.some((id) => !active.has(id) || !isPitcher(id))) return "The rotation needs active pitchers.";
  if (new Set(d.rotation).size !== d.rotation.length) return "A pitcher can only hold one rotation spot.";
  return null;
}

// ---------------------------------------------------------------------------
// Handlers

type Progress = (day: number, total: number) => void;
type Handlers = { [K in ApiName]: (req: Api[K]["req"], progress: Progress) => Api[K]["res"] | Promise<Api[K]["res"]> };

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function qualifying(s: Season, level: Level): { pa: number; ip: number } {
  const recs = s.levels[level].records;
  const games = recs.length ? recs.reduce((a, r) => a + r.w + r.l, 0) / recs.length : 0;
  return { pa: Math.round(3.1 * games), ip: Math.round(games) };
}

const handlers: Handlers = {
  async status() {
    if (!league) saveExists = await hasSave();
    return currentStatus();
  },

  newGameTeams({ seed }) {
    return previewTeams(leagueFor(seed));
  },

  async newGame({ seed, teamId, minors }) {
    const l = leagueFor(seed);
    preview = null;
    hireGm(l, teamId);
    league = l;
    season = new Season(l, { minors });
    attach(season);
    await persist();
    return currentStatus();
  },

  async load() {
    const text = await readSave();
    if (!text) throw new Error("No saved game found.");
    restore(text);
    saveExists = true;
    return currentStatus();
  },

  async importSave({ text }) {
    restore(text);
    await persist();
    return currentStatus();
  },

  exportSave() {
    if (!league) throw new Error("No game in progress.");
    return serialize(saveGame(league, season));
  },

  async deleteSave() {
    await clearSave();
    league = null;
    season = null;
    boxes.clear();
    stats.clear();
    saveExists = false;
    return currentStatus();
  },

  async sim({ days }, progress) {
    const s = requireSeason();
    if (simulating) throw new Error("Already simulating.");
    simulating = true;
    stopRequested = false;
    try {
      const start = s.day;
      const target = days === "end" ? s.totalDays : Math.min(s.totalDays, s.day + days);
      while (s.day < target && !stopRequested) {
        s.simDay();
        progress(s.day - start, target - start);
        await pause();
      }
    } finally {
      simulating = false;
    }
    await persist();
    return currentStatus();
  },

  stop() {
    stopRequested = true;
    return { ok: simulating };
  },

  async playoffs() {
    const s = requireSeason();
    if (!s.done) throw new Error("The regular season isn't over yet.");
    if (!s.postseason) runPostseason(s);
    await persist();
    return currentStatus();
  },

  dashboard() {
    return dashboardView(requireSeason(), stats, boxes, currentStatus());
  },

  standings({ level }) {
    return standingsView(requireSeason(), level);
  },

  team({ teamId }) {
    return teamView(requireSeason(), stats, teamId, ctx());
  },

  player({ playerId }) {
    return playerView(requireSeason(), stats, playerId, ctx());
  },

  stats({ level, kind }): StatsView {
    const s = requireSeason();
    const { stats: st } = stats.get(level);
    const c = st.context;
    const q = qualifying(s, level);
    return {
      level,
      kind,
      qualifyingPA: q.pa,
      qualifyingIP: q.ip,
      ...(kind === "hitters" ? { hitters: st.hitters } : { pitchers: st.pitchers }),
      context: {
        runsPerGame: c.runsPerGame,
        lgAvg: c.lgAvg,
        lgObp: c.lgObp,
        lgSlg: c.lgSlg,
        lgEra: c.lgEra,
        lgWoba: c.lgWoba,
        fipConstant: c.fipConstant,
        runsPerWin: c.runsPerWin,
        weights: { ...c.weights },
        wobaScale: c.wobaScale,
      },
    };
  },

  transactions(opts) {
    return transactions(requireSeason(), opts);
  },

  scores({ day }): ScoresView {
    const s = requireSeason();
    const played = s.games;
    const lastDay = played.length ? played[played.length - 1]!.day : 0;
    const firstDay = played.length ? played[0]!.day : 0;
    let d = day ?? lastDay;
    d = Math.max(firstDay, Math.min(lastDay, d));
    return { day: d, date: dateLabel(s, d), firstDay, lastDay, games: gameItems(s, d, boxes) };
  },

  boxScore({ key }) {
    const box = boxes.get(key);
    if (!box) return null;
    const [day, home] = key.split("-").map(Number);
    const game = requireSeason().games.find((g) => g.day === day && g.homeId === home);
    return game?.attendance ? { ...box, attendance: game.attendance } : box;
  },

  rosterAction(req) {
    const result = applyRosterAction(req);
    stats.clear();
    if (result.ok) persistSoon();
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  },

  setDepth({ depth }) {
    const s = requireSeason();
    const team = userTeam();
    const problem = validDepth(team, s.league, depth);
    if (problem) return { ok: false, reason: problem };
    team.depth = structuredClone(depth);
    team.manualDepth = true;
    refreshDepth(s.league, team);
    persistSoon();
    return { ok: true };
  },

  setFlags({ manualRoster, manualDepth }) {
    const s = requireSeason();
    const team = userTeam();
    if (manualRoster !== undefined) team.manualRoster = manualRoster;
    if (manualDepth !== undefined) {
      team.manualDepth = manualDepth;
      refreshDepth(s.league, team);
    }
    persistSoon();
    return { ok: true };
  },

  postseason() {
    return postseasonView(requireSeason());
  },

  // --- The offseason -------------------------------------------------------

  async beginOffseason() {
    const s = requireSeason();
    if (!s.postseason) throw new Error("Play the postseason first.");
    beginOffseason(s.league, s);
    stats.clear();
    await persist();
    return currentStatus();
  },

  async advance() {
    const s = requireSeason();
    winter();
    if (s.league.gm?.fired) throw new Error("You need a new job first: pick one of the clubs that called.");
    const next = advanceOffseason(s.league, s);
    if (next) {
      season = next;
      attach(next);
    }
    stats.clear();
    await persist();
    return currentStatus();
  },

  async winterWeek() {
    const s = requireSeason();
    if (winter().phase !== "freeAgency") throw new Error("Free agency isn't open.");
    winterWeek(s.league, s);
    stats.clear();
    await persist();
    return currentStatus();
  },

  offseason() {
    return offseasonView(requireSeason(), stats);
  },

  setTender({ playerId, tender }) {
    const w = winter();
    const t = w.tenders.find((x) => x.playerId === playerId && x.teamId === userTeam().id);
    if (!t) return { ok: false, reason: "He isn't one of your arbitration cases." };
    if (w.phase !== "review" && w.phase !== "tenders") return { ok: false, reason: "The tender deadline has passed." };
    t.tender = tender;
    persistSoon();
    return { ok: true };
  },

  draftPick({ playerId }) {
    const w = winter();
    if (w.phase !== "draft" || !w.draft) return { ok: false, reason: "The draft isn't on." };
    const p = makePick(requireSeason().league, w.draft, userTeam().id, playerId, WINTER_DAYS.draft);
    if (!p) return { ok: false, reason: "You're not on the clock." };
    persistSoon();
    return { ok: true };
  },

  async draftToMe() {
    const w = winter();
    if (w.phase !== "draft" || !w.draft) throw new Error("The draft isn't on.");
    simDraft(requireSeason().league, w.draft, WINTER_DAYS.draft, userTeam().id);
    await persist();
    return currentStatus();
  },

  faOffer(offer) {
    const w = winter();
    if (w.phase !== "freeAgency" || !w.freeAgency) return { ok: false, reason: "Free agency isn't open." };
    const salary = Math.round(offer.salary * 20) / 20;
    const check = validateOffer(requireSeason().league, w.freeAgency, userTeam().id, { ...offer, salary });
    if (!check.ok) return check;
    w.freeAgency.offers = [...w.freeAgency.offers.filter((o) => o.playerId !== offer.playerId), { ...offer, salary }];
    persistSoon();
    return { ok: true };
  },

  faWithdraw({ playerId }) {
    const fa = winter().freeAgency;
    if (fa) fa.offers = fa.offers.filter((o) => o.playerId !== playerId);
    persistSoon();
    return { ok: true };
  },

  intlSign({ playerId }) {
    const w = winter();
    if (w.phase !== "international" || !w.international) return { ok: false, reason: "The signing period isn't open." };
    const res = signInternational(requireSeason().league, w.international, userTeam().id, playerId, WINTER_DAYS.international);
    if (res.ok) persistSoon();
    return res;
  },

  tradeSides({ partnerId }) {
    const s = requireSeason();
    return { mine: tradeSide(s, stats, userTeam()), theirs: tradeSide(s, stats, s.team(partnerId)) };
  },

  trade({ partnerId, give, get, execute }) {
    const s = requireSeason();
    const mine = userTeam();
    const partner = s.team(partnerId);
    const st = currentStatus();
    const fraction = s.league.offseason ? 1 : Math.max(0, 1 - s.day / s.totalDays);
    const check = evaluateTrade(s.league, mine, partner, give, get, fraction, (viewer, p) => warShift(s, viewer, p));
    if (!st.canTrade) return { ...check, ok: false, reason: st.tradeNote };
    if (!execute || !check.ok) return check;
    executeTrade(ctx(), mine, partner, give, get);
    stats.clear();
    persistSoon();
    return { ...check, done: true };
  },

  history() {
    return historyView(requireSeason().league);
  },

  // --- Scouting --------------------------------------------------------------

  scouting() {
    return scoutingView(requireSeason());
  },

  setDepartments({ scouting, analytics }) {
    const s = requireSeason();
    const team = userTeam();
    if (!s.league.offseason && s.day > 0) return { ok: false, reason: "Department budgets are set in the offseason (or before Opening Day)." };
    if (![scouting, analytics].every((t) => Number.isInteger(t) && t >= 1 && t <= 5)) return { ok: false, reason: "Pick a level from 1 to 5." };
    s.league.scouting.scouting[team.id] = scouting;
    s.league.scouting.analytics[team.id] = analytics;
    stats.clear();
    persistSoon();
    return { ok: true };
  },

  // --- The business side ----------------------------------------------------

  finances({ teamId }) {
    const s = requireSeason();
    const id = teamId ?? s.league.userTeamId;
    if (id === null || id === undefined || !s.league.teams[id]) throw new Error("Pick a club.");
    return financeView(s, s.team(id));
  },

  setTicketPrice({ price }) {
    const team = userTeam();
    const f = team.finance;
    if (price === "auto") {
      f.autoPrice = true;
      f.ticketPrice = bestTicketPrice(team);
    } else {
      if (!Number.isFinite(price) || price < 5 || price > 250) return { ok: false, reason: "Pick a price between $5 and $250." };
      f.autoPrice = false;
      f.ticketPrice = Math.round(price);
    }
    persistSoon();
    return { ok: true };
  },

  owner() {
    return ownerView(requireSeason());
  },

  async acceptJob({ teamId }) {
    const s = requireSeason();
    acceptJob(s.league, teamId);
    stats.clear();
    await persist();
    return currentStatus();
  },

  scoutPlayer({ playerId }) {
    const s = requireSeason();
    const w = s.league.offseason;
    const pool = [...(w?.draft?.pool ?? []), ...(w?.international?.pool ?? [])];
    const p = playerId >= 0 ? s.league.players[playerId] : pool.find((x) => x.id === playerId);
    if (!p) return { ok: false, reason: "No such player." };
    const res = takeLook(s.league, s.day, p);
    if (res.ok) persistSoon();
    return res;
  },
};

function scoutingView(season: Season): ScoutingView {
  const league = season.league;
  const team = userTeam();
  const st = league.scouting;
  const tier = st.scouting[team.id]!;
  const aTier = st.analytics[team.id]!;
  const sc = SCOUTING_TIERS[tier - 1]!;
  const an = ANALYTICS_TIERS[aTier - 1]!;
  const w = league.offseason;
  const pool = [...(w?.draft?.pool ?? []), ...(w?.international?.pool ?? [])];
  const scouted = Object.entries(st.looks)
    .map(([key, looks]) => {
      const id = Number(key);
      const p = id >= 0 ? league.players[id] : pool.find((x) => x.id === id);
      if (!p) return null;
      return {
        playerId: id,
        name: `${p.firstName} ${p.lastName}`,
        team: p.teamId === null ? (id < 0 ? "Amateur" : "FA") : league.teams[p.teamId]!.abbrev,
        pos: p.pitching ? (p.role === "SP" ? "SP" : "RP") : p.position,
        looks,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.looks - a.looks);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    editable: w !== null || season.day === 0,
    scouting: { tier, label: sc.label, cost: sc.cost },
    analytics: { tier: aTier, label: an.label, cost: an.cost, basis: an.basis },
    tiers: {
      scouting: SCOUTING_TIERS.map((t) => ({ tier: t.tier, label: t.label, cost: t.cost, sigma: t.sigma })),
      analytics: ANALYTICS_TIERS.map((t) => ({ tier: t.tier, label: t.label, cost: t.cost, trust: t.trust, basis: t.basis })),
    },
    accuracy: [
      { label: "Your own organization", sigma: r1(sc.sigma * FAMILIARITY.own) },
      { label: "Other clubs' big leaguers", sigma: r1(sc.sigma * FAMILIARITY.bigLeaguer) },
      { label: "Other clubs' upper minors (AAA, AA)", sigma: r1(sc.sigma * FAMILIARITY.upperMinors) },
      { label: "Other clubs' lower minors (High-A, Single-A)", sigma: r1(sc.sigma * FAMILIARITY.lowerMinors) },
      { label: "College draft prospects", sigma: r1(sc.sigma * FAMILIARITY.college) },
      { label: "High schoolers and international amateurs", sigma: r1(sc.sigma * FAMILIARITY.amateur) },
    ],
    looksLeft: looksLeft(league, season.day),
    looksPerWindow: looksAllowance(tier, w !== null),
    scouted,
    budget: { budget: team.budget, payroll: payroll(league, team), staff: staffCost(league, team) },
  };
}

// ---------------------------------------------------------------------------
// Message loop

const post = (msg: ResponseMessage) => self.postMessage(msg);

self.onmessage = async (e: MessageEvent<RequestMessage>) => {
  const { id, name, payload } = e.data;
  const progress: Progress = (day, total) => post({ id, progress: { day, total } });
  try {
    const handler = handlers[name] as (req: unknown, progress: Progress) => unknown;
    const result = await handler(payload, progress);
    post({ id, ok: true, result });
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
