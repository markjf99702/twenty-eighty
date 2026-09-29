import type { Rng } from "../core/rng";
import { seasonWar } from "../org/contracts";
import { canStart, pitchingValue } from "../org/value";
import { addBat, addPit, type CareerBat, type CareerPit } from "../stats/career";
import { type Player, SERVICE_DAYS_PER_YEAR } from "./types";

/**
 * Big-league careers from before the league's first simulated season, so a
 * 34-year-old arrives with the thirteen years behind him that his service
 * time says he has: counting stats for the record book, the Hall of Fame's
 * ballot and his page. Each season is drawn from his grades as they were at
 * that age (a gentle aging curve back from today's), at rates fit to the
 * engine's own seasons (scripts/prior-fit.ts).
 */

export interface PriorCareer {
  /** Big-league seasons before the league's first (a partial one counts). */
  seasons: number;
  /** His first big-league season. */
  from: number;
  bat?: CareerBat;
  pit?: CareerPit;
}

/** Grade points a player was above or below today's self at `then`, on a curve peaking at 28 (steeper on the way up). */
const curve = (age: number) => (age < 28 ? -0.25 : -0.1) * (age - 28) ** 2;
const delta = (now: number, then: number) => Math.max(-12, Math.min(8, curve(then) - curve(now)));
const clamp01 = (x: number) => Math.max(0, x);

/** One hitter's season at `shift` grade points from today, over `pa` plate appearances. */
function batSeason(p: Player, shift: number, pa: number, noise: () => number): CareerBat {
  const t = p.hitting;
  const hit = t.hit.present + shift;
  const pow = t.power.present + shift;
  const eye = t.eye.present + shift * 0.5;
  const spd = t.speed.present + shift;
  const bbRate = clamp01(0.011 + 0.001445 * eye);
  const BB = Math.round(pa * bbRate * noise());
  const AB = Math.round((pa - BB) * 0.965);
  const avg = Math.max(0.17, 0.0152 + 0.00222 * hit + 0.0017 * pow + 0.00059 * spd);
  const H = Math.round(AB * avg * noise());
  const HR = Math.round(pa * clamp01(-0.0543 + 0.000528 * hit + 0.00122 * pow) * noise());
  const D = Math.round(AB * clamp01(-0.0377 + 0.000646 * hit + 0.000869 * pow) * noise());
  const T = Math.round(AB * clamp01(-0.0031 + 0.000159 * spd) * noise());
  const RBI = Math.round(pa * clamp01(0.0337 + 0.000469 * hit + 0.00154 * pow - 0.000348 * eye) * noise());
  const SB = Math.round(pa * clamp01(-0.0334 + 0.00134 * spd) * noise());
  const WAR = Math.round((seasonWar(p) + 0.2 * shift) * (pa / 600) * noise() * 10) / 10;
  return { G: Math.round(pa / 4.07), PA: pa, AB, H: Math.max(H, HR + D + T), D, T, HR, RBI, BB, SB, WAR };
}

/** One pitcher's season: a starter's `n` starts or a reliever's `n` games (`closer` saves them). */
function pitchSeason(p: Player, shift: number, starter: boolean, n: number, closer: boolean, noise: () => number): CareerPit {
  const pv = pitchingValue(p) + shift * 1.2;
  const ctl = p.pitching!.control.present + shift * 0.5;
  const outs = Math.max(1, Math.round(n * (starter ? -4.4 + 0.01356 * pv + 0.3557 * p.pitching!.stamina.present : 2.87 - 0.0103 * pv + 0.0042 * ctl)));
  const bfPerOut = starter ? 1.519 - 0.00168 * pv - 0.00201 * ctl : 1.6 - 0.00157 * pv - 0.00341 * ctl;
  const BF = outs * bfPerOut;
  const SO = Math.round(BF * clamp01((starter ? 0.2198 + 0.001947 * pv : 0.2063 + 0.001586 * pv) + 0.00024 * ctl) * noise());
  const BB = Math.round(BF * clamp01((starter ? 0.1753 : 0.1836) - 0.0002 * pv - 0.0019 * ctl) * noise());
  const ER = Math.round(outs * clamp01(starter ? 0.1719 - 0.001319 * pv - 0.000359 * ctl : 0.2205 - 0.001003 * pv - 0.001225 * ctl) * noise());
  const W = Math.round(n * clamp01(starter ? 0.128 + 0.00082 * pv + 0.00223 * ctl : 0.052 + 0.0003 * pv + 0.00035 * ctl) * noise());
  const L = Math.round(n * clamp01(starter ? 0.2926 - 0.001633 * pv : 0.0696 - 0.0005 * pv) * noise());
  const SV = closer ? Math.round(n * 0.52 * noise()) : Math.round(n * 0.02 * noise());
  const full = starter ? 540 : 195;
  const WAR = Math.round((seasonWar(p) + (starter ? 0.9 * 0.0606 : 0.0263) * 1.2 * shift) * (outs / full) * noise() * 10) / 10;
  return { G: n, GS: starter ? n : 0, W, L, SV, outs, ER, SO, BB, WAR };
}

/**
 * Give a player the career his service time implies, up to the season before
 * `year`, less any big-league seasons already on his record. `closerBar` is
 * the pitching value a reliever needed to close (about one per club).
 */
export function generatePrior(p: Player, year: number, rng: Rng, closerBar: number): PriorCareer | undefined {
  const played = new Set(p.career.filter((c) => c.level === "MLB").map((c) => c.year)).size;
  const years = p.service / SERVICE_DAYS_PER_YEAR - played;
  if (years < 0.1) return undefined;
  const seasons = Math.ceil(years - 1e-9);
  const lastYear = year - 1 - played;
  const noise = () => Math.exp(rng.normal(0, 0.12));
  // How much he played: regulars a full season, the rest a part; the earliest season is the partial one.
  const share = (k: number) => (k === seasons - 1 ? years - (seasons - 1) : 1);
  let bat: CareerBat | undefined;
  let pit: CareerPit | undefined;
  const sum = <T,>(t: T | undefined, s: T, add: (a: T, b: T) => void): T => {
    if (!t) return s;
    add(t, s);
    return t;
  };
  const starter = p.pitching !== undefined && canStart(p);
  for (let k = 0; k < seasons; k++) {
    const age = p.age - played - 1 - k;
    const shift = delta(p.age, age) + rng.normal(0, 1.5);
    if (p.pitching) {
      const n = Math.max(1, Math.round((starter ? 30 : 60) * share(k)));
      const closer = !starter && pitchingValue(p) + shift * 1.2 >= closerBar;
      const s = pitchSeason(p, shift, starter, n, closer, noise);
      pit = sum(pit, s, addPit);
    } else {
      const regular = seasonWar(p) + 0.2 * shift >= 1.5 ? 1 : 0.55;
      const pa = Math.max(10, Math.round(620 * share(k) * regular));
      const s = batSeason(p, shift, pa, noise);
      bat = sum(bat, s, addBat);
    }
  }
  return { seasons, from: lastYear - seasons + 1, ...(bat ? { bat } : {}), ...(pit ? { pit } : {}) };
}

/** The pitching value of about the thirtieth-best reliever in the majors: what it takes to close. */
export function closerBar(players: Player[]): number {
  const rp = players
    .filter((p) => p.pitching && p.level === "MLB" && p.teamId !== null && p.retired === undefined && !canStart(p))
    .map((p) => pitchingValue(p))
    .sort((a, b) => b - a);
  return rp[Math.min(rp.length - 1, 29)] ?? 0;
}

/** Prior careers for everyone with big-league time and none yet. */
export function generatePriors(players: Player[], year: number, rng: Rng): void {
  const bar = closerBar(players);
  for (const p of players) {
    if (p.prior || p.retired !== undefined || p.service <= 0) continue;
    const prior = generatePrior(p, year, rng.fork(`prior${p.id}`), bar);
    if (prior) p.prior = prior;
  }
}
