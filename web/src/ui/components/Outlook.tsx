import type { PlayerSummary } from "../../api/protocol";
import { fixed, GLOSSARY, warWord } from "../format";
import { useBasics } from "../settings";
import { Grade } from "./Grade";
import type { Column } from "./Table";

/**
 * How good a player is, in the number that fits him: projected WAR a season
 * for big leaguers (and anyone close), where the 20-80 overall grade bunches
 * up, and future value for prospects, where the grade is the point.
 */

/** The Now grade, with a mark when analytics sees him noticeably differently than the scouts. */
export function NowGrade({ p }: { p: PlayerSummary }) {
  const a = p.read.analytics;
  // Only when analytics actually moves your read (a big gap on a small sample doesn't).
  const gap = p.ovr - p.read.scouts;
  const title = `Your read ${p.ovr}: scouts ${p.read.scouts}${a === null ? "" : `, analytics ${a}`} (${p.read.confidence} confidence)`;
  return (
    <span class="now-grade" title={title}>
      <Grade g={p.ovr} title={title} />
      {gap >= 3 ? <span class="ana-up">▲</span> : gap <= -3 ? <span class="ana-down">▼</span> : null}
    </span>
  );
}

/** Projected WAR a season by your read (a dash for a prospect below AAA), marked when analytics moves the read off the scouts'. */
export function Proj({ p, word }: { p: PlayerSummary; word?: boolean }) {
  const basics = useBasics();
  if (p.proj === null) return <span class="muted">—</span>;
  const what = warWord(p.proj, p.pos);
  const gap = p.ovr - p.read.scouts;
  const moved = gap >= 3 ? "up" : gap <= -3 ? "down" : null;
  const why = moved ? `; the numbers have your read ${moved === "up" ? "above" : "below"} the scouts'` : "";
  return (
    <span class={`proj${p.proj < 0 ? " neg" : ""}`} title={`About ${fixed(p.proj)} WAR over a full season by your read: ${what.toLowerCase()}${why}`}>
      {fixed(p.proj)}
      {moved === "up" ? <span class="ana-up">▲</span> : moved === "down" ? <span class="ana-down">▼</span> : null}
      {(word ?? basics) && <span class="word"> {what}</span>}
    </span>
  );
}

/** The one number that fits him, for tight spots: "2.3 WAR", or FV for a prospect below AAA. */
export function Headline({ p }: { p: PlayerSummary }) {
  if (p.proj === null) {
    return (
      <span class="headline" title="Future value: the overall grade your scouts project at his peak">
        FV <Grade g={p.fv} />
      </span>
    );
  }
  return (
    <span class={`headline num${p.proj < 0 ? " neg" : ""}`} title={`About ${fixed(p.proj)} WAR over a full season by your read: ${warWord(p.proj, p.pos).toLowerCase()}`}>
      {fixed(p.proj)} WAR
    </span>
  );
}

/** Future value, for prospects (a dash for everyone else). */
export function Fv({ p }: { p: PlayerSummary }) {
  return p.prospect ? <Grade g={p.fv} /> : <span class="muted">—</span>;
}

/**
 * The columns that say how good players are: projected WAR, the Now grade,
 * and FV. A column nobody in the table has a number for is left out, and the
 * Now grade only shows where some players are prospects below AAA (a table
 * of big leaguers leads with wins).
 */
export function outlookColumns<T>(rows: T[], get: (r: T) => PlayerSummary): Column<T>[] {
  const cols: Column<T>[] = [];
  if (rows.some((r) => get(r).proj !== null)) {
    cols.push({ key: "proj", label: "Proj", title: GLOSSARY.Proj, cls: "num", sort: (r) => get(r).proj ?? -99, render: (r) => <Proj p={get(r)} word={false} /> });
  }
  if (rows.some((r) => get(r).proj === null)) {
    cols.push({
      key: "ovr",
      label: "Now",
      title: "Your read of his overall grade today on the 20-80 scale (scouts blended with analytics)",
      cls: "ctr",
      sort: (r) => get(r).ovr,
      render: (r) => <NowGrade p={get(r)} />,
    });
  }
  if (rows.some((r) => get(r).prospect)) {
    cols.push({ key: "fv", label: "FV", title: GLOSSARY.FV, cls: "ctr", sort: (r) => (get(r).prospect ? get(r).fv : 0), render: (r) => <Fv p={get(r)} /> });
  }
  return cols;
}
