import { useApi } from "../../api/client";
import type { Status } from "../../api/protocol";
import { ErrorNote, Loading, Section } from "../components/Common";
import { playerHref } from "../router";

export function History({ status }: { status: Status }) {
  const view = useApi("history", undefined);
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const seasons = view.data.seasons;
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">Since {status.seed}</div>
          <h1>League history</h1>
        </div>
      </div>
      {seasons.length === 0 ? (
        <div class="empty">History starts when the first season ends.</div>
      ) : (
        <>
          <Section title="Champions">
            <div class="tbl-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Champion</th>
                    <th>Runner-up</th>
                    <th>Your club</th>
                  </tr>
                </thead>
                <tbody>
                  {seasons.map((s) => (
                    <tr key={s.year}>
                      <td class="num">{s.year}</td>
                      <td class="name">{s.champion}</td>
                      <td>{s.runnerUp ?? "—"}</td>
                      <td class="dim">{s.mine ? `${s.mine.record}, ${s.mine.finish.toLowerCase()}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title="Awards">
            <div class="tbl-wrap">
              <table class="tbl">
                <tbody>
                  {seasons.flatMap((s) =>
                    s.awards.map((a) => (
                      <tr key={`${s.year}-${a.name}-${a.league}`}>
                        <td class="num">{s.year}</td>
                        <td class="nowrap">
                          {a.league} {a.name}
                        </td>
                        <td class="name">
                          <a href={playerHref(a.playerId)}>{a.player}</a> <span class="muted">{a.team}</span>
                        </td>
                        <td class="dim wrap">{a.note}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
