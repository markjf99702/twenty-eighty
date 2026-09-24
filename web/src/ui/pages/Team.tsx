import { useState } from "preact/hooks";
import { bump, call, useApi } from "../../api/client";
import type { PlayerSummary, Status, TeamView } from "../../api/protocol";
import type { DepthChart } from "../../../../src/league/types";
import { FIELD_POSITIONS, MINOR_LEVELS } from "../../../../src/players/types";
import { ErrorNote, Loading, notify, Section, Seg } from "../components/Common";
import { PlayerTable } from "../components/PlayerTable";
import { LEVEL_NAMES, signed } from "../format";
import { go, playerHref } from "../router";

type Tab = "roster" | "depth" | "farm";

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
            ]}
            onChange={(t) => go({ page: "team", teamId, tab: t })}
          />
        </div>
      </div>
      {view.error && <ErrorNote error={view.error} />}
      {!d && !view.error && <Loading />}
      {d && tab === "roster" && <Roster d={d} />}
      {d && tab === "depth" && <Depth d={d} />}
      {d && tab === "farm" && <Farm d={d} />}
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

function Roster({ d }: { d: TeamView }) {
  const hitters = d.active.filter((p) => !p.pitcher);
  const pitchers = d.active.filter((p) => p.pitcher);
  return (
    <>
      <Counts d={d} />
      {d.isUser && d.problems.length > 0 && (
        <div class="note alert">
          <b>Roster problems:</b> {d.problems.join(" ")}
        </div>
      )}
      {d.isUser && <Flags d={d} />}
      <Section title="Position players" aside={`${hitters.length}`}>
        <PlayerTable rows={hitters} pitchers={false} manage={d.isUser} />
      </Section>
      <Section title="Pitchers" aside={`${pitchers.length}`}>
        <PlayerTable rows={pitchers} pitchers manage={d.isUser} />
      </Section>
      <Section title="Injured list" aside={`${d.injured.length}`}>
        {d.injured.some((p) => !p.pitcher) && <PlayerTable rows={d.injured.filter((p) => !p.pitcher)} pitchers={false} manage={d.isUser} />}
        {d.injured.some((p) => p.pitcher) && <PlayerTable rows={d.injured.filter((p) => p.pitcher)} pitchers manage={d.isUser} />}
        {d.injured.length === 0 && <div class="empty">Nobody on the injured list.</div>}
      </Section>
    </>
  );
}

function Farm({ d }: { d: TeamView }) {
  const [level, setLevel] = useState<(typeof MINOR_LEVELS)[number]>("AAA");
  const rows = d.minors[level];
  return (
    <>
      <div class="toolbar">
        <Seg label="Affiliate" value={level} options={MINOR_LEVELS.map((l) => [l, LEVEL_NAMES[l]])} onChange={setLevel} />
        <span class="dim">
          {d.team.affiliates[level]} · {rows.length} players
        </span>
      </div>
      <Section title="Position players">
        <PlayerTable rows={rows.filter((p) => !p.pitcher)} pitchers={false} manage={d.isUser} sortKey="fv" />
      </Section>
      <Section title="Pitchers">
        <PlayerTable rows={rows.filter((p) => p.pitcher)} pitchers manage={d.isUser} sortKey="fv" />
      </Section>
    </>
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
