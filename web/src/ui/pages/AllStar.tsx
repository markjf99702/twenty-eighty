import { useApi } from "../../api/client";
import type { AllStarBatRow, AllStarPitchRow, AllStarView } from "../../api/protocol";
import { ErrorNote, Loading, Section } from "../components/Common";
import { href, playerHref } from "../router";

/** This season's All-Star Game: the line score, both boxes, who didn't get in, and your All-Stars. */
export function AllStar() {
  const view = useApi("allStar", undefined, []);
  if (view.error) return <ErrorNote error={view.error} />;
  if (view.loading && !view.data) return <Loading />;
  const g = view.data;
  if (!g) {
    return (
      <div class="empty">
        The All-Star Game is played in mid-July, on the second day of the break. <a href={href({ page: "home" })}>Back to the front office</a>
      </div>
    );
  }
  const won = g.score[0] > g.score[1] ? 0 : 1;
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">
            {g.year} All-Star Game · {g.date} · {g.where}
          </div>
          <h1>
            {g.leagues[won]} {g.score[won]}, {g.leagues[1 - won]} {g.score[1 - won]}
            {g.innings > 9 ? ` (${g.innings})` : ""}
          </h1>
        </div>
      </div>

      <LineScore g={g} />

      <div class="allstar-notes">
        {g.mvp && (
          <div>
            <span class="k">MVP</span> <a href={playerHref(g.mvp.playerId)}>{g.mvp.name}</a> <span class="muted">{g.mvp.team}</span>, {g.mvp.note}
          </div>
        )}
        <div>
          <span class="k">Your All-Stars</span>{" "}
          {g.mine.length === 0
            ? "none this year"
            : g.mine.map((p, i) => (
                <span key={p.playerId}>
                  {i > 0 ? ", " : ""}
                  <a href={playerHref(p.playerId)}>{p.name}</a>
                </span>
              ))}
        </div>
      </div>

      <div class="grid-2">
        {g.sides.map((side, s) => (
          <div class="section" key={s} style={{ gap: "18px" }}>
            <Section title={`${side.league} League`} aside={s === 0 ? "Visitors" : "Home"}>
              <Batting rows={side.batting} />
            </Section>
            <Pitching rows={side.pitching} />
            {side.unused.length > 0 && (
              <div class="small dim">
                Also named:{" "}
                {side.unused.map((p, i) => (
                  <span key={p.playerId} class={p.mine ? "mine" : ""}>
                    {i > 0 ? ", " : ""}
                    <a href={playerHref(p.playerId)}>{p.name}</a> ({p.pos}, {p.team})
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <p class="small dim">
        The fans vote in the starters (wins first, with a thumb on the scale for homers and average), every club sends at least one
        player, and the pitchers work an inning or two apiece. It counts for nothing but the record: no stats, no wear, no injuries.
      </p>
    </>
  );
}

function LineScore({ g }: { g: AllStarView }) {
  const innings = Math.max(9, g.lineScore[0].length, g.lineScore[1].length);
  const hits = g.sides.map((s) => s.batting.reduce((n, b) => n + b.H, 0));
  return (
    <div class="linescore-wrap">
      <table>
        <thead>
          <tr>
            <th />
            {Array.from({ length: innings }, (_, i) => (
              <th key={i}>{i + 1}</th>
            ))}
            <th class="tot">R</th>
            <th>H</th>
          </tr>
        </thead>
        <tbody>
          {[0, 1].map((side) => (
            <tr key={side}>
              <td>{g.leagues[side]}</td>
              {Array.from({ length: innings }, (_, i) => (
                <td key={i}>{g.lineScore[side]![i] ?? (side === 1 && i >= g.lineScore[1].length && i < g.lineScore[0].length ? "x" : "")}</td>
              ))}
              <td class="tot">{g.score[side]}</td>
              <td>{hits[side]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Batting({ rows }: { rows: AllStarBatRow[] }) {
  return (
    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>Batter</th>
            <th>Pos</th>
            <th class="num">AB</th>
            <th class="num">R</th>
            <th class="num">H</th>
            <th class="num">RBI</th>
            <th class="num">BB</th>
            <th class="num">SO</th>
            <th class="num">HR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId} class={`${r.starter ? "" : "sub-row"}${r.mine ? " mine" : ""}`}>
              <td class="name">
                <a href={playerHref(r.playerId)}>{r.name}</a> <span class="muted small">{r.team}</span>
              </td>
              <td>{r.pos}</td>
              <td class="num">{r.AB}</td>
              <td class="num">{r.R}</td>
              <td class="num">{r.H}</td>
              <td class="num">{r.RBI}</td>
              <td class="num">{r.BB}</td>
              <td class="num">{r.SO}</td>
              <td class="num">{r.HR || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pitching({ rows }: { rows: AllStarPitchRow[] }) {
  return (
    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>Pitcher</th>
            <th class="num">IP</th>
            <th class="num">H</th>
            <th class="num">R</th>
            <th class="num">ER</th>
            <th class="num">BB</th>
            <th class="num">SO</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId} class={r.mine ? "mine" : ""}>
              <td class="name">
                <a href={playerHref(r.playerId)}>{r.name}</a> <span class="muted small">{r.team}</span>
              </td>
              <td class="num">{r.IP}</td>
              <td class="num">{r.H}</td>
              <td class="num">{r.R}</td>
              <td class="num">{r.ER}</td>
              <td class="num">{r.BB}</td>
              <td class="num">{r.SO}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
