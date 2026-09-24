import type { BattingLine, FieldingLine, PitchingLine } from "./lines";
import type { EventCode } from "./runExpectancy";

/**
 * Modern rate stats and WAR, computed the way FanGraphs does it - but with
 * every constant (wOBA weights, FIP constant, runs per win, replacement
 * level, park factors) derived from the simulated league itself each season.
 */

export interface LeagueTotals {
  batting: BattingLine;
  pitching: PitchingLine;
  /** Total team-games / 2. */
  games: number;
  runs: number;
  /** Raw linear weights from the season's own run-expectancy matrix. */
  linearWeights: Record<EventCode, number>;
  /** Out value: average of strikeouts and batted-ball outs. */
  outValue: number;
  parkFactors: Map<number, number>;
}

export interface WobaWeights {
  BB: number;
  HBP: number;
  "1B": number;
  "2B": number;
  "3B": number;
  HR: number;
}

export interface LeagueContext {
  games: number;
  lgPA: number;
  runsPerPA: number;
  runsPerOut: number;
  runsPerGame: number;
  weights: WobaWeights;
  wobaScale: number;
  lgWoba: number;
  lgAvg: number;
  lgObp: number;
  lgSlg: number;
  lgEra: number;
  lgRa9: number;
  fipConstant: number;
  lgHrPerFb: number;
  runsPerWin: number;
  runSB: number;
  runCS: number;
  lgWsbRate: number;
  /** Run values of hits relative to an out, used for defense. */
  hitValue: { "1B": number; "2B": number; "3B": number };
  /** Value of turning a ball into a strike (framing). */
  strikeValue: number;
  replacementRunsPerPA: number;
  parkFactors: Map<number, number>;
  linearWeights: Record<EventCode, number>;
  sieraShift: number;
}

const safe = (n: number, d: number) => (d > 0 ? n / d : 0);

export const ipOf = (outs: number) => outs / 3;

export function obp(b: BattingLine): number {
  return safe(b.H + b.BB + b.HBP, b.AB + b.BB + b.HBP + b.SF);
}

export function slg(b: BattingLine): number {
  return safe(b["1B"] + 2 * b["2B"] + 3 * b["3B"] + 4 * b.HR, b.AB);
}

export const avg = (b: BattingLine) => safe(b.H, b.AB);

function wobaNumerator(b: BattingLine, w: WobaWeights): number {
  return w.BB * (b.BB - b.IBB) + w.HBP * b.HBP + w["1B"] * b["1B"] + w["2B"] * b["2B"] + w["3B"] * b["3B"] + w.HR * b.HR;
}

const wobaDenominator = (b: BattingLine) => b.AB + b.BB - b.IBB + b.SF + b.HBP;

export function woba(b: BattingLine, w: WobaWeights): number {
  return safe(wobaNumerator(b, w), wobaDenominator(b));
}

export function xwoba(b: BattingLine, w: WobaWeights): number {
  const num =
    w.BB * (b.BB - b.IBB) + w.HBP * b.HBP + w["1B"] * b.x1B + w["2B"] * b.x2B + w["3B"] * b.x3B + w.HR * b.xHR;
  return safe(num, wobaDenominator(b));
}

function rawSiera(p: PitchingLine): number {
  const pa = p.BF;
  if (pa === 0) return 0;
  const so = p.SO / pa;
  const bb = p.BB / pa;
  const net = (p.GB - p.FB - p.PU) / pa;
  return (
    6.145 -
    16.986 * so +
    11.434 * bb -
    1.858 * net +
    7.653 * so * so -
    6.664 * net * Math.abs(net) +
    10.13 * so * net -
    5.195 * bb * net
  );
}

export function buildLeagueContext(t: LeagueTotals): LeagueContext {
  const b = t.batting;
  const p = t.pitching;
  const lw = t.linearWeights;
  const rel = (code: EventCode) => lw[code] - t.outValue;
  const raw: WobaWeights = { BB: rel("BB"), HBP: rel("HBP"), "1B": rel("1B"), "2B": rel("2B"), "3B": rel("3B"), HR: rel("HR") };
  const lgObp = obp(b);
  const rawWoba = safe(wobaNumerator(b, raw), wobaDenominator(b));
  const wobaScale = safe(lgObp, rawWoba);
  const weights: WobaWeights = {
    BB: raw.BB * wobaScale,
    HBP: raw.HBP * wobaScale,
    "1B": raw["1B"] * wobaScale,
    "2B": raw["2B"] * wobaScale,
    "3B": raw["3B"] * wobaScale,
    HR: raw.HR * wobaScale,
  };

  const ip = ipOf(p.outs);
  const lgEra = safe(9 * p.ER, ip);
  const lgRa9 = safe(9 * p.R, ip);
  const fipConstant = lgEra - safe(13 * p.HR + 3 * (p.BB + p.HBP - p.IBB) - 2 * p.SO, ip);
  const runsPerOut = safe(t.runs, p.outs);
  const runSB = 0.2;
  const runCS = -(2 * runsPerOut + 0.075);
  const lgWsbRate = safe(b.SB * runSB + b.CS * runCS, b["1B"] + b.BB + b.HBP - b.IBB);
  const runsPerWin = 9 * safe(t.runs, ip) * 1.5 + 3;
  const lgPA = b.PA;

  // SIERA's intercept is era-specific; shift so the league average equals league ERA.
  const sieraShift = lgEra - rawSiera(p);

  return {
    games: t.games,
    lgPA,
    runsPerPA: safe(t.runs, lgPA),
    runsPerOut,
    runsPerGame: safe(t.runs, 2 * t.games),
    weights,
    wobaScale,
    lgWoba: woba(b, weights),
    lgAvg: avg(b),
    lgObp,
    lgSlg: slg(b),
    lgEra,
    lgRa9,
    fipConstant,
    lgHrPerFb: safe(p.HR, p.FB + p.PU),
    runsPerWin,
    runSB,
    runCS,
    lgWsbRate,
    hitValue: { "1B": rel("1B"), "2B": rel("2B"), "3B": rel("3B") },
    strikeValue: 0.125,
    replacementRunsPerPA: safe(570 * (t.games / 2430) * runsPerWin, lgPA),
    parkFactors: t.parkFactors,
    linearWeights: lw,
    sieraShift,
  };
}

// ---------------------------------------------------------------------------
// Hitters

export interface HitterAdvanced {
  PA: number;
  AVG: number;
  OBP: number;
  SLG: number;
  OPS: number;
  ISO: number;
  BABIP: number;
  wOBA: number;
  xwOBA: number;
  wRCplus: number;
  OPSplus: number;
  Kpct: number;
  BBpct: number;
  chasePct: number;
  zoneContactPct: number;
  whiffPct: number;
  avgEV: number;
  hardHitPct: number;
  barrelPct: number;
  sweetSpotPct: number;
  battingRuns: number;
  baserunningRuns: number;
  fieldingRuns: number;
  positionalRuns: number;
  replacementRuns: number;
  WAR: number;
}

const POSITIONAL_RUNS_PER_162: Record<string, number> = {
  outsC: 12.5,
  outs1B: -12.5,
  outs2B: 2.5,
  outs3B: 2.5,
  outsSS: 7.5,
  outsLF: -7.5,
  outsCF: 2.5,
  outsRF: -7.5,
};
const OUTS_PER_162 = 162 * 27;

export function fieldingRuns(f: FieldingLine, ctx: LeagueContext): number {
  const v = ctx.hitValue;
  const range = (f.exp1B - f.act1B) * v["1B"] + (f.exp2B - f.act2B) * v["2B"] + (f.exp3B - f.act3B) * v["3B"];
  const framing = (f.framingActual - f.framingExpected) * ctx.strikeValue;
  const arm = (f.sbExpected - f.sbAllowed) * (ctx.runSB - ctx.runCS);
  return range + framing + arm;
}

export function positionalRuns(f: FieldingLine): number {
  let runs = 0;
  for (const [key, per162] of Object.entries(POSITIONAL_RUNS_PER_162)) {
    runs += (per162 * (f as unknown as Record<string, number>)[key]!) / OUTS_PER_162;
  }
  return runs + (-17.5 * f.gamesDH) / 162;
}

/** Hitter stats before the league-wide WAR adjustment. */
export function hitterAdvanced(b: BattingLine, f: FieldingLine | undefined, pf: number, ctx: LeagueContext): HitterAdvanced {
  const w = ctx.weights;
  const pa = b.PA;
  const o = obp(b);
  const s = slg(b);
  const a = avg(b);
  const wo = woba(b, w);
  const wraa = safe(wo - ctx.lgWoba, ctx.wobaScale) * pa;
  const parkAdj = (ctx.runsPerPA - pf * ctx.runsPerPA) * pa;
  const battingRuns = wraa + parkAdj;
  const wsb = b.SB * ctx.runSB + b.CS * ctx.runCS - ctx.lgWsbRate * (b["1B"] + b.BB + b.HBP - b.IBB);
  const fld = f ? fieldingRuns(f, ctx) : 0;
  const pos = f ? positionalRuns(f) : 0;
  const repl = ctx.replacementRunsPerPA * pa;
  const swings = b.zoneSwings + b.outSwings;
  const contact = b.zoneContact + b.outContact;
  return {
    PA: pa,
    AVG: a,
    OBP: o,
    SLG: s,
    OPS: o + s,
    ISO: s - a,
    BABIP: safe(b.H - b.HR, b.AB - b.SO - b.HR + b.SF),
    wOBA: wo,
    xwOBA: xwoba(b, w),
    wRCplus: pa > 0 ? (100 * (safe(wraa, pa) + ctx.runsPerPA + safe(parkAdj, pa))) / ctx.runsPerPA : 0,
    OPSplus: pa > 0 ? 100 * (o / (ctx.lgObp * pf) + s / (ctx.lgSlg * pf) - 1) : 0,
    Kpct: safe(b.SO, pa),
    BBpct: safe(b.BB, pa),
    chasePct: safe(b.outSwings, b.outPitches),
    zoneContactPct: safe(b.zoneContact, b.zoneSwings),
    whiffPct: safe(swings - contact, swings),
    avgEV: safe(b.evSum, b.BBE),
    hardHitPct: safe(b.hardHit, b.BBE),
    barrelPct: safe(b.barrels, b.BBE),
    sweetSpotPct: safe(b.sweetSpot, b.BBE),
    battingRuns,
    baserunningRuns: wsb,
    fieldingRuns: fld,
    positionalRuns: pos,
    replacementRuns: repl,
    WAR: 0,
  };
}

/**
 * Finish position-player WAR for a whole league: the league adjustment makes
 * the non-replacement components sum to zero, so total WAR lands at the
 * FanGraphs convention of 570 wins per 2430 games.
 */
export function finishHitterWar(rows: HitterAdvanced[], ctx: LeagueContext): void {
  let sum = 0;
  let pa = 0;
  for (const r of rows) {
    sum += r.battingRuns + r.baserunningRuns + r.fieldingRuns + r.positionalRuns;
    pa += r.PA;
  }
  const adjPerPA = safe(-sum, pa);
  for (const r of rows) {
    const runs = r.battingRuns + r.baserunningRuns + r.fieldingRuns + r.positionalRuns + adjPerPA * r.PA + r.replacementRuns;
    r.WAR = runs / ctx.runsPerWin;
  }
}

// ---------------------------------------------------------------------------
// Pitchers

export interface PitcherAdvanced {
  IP: number;
  ERA: number;
  FIP: number;
  xFIP: number;
  SIERA: number;
  ERAminus: number;
  FIPminus: number;
  WHIP: number;
  Kpct: number;
  BBpct: number;
  KminusBB: number;
  K9: number;
  BB9: number;
  HR9: number;
  BABIP: number;
  GBpct: number;
  whiffPct: number;
  cswPct: number;
  chasePct: number;
  zonePct: number;
  avgEV: number;
  hardHitPct: number;
  barrelPct: number;
  xwOBA: number;
  WAR: number;
}

export function pitcherAdvanced(p: PitchingLine, pf: number, ctx: LeagueContext): PitcherAdvanced {
  const ip = ipOf(p.outs);
  const era = safe(9 * p.ER, ip);
  const fip = safe(13 * p.HR + 3 * (p.BB + p.HBP - p.IBB) - 2 * p.SO, ip) + ctx.fipConstant;
  const xfip = safe(13 * (p.FB + p.PU) * ctx.lgHrPerFb + 3 * (p.BB + p.HBP - p.IBB) - 2 * p.SO, ip) + ctx.fipConstant;
  const w = ctx.weights;
  const xnum = w.BB * (p.BB - p.IBB) + w.HBP * p.HBP + w["1B"] * p.x1B + w["2B"] * p.x2B + w["3B"] * p.x3B + w.HR * p.xHR;
  const bip = p.BF - p.SO - p.BB - p.HBP - p.HR;

  // FanGraphs-style FIP WAR.
  let war = 0;
  if (ip > 0) {
    const fipr9 = fip + (ctx.lgRa9 - ctx.lgEra);
    const pfipr9 = fipr9 / pf;
    const ipPerG = ip / Math.max(1, p.G);
    const drpw = (((18 - ipPerG) * ctx.lgRa9 + ipPerG * pfipr9) / 18 + 2) * 1.5;
    const wpgaa = (ctx.lgRa9 - pfipr9) / drpw;
    const startShare = safe(p.GS, p.G);
    const repl = 0.03 * (1 - startShare) + 0.12 * startShare;
    war = (wpgaa + repl) * (ip / 9);
  }

  return {
    IP: ip,
    ERA: era,
    FIP: fip,
    xFIP: xfip,
    SIERA: rawSiera(p) + ctx.sieraShift,
    ERAminus: ip > 0 ? (100 * (era + (era - era * pf))) / ctx.lgEra : 0,
    FIPminus: ip > 0 ? (100 * (fip + (fip - fip * pf))) / ctx.lgEra : 0,
    WHIP: safe(p.H + p.BB, ip),
    Kpct: safe(p.SO, p.BF),
    BBpct: safe(p.BB, p.BF),
    KminusBB: safe(p.SO - p.BB, p.BF),
    K9: safe(9 * p.SO, ip),
    BB9: safe(9 * p.BB, ip),
    HR9: safe(9 * p.HR, ip),
    BABIP: safe(p.H - p.HR, bip),
    GBpct: safe(p.GB, p.BBE),
    whiffPct: safe(p.whiffs, p.swings),
    cswPct: safe(p.whiffs + p.calledStrikes, p.pitches),
    chasePct: safe(p.outSwings, p.outPitches),
    zonePct: safe(p.zonePitches, p.pitches),
    avgEV: safe(p.evSum, p.BBE),
    hardHitPct: safe(p.hardHit, p.BBE),
    barrelPct: safe(p.barrels, p.BBE),
    xwOBA: safe(xnum, p.BF),
    WAR: war,
  };
}

/** Scale pitcher WAR so the league total is 430 wins per 2430 games. */
export function finishPitcherWar(rows: PitcherAdvanced[], ctx: LeagueContext): void {
  const target = 430 * (ctx.games / 2430);
  let total = 0;
  let ip = 0;
  for (const r of rows) {
    total += r.WAR;
    ip += r.IP;
  }
  const perNine = safe(target - total, ip / 9);
  for (const r of rows) r.WAR += perNine * (r.IP / 9);
}
