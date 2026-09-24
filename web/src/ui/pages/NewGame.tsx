import { useMemo, useState } from "preact/hooks";
import { call, useApi } from "../../api/client";
import type { NewGameTeam, Status } from "../../api/protocol";
import { ErrorNote, Loading, notify } from "../components/Common";
import { ScaleLegend } from "../components/Grade";
import { ordinal } from "../format";

/** Rank among 30 clubs, colored like a grade: top third blue, bottom third orange. */
function Rank({ n, title }: { n: number; title: string }) {
  const cls = n <= 5 ? "g70" : n <= 10 ? "g60" : n <= 20 ? "g50" : n <= 25 ? "g40" : "g30";
  return (
    <span class={`gc ${cls}`} title={title}>
      {ordinal(n)}
    </span>
  );
}

const WORDS = ["cutter", "gap", "bullpen", "dugout", "slider", "bleacher", "rosin", "fungo", "chalk", "ivy", "sweeper", "knuckle", "sinker", "warning", "track", "foul", "pole", "rally", "lumber", "mound"];
const randomSeed = () => {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)]!;
  return `${pick()}-${pick()}-${Math.floor(Math.random() * 90) + 10}`;
};

export function NewGame({ onStarted }: { onStarted: (st: Status) => void }) {
  const [seed, setSeed] = useState(randomSeed);
  const [draft, setDraft] = useState(seed);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [minors, setMinors] = useState(true);
  const [starting, setStarting] = useState(false);
  const teams = useApi("newGameTeams", { seed }, [seed]);

  const byDivision = useMemo(() => {
    const out: NewGameTeam[][][] = [[[], [], []], [[], [], []]];
    for (const t of teams.data ?? []) out[t.league]![t.division]!.push(t);
    return out;
  }, [teams.data]);

  const ranks = useMemo(() => {
    const list = teams.data ?? [];
    const rank = (key: "strength" | "farm") => {
      const sorted = [...list].sort((a, b) => b[key] - a[key]);
      return new Map(sorted.map((t, i) => [t.id, i + 1]));
    };
    return { mlb: rank("strength"), farm: rank("farm") };
  }, [teams.data]);

  const chosen = teams.data?.find((t) => t.id === teamId);

  const start = async () => {
    if (teamId === null) return;
    setStarting(true);
    try {
      onStarted(await call("newGame", { seed, teamId, minors }));
    } catch (err) {
      notify((err as Error).message, true);
      setStarting(false);
    }
  };

  const LEAGUES = ["Continental League", "Federal League"];
  const DIVISIONS = ["East", "Central", "West"];

  return (
    <>
      <div class="intro">
        <div>
          <div class="eyebrow">A baseball front office</div>
          <h1>Build a club on the 20–80 scale.</h1>
          <p>
            You're the general manager. Every player in the organization, from the big-league closer to the
            19-year-old in Single-A, carries a present and future grade the way a scout writes them up. The seasons
            are played pitch by pitch, and the numbers come back as wOBA, FIP and WAR.
          </p>
        </div>
        <div class="panel setup">
          <label class="k" for="seed">
            League seed
          </label>
          <div class="row">
            <input
              id="seed"
              class="txt"
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === "Enter" && draft.trim() && setSeed(draft.trim())}
              style={{ flex: "1 1 160px" }}
            />
            <button type="button" class="btn" disabled={!draft.trim() || draft.trim() === seed} onClick={() => setSeed(draft.trim())}>
              Generate
            </button>
            <button
              type="button"
              class="btn ghost"
              onClick={() => {
                const s = randomSeed();
                setDraft(s);
                setSeed(s);
                setTeamId(null);
              }}
            >
              New seed
            </button>
          </div>
          <span class="small muted">The same seed always builds the same 30 organizations and about 4,000 players.</span>
          <label class="check">
            <input type="checkbox" checked={minors} onChange={(e) => setMinors((e.target as HTMLInputElement).checked)} />
            Play the minor league seasons too (four affiliates per club; sims take about 4x longer)
          </label>
          <ScaleLegend />
        </div>
      </div>

      <section class="section">
        <header>
          <h2>Pick your club</h2>
          <span class="aside">MLB and farm ranks are this seed's talent, 1 = best.</span>
        </header>
        {teams.loading && !teams.data && <Loading what="thirty organizations" />}
        {teams.error && <ErrorNote error={teams.error} />}
        {teams.data && (
          <div class="clubs">
            {byDivision.map((divs, lg) => (
              <div key={lg} class="section">
                <div class="eyebrow">{LEAGUES[lg]}</div>
                {divs.map((clubs, d) => (
                  <div class="division" key={d}>
                    <h3>{DIVISIONS[d]}</h3>
                    {clubs.map((t) => (
                      <button type="button" key={t.id} class={`club-pick${t.id === teamId ? " on" : ""}`} aria-pressed={t.id === teamId} onClick={() => setTeamId(t.id)}>
                        <span class="ab">{t.abbrev}</span>
                        <span style={{ minWidth: 0 }}>
                          <span class="nm">
                            {t.city} {t.nickname}
                          </span>
                          <span class="meta">
                            {t.park}
                            {t.altitude >= 1000 ? ` · ${t.altitude.toLocaleString()} ft` : ""} · metro {t.market.toFixed(1)}M
                          </span>
                        </span>
                        <span class="ratings">
                          MLB <Rank n={ranks.mlb.get(t.id)!} title={`Top 13 players average ${t.strength.toFixed(1)} on the 20-80 scale`} />
                          Farm <Rank n={ranks.farm.get(t.id)!} title={`Top 10 prospects average ${t.farm.toFixed(1)} FV`} />
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <div class="start-bar">
        <span class="dim">
          {chosen
            ? `${chosen.city} ${chosen.nickname}: MLB talent ranks ${ranks.mlb.get(chosen.id)} of 30, farm ${ranks.farm.get(chosen.id)} of 30.`
            : "Choose a club to run."}
        </span>
        <button type="button" class="btn primary" disabled={teamId === null || starting} onClick={start}>
          {starting ? "Setting up…" : chosen ? `Take the ${chosen.nickname} job` : "Take the job"}
        </button>
      </div>
    </>
  );
}
