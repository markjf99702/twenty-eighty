import { useApi } from "../../api/client";
import type { HallView } from "../../api/protocol";
import { ErrorNote, Loading, Section } from "../components/Common";
import { href, playerHref } from "../router";

/** The Hall of Fame: the last ballot, then every member's plaque, newest class first. */
export function Hall() {
  const view = useApi("hall", undefined);
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">{v.members.length} members</div>
          <h1>Hall of Fame</h1>
        </div>
        <a class="btn" href={href({ page: "records", kind: "career", teamId: null })}>
          Career records
        </a>
      </div>
      {v.ballot ? <Ballot ballot={v.ballot} /> : null}
      <p class="small dim">
        Each winter the writers vote on players who retired two winters before with ten or more big-league seasons and a case worth a look.
        It takes 75% to get in; under 5%, or ten years on the ballot, and a player comes off. They weigh WAR first, then MVPs, Cy Youngs and
        All-Star teams, and the round numbers: 500 home runs, 3,000 hits, 300 wins, 3,000 strikeouts, a pile of saves.
      </p>
      <Section title="Members" aside="Newest class first">
        <div class="plaques">
          {v.members.map((m) => (
            <div class={`plaque${m.mine ? " mine" : ""}`} key={`${m.playerId ?? "l"}-${m.legendId ?? m.playerId}`}>
              <div class="plaque-class">Class of {m.inducted}</div>
              <div class="plaque-name">{m.playerId !== null ? <a href={playerHref(m.playerId)}>{m.name}</a> : m.name}</div>
              <div class="plaque-meta">
                {m.pos} · {m.years}
                {m.team && ` · ${m.team}`}
              </div>
              <div class="plaque-line">{m.line}</div>
              <div class="plaque-vote dim small">{m.vote.toFixed(1)}% of the vote</div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function Ballot({ ballot }: { ballot: NonNullable<HallView["ballot"]> }) {
  return (
    <Section title={`${ballot.year} ballot`} aside={`${ballot.entries.filter((e) => e.elected).length} elected`}>
      <div class="tbl-wrap">
        <table class="tbl ballot">
          <thead>
            <tr>
              <th>Player</th>
              <th>Career</th>
              <th class="num" title="Year on the ballot">Yr</th>
              <th class="vote-col">Vote</th>
            </tr>
          </thead>
          <tbody>
            {ballot.entries.map((e) => (
              <tr key={e.playerId}>
                <td class="name">
                  <a href={playerHref(e.playerId)}>{e.name}</a> <span class="muted">{e.pos}</span>
                </td>
                <td class="dim small">{e.line}</td>
                <td class="num">{e.ballot}</td>
                <td class="vote-col">
                  <span class="vote-bar" aria-hidden="true">
                    <span class={e.elected ? "in" : ""} style={{ width: `${Math.min(100, e.vote)}%` }} />
                    <span class="line75" />
                  </span>
                  <span class="num">{e.vote.toFixed(1)}%</span>
                  {e.elected ? <b class="elected"> Elected</b> : e.dropped ? <span class="dim"> Off the ballot</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
