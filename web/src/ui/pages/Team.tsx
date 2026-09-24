import { useState } from "preact/hooks";
import { bump, call, useApi } from "../../api/client";
import type { PlayerSummary, Status, TeamView } from "../../api/protocol";
import type { DepthChart } from "../../../../src/league/types";
import { FIELD_POSITIONS, MINOR_LEVELS } from "../../../../src/players/types";
import { ErrorNote, Loading, notify, Section, Seg } from "../components/Common";
import { PlayerTable, type RosterView } from "../components/PlayerTable";
import { Grade } from "../components/Grade";
import { type Column, Table } from "../components/Table";
import { LEVEL_NAMES, signed } from "../format";
import { go, playerHref } from "../router";

type Tab = "roster" | "depth" | "farm" | "payroll";

const VIEW_KEY = "twenty-eighty.rosterView";

/** Scouting report or stats, remembered in this browser (storage can be unavailable; that's fine). */
function useRosterView(): [RosterView, (v: RosterView) => void] {
  const [view, setView] = useState<RosterView>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === "stats" || v === "last" || v === "recent" || v === "scouting" ? v : "scouting";
    } catch {
      return "scouting";
    }
  });
  const set = (v: RosterView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private window or blocked storage: the choice lasts until the page closes.
    }
  };
  return [view, set];
}

function ViewSwitch({ view, onChange, year }: { view: RosterView; onChange: (v: RosterView) => void; year: number }) {
  return (
    <Seg<RosterView>
      label="Show"
      value={view}
      options={[
        ["scouting", "Scouting report"],
        ["recent", "Last 15"],
        ["stats", `${year} stats`],
        ["last", `${year - 1} stats`],
      ]}
      onChange={onChange}
    />
  );
}

export function TeamPage({ teamId, tab, status }: { teamId: number; tab: Tab; status: Status }) {
  const view = useApi("team", { teamId }, [teamId]);
  const teams = [...(status.teams ?? [])].sort((a, b) => a.city.localeCompare(b.city));
  const d = view.data;

  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">
            {d ? `${d.team.park}${d.team.altitude >= 1000 ? ` · ${d.team.altitude.toLocaleString()} ft` : ""} · metro ${d.team.market.toFixed(1)}M` : "Club"}
          </div>
          <h1>{d ? `${d.team.city} ${d.team.nickname}` : "…"}</h1>
          {d?.record && (
            <div class="sub">
              {d.record.w}–{d.record.l}, {d.record.rs} runs scored, {d.record.ra} allowed ({signed(d.record.rs - d.record.ra)})
            </div>
          )}
        </div>
        <div class="toolbar">
          <select class="sel" aria-label="Club" value={teamId} onChange={(e) => go({ page: "team", teamId: Number((e.target as HTMLSelectElement).value), tab })}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.city} {t.nickname}
                {t.id === status.userTeamId ? " (yours)" : ""}
              </option>
            ))}
          </select>
          <Seg<Tab>
            label="View"
            value={tab}
            options={[
              ["roster", "Big-league roster"],
              ["depth", "Depth chart"],
              ["farm", "Farm system"],
              ["payroll", "Payroll"],
            ]}
            onChange={(t) => go({ page: "team", teamId, tab: t })}
          />
        </div>
      </div>
      {view.error && <ErrorNote error={view.error} />}
      {!d && !view.error && <Loading />}
      {d && tab === "roster" && <Roster d={d} year={status.year ?? 0} />}
      {d && tab === "depth" && <Depth d={d} />}
      {d && tab === "farm" && <Farm d={d} year={status.year ?? 0} />}
      {d && tab === "payroll" && <Payroll d={d} />}
    </>
  );
}

function Counts({ d }: { d: TeamView }) {
  const c = d.counts;
  return (
    <div class="counts">
      <span class={c.active > c.activeLimit ? "over" : ""}>
        Active <b>{c.active}</b>/{c.activeLimit}
      </span>
      <span class={c.pitchers > c.pitcherLimit ? "over" : ""}>
        Pitchers <b>{c.pitchers}</b>/{c.pitcherLimit}
      </span>
      <span class={c.fortyMan > 40 ? "over" : ""}>
        40-man <b>{c.fortyMan}</b>/40
      </span>
      <span>
        Injured list <b>{d.injured.length}</b>
      </span>
    </div>
  );
}

function Flags({ d }: { d: TeamView }) {
  const set = async (flags: { manualRoster?: boolean; manualDepth?: boolean }) => {
    await call("setFlags", flags);
    bump();
  };
  return (
    <div class="panel" style={{ display: "grid", gap: "8px" }}>
      <label class="check">
        <input type="checkbox" checked={!d.manualRoster} onChange={(e) => set({ manualRoster: !(e.target as HTMLInputElement).checked })} />
        <span>
          <b>Assistant GM handles roster moves.</b> Injuries, call-ups, weekly swaps with Triple-A and farm promotions happen
          automatically. Your own moves still work, but he may undo them later. Turn this off to run everything yourself.
        </span>
      </label>
      <label class="check">
        <input type="checkbox" checked={!d.manualDepth} onChange={(e) => set({ manualDepth: !(e.target as HTMLInputElement).checked })} />
        <span>
          <b>Manager sets the depth chart.</b> Turn this off (or edit the depth chart) to choose the lineup, rotation and bullpen order
          yourself; he'll still fill holes when someone leaves the roster.
        </span>
      </label>
    </div>
  );
}

function Roster({ d, year }: { d: TeamView; year: number }) {
  const hitters = d.active.filter((p) => !p.pitcher);
  const pitchers = d.active.filter((p) => p.pitcher);
  const [view, setView] = useRosterView();
  const statSort = view === "scouting" ? undefined : "WAR";
  return (
    <>
      <div class="toolbar" style={{ justifyContent: "space-between" }}>
        <Counts d={d} />
        <ViewSwitch view={view} onChange={setView} year={year} />
      </div>
      {view !== "scouting" && <StatsKey recent={view === "recent"} />}
      {d.isUser && d.problems.length > 0 && (
        <div class="note alert">
          <b>Roster problems:</b> {d.problems.join(" ")}
        </div>
      )}
      {d.isUser && <Flags d={d} />}
      <Section title="Position players" aside={`${hitters.length}`}>
        <PlayerTable key={`h-${view}`} rows={hitters} pitchers={false} manage={d.isUser} view={view} sortKey={statSort} />
      </Section>
      <Section title="Pitchers" aside={`${pitchers.length}`}>
        <PlayerTable key={`p-${view}`} rows={pitchers} pitchers manage={d.isUser} view={view} sortKey={statSort} />
      </Section>
      <Section title="Injured list" aside={`${d.injured.length}`}>
        {d.injured.some((p) => !p.pitcher) && <PlayerTable rows={d.injured.filter((p) => !p.pitcher)} pitchers={false} manage={d.isUser} view={view} />}
        {d.injured.some((p) => p.pitcher) && <PlayerTable rows={d.injured.filter((p) => p.pitcher)} pitchers manage={d.isUser} view={view} />}
        {d.injured.length === 0 && <div class="empty">Nobody on the injured list.</div>}
      </Section>
    </>
  );
}

function Farm({ d, year }: { d: TeamView; year: number }) {
  const [level, setLevel] = useState<(typeof MINOR_LEVELS)[number]>("AAA");
  const [view, setView] = useRosterView();
  const rows = d.minors[level];
  const sort = view === "scouting" ? "fv" : "WAR";
  return (
    <>
      <div class="toolbar" style={{ justifyContent: "space-between" }}>
        <div class="toolbar">
          <Seg label="Affiliate" value={level} options={MINOR_LEVELS.map((l) => [l, LEVEL_NAMES[l]])} onChange={setLevel} />
          <span class="dim">
            {d.team.affiliates[level]} · {rows.length} players
          </span>
        </div>
        <ViewSwitch view={view} onChange={setView} year={year} />
      </div>
      {view !== "scouting" && <StatsKey minors recent={view === "recent"} />}
      <Section title="Position players">
        <PlayerTable key={`h-${view}-${level}`} rows={rows.filter((p) => !p.pitcher)} pitchers={false} manage={d.isUser} sortKey={sort} view={view} />
      </Section>
      <Section title="Pitchers">
        <PlayerTable key={`p-${view}-${level}`} rows={rows.filter((p) => p.pitcher)} pitchers manage={d.isUser} sortKey={sort} view={view} />
      </Section>
    </>
  );
}

function StatsKey({ minors, recent }: { minors?: boolean; recent?: boolean }) {
  return (
    <div class="small dim stats-key">
      {recent && <span>Last 15 covers the club's last 15 games at each player's level: about three starts for a starting pitcher. </span>}
      <span>
        <span class="good">Blue</span> and <span class="bad">orange</span> mark wRC+ and ERA well above or below league average (once he has 50
        PA or 15 innings);{" "}
      </span>
      <span class="small-sample">faded</span> numbers are small samples.{" "}
      {minors ? "Expected stats and fielding runs are tracked in the majors only." : ""}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Depth chart

const SLOTS = [...FIELD_POSITIONS, "DH"] as const;

function bullpenRole(i: number, n: number): string {
  if (i === 0) return "CL";
  if (i <= 2) return "SU";
  if (i === n - 1) return "LR";
  return "MR";
}

function Depth({ d }: { d: TeamView }) {
  const byId = new Map(d.active.map((p) => [p.id, p]));
  const hitters = d.active.filter((p) => !p.pitcher).sort((a, b) => a.name.localeCompare(b.name));
  const pitchers = d.active.filter((p) => p.pitcher).sort((a, b) => a.name.localeCompare(b.name));
  const depth = d.depth;
  const edit = d.isUser;

  const save = async (next: DepthChart) => {
    const res = await call("setDepth", { depth: next });
    if (!res.ok) notify(res.reason ?? "That depth chart isn't valid.", true);
    bump();
  };

  const slotId = (slot: (typeof SLOTS)[number]) => (slot === "DH" ? depth.dh : depth.starters[slot]);

  const setLineup = (slot: (typeof SLOTS)[number], id: number) => {
    const next: DepthChart = structuredClone(depth);
    const prev = slotId(slot);
    const other = SLOTS.find((s) => s !== slot && (s === "DH" ? next.dh : next.starters[s]) === id);
    const put = (s: (typeof SLOTS)[number], v: number) => {
      if (s === "DH") next.dh = v;
      else next.starters[s] = v;
    };
    put(slot, id);
    if (other) put(other, prev);
    else next.bench = next.bench.map((b) => (b === id ? prev : b));
    void save(next);
  };

  const setRotation = (i: number, id: number) => {
    const next: DepthChart = structuredClone(depth);
    const prev = next.rotation[i]!;
    const j = next.rotation.indexOf(id);
    next.rotation[i] = id;
    if (j >= 0) next.rotation[j] = prev;
    else next.bullpen = next.bullpen.map((b) => (b === id ? prev : b));
    void save(next);
  };

  const moveReliever = (i: number, dir: -1 | 1) => {
    const next: DepthChart = structuredClone(depth);
    const j = i + dir;
    if (j < 0 || j >= next.bullpen.length) return;
    [next.bullpen[i], next.bullpen[j]] = [next.bullpen[j]!, next.bullpen[i]!];
    void save(next);
  };

  const label = (p: PlayerSummary | undefined) => (p ? `${p.name} (${p.pos})` : "—");
  const link = (id: number) => {
    const p = byId.get(id);
    return p ? <a href={playerHref(id)}>{p.name}</a> : <span class="muted">Empty</span>;
  };

  return (
    <>
      {d.isUser ? (
        <div class="note">
          {d.manualDepth
            ? "You're setting the depth chart. Changes save immediately; the manager only fills holes when a player leaves the roster."
            : "The manager is setting the depth chart. Change any slot to take it over."}
        </div>
      ) : (
        <div class="note">This is how their manager lines them up today.</div>
      )}
      <div class="depth">
        <Section title="Lineup">
          {SLOTS.map((slot) => {
            const id = slotId(slot);
            return (
              <div class="depth-row" key={slot}>
                <span class="slot">{slot}</span>
                {edit ? (
                  <select class="sel" aria-label={`Starter at ${slot}`} value={id} onChange={(e) => setLineup(slot, Number((e.target as HTMLSelectElement).value))}>
                    {hitters.map((p) => (
                      <option key={p.id} value={p.id}>
                        {label(p)}
                      </option>
                    ))}
                  </select>
                ) : (
                  link(id)
                )}
                <span class="dim small">{byId.get(id)?.line.split(",").slice(1, 2).join("").trim()}</span>
              </div>
            );
          })}
          <div class="small dim">The manager sets the batting order each day from the nine starters, best hitters at the top.</div>
        </Section>

        <Section title="Bench">
          {depth.bench.length ? (
            depth.bench.map((id) => (
              <div class="depth-row" key={id}>
                <span class="slot">{byId.get(id)?.pos}</span>
                {link(id)}
                <span />
              </div>
            ))
          ) : (
            <div class="empty">No bench players.</div>
          )}
          <div class="small dim">Bench players start on rest days and come in to pinch-hit, pinch-run and play defense late.</div>
        </Section>

        <Section title="Pitching staff">
          {depth.rotation.map((id, i) => (
            <div class="depth-row" key={`sp${i}`}>
              <span class="slot">SP{i + 1}</span>
              {edit ? (
                <select class="sel" aria-label={`Starter ${i + 1}`} value={id} onChange={(e) => setRotation(i, Number((e.target as HTMLSelectElement).value))}>
                  {pitchers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {label(p)}
                    </option>
                  ))}
                </select>
              ) : (
                link(id)
              )}
              <span />
            </div>
          ))}
          {depth.bullpen.map((id, i) => (
            <div class="depth-row" key={`rp${id}`}>
              <span class="slot">{bullpenRole(i, depth.bullpen.length)}</span>
              {link(id)}
              {edit ? (
                <span class="order-btns">
                  <button type="button" class="btn small" disabled={i === 0} aria-label="Move up" onClick={() => moveReliever(i, -1)}>
                    ↑
                  </button>
                  <button type="button" class="btn small" disabled={i === depth.bullpen.length - 1} aria-label="Move down" onClick={() => moveReliever(i, 1)}>
                    ↓
                  </button>
                </span>
              ) : (
                <span />
              )}
            </div>
          ))}
          <div class="small dim">The first reliever closes; the next two set up. Order is how the manager trusts them in close games.</div>
        </Section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Payroll

const money = (x: number) => (Math.abs(x) >= 10 ? `$${x.toFixed(1)}M` : `$${x.toFixed(2)}M`);

function Payroll({ d }: { d: TeamView }) {
  const p = d.payroll;
  const share = Math.min(1.2, (p.payroll + p.staff) / p.budget);
  type Row = TeamView["payroll"]["contracts"][number];
  const columns: Column<Row>[] = [
    { key: "name", label: "Name", cls: "name", sort: (r) => r.name, asc: true, render: (r) => <a href={playerHref(r.id)}>{r.name}</a> },
    { key: "pos", label: "Pos", render: (r) => r.pos },
    { key: "age", label: "Age", cls: "num", sort: (r) => r.age, asc: true, render: (r) => r.age },
    { key: "lvl", label: "Lvl", render: (r) => (r.status.il ?? LEVEL_NAMES[r.level]) },
    { key: "ovr", label: "Now", cls: "ctr", sort: (r) => r.ovr, render: (r) => <Grade g={r.ovr} /> },
    { key: "svc", label: "Svc", title: "Service time (years.days)", cls: "num", sort: (r) => Number(r.status.service), render: (r) => r.status.service },
    { key: "type", label: "Status", render: (r) => ({ "pre-arb": "Pre-arb", arb: "Arbitration", guaranteed: "Signed", minor: "Minors" })[r.contract!.type] },
    { key: "salary", label: "Salary", cls: "num", sort: (r) => r.contract!.salary, render: (r) => money(r.contract!.salary) },
    { key: "through", label: "Through", cls: "num", sort: (r) => r.contract!.through, render: (r) => (r.contract!.type === "guaranteed" ? r.contract!.through : "—") },
    {
      key: "surplus",
      label: "Value",
      title: "Surplus value: projected wins over his years of control at $8M a win, minus salary",
      cls: "num",
      sort: (r) => r.surplus,
      render: (r) => <span class={r.surplus < 0 ? "neg" : ""}>{money(r.surplus)}</span>,
    },
  ];
  return (
    <>
      <div class="payroll-head">
        <div>
          <span class="k">Payroll</span>
          <span class="v">{money(p.payroll)}</span>
        </div>
        <div>
          <span class="k">Budget</span>
          <span class="v">{money(p.budget)}</span>
        </div>
        <div>
          <span class="k" title="Scouting and analytics departments">Staff</span>
          <span class="v">{money(p.staff)}</span>
        </div>
        <div>
          <span class="k">Room</span>
          <span class={`v${p.payroll + p.staff > p.budget ? " neg" : ""}`}>{money(p.budget - p.payroll - p.staff)}</span>
        </div>
        {p.deadMoney > 0 && (
          <div>
            <span class="k">Dead money</span>
            <span class="v neg">{money(p.deadMoney)}</span>
          </div>
        )}
        <div class="budget-bar" role="img" aria-label={`Payroll is ${Math.round(100 * share)}% of budget`}>
          <span style={{ width: `${Math.min(100, (100 * share) / 1.2)}%` }} class={share > 1 ? "over" : ""} />
          <i style={{ left: `${100 / 1.2}%` }} />
        </div>
      </div>
      <Section title="Guaranteed money already committed">
        <div class="facts">
          {p.commitments.map((c) => (
            <div key={c.year}>
              <span class="k">{c.year}</span>
              <span class="v">{money(c.amount)}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Contracts" aside={`${p.contracts.length} big-league deals`}>
        <Table columns={columns} rows={p.contracts} rowKey={(r) => r.id} sortKey="salary" />
      </Section>
    </>
  );
}
