import { useApi } from "../../api/client";
import type { GameItem, Status, TransactionItem } from "../../api/protocol";
import { ErrorNote, Loading, Section } from "../components/Common";
import { Grade } from "../components/Grade";
import { StatusBadges } from "../components/PlayerTable";
import { LEVEL_NAMES, gamesBack, ordinal, signed, streak } from "../format";
import { href, playerHref, teamHref } from "../router";
import { ConfidenceMeter, GoalList } from "./Owner";

const $m = (x: number) => `${x < 0 ? "-" : ""}$${Math.abs(x).toFixed(1)}M`;

/** The owner's mood and goals beside the club's books. */
function Boardroom() {
  const owner = useApi("owner", undefined);
  const money = useApi("finances", {});
  const o = owner.data;
  const f = money.data;
  if (!o || !f) return null;
  const l = f.current;
  return (
    <div class="grid-2">
      <Section title={`The owner · ${o.owner.name}`} aside={<a href={href({ page: "owner" })}>Owner's office</a>}>
        <ConfidenceMeter value={o.confidence} mood={o.mood} />
        <GoalList goals={o.goals} />
      </Section>
      <Section title={`Business · ${l.year}`} aside={<a href={href({ page: "finances", teamId: null })}>Finances</a>}>
        <div class="read-row">
          <div>
            <span class="k">Fans a game</span>
            <b>{l.perGame ? l.perGame.toLocaleString("en-US") : "—"}</b>
          </div>
          <div>
            <span class="k">Revenue</span>
            <b>{$m(l.revenue.total)}</b>
          </div>
          <div>
            <span class="k">Profit</span>
            <b class={l.profit < 0 ? "bad" : ""}>{$m(l.profit)}</b>
          </div>
          <div>
            <span class="k">Tickets</span>
            <b>${f.ticket.price}</b>
          </div>
          <div>
            <span class="k">Payroll and staff</span>
            <b class={f.payroll + f.staff > f.budget ? "bad" : ""}>
              {$m(f.payroll + f.staff)} of ${f.budget}M
            </b>
          </div>
        </div>
      </Section>
    </div>
  );
}

export function GameList({ games, teamId }: { games: GameItem[]; teamId: number }) {
  if (games.length === 0) return <div class="empty">No games yet. Opening Day is March 26.</div>;
  return (
    <div class="games">
      {games.map((g) => {
        const home = g.homeId === teamId;
        const us = home ? g.score[1] : g.score[0];
        const them = home ? g.score[0] : g.score[1];
        const won = us > them;
        return (
          <div class="game-row" key={g.key}>
            <span class={`badge ${won ? "w" : "l"}`}>{won ? "W" : "L"}</span>
            <span class="nowrap">
              {us}–{them}
              {g.innings > 9 ? ` (${g.innings})` : ""}
            </span>
            <span class="opp">
              {home ? "vs" : "at"} {home ? g.away : g.home}
            </span>
            {g.hasBox ? (
              <a class="small" href={href({ page: "box", key: g.key })}>
                Box
              </a>
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Wire({ items, showClub = true }: { items: TransactionItem[]; showClub?: boolean }) {
  if (items.length === 0) return <div class="empty">Quiet so far.</div>;
  return (
    <div class="wire">
      {items.map((t, i) => (
        <div class={`wire-item${t.type === "injury" ? " injury" : ""}`} key={i} style={showClub ? undefined : { gridTemplateColumns: "52px minmax(0, 1fr)" }}>
          <span class="date">{t.date}</span>
          {showClub && <span class="club">{t.abbrev}</span>}
          <a class="text" href={playerHref(t.playerId)} style={{ color: "inherit" }}>
            {t.text}
          </a>
        </div>
      ))}
    </div>
  );
}

export function Dashboard({ status }: { status: Status }) {
  const view = useApi("dashboard", undefined);
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const d = view.data;
  const r = d.record;
  const division = `${status.leagues?.[d.team.league]?.replace(" League", "")} ${status.divisions?.[d.team.division]}`;
  const played = r.w + r.l;

  return (
    <>
      <div class="club-hero">
        <div>
          <div class="eyebrow">Your club · {status.year}</div>
          <h1>
            <a href={teamHref(d.team.id)} style={{ color: "inherit" }}>
              {d.team.city} {d.team.nickname}
            </a>
          </h1>
        </div>
        <div class="rec">
          {r.w}–{r.l}
        </div>
        <div class="stat-strip">
          <div>
            <span class="k">{division}</span>
            <span class="v">{played ? `${ordinal(r.divRank)}${r.gb > 0 ? `, ${gamesBack(r.gb)} GB` : ""}` : "—"}</span>
          </div>
          <div>
            <span class="k">Run diff</span>
            <span class="v">{played ? signed(r.rs - r.ra) : "—"}</span>
          </div>
          <div>
            <span class="k">Streak</span>
            <span class="v">{streak(r.streak)}</span>
          </div>
          <div>
            <span class="k">Last 10</span>
            <span class="v">{played ? r.last10 : "—"}</span>
          </div>
        </div>
      </div>

      {status.phase === "offseason" && status.winter && (
        <div class="note warn">
          It's the offseason: <b>{status.winter.label}</b>. <a href={href({ page: "winter" })}>Go to the offseason desk</a>. The numbers below are
          from the {status.year} season.
        </div>
      )}
      {status.phase === "done" && <div class="note">The {status.year} season is in the books. Start the offseason from the scoreboard.</div>}
      {status.owner?.fired && (
        <div class="note alert">
          You've been let go. <a href={href({ page: "owner" })}>See which clubs called</a>.
        </div>
      )}

      {status.day === 0 && status.phase === "regular" && (
        <div class="note">
          Welcome to the job. The scoreboard's <b>Sim</b> buttons play the schedule a day, a week or a month at a time. Your
          assistant GM handles injuries and call-ups until you take over under <a href={teamHref(d.team.id)}>My club</a>, where
          every player's roster moves (call up, option, DFA, the injured list) are one click away.
        </div>
      )}

      <div class="grid-3">
        <Section title="Division" aside={<a href={href({ page: "standings", level: "MLB" })}>Standings</a>}>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Club</th>
                  <th class="num">W</th>
                  <th class="num">L</th>
                  <th class="num">GB</th>
                  <th class="num">Diff</th>
                </tr>
              </thead>
              <tbody>
                {d.division.map((row) => (
                  <tr key={row.teamId} class={row.teamId === d.team.id ? "mine" : ""}>
                    <td class="name">
                      <a href={teamHref(row.teamId)}>{row.name}</a>
                    </td>
                    <td class="num">{row.w}</td>
                    <td class="num">{row.l}</td>
                    <td class="num">{gamesBack(row.gb)}</td>
                    <td class="num">{signed(row.rs - row.ra)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Recent games" aside={<a href={href({ page: "scores", day: null })}>Scores</a>}>
          <GameList games={d.recent} teamId={d.team.id} />
        </Section>

        <Section title="Club leaders">
          {d.leaders.length ? (
            <div class="leaders">
              {d.leaders.map((l) => (
                <div class="leader" key={l.label}>
                  <span class="k">{l.label}</span>
                  <span class="v">{l.value}</span>
                  <a href={playerHref(l.playerId)}>{l.name}</a>
                </div>
              ))}
            </div>
          ) : (
            <div class="empty">Leaders appear once games are played.</div>
          )}
        </Section>
      </div>

      {status.owner && <Boardroom />}

      <div class="grid-2">
        <Section title="Injuries" aside={`${d.injured.length} player${d.injured.length === 1 ? "" : "s"}`}>
          {d.injured.length ? (
            <div class="tbl-wrap">
              <table class="tbl">
                <tbody>
                  {d.injured.map((p) => (
                    <tr key={p.id}>
                      <td>{p.pos}</td>
                      <td class="name">
                        <a href={playerHref(p.id)}>{p.name}</a>
                        <StatusBadges p={p} />
                      </td>
                      <td class="dim wrap">{p.status.injury?.name ?? "Recovering"}</td>
                      <td class="num">{p.status.injury ? `${p.status.injury.daysLeft}d` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div class="empty">Everybody's healthy.</div>
          )}
        </Section>

        <Section title="Top prospects" aside={<a href={href({ page: "team", teamId: d.team.id, tab: "farm" })}>Farm system</a>}>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Pos</th>
                  <th class="num">Age</th>
                  <th>Level</th>
                  <th class="ctr" title="Overall grade today">Now</th>
                  <th class="ctr" title="Future value">FV</th>
                </tr>
              </thead>
              <tbody>
                {d.prospects.map((p) => (
                  <tr key={p.id}>
                    <td class="name">
                      <a href={playerHref(p.id)}>{p.name}</a>
                    </td>
                    <td>{p.pos}</td>
                    <td class="num">{p.age}</td>
                    <td>{LEVEL_NAMES[p.level]}</td>
                    <td class="ctr">
                      <Grade g={p.ovr} />
                    </td>
                    <td class="ctr">
                      <Grade g={p.fv} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <div class="grid-2">
        <Section title="Your moves" aside={<a href={href({ page: "moves", mine: true })}>All</a>}>
          <Wire items={d.userNews} showClub={false} />
        </Section>
        <Section title="Around the league" aside={<a href={href({ page: "moves", mine: false })}>Wire</a>}>
          <Wire items={d.news} />
        </Section>
      </div>
    </>
  );
}
