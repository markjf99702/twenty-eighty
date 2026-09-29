import { useEffect, useState } from "preact/hooks";
import { bump, call, useApi } from "../../api/client";
import type { PlayerSummary, PostseasonView, SeriesView, Status } from "../../api/protocol";
import { ErrorNote, Loading, notify, Section } from "../components/Common";
import { Proj } from "../components/Outlook";
import { type Column, Table } from "../components/Table";
import { LEVEL_NAMES, statBrief } from "../format";
import { playerHref, teamHref } from "../router";
import { useBasics } from "../settings";

const seedTag = (t: SeriesView["higher"]) => (t.seed ? `${t.seed}. ` : "");
const scoreText = (g: SeriesView["games"][number]) => `${g.away} ${g.score[0]}, ${g.home} ${g.score[1]}${g.innings > 9 ? ` (${g.innings})` : ""}`;

/** One series in the bracket: the matchup, where it stands, and each game's score. */
function SeriesCard({ s }: { s: SeriesView }) {
  const done = s.winner !== null;
  return (
    <div class={`series${s.mine ? " mine" : ""}`}>
      <span class="round">{s.round}</span>
      <div class="matchup">
        <span class={s.winner === s.higher.abbrev ? "win" : ""}>
          <small class="seed">{s.higher.seed ?? ""}</small> {s.higher.abbrev}
        </span>
        <span class="muted">
          {s.wins[0]}–{s.wins[1]}
        </span>
        <span class={s.winner === s.lower.abbrev ? "win" : ""}>
          {s.lower.abbrev} <small class="seed">{s.lower.seed ?? ""}</small>
        </span>
      </div>
      {!done && <div class="small">{s.games.length ? s.status : s.next ? `Game 1 ${s.next.date}` : ""}</div>}
      {s.games.length > 0 && (
        <div class="games-list">
          {s.games.map((g, i) => (
            <span key={g.key}>
              {i > 0 ? " · " : ""}
              {g.hasBox ? <a href={`#box-${g.key}`}>{scoreText(g)}</a> : scoreText(g)}
            </span>
          ))}
        </div>
      )}
      {s.mvp && (
        <div class="small">
          MVP: <a href={playerHref(s.mvp.playerId)}>{s.mvp.name}</a> <span class="dim">({s.mvp.line})</span>
        </div>
      )}
    </div>
  );
}

/** The user's series, game by game. */
function MySeries({ s, current }: { s: SeriesView; current: boolean }) {
  return (
    <div class={`my-series${current ? " current" : ""}`}>
      <div class="my-series-head">
        <span class="round">{s.round}</span>
        <span class="teams">
          <a href={teamHref(s.higher.id)}>
            {seedTag(s.higher)}
            {s.higher.name}
          </a>
          <b class="series-score">
            {s.wins[0]}–{s.wins[1]}
          </b>
          <a href={teamHref(s.lower.id)}>
            {seedTag(s.lower)}
            {s.lower.name}
          </a>
        </span>
        <span class="state">{s.status}</span>
      </div>
      {s.games.length > 0 && (
        <ol class="game-log">
          {s.games.map((g) => (
            <li key={g.key}>
              <span class="g">G{g.n}</span>
              <span class="d dim">{g.date}</span>
              <span class="recap">{g.recap || scoreText(g)}</span>
              <span class="after dim">{g.after}</span>
              {g.hasBox ? (
                <a class="box" href={`#box-${g.key}`}>
                  Box
                </a>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ol>
      )}
      {s.mvp && (
        <p class="small">
          Series MVP: <a href={playerHref(s.mvp.playerId)}>{s.mvp.name}</a> ({s.mvp.team}), {s.mvp.line}.
        </p>
      )}
    </div>
  );
}

/** Pick the playoff roster (26 from the 40-man) and the order of the rotation. */
function PlanEditor({ onClose }: { onClose: () => void }) {
  const basics = useBasics();
  const view = useApi("playoffPlan", undefined);
  const [roster, setRoster] = useState<Set<number> | null>(null);
  const [rotation, setRotation] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (view.data && roster === null) {
      setRoster(new Set(view.data.roster));
      setRotation(view.data.rotation);
    }
  }, [view.data]);
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data || roster === null) return <Loading />;
  const d = view.data;
  const byId = new Map(d.players.map((p) => [p.id, p]));
  const chosen = [...roster].map((id) => byId.get(id)).filter((p): p is PlayerSummary => !!p);
  const pitchers = chosen.filter((p) => p.pitcher).length;
  const arms = chosen.filter((p) => p.pitcher).sort((a, b) => (b.proj ?? -9) - (a.proj ?? -9));
  const toggle = (id: number) => {
    const next = new Set(roster);
    if (next.has(id)) {
      next.delete(id);
      setRotation(rotation.filter((r) => r !== id));
    } else next.add(id);
    setRoster(next);
  };
  const setSlot = (i: number, id: number | null) => {
    if (id === null) {
      setRotation(rotation.slice(0, i));
      return;
    }
    const next = [...rotation];
    // Picking someone already in the rotation swaps the two.
    const was = next.indexOf(id);
    if (was >= 0 && i < next.length) next[was] = next[i]!;
    else if (was >= 0) next.splice(was, 1);
    next[Math.min(i, next.length)] = id;
    setRotation(next);
  };
  const save = async () => {
    setBusy(true);
    try {
      const res = await call("setPlayoffPlan", { roster: [...roster], rotation });
      if (!res.ok) notify(res.reason ?? "That roster doesn't work.", true);
      else {
        notify("Playoff roster and rotation set.");
        bump();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<PlayerSummary>[] = [
    {
      key: "on",
      label: "",
      render: (p) => (
        <input type="checkbox" aria-label={`${p.name} on the playoff roster`} checked={roster.has(p.id)} disabled={!d.editable} onChange={() => toggle(p.id)} />
      ),
    },
    {
      key: "name",
      label: "Name",
      cls: "name",
      sort: (p) => p.name,
      asc: true,
      render: (p) => (
        <>
          <a href={playerHref(p.id)}>{p.name}</a>
          {p.status.injury && <span class="badge hurt">Hurt {p.status.injury.daysLeft}d</span>}
          <span class="stat-brief">{statBrief(p, basics)}</span>
        </>
      ),
    },
    { key: "pos", label: "Pos", render: (p) => p.pos },
    { key: "lvl", label: "Lvl", render: (p) => LEVEL_NAMES[p.level] },
    { key: "proj", label: "Proj", cls: "num", sort: (p) => p.proj ?? -99, render: (p) => <Proj p={p} word={false} /> },
  ];
  const rows = (pitching: boolean) => d.players.filter((p) => p.pitcher === pitching);

  return (
    <div class="plan-editor">
      <div class="plan-counts">
        <span class={chosen.length === d.limits.roster ? "" : "over"}>
          <b>{chosen.length}</b> of {d.limits.roster} on the roster
        </span>
        <span class={pitchers > d.limits.pitchers ? "over" : ""}>
          <b>{pitchers}</b> pitchers (at most {d.limits.pitchers})
        </span>
      </div>
      <div class="plan-rotation">
        <span class="k">Rotation</span>
        {[0, 1, 2, 3].map((i) => (
          <select
            key={i}
            class="sel"
            aria-label={`Starter ${i + 1}`}
            value={rotation[i] ?? ""}
            disabled={!d.editable || (i > 0 && rotation[i - 1] === undefined)}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              setSlot(i, v === "" ? null : Number(v));
            }}
          >
            <option value="">{i >= 3 ? "No fourth starter" : "Pick a starter"}</option>
            {arms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.proj?.toFixed(1) ?? "–"} WAR)
              </option>
            ))}
          </select>
        ))}
        <span class="small dim">Each series starts from the top with whoever is rested.</span>
      </div>
      <div class="grid-2">
        <Section title="Pitchers" aside={`${pitchers} picked`}>
          <Table columns={columns} rows={rows(true)} rowKey={(p) => p.id} sortKey="proj" rowClass={(p) => (roster.has(p.id) ? "mine" : "")} />
        </Section>
        <Section title="Position players" aside={`${chosen.length - pitchers} picked`}>
          <Table columns={columns} rows={rows(false)} rowKey={(p) => p.id} sortKey="proj" rowClass={(p) => (roster.has(p.id) ? "mine" : "")} />
        </Section>
      </div>
      <div class="offer-actions">
        <button type="button" class="btn primary" disabled={!d.editable || busy} onClick={save}>
          Set the playoff roster
        </button>
        <button type="button" class="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n] ?? "th"}`;

function YourOctober({ d, status }: { d: PostseasonView; status: Status }) {
  const [editing, setEditing] = useState(false);
  const u = d.user;
  if (!u) return null;
  if (u.seed === null) {
    return (
      <div class="note">
        {status.record ? `At ${status.record.w}-${status.record.l}, your club` : "Your club"} missed the postseason. The bracket is below.
      </div>
    );
  }
  const current = u.series.at(-1);
  const champs = d.champion !== null && d.champion === status.teams?.find((t) => t.id === status.userTeamId)?.abbrev;
  return (
    <Section title="Your October" aside={`${ordinal(u.seed)} seed`}>
      {u.next && (
        <div class="next-game">
          <div>
            <span class="k">Next</span>
            <span class="v">
              Game {u.next.n}, {u.next.round}
            </span>
            <span class="dim">
              {u.next.date} · {u.next.home ? "at home against" : "on the road at"} the {u.next.opponent}
            </span>
          </div>
          <div>
            <span class="k">Your starter</span>
            <span class="v">{u.next.starter ? <a href={playerHref(u.next.starter.id)}>{u.next.starter.name}</a> : "TBD"}</span>
            <span class="dim">{u.next.starter?.line}</span>
          </div>
          <div>
            <span class="k">Theirs</span>
            <span class="v">{u.next.theirStarter ? <a href={playerHref(u.next.theirStarter.id)}>{u.next.theirStarter.name}</a> : "TBD"}</span>
            <span class="dim">{u.next.theirStarter?.line}</span>
          </div>
        </div>
      )}
      {!u.alive && !champs && current && (
        <p class="note">
          Your season ended in the {current.round}: {current.status.replace(/ win /, " won ")}.
        </p>
      )}
      {[...u.series].reverse().map((s, i) => (
        <MySeries key={`${s.round}-${i}`} s={s} current={i === 0} />
      ))}
      {u.alive && (
        <div class="plan-line">
          <span>
            Playoff roster: <b>{u.plan.roster}</b> players, {u.plan.pitchers} pitchers.
            {u.plan.rotation.length > 0 && <> Rotation: {u.plan.rotation.map((r) => r.name).join(", ")}.</>}
          </span>
          {!editing && (
            <button type="button" class="btn small" onClick={() => setEditing(true)}>
              Change the roster or rotation
            </button>
          )}
        </div>
      )}
      {editing && <PlanEditor onClose={() => setEditing(false)} />}
    </Section>
  );
}

export function Postseason({ status }: { status: Status }) {
  const view = useApi("postseason", undefined);
  if (view.error) return <ErrorNote error={view.error} />;
  if (view.loading && !view.data) return <Loading />;
  const d = view.data;
  if (!d) {
    return (
      <>
        <div class="page-head">
          <h1>Postseason</h1>
        </div>
        <div class="empty">
          {status.phase === "postseason"
            ? "The regular season is over. Start the postseason from the scoreboard."
            : "Twelve clubs make it: three division winners and three wild cards per league."}
        </div>
      </>
    );
  }
  const champ = status.teams?.find((t) => t.abbrev === d.champion);
  const ws = d.series.find((s) => s.round === "World Series");
  const yours = !!champ && champ.id === status.userTeamId;

  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">{status.year} postseason</div>
          <h1>October</h1>
          {!d.over && d.round && (
            <div class="sub">
              {d.round}
              {d.date ? ` · next games ${d.date}` : ""}
            </div>
          )}
        </div>
      </div>
      {champ && (
        <div class={`champion${yours ? " yours" : ""}`}>
          <span class="k">{yours ? "You won the World Series" : `${status.year} champions`}</span>
          <span class="v">
            <a href={teamHref(champ.id)} style={{ color: "inherit" }}>
              {champ.city} {champ.nickname}
            </a>
          </span>
          {ws && (
            <span class="small" style={{ color: "var(--board-dim)" }}>
              World Series {ws.wins[0] > ws.wins[1] ? `${ws.wins[0]}-${ws.wins[1]}` : `${ws.wins[1]}-${ws.wins[0]}`}: {ws.games.map(scoreText).join(" · ")}
              {ws.mvp ? ` · MVP ${ws.mvp.name}, ${ws.mvp.line}` : ""}
            </span>
          )}
        </div>
      )}
      <YourOctober d={d} status={status} />
      <div class="bracket">
        {d.seeds.map((seeds, i) => {
          const lg = d.leagues[i]!;
          return (
            <Section key={lg} title={lg}>
              <div class="small dim">Seeds: {seeds.map((s, n) => `${n + 1}. ${s.abbrev}`).join("  ")}</div>
              <div class="rounds">
                {d.series
                  .filter((s) => s.league === lg)
                  .map((s, j) => (
                    <SeriesCard key={j} s={s} />
                  ))}
              </div>
            </Section>
          );
        })}
      </div>
      {ws && (
        <Section title="World Series">
          <div class="rounds">
            <SeriesCard s={ws} />
          </div>
        </Section>
      )}
    </>
  );
}
