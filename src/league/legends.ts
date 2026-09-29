import { Rng } from "../core/rng";
import { randomName } from "../players/names";
import type { CareerBat, CareerPit } from "../stats/career";
import type { SeasonStat } from "../stats/records";
import type { League } from "./types";

/**
 * The league's past: a couple of dozen fictional greats who played before the
 * first simulated season. They hold the records a modern player chases (set
 * just above what the engine's best seasons reach, so one falls now and then)
 * and they're the Hall of Fame's first members. Generated from the league's
 * seed, so a league always has the same history.
 */

export interface Legend {
  id: number;
  name: string;
  pos: string;
  /** The franchise he's remembered with. */
  teamId: number;
  from: number;
  to: number;
  bat?: CareerBat;
  pit?: CareerPit;
  /** His seasons in the record book. */
  records: { stat: SeasonStat; year: number; value: number }[];
  inducted: number;
  /** His share of the Hall of Fame vote, %. */
  vote: number;
}

type HitterKind = "power" | "contact" | "speed" | "complete";
type PitcherKind = "ace" | "control" | "closer";

/** A great season of each kind (650 PA; a starter's 33 starts or a closer's 66 games). */
const BAT: Record<HitterKind, { avg: number; HR: number; D: number; T: number; RBI: number; BB: number; SB: number; WAR: number; pos: string[] }> = {
  power: { avg: 0.285, HR: 44, D: 30, T: 2, RBI: 124, BB: 85, SB: 5, WAR: 6.8, pos: ["1B", "LF", "RF"] },
  contact: { avg: 0.334, HR: 14, D: 40, T: 8, RBI: 86, BB: 55, SB: 15, WAR: 6.3, pos: ["2B", "CF", "RF", "3B"] },
  speed: { avg: 0.3, HR: 9, D: 28, T: 12, RBI: 62, BB: 70, SB: 70, WAR: 6.1, pos: ["CF", "SS", "2B", "LF"] },
  complete: { avg: 0.312, HR: 35, D: 38, T: 5, RBI: 112, BB: 90, SB: 22, WAR: 8.6, pos: ["SS", "CF", "3B", "C"] },
};
const PIT: Record<PitcherKind, { G: number; GS: number; outs: number; W: number; L: number; SV: number; SO: number; ER: number; BB: number; WAR: number }> = {
  ace: { G: 33, GS: 33, outs: 700, W: 15, L: 8, SV: 0, SO: 255, ER: 72, BB: 55, WAR: 7.2 },
  control: { G: 32, GS: 32, outs: 670, W: 14, L: 8, SV: 0, SO: 175, ER: 60, BB: 32, WAR: 6.4 },
  closer: { G: 66, GS: 0, outs: 210, W: 4, L: 3, SV: 43, SO: 88, ER: 15, BB: 17, WAR: 2.9 },
};
const HITTERS: HitterKind[] = ["power", "contact", "speed", "complete", "power", "contact", "complete", "speed", "power", "complete", "contact", "power", "complete", "contact"];
const PITCHERS: PitcherKind[] = ["ace", "control", "closer", "ace", "ace", "control", "closer", "ace", "control", "ace"];

/** Each record, the kind of player who'd hold it, and how far past the engine's best seasons it sits. */
const RECORDS: { stat: SeasonStat; kinds: (HitterKind | PitcherKind)[]; lo: number; hi: number; places: number }[] = [
  { stat: "HR", kinds: ["power"], lo: 72, hi: 76, places: 0 },
  { stat: "RBI", kinds: ["power", "complete"], lo: 168, hi: 180, places: 0 },
  { stat: "H", kinds: ["contact"], lo: 224, hi: 236, places: 0 },
  { stat: "SB", kinds: ["speed"], lo: 118, hi: 134, places: 0 },
  { stat: "AVG", kinds: ["contact"], lo: 0.341, hi: 0.356, places: 3 },
  { stat: "bWAR", kinds: ["complete"], lo: 10.2, hi: 11.4, places: 1 },
  { stat: "streak", kinds: ["contact", "speed"], lo: 46, hi: 52, places: 0 },
  { stat: "W", kinds: ["ace"], lo: 22, hi: 24, places: 0 },
  { stat: "SO", kinds: ["ace"], lo: 272, hi: 292, places: 0 },
  { stat: "SV", kinds: ["closer"], lo: 46, hi: 51, places: 0 },
  { stat: "ERA", kinds: ["control"], lo: 1.75, hi: 1.95, places: 2 },
  { stat: "pWAR", kinds: ["ace", "control"], lo: 8, hi: 9, places: 1 },
];

/** Seasons at full strength over a career of `n`: a two-year climb and a three-year fade. */
const fullSeasons = (n: number) => n - 0.6 - 0.9;

export function generateLegends(league: League): Legend[] {
  const rng = new Rng(`${league.seed}:legends`);
  const last = league.year - 8;
  const legends: (Legend & { kind: HitterKind | PitcherKind; g: number })[] = [];
  const nameOf = () => {
    const n = randomName(rng);
    return `${n.first} ${n.last}`;
  };
  const span = (n: number) => {
    const from = rng.int(1901, last - n);
    return { from, to: from + n - 1 };
  };
  const noise = () => Math.exp(rng.normal(0, 0.06));

  for (const kind of HITTERS) {
    const t = BAT[kind];
    const n = rng.int(17, 22);
    const g = 0.88 + rng.next() * 0.16;
    const e = fullSeasons(n) * g;
    const PA = Math.round(650 * e * noise());
    const BB = Math.round(t.BB * e * noise());
    const AB = Math.round((PA - BB) * 0.965);
    const avg = t.avg * (0.97 + rng.next() * 0.04);
    const bat: CareerBat = {
      G: Math.round(PA / 4.2),
      PA,
      AB,
      H: Math.round(AB * avg),
      D: Math.round(t.D * e * noise()),
      T: Math.round(t.T * e * noise()),
      HR: Math.round(t.HR * e * noise()),
      RBI: Math.round(t.RBI * e * noise()),
      BB,
      SB: Math.round(t.SB * e * noise()),
      WAR: Math.round(t.WAR * e * noise() * 10) / 10,
    };
    legends.push({ id: legends.length, name: nameOf(), pos: rng.pick(t.pos), teamId: rng.int(0, league.teams.length - 1), ...span(n), bat, records: [], inducted: 0, vote: 0, kind, g });
  }
  for (const kind of PITCHERS) {
    const t = PIT[kind];
    const n = kind === "closer" ? rng.int(14, 18) : rng.int(16, 21);
    const g = 0.88 + rng.next() * 0.16;
    const e = fullSeasons(n) * g;
    const outs = Math.round(t.outs * e * noise());
    const pit: CareerPit = {
      G: Math.round(t.G * e),
      GS: Math.round(t.GS * e),
      W: Math.round(t.W * e * noise()),
      L: Math.round(t.L * e * noise()),
      SV: Math.round(t.SV * e * noise()),
      outs,
      ER: Math.round((t.ER / t.outs) * outs * noise()),
      SO: Math.round(t.SO * e * noise()),
      BB: Math.round(t.BB * e * noise()),
      WAR: Math.round(t.WAR * e * noise() * 10) / 10,
    };
    legends.push({ id: legends.length, name: nameOf(), pos: kind === "closer" ? "RP" : "SP", teamId: rng.int(0, league.teams.length - 1), ...span(n), pit, records: [], inducted: 0, vote: 0, kind, g });
  }

  // The records: the greatest of the right kind, spread around so no one holds more than two.
  for (const r of RECORDS) {
    const holder = legends.filter((l) => r.kinds.includes(l.kind) && l.records.length < 2).sort((a, b) => b.g - a.g)[0];
    if (!holder) continue;
    const f = 10 ** r.places;
    const value = Math.round((r.lo + rng.next() * (r.hi - r.lo)) * f) / f;
    holder.records.push({ stat: r.stat, year: rng.int(holder.from + 3, Math.max(holder.from + 3, holder.to - 3)), value });
  }
  for (const l of legends) {
    l.inducted = Math.min(league.year - 1, l.to + 5 + rng.int(0, 2));
    l.vote = Math.round((78 + rng.next() * 21) * 10) / 10;
  }
  return legends.map(({ kind: _k, g: _g, ...l }) => l);
}
