import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { call } from "../../api/client";
import type { GameSettings, NewGameTeam, Status } from "../../api/protocol";
import { SettingsPicker } from "../components/SettingsPicker";
import { DEFAULT_SETTINGS } from "../settings";
import { ErrorNote, Loading, notify } from "../components/Common";
import { ScaleLegend } from "../components/Grade";
import { ordinal } from "../format";
import { DrawerFoot } from "../components/DrawerFoot";
import { DriveContinue } from "../components/Drive";

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
  // The clubs on screen and the seed they come from. Until a new seed's clubs arrive, they're the last seed's.
  const [shown, setShown] = useState<{ seed: string; teams: NewGameTeam[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef("");
  const gone = useRef(false);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [minors, setMinors] = useState(true);
  const [starting, setStarting] = useState(false);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);

  /** Ask the worker for a seed's clubs at once, so a game started straight after is built from that same league. */
  const show = (s: string) => {
    asked.current = s;
    setSeed(s);
    setError(null);
    call("newGameTeams", { seed: s }).then(
      (teams) => !gone.current && asked.current === s && setShown({ seed: s, teams }),
      (err: Error) => {
        if (gone.current || asked.current !== s) return;
        setShown(null);
        setError(err.message);
      },
    );
  };
  useEffect(() => {
    show(seed);
    return () => void (gone.current = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Use the seed in the box (on Enter, Generate, leaving the box and Take the job). An empty box gets the last one back. */
  const apply = (text: string) => {
    // A box that still has the keyboard lets go as the page closes for the new league; there's nothing to show then.
    if (gone.current) return;
    const s = text.trim();
    setDraft(s || asked.current);
    if (s && s !== asked.current) show(s);
  };

  const byDivision = useMemo(() => {
    const out: NewGameTeam[][][] = [[[], [], []], [[], [], []]];
    for (const t of shown?.teams ?? []) out[t.league]![t.division]!.push(t);
    return out;
  }, [shown]);

  const ranks = useMemo(() => {
    const list = shown?.teams ?? [];
    const rank = (key: "strength" | "farm") => {
      const sorted = [...list].sort((a, b) => b[key] - a[key]);
      return new Map(sorted.map((t, i) => [t.id, i + 1]));
    };
    return { mlb: rank("strength"), farm: rank("farm") };
  }, [shown]);

  const chosen = shown?.teams.find((t) => t.id === teamId);
  const updating = shown !== null && shown.seed !== seed;

  const start = async () => {
    if (teamId === null) return;
    // The league starts from what's in the box, though the tap came before Enter or the box let go (the clubs keep
    // their places in every seed, so the pick still stands).
    const s = draft.trim() || asked.current;
    apply(s);
    setStarting(true);
    try {
      onStarted(await call("newGame", { seed: s, teamId, minors, settings }));
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
          <DriveContinue onStarted={onStarted} />
        </div>
        <div class="panel setup">
          <label class="k" for="seed">
            League seed
          </label>
          <div class="row">
            {/* Seeds are case-sensitive, so a phone's keyboard mustn't capitalize or correct one. autoCorrect and
                autoCapitalize go in as attributes: iOS has a true-or-false autocorrect property that "off" would turn on. */}
            <input
              id="seed"
              class="txt"
              autoCapitalize="none"
              autoCorrect="off"
              spellcheck={false}
              autoComplete="off"
              enterKeyHint="go"
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === "Enter" && apply(draft)}
              onBlur={() => apply(draft)}
              style={{ flex: "1 1 160px" }}
            />
            <button type="button" class="btn" disabled={!draft.trim() || draft.trim() === seed} onClick={() => apply(draft)}>
              Generate
            </button>
            <button
              type="button"
              class="btn ghost"
              onClick={() => {
                const s = randomSeed();
                setDraft(s);
                show(s);
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
          <h2>How you want to play</h2>
          <span class="aside">You can change these later in the League office.</span>
        </header>
        <SettingsPicker value={settings} onChange={setSettings} />
      </section>

      <section class="section">
        <header>
          <h2>Pick your club</h2>
          <span class="aside">MLB and farm ranks are this seed's talent, 1 = best.</span>
        </header>
        {!shown && !error && <Loading what="thirty organizations" />}
        {error && <ErrorNote error={error} />}
        {shown && (
          <div class="clubs" aria-busy={updating}>
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
        <span class="dim" aria-busy={updating}>
          {chosen
            ? `${chosen.city} ${chosen.nickname}: MLB talent ranks ${ranks.mlb.get(chosen.id)} of 30, farm ${ranks.farm.get(chosen.id)} of 30.`
            : "Choose a club to run."}
        </span>
        <button type="button" class="btn primary" disabled={teamId === null || starting} onClick={start}>
          {starting ? "Setting up…" : chosen ? `Take the ${chosen.nickname} job` : "Take the job"}
        </button>
      </div>
      <DrawerFoot />
    </>
  );
}
