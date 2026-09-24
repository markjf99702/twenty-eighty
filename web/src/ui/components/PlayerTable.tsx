import { useState } from "preact/hooks";
import { bump, call } from "../../api/client";
import type { PlayerSummary, RosterActionOption } from "../../api/protocol";
import { LEVEL_NAMES } from "../format";
import { playerHref } from "../router";
import { notify } from "./Common";
import { Grade } from "./Grade";
import { type Column, Table } from "./Table";

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

interface Props {
  rows: PlayerSummary[];
  pitchers: boolean;
  /** Show roster-move controls (the user's own club). */
  manage?: boolean;
  showLevel?: boolean;
  empty?: string;
  sortKey?: string;
}

export function PlayerTable({ rows, pitchers, manage, showLevel, empty, sortKey }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const tools = pitchers ? PITCHER_TOOLS : HITTER_TOOLS;
  const toolIndex = (label: string) => tools.indexOf(label);

  const columns: Column<PlayerSummary>[] = [
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
    { key: "bt", label: "B/T", cls: "ctr", render: (p) => `${p.bats}/${p.throws}` },
    { key: "ovr", label: "Now", title: "Overall grade today", cls: "ctr", sort: (p) => p.ovr, render: (p) => <Grade g={p.ovr} /> },
    { key: "fv", label: "FV", title: "Future value", cls: "ctr", sort: (p) => p.fv, render: (p) => <Grade g={p.fv} /> },
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
  ];
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

  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(p) => p.id}
      sortKey={sortKey}
      empty={empty}
      expanded={manage ? (p) => (open === p.id ? <RosterMoves p={p} onDone={() => setOpen(null)} /> : null) : undefined}
    />
  );
}
