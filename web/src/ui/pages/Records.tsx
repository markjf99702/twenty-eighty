import { useApi } from "../../api/client";
import type { MomentView, RecordsView, RecordRowView } from "../../api/protocol";
import { ErrorNote, Loading, Seg, Section } from "../components/Common";
import { href, playerHref } from "../router";

type Kind = "season" | "career" | "moments";

/** The record book: the best seasons and careers, league-wide or one club's, and the moments. */
export function Records({ kind, teamId }: { kind: Kind; teamId: number | null }) {
  const view = useApi("records", { kind, teamId }, [kind, teamId]);
  const go = (k: Kind, t: number | null) => (location.hash = href({ page: "records", kind: k, teamId: t }));
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">
            {v.scope} · {kind === "moments" ? `since ${v.since}` : "all time"}
          </div>
          <h1>Record book</h1>
        </div>
        <a class="btn" href={href({ page: "hall" })}>
          Hall of Fame
        </a>
      </div>
      <div class="records-controls">
        <Seg<Kind>
          label="Records"
          value={kind}
          options={[
            ["season", "Single season"],
            ["career", "Career"],
            ["moments", "Moments"],
          ]}
          onChange={(k) => go(k, teamId)}
        />
        <label class="year-pick">
          <span class="k">For</span>{" "}
          <select value={teamId ?? ""} onChange={(e) => go(kind, (e.target as HTMLSelectElement).value === "" ? null : Number((e.target as HTMLSelectElement).value))}>
            <option value="">The whole league</option>
            {v.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind === "moments" ? <Moments moments={v.moments} /> : <Categories v={v} kind={kind} teamId={teamId} />}
    </>
  );
}

function Categories({ v, kind, teamId }: { v: RecordsView; kind: Kind; teamId: number | null }) {
  const group = (pitching: boolean) => v.categories.filter((c) => c.pitching === pitching);
  return (
    <>
      <p class="small dim">
        {kind === "season"
          ? "The best single seasons, from the league's legends to this year (an asterisk marks this season, still being played). Batting average needs 502 plate appearances, ERA 162 innings."
          : `The best careers: the legends, retired players and active ones (in bold), counting what veterans did before ${v.since}. Batting average needs 4,000 plate appearances, ERA 1,500 innings.`}
        {teamId !== null && " For one club, only seasons with it count (careers from before the league's first season don't)."}
      </p>
      {[false, true].map((pitching) => (
        <div key={String(pitching)} class="records-group">
          <h2 class="records-head">{pitching ? "Pitching" : "Hitting"}</h2>
          <div class="records-grid">
            {group(pitching).map((c) => (
              <Section key={c.stat} title={c.label}>
                <Board rows={c.rows} />
              </Section>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function Board({ rows }: { rows: RecordRowView[] }) {
  if (rows.length === 0) return <div class="empty">No one yet.</div>;
  return (
    <table class="tbl record-board">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} class={r.mine ? "mine" : ""}>
            <td class="num rank">{i + 1}</td>
            <td class="name">
              {r.playerId !== null ? (
                <a href={playerHref(r.playerId)} class={r.active ? "active" : ""}>
                  {r.name}
                </a>
              ) : (
                <a href={href({ page: "hall" })} class="legend" title="A legend from before the league's first season">
                  {r.name}
                </a>
              )}
              <span class="muted small"> {r.team}</span>
            </td>
            <td class="dim small when">{r.when}</td>
            <td class="num value">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Moments({ moments }: { moments: MomentView[] }) {
  if (moments.length === 0) return <div class="empty">No-hitters, cycles, milestones and records show up here as they happen.</div>;
  const years = [...new Set(moments.map((m) => m.year))];
  return (
    <>
      {years.map((y) => (
        <Section key={y} title={String(y)} aside={`${moments.filter((m) => m.year === y).length}`}>
          <MomentList moments={moments.filter((m) => m.year === y)} />
        </Section>
      ))}
    </>
  );
}

/** Moments as a list: the date, what happened, and the box score while it's kept. */
export function MomentList({ moments }: { moments: MomentView[] }) {
  return (
    <ul class="moments">
      {moments.map((m, i) => (
        <li key={i} class={`${m.kind}${m.mine ? " mine" : ""}`}>
          <span class="d dim">{m.date.replace(/, \d{4}$/, "")}</span>
          <span class="t">
            <a href={playerHref(m.playerId)}>{m.text}</a>
          </span>
          {m.box && (
            <a class="box small" href={`#box-${m.box}`}>
              Box
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
