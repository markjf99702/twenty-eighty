import { useApi } from "../../api/client";
import type { Status } from "../../api/protocol";
import { ErrorNote, Loading } from "../components/Common";
import { go, href } from "../router";

export function Scores({ day, status }: { day: number | null; status: Status }) {
  const view = useApi("scores", day === null ? {} : { day }, [day]);
  const d = view.data;
  const user = status.userTeamId;
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">Scores</div>
          <h1>{d ? d.date : "…"}</h1>
        </div>
        {d && (
          <div class="toolbar">
            <button type="button" class="btn" disabled={d.day <= d.firstDay} onClick={() => go({ page: "scores", day: d.day - 1 })}>
              ← Previous day
            </button>
            <button type="button" class="btn" disabled={d.day >= d.lastDay} onClick={() => go({ page: "scores", day: d.day + 1 })}>
              Next day →
            </button>
          </div>
        )}
      </div>
      {view.error && <ErrorNote error={view.error} />}
      {!d && !view.error && <Loading />}
      {d && d.games.length === 0 && <div class="empty">{status.day === 0 ? "No games yet. Sim a day to play Opening Day." : "Off day around the league."}</div>}
      {d && d.games.length > 0 && (
        <>
          <div class="scoreboard-grid">
            {d.games.map((g) => {
              const mine = g.awayId === user || g.homeId === user;
              const body = (
                <>
                  <div class={`line${g.score[0] > g.score[1] ? " won" : ""}`}>
                    <span class="team">{g.away}</span>
                    <span class="runs">{g.score[0]}</span>
                  </div>
                  <div class={`line${g.score[1] > g.score[0] ? " won" : ""}`}>
                    <span class="team">{g.home}</span>
                    <span class="runs">{g.score[1]}</span>
                  </div>
                  <div class="pitchers">
                    {g.innings !== 9 ? `F/${g.innings} · ` : ""}
                    {g.wp && `W ${g.wp}`}
                    {g.lp && ` · L ${g.lp}`}
                    {g.sv && ` · S ${g.sv}`}
                  </div>
                </>
              );
              return g.hasBox ? (
                <a key={g.key} class={`game-card${mine ? " mine" : ""}`} href={href({ page: "box", key: g.key })}>
                  {body}
                </a>
              ) : (
                <div key={g.key} class={`game-card${mine ? " mine" : ""}`}>
                  {body}
                </div>
              );
            })}
          </div>
          <div class="small muted">Box scores are kept for the last week of games, and for every one of your club's games.</div>
        </>
      )}
    </>
  );
}
