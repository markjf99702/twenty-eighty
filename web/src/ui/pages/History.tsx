import { useState } from "preact/hooks";
import { useApi } from "../../api/client";
import { AwardsBlock } from "../components/Awards";
import type { Status } from "../../api/protocol";
import { ErrorNote, Loading, Section } from "../components/Common";

export function History({ status }: { status: Status }) {
  const view = useApi("history", undefined);
  const [year, setYear] = useState<number | null>(null);
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const seasons = view.data.seasons;
  const shown = seasons.find((s) => s.year === year) ?? seasons[0];
  const first = seasons.length ? Math.min(...seasons.map((s) => s.year)) : status.year;
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">Since {first}</div>
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
          <div class="history-awards">
            <label class="year-pick">
              <span class="k">Awards for</span>{" "}
              <select value={shown?.year} onChange={(e) => setYear(Number((e.target as HTMLSelectElement).value))}>
                {seasons.map((s) => (
                  <option key={s.year} value={s.year}>
                    {s.year}
                  </option>
                ))}
              </select>
            </label>
            {shown && <AwardsBlock awards={shown.awards} executives={shown.executives} allStar={shown.allStar} />}
          </div>
        </>
      )}
    </>
  );
}
