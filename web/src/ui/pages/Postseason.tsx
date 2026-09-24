import { useApi } from "../../api/client";
import type { PostseasonView, Status } from "../../api/protocol";
import { ErrorNote, Loading, Section } from "../components/Common";
import { teamHref } from "../router";

type Series = PostseasonView["series"][number];

function SeriesCard({ s }: { s: Series }) {
  const higherWon = s.winner === s.higher;
  return (
    <div class="series">
      <span class="round">{s.round}</span>
      <div class="matchup">
        <span class={higherWon ? "win" : ""}>{s.higher}</span>
        <span class="muted">
          {s.wins[0]}–{s.wins[1]}
        </span>
        <span class={!higherWon ? "win" : ""}>{s.lower}</span>
      </div>
      <div class="games-list">{s.games.join(" · ")}</div>
    </div>
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
          {status.phase === "postseason" ? "The regular season is over. Use “Play the postseason” in the scoreboard." : "Twelve clubs make it: three division winners and three wild cards per league."}
        </div>
      </>
    );
  }
  const champ = status.teams?.find((t) => t.abbrev === d.champion);
  const leagues = [...new Set(d.series.filter((s) => s.league).map((s) => s.league))];
  const ws = d.series.find((s) => s.round === "World Series");

  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">{status.year} postseason</div>
          <h1>October</h1>
        </div>
      </div>
      {champ && (
        <div class="champion">
          <span class="k">{status.year} champions</span>
          <span class="v">
            <a href={teamHref(champ.id)} style={{ color: "inherit" }}>
              {champ.city} {champ.nickname}
            </a>
          </span>
          {ws && (
            <span class="small" style={{ color: "var(--board-dim)" }}>
              World Series: {ws.games.join(" · ")}
            </span>
          )}
        </div>
      )}
      <div class="bracket">
        {leagues.map((lg, i) => (
          <Section key={lg} title={lg}>
            <div class="small dim">
              Seeds: {d.seeds[i]!.map((s, n) => `${n + 1}. ${s.abbrev}`).join("  ")}
            </div>
            <div class="rounds">
              {d.series
                .filter((s) => s.league === lg)
                .map((s, j) => (
                  <SeriesCard key={j} s={s} />
                ))}
            </div>
          </Section>
        ))}
      </div>
    </>
  );
}
