import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { bump, call } from "../../api/client";
import type { PlayerSummary, RosterActionOption } from "../../api/protocol";
import { fixed, ip, LEVEL_NAMES, pct, rate3, whole } from "../format";
import { playerHref } from "../router";
import { useBasics } from "../settings";
import { notify } from "./Common";
import { Grade } from "./Grade";
import { type Column, Table } from "./Table";

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

export function StatusBadges({ p }: { p: PlayerSummary }) {
  const s = p.status;
  return (
    <span class="name-badges">
      {s.il && <span class="badge il" title={s.injury ? `${s.injury.name}, about ${s.injury.daysLeft} days left` : "Injured list"}>{s.il}</span>}
      {!s.il && s.injury && (
        <span class="badge hurt" title={s.injury.name}>
          Hurt {s.injury.daysLeft}d
        </span>
      )}
    </span>
  );
}

export function RosterMoves({ p, onDone }: { p: PlayerSummary; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (a: RosterActionOption) => {
    setBusy(true);
    try {
      const res = await call("rosterAction", { kind: a.kind, playerId: p.id, ...(a.level ? { level: a.level } : {}) });
      if (res.ok) notify(`${a.label}: ${p.name}`);
      else notify(res.reason ?? "That move isn't allowed.", true);
      bump();
      onDone?.();
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  if (!p.actions?.length) return <span class="muted">No moves available.</span>;
  return (
    <div class="actions">
      {p.actions.map((a) => (
        <div class="action" key={`${a.kind}-${a.level ?? ""}`}>
          <button type="button" class={`btn small${a.kind === "release" || a.kind === "dfa" ? " danger" : ""}`} disabled={!a.ok || busy} onClick={() => run(a)}>
            {a.label}
          </button>
          {!a.ok && a.reason && <span class="why">{a.reason}</span>}
        </div>
      ))}
    </div>
  );
}

const HITTER_TOOLS = ["Hit", "Pow", "Eye", "Run", "Fld", "Arm"];
const PITCHER_TOOLS = ["Stuff", "Ctl", "Cmd", "Stam"];
const TOOL_TITLES: Record<string, string> = {
  Hit: "Hit: bat-to-ball skill",
  Pow: "Raw power",
  Eye: "Plate discipline",
  Run: "Speed",
  Fld: "Fielding",
  Arm: "Arm",
  Stuff: "Pitch quality, usage-weighted",
  Ctl: "Control: throwing strikes",
  Cmd: "Command: hitting spots",
  Stam: "Stamina",
};

/** What the roster table shows beside the overall grades: the tools, or a season's stats. */
export type RosterView = "scouting" | "recent" | "stats" | "last";

const SMALL_PA = 30;
const SMALL_IP = 10;

type Snap = NonNullable<PlayerSummary["stats"]>;
const snapOf = (p: PlayerSummary, view: RosterView): Snap | null => (view === "last" ? p.last : view === "recent" ? p.recent : p.stats);

/** Tint a rate against league average once the sample means something. */
function tone(value: number | null | undefined, goodAbove: number, badBelow: number, enough: boolean, lowerIsBetter = false): string {
  if (value === null || value === undefined || !enough) return "";
  const v = lowerIsBetter ? -value : value;
  const good = lowerIsBetter ? -goodAbove : goodAbove;
  const bad = lowerIsBetter ? -badBelow : badBelow;
  return v >= good ? "good" : v <= bad ? "bad" : "";
}

/** Columns kept in Basics mode: the familiar numbers. */
const BASIC_BAT = new Set(["slvl", "G", "PA", "AVG", "OBP", "SLG", "HR", "SB", "WAR"]);
const BASIC_PIT = new Set(["slvl", "G", "GS", "IP", "W", "SV", "ERA", "WHIP", "WAR"]);

function statColumns(pitchers: boolean, view: RosterView, rows: PlayerSummary[], basics = false): Column<PlayerSummary>[] {
  const all = allStatColumns(pitchers, view, rows);
  return basics ? all.filter((c) => (pitchers ? BASIC_PIT : BASIC_BAT).has(c.key)) : all;
}

function allStatColumns(pitchers: boolean, view: RosterView, rows: PlayerSummary[]): Column<PlayerSummary>[] {
  const cell = (render: (s: Snap) => ComponentChildren, cls?: (s: Snap) => string) => (p: PlayerSummary) => {
    const s = snapOf(p, view);
    if (!s || (pitchers ? !s.pit : !s.bat)) return <span class="muted">—</span>;
    const small = pitchers ? s.pit!.IP < SMALL_IP : s.bat!.PA < SMALL_PA;
    return <span class={`${small ? "small-sample" : ""} ${cls?.(s) ?? ""}`}>{render(s)}</span>;
  };
  // Players without a line sort to the bottom in the column's natural direction.
  const num = (get: (s: Snap) => number | null | undefined, asc = false) => (p: PlayerSummary) => {
    const s = snapOf(p, view);
    const v = s && (pitchers ? s.pit : s.bat) ? get(s) : null;
    return v === null || v === undefined || !Number.isFinite(v) ? (asc ? 1e9 : -1e9) : v;
  };
  const col = (
    key: string,
    label: string,
    get: (s: Snap) => number | null | undefined,
    fmt: (x: number) => string,
    opts: { title?: string; asc?: boolean; cls?: (s: Snap) => string } = {},
  ): Column<PlayerSummary> => ({
    key,
    label,
    title: opts.title,
    cls: "num",
    asc: opts.asc,
    sort: num(get, opts.asc),
    render: cell((s) => {
      const v = get(s);
      return v === null || v === undefined || !Number.isFinite(v) ? "—" : fmt(v);
    }, opts.cls),
  });
  const pct1 = (x: number) => pct(x);
  // Say where the numbers came from when it isn't where he plays now.
  const elsewhere = rows.some((p) => {
    const s = snapOf(p, view);
    return s !== null && s.level !== p.level;
  });
  const levelCol: Column<PlayerSummary>[] = elsewhere
    ? [{ key: "slvl", label: "At", title: "Level these numbers are from", render: (p) => (snapOf(p, view) ? LEVEL_NAMES[snapOf(p, view)!.level] : "") }]
    : [];

  if (pitchers) {
    const P = (s: Snap) => s.pit!;
    const warTracked = rows.some((p) => {
      const s = snapOf(p, view);
      return s?.pit && s.pit.WAR !== null;
    });
    return [
      ...levelCol,
      col("G", "G", (s) => P(s).G, String),
      col("GS", "GS", (s) => P(s).GS, String),
      col("IP", "IP", (s) => P(s).IP, ip),
      col("W", "W-L", (s) => P(s).W, () => "", {}),
      col("SV", "SV", (s) => P(s).SV, String),
      col("ERA", "ERA", (s) => P(s).ERA, (x) => fixed(x, 2), {
        asc: true,
        cls: (s) => tone(P(s).ERAminus, 85, 115, P(s).IP >= 15, true),
        title: "Tinted blue or orange when his park-adjusted ERA is well above or below league average",
      }),
      col("ERAm", "ERA-", (s) => P(s).ERAminus, whole, {
        asc: true,
        title: view === "recent" ? "ERA against league average, 100 = average, lower is better" : "Park-adjusted ERA, 100 = league average, lower is better",
      }),
      col("FIP", "FIP", (s) => P(s).FIP, (x) => fixed(x, 2), { asc: true }),
      col("K", "K%", (s) => P(s).Kpct, pct1),
      col("BB", "BB%", (s) => P(s).BBpct, pct1, { asc: true }),
      col("WHIP", "WHIP", (s) => P(s).WHIP, (x) => fixed(x, 2), { asc: true }),
      ...(warTracked ? [col("WAR", "WAR", (s) => P(s).WAR, (x) => fixed(x))] : []),
    ].map((c) => (c.key === "W" ? { ...c, render: cell((s) => `${P(s).W}-${P(s).L}`) } : c));
  }
  const B = (s: Snap) => s.bat!;
  const tracked = (get: (s: Snap) => number | null) => rows.some((p) => {
    const s = snapOf(p, view);
    return s?.bat && get(s) !== null;
  });
  return [
    ...levelCol,
    col("G", "G", (s) => B(s).G, String),
    col("PA", "PA", (s) => B(s).PA, String),
    col("AVG", "AVG", (s) => B(s).AVG, rate3),
    col("OBP", "OBP", (s) => B(s).OBP, rate3),
    col("SLG", "SLG", (s) => B(s).SLG, rate3),
    col("HR", "HR", (s) => B(s).HR, String),
    col("SB", "SB", (s) => B(s).SB, String),
    col("BB", "BB%", (s) => B(s).BBpct, pct1),
    col("K", "K%", (s) => B(s).Kpct, pct1, { asc: true }),
    col("wRC", "wRC+", (s) => B(s).wRCplus, whole, {
      title: "Park-adjusted runs created, 100 = league average",
      cls: (s) => tone(B(s).wRCplus, 115, 85, B(s).PA >= 50),
    }),
    ...(tracked((s) => B(s).xwOBA) ? [col("xwOBA", "xwOBA", (s) => B(s).xwOBA, rate3, { title: "Expected wOBA from exit velocity and launch angle" })] : []),
    ...(tracked((s) => B(s).def) ? [col("Def", "Fld", (s) => B(s).def, (x) => fixed(x), { title: "Fielding runs above average" })] : []),
    ...(tracked((s) => B(s).WAR) ? [col("WAR", "WAR", (s) => B(s).WAR, (x) => fixed(x))] : []),
  ];
}

interface Props {
  rows: PlayerSummary[];
  pitchers: boolean;
  /** Show roster-move controls (the user's own club). */
  manage?: boolean;
  showLevel?: boolean;
  empty?: string;
  sortKey?: string;
  view?: RosterView;
}

export function PlayerTable({ rows, pitchers, manage, showLevel, empty, sortKey, view = "scouting" }: Props) {
  const basics = useBasics();
  const [open, setOpen] = useState<number | null>(null);
  const tools = pitchers ? PITCHER_TOOLS : HITTER_TOOLS;
  const toolIndex = (label: string) => tools.indexOf(label);
  const scouting = view === "scouting";

  let columns: Column<PlayerSummary>[] = [
    { key: "pos", label: "Pos", render: (p) => p.pos, sort: (p) => p.pos, asc: true },
    {
      key: "name",
      label: "Name",
      cls: "name",
      sort: (p) => p.name,
      asc: true,
      render: (p) => (
        <>
          <a href={playerHref(p.id)}>{p.name}</a>
          <StatusBadges p={p} />
        </>
      ),
    },
    ...(showLevel ? [{ key: "lvl", label: "Lvl", render: (p: PlayerSummary) => LEVEL_NAMES[p.level], sort: (p: PlayerSummary) => p.level }] : []),
    { key: "age", label: "Age", cls: "num", sort: (p) => p.age, asc: true, render: (p) => p.age },
    ...(scouting ? [{ key: "bt", label: "B/T", cls: "ctr", render: (p: PlayerSummary) => `${p.bats}/${p.throws}` }] : []),
    { key: "ovr", label: "Now", title: "Your read of his overall grade today (scouts blended with analytics)", cls: "ctr", sort: (p) => p.ovr, render: (p) => <NowGrade p={p} /> },
    { key: "fv", label: "FV", title: "Future value", cls: "ctr", sort: (p) => p.fv, render: (p) => <Grade g={p.fv} /> },
    ...(scouting ? scoutingColumns() : statColumns(pitchers, view, rows, basics)),
  ];

  function scoutingColumns(): Column<PlayerSummary>[] {
    return [
    ...tools.map(
      (t): Column<PlayerSummary> => ({
        key: `t-${t}`,
        label: t,
        title: TOOL_TITLES[t],
        cls: "ctr",
        sort: (p) => p.grades[toolIndex(t)]?.[1] ?? 0,
        render: (p) => {
          const g = p.grades[toolIndex(t)];
          return g ? <Grade g={g[1]} title={`${TOOL_TITLES[t]}: ${Math.round(g[1])}`} /> : null;
        },
      }),
    ),
    { key: "line", label: "This season", render: (p) => <span class="dim">{p.line || "—"}</span> },
    ];
  }
  columns.push(
    {
      key: "pay",
      label: "Salary",
      cls: "num",
      sort: (p) => (p.contract?.type === "minor" ? 0 : (p.contract?.salary ?? 0)),
      render: (p) =>
        !p.contract || p.contract.type === "minor" ? (
          <span class="muted">MiLB</span>
        ) : (
          <span title={p.contract.label}>
            ${p.contract.salary >= 10 ? p.contract.salary.toFixed(1) : p.contract.salary.toFixed(2)}M
            {p.contract.type === "guaranteed" && p.contract.years > 1 ? <span class="muted"> ×{p.contract.years}</span> : null}
          </span>
        ),
    },
    {
      key: "forty",
      label: "40",
      title: "On the 40-man roster",
      cls: "ctr",
      sort: (p) => (p.status.fortyMan ? 1 : 0),
      render: (p) => (p.status.fortyMan ? "●" : <span class="muted">·</span>),
    },
    {
      key: "opt",
      label: "Opt",
      title: "Option years left (* = already optioned this season, which doesn't cost another)",
      cls: "ctr",
      sort: (p) => p.status.optionsLeft,
      render: (p) => (p.status.canBeOptioned || p.status.optionedThisYear ? `${p.status.optionsLeft}${p.status.optionedThisYear ? "*" : ""}` : <span class="muted" title="Out of options (or 5+ years of service)">–</span>),
    },
    { key: "svc", label: "Svc", title: "MLB service time (years.days, 172 days = 1 year)", cls: "num", sort: (p) => Number(p.status.service), render: (p) => p.status.service },
  );
  // The stat views trade salary and service time for width; the grades and option status stay.
  if (!scouting) columns = columns.filter((c) => c.key !== "pay" && c.key !== "svc");
  if (manage) {
    columns.push({
      key: "moves",
      label: "",
      render: (p) => (
        <button type="button" class="btn small" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
          Moves {open === p.id ? "▴" : "▾"}
        </button>
      ),
    });
  }

  // Stat views sort by WAR when there is one; recent form (no WAR) by wRC+ or ERA.
  let initialSort = sortKey;
  let initialAsc = false;
  if (sortKey && !columns.some((c) => c.key === sortKey)) {
    initialSort = pitchers ? "ERA" : "wRC";
    initialAsc = pitchers;
  }

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(p) => p.id}
      sortKey={initialSort}
      sortAsc={initialAsc}
      empty={empty}
      expanded={manage ? (p) => (open === p.id ? <RosterMoves p={p} onDone={() => setOpen(null)} /> : null) : undefined}
    />
  );
}
