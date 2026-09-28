import { useEffect, useState } from "preact/hooks";
import { useApi } from "../../api/client";
import type { Status } from "../../api/protocol";
import { ErrorNote, Loading, Seg } from "../components/Common";
import { go } from "../router";
import { Wire } from "./Dashboard";

/** How much of the wire to show: the news, every big-league move, or everything down to the minor league shuffles. */
type Scope = "headlines" | "major" | "all";

export function Transactions({ mine, status }: { mine: boolean; status: Status }) {
  // The league's wire opens on the headlines; your own club's on every big-league move.
  const [scope, setScope] = useState<Scope>(mine ? "major" : "headlines");
  useEffect(() => setScope(mine ? "major" : "headlines"), [mine]);
  const [team, setTeam] = useState<number | "all">("all");
  const user = status.userTeamId ?? null;
  const teamId = mine && user !== null ? user : team === "all" ? undefined : team;
  const view = useApi(
    "transactions",
    { ...(teamId !== undefined ? { teamId } : {}), majorOnly: scope !== "all", headlines: scope === "headlines", limit: 300 },
    [teamId, scope],
  );
  const teams = [...(status.teams ?? [])].sort((a, b) => a.city.localeCompare(b.city));

  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">{status.year}</div>
          <h1>Transactions</h1>
        </div>
        <div class="toolbar">
          {user !== null && (
            <Seg
              label="Club"
              value={mine ? "mine" : "all"}
              options={[
                ["mine", "My club"],
                ["all", "League"],
              ]}
              onChange={(v) => go({ page: "moves", mine: v === "mine" })}
            />
          )}
          {!mine && (
            <select
              class="sel"
              aria-label="Club"
              value={String(team)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value;
                setTeam(v === "all" ? "all" : Number(v));
              }}
            >
              <option value="all">All clubs</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.city} {t.nickname}
                </option>
              ))}
            </select>
          )}
          <Seg<Scope>
            label="Show"
            value={scope}
            options={[
              ["headlines", "Headlines"],
              ["major", "Big-league moves"],
              ["all", "Everything"],
            ]}
            onChange={setScope}
          />
        </div>
      </div>
      {scope === "headlines" && (
        <p class="small dim">
          Trades, extensions, big-league free-agent deals, first-round picks and big international bonuses, top prospects' debuts,
          injuries that cost two months (three weeks for a star), waiver claims of players who help, and retirements after real
          careers.
        </p>
      )}
      {view.error && <ErrorNote error={view.error} />}
      {!view.data && !view.error && <Loading />}
      {view.data && <Wire items={view.data} showClub={!mine} />}
    </>
  );
}
