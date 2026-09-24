import { useApi } from "../../api/client";
import type { BoxBatter, BoxPitcher, Status } from "../../api/protocol";
import { ErrorNote, Loading, Section } from "../components/Common";
import { href, playerHref, teamHref } from "../router";

export function BoxScorePage({ gameKey }: { gameKey: string; status: Status }) {
  const view = useApi("boxScore", { key: gameKey }, [gameKey]);
  if (view.error) return <ErrorNote error={view.error} />;
  if (view.loading && !view.data) return <Loading />;
  const b = view.data;
  if (!b) return <div class="empty">That box score is no longer kept. <a href={href({ page: "scores", day: null })}>Back to scores</a></div>;
  const innings = Math.max(9, b.lineScore[0].length, b.lineScore[1].length);
  const day = Number(gameKey.split("-")[0]);
  const homeWon = b.totals[1].r > b.totals[0].r;
  const [winner, loser] = homeWon ? [b.teams[1], b.teams[0]] : [b.teams[0], b.teams[1]];

  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">
            {b.date} · {b.park}
          </div>
          <h1>
            {winner.nickname} {Math.max(b.totals[0].r, b.totals[1].r)}, {loser.nickname} {Math.min(b.totals[0].r, b.totals[1].r)}
            {innings > 9 ? ` (${innings})` : ""}
          </h1>
        </div>
        <a class="btn" href={href({ page: "scores", day })}>
          All scores that day
        </a>
      </div>

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
              <th>E</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1].map((side) => (
              <tr key={side}>
                <td>
                  <a href={teamHref(b.teams[side]!.id)} style={{ color: "inherit" }}>
                    {b.teams[side]!.abbrev}
                  </a>
                </td>
                {Array.from({ length: innings }, (_, i) => (
                  <td key={i}>{b.lineScore[side]![i] ?? (side === 1 && i >= b.lineScore[1].length && i < b.lineScore[0].length ? "x" : "")}</td>
                ))}
                <td class="tot">{b.totals[side]!.r}</td>
                <td>{b.totals[side]!.h}</td>
                <td>{b.totals[side]!.e}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {b.notes.length > 0 && (
        <div class="box-notes">
          {b.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      <div class="grid-2">
        {[0, 1].map((side) => (
          <div class="section" key={side} style={{ gap: "18px" }}>
            <Section title={`${b.teams[side]!.city} ${b.teams[side]!.nickname}`}>
              <Batting rows={b.batting[side]!} />
            </Section>
            <Pitching rows={b.pitching[side]!} />
          </div>
        ))}
      </div>
    </>
  );
}

function Batting({ rows }: { rows: BoxBatter[] }) {
  const tot = rows.reduce((a, r) => ({ ab: a.ab + r.ab, r: a.r + r.r, h: a.h + r.h, rbi: a.rbi + r.rbi, bb: a.bb + r.bb, so: a.so + r.so }), { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0 });
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
            <th class="num" title="Average exit velocity">EV</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} class={r.sub ? "sub-row" : ""}>
              <td class="name">
                <a href={playerHref(r.id)}>{r.name}</a>
                {r.sub && <span class="muted small"> ({r.sub})</span>}
              </td>
              <td>{r.pos}</td>
              <td class="num">{r.ab}</td>
              <td class="num">{r.r}</td>
              <td class="num">{r.h}</td>
              <td class="num">{r.rbi}</td>
              <td class="num">{r.bb}</td>
              <td class="num">{r.so}</td>
              <td class="num">{r.hr || ""}</td>
              <td class="num">{r.avgEv === null ? "" : r.avgEv.toFixed(1)}</td>
            </tr>
          ))}
          <tr>
            <td class="name">Totals</td>
            <td />
            <td class="num">{tot.ab}</td>
            <td class="num">{tot.r}</td>
            <td class="num">{tot.h}</td>
            <td class="num">{tot.rbi}</td>
            <td class="num">{tot.bb}</td>
            <td class="num">{tot.so}</td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Pitching({ rows }: { rows: BoxPitcher[] }) {
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
            <th class="num">HR</th>
            <th class="num">Pit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td class="name">
                <a href={playerHref(r.id)}>{r.name}</a>
                {r.note && <span class="badge acc" style={{ marginLeft: "6px" }}>{r.note}</span>}
              </td>
              <td class="num">{r.ip}</td>
              <td class="num">{r.h}</td>
              <td class="num">{r.r}</td>
              <td class="num">{r.er}</td>
              <td class="num">{r.bb}</td>
              <td class="num">{r.so}</td>
              <td class="num">{r.hr || ""}</td>
              <td class="num">{r.pitches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
