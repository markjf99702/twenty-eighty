import { useState } from "preact/hooks";
import { useApi } from "../../api/client";
import type { Status } from "../../api/protocol";
import { ErrorNote, Loading, Seg } from "../components/Common";
import { go } from "../router";
import { Wire } from "./Dashboard";

export function Transactions({ mine, status }: { mine: boolean; status: Status }) {
  const [major, setMajor] = useState(true);
  const [team, setTeam] = useState<number | "all">("all");
  const user = status.userTeamId ?? null;
  const teamId = mine && user !== null ? user : team === "all" ? undefined : team;
  const view = useApi("transactions", { ...(teamId !== undefined ? { teamId } : {}), majorOnly: major, limit: 300 }, [teamId, major]);
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
              label="Scope"
              value={mine ? "mine" : "all"}
              options={[
                ["mine", "My club"],
                ["all", "League"],
              ]}
              onChange={(v) => go({ page: "moves", mine: v === "mine" })}
            />
          )}
          {!mine && (
            <select class="sel" aria-label="Club" value={String(team)} onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              setTeam(v === "all" ? "all" : Number(v));
            }}>
              <option value="all">All clubs</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.city} {t.nickname}
                </option>
              ))}
            </select>
          )}
          <label class="check">
            <input type="checkbox" checked={!major} onChange={(e) => setMajor(!(e.target as HTMLInputElement).checked)} />
            Include minor league shuffles
          </label>
        </div>
      </div>
      {view.error && <ErrorNote error={view.error} />}
      {!view.data && !view.error && <Loading />}
      {view.data && <Wire items={view.data} showClub={!mine} />}
    </>
  );
}
