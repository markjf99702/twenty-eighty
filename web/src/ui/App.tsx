import { useEffect, useRef, useState } from "preact/hooks";
import { bump, call } from "../api/client";
import type { Status, StopNote, StopRules } from "../api/protocol";
import { notify, Toasts } from "./components/Common";
import { href, type Route, useRoute } from "./router";
import { BoxScorePage } from "./pages/BoxScore";
import { Dashboard } from "./pages/Dashboard";
import { NewGame } from "./pages/NewGame";
import { Office } from "./pages/Office";
import { PlayerPage } from "./pages/Player";
import { Postseason } from "./pages/Postseason";
import { Scores } from "./pages/Scores";
import { Standings } from "./pages/Standings";
import { StatsPage } from "./pages/Stats";
import { TeamPage } from "./pages/Team";
import { History } from "./pages/History";
import { Scouting } from "./pages/Scouting";
import { Finances } from "./pages/Finances";
import { Owner } from "./pages/Owner";
import { Staff } from "./pages/Staff";
import { DEFAULT_SETTINGS, SettingsContext } from "./settings";
import { Trades } from "./pages/Trades";
import { Transactions } from "./pages/Transactions";
import { Winter } from "./pages/Winter";

export interface SimState {
  done: number;
  total: number;
  label?: string;
}

/** Sim speed: how long each simulated day stays on screen at least. */
type Pace = "fast" | "steady" | "slow";
const PACES: { key: Pace; label: string; ms: number; title: string }[] = [
  { key: "fast", label: "Fast", ms: 0, title: "As fast as the sim runs" },
  { key: "steady", label: "Steady", ms: 400, title: "About a month in 12 seconds" },
  { key: "slow", label: "Slow", ms: 1200, title: "About a week in 8 seconds" },
];
const PACE_KEY = "twenty-eighty.pace";
const paceMs = (p: Pace) => PACES.find((x) => x.key === p)!.ms;

const STOPS_KEY = "twenty-eighty.stops";
const DEFAULT_STOPS: StopRules = { streak: 0, injury: false, offer: true, deadline: true, staff: true };

function storedStops(): StopRules {
  try {
    const raw = localStorage.getItem(STOPS_KEY);
    return raw ? { ...DEFAULT_STOPS, ...(JSON.parse(raw) as Partial<StopRules>) } : DEFAULT_STOPS;
  } catch {
    return DEFAULT_STOPS;
  }
}

function storedPace(): Pace {
  try {
    const v = localStorage.getItem(PACE_KEY);
    return PACES.some((p) => p.key === v) ? (v as Pace) : "fast";
  } catch {
    return "fast";
  }
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [booting, setBooting] = useState("Opening the front office");
  const [sim, setSim] = useState<SimState | null>(null);
  const [pace, setPace] = useState<Pace>(storedPace);
  const paceRef = useRef(pace);
  const [stops, setStops] = useState<StopRules>(storedStops);
  const stopsRef = useRef(stops);
  const [stopNote, setStopNote] = useState<StopNote | null>(null);

  const changeStops = (next: StopRules) => {
    setStops(next);
    stopsRef.current = next;
    try {
      localStorage.setItem(STOPS_KEY, JSON.stringify(next));
    } catch {
      // Storage refused: the rules still apply for this session.
    }
    void call("setStops", next);
  };
  const route = useRoute();

  const changePace = (p: Pace) => {
    setPace(p);
    paceRef.current = p;
    try {
      localStorage.setItem(PACE_KEY, p);
    } catch {
      // Private windows can refuse storage; the choice still holds for this session.
    }
    void call("setPace", { msPerDay: paceMs(p) });
  };

  // Esc stops a running sim.
  useEffect(() => {
    if (!sim || sim.total <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void call("stop", undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sim !== null && sim.total > 1]);

  useEffect(() => {
    (async () => {
      try {
        let st = await call("status", undefined);
        if (!st.hasGame && st.hasSave) {
          setBooting("Loading your league");
          st = await call("load", undefined).catch(() => st);
        }
        setStatus(st);
      } catch (err) {
        notify((err as Error).message, true);
        setStatus({ hasGame: false, hasSave: false });
      }
    })();
  }, []);

  const refresh = async () => setStatus(await call("status", undefined));

  const runSim = async (days: number | "end") => {
    if (sim) return;
    setSim({ done: 0, total: 1 });
    setStopNote(null);
    let lastBump = 0;
    try {
      const st = await call("sim", { days, msPerDay: paceMs(paceRef.current), stops: stopsRef.current }, (done, total) => {
        setSim({ done, total });
        // Watching at a slower speed: every page follows along day by day.
        if (done - lastBump >= (paceRef.current === "fast" ? 5 : 1)) {
          lastBump = done;
          bump();
          void refresh();
        }
      });
      setStatus(st);
      if (st.stop) setStopNote(st.stop);
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setSim(null);
      bump();
    }
  };

  const playoffs = async () => {
    setSim({ done: 0, total: 0, label: "Playing October" });
    try {
      setStatus(await call("playoffs", undefined));
      location.hash = href({ page: "playoffs" });
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setSim(null);
      bump();
    }
  };

  /** Winter steps: open the offseason, finish a phase, or play a week of free agency. */
  const winterStep = async (kind: "beginOffseason" | "advance" | "winterWeek") => {
    const label = kind === "beginOffseason" ? "Closing the books" : kind === "winterWeek" ? "A week of free agency" : "Working";
    setSim({ done: 0, total: 0, label });
    try {
      const st = await call(kind, undefined);
      setStatus(st);
      if (st.phase === "regular") {
        notify(`Welcome to ${st.year}. Opening Day is set.`);
        location.hash = "#home";
      } else {
        location.hash = href({ page: "winter" });
      }
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setSim(null);
      bump();
    }
  };

  if (!status) {
    return (
      <div class="app">
        <Board status={null} sim={null} />
        <main style={{ gridColumn: "1 / -1" }}>
          <div class="loading">{booting}…</div>
        </main>
      </div>
    );
  }

  if (!status.hasGame) {
    return (
      <div class="app">
        <Board status={status} sim={null} />
        <main style={{ gridColumn: "1 / -1" }}>
          <NewGame onStarted={(st) => { setStatus(st); location.hash = "#home"; bump(); }} />
        </main>
        <Toasts />
      </div>
    );
  }

  return (
    <SettingsContext.Provider value={status.settings ?? DEFAULT_SETTINGS}>
    <div class="app">
      <Board
        status={status}
        sim={sim}
        onSim={runSim}
        onPlayoffs={playoffs}
        onWinter={winterStep}
        pace={pace}
        onPace={changePace}
        stops={stops}
        onStops={changeStops}
      />
      <Rail status={status} route={route} />
      <main>
        {stopNote && (
          <div class={`stop-note ${stopNote.kind}`} role="status">
            <span class="k">Stopped</span>
            <span class="t">{stopNote.text}</span>
            {stopNote.href && (
              <a class="btn small" href={stopNote.href} onClick={() => setStopNote(null)}>
                {stopNote.kind === "offer" || stopNote.kind === "deadline" ? "Trade desk" : stopNote.kind === "injury" ? "See him" : stopNote.kind === "staff" ? "Take a look" : "Your club"}
              </a>
            )}
            <button type="button" class="btn ghost small" aria-label="Dismiss" onClick={() => setStopNote(null)}>
              ×
            </button>
          </div>
        )}
        <Page route={route} status={status} onStatus={setStatus} onWinter={winterStep} />
      </main>
      <Toasts />
    </div>
    </SettingsContext.Provider>
  );
}

function Page({
  route,
  status,
  onStatus,
  onWinter,
}: {
  route: Route;
  status: Status;
  onStatus: (s: Status) => void;
  onWinter: (kind: "beginOffseason" | "advance" | "winterWeek") => void;
}) {
  const user = status.userTeamId ?? null;
  switch (route.page) {
    case "home":
      return user === null ? <Standings level="MLB" status={status} /> : <Dashboard status={status} />;
    case "standings":
      return <Standings level={route.level} status={status} />;
    case "team":
      return <TeamPage teamId={route.teamId ?? user ?? 0} tab={route.tab} status={status} />;
    case "player":
      return <PlayerPage playerId={route.playerId} status={status} />;
    case "stats":
      return <StatsPage level={route.level} kind={route.kind} status={status} />;
    case "scores":
      return <Scores day={route.day} status={status} />;
    case "box":
      return <BoxScorePage gameKey={route.key} status={status} />;
    case "moves":
      return <Transactions mine={route.mine} status={status} />;
    case "playoffs":
      return <Postseason status={status} />;
    case "office":
      return <Office status={status} onStatus={onStatus} />;
    case "winter":
      return <Winter status={status} onWinter={onWinter} onStatus={onStatus} />;
    case "trades":
      return <Trades partnerId={route.partnerId} status={status} />;
    case "history":
      return <History status={status} />;
    case "scouting":
      return <Scouting status={status} />;
    case "finances":
      return <Finances teamId={route.teamId} status={status} />;
    case "owner":
      return <Owner onStatus={onStatus} />;
    case "staff":
      return <Staff onStatus={onStatus} />;
  }
}

// ---------------------------------------------------------------------------
// The scoreboard strip

function Board({
  status,
  sim,
  onSim,
  onPlayoffs,
  onWinter,
  pace,
  onPace,
  stops,
  onStops,
}: {
  status: Status | null;
  sim: SimState | null;
  onSim?: (days: number | "end") => void;
  onPlayoffs?: () => void;
  onWinter?: (kind: "beginOffseason" | "advance" | "winterWeek") => void;
  pace?: Pace;
  onPace?: (p: Pace) => void;
  stops?: StopRules;
  onStops?: (s: StopRules) => void;
}) {
  const game = status?.hasGame ? status : null;
  const speed = pace && onPace && (
    <div class="pace" role="radiogroup" aria-label="Sim speed">
      {PACES.map((p) => (
        <button
          type="button"
          role="radio"
          key={p.key}
          aria-checked={pace === p.key}
          class={pace === p.key ? "on" : ""}
          title={p.title}
          onClick={() => onPace(p.key)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
  const user = game?.teams?.find((t) => t.id === game.userTeamId);
  return (
    <header class={`board${sim && sim.total > 1 ? " simming" : ""}`}>
      <a class="wordmark" href="#home">
        Twenty-Eighty <span class="scale">20–80</span>
      </a>
      {game && (
        <div class="board-cells">
          <div class="cell">
            <span class="k">{game.year}</span>
            <span class="v">
              {game.phase === "regular" ? game.date : game.phase === "postseason" ? "Oct" : game.phase === "offseason" ? "Winter" : "Final"}
            </span>
          </div>
          <div class="cell">
            <span class="k">{game.phase === "regular" ? "Day" : game.phase === "offseason" ? "Offseason" : "Season"}</span>
            <span class="v">
              {game.phase === "regular"
                ? `${game.day}/${game.totalDays}`
                : game.phase === "postseason"
                  ? "Playoffs"
                  : game.phase === "offseason"
                    ? game.winter?.label
                    : "Over"}
            </span>
          </div>
          {user && game.record && (
            <div class="cell">
              <span class="k">{user.abbrev}</span>
              <span class="v">
                {game.record.w}–{game.record.l}
              </span>
            </div>
          )}
        </div>
      )}
      {game && onSim && (
        <div class="sim">
          {sim ? (
            <div class="progress" aria-live="polite">
              <div class="bar">
                <span style={{ width: `${sim.total ? (100 * sim.done) / sim.total : 100}%` }} />
              </div>
              <span class="txt">{sim.total ? `Day ${sim.done} of ${sim.total}` : (sim.label ?? "Working")}</span>
              {sim.total > 1 && speed}
              {sim.total > 1 && stops && onStops && <StopsMenu stops={stops} onChange={onStops} />}
              {sim.total > 1 && (
                <button type="button" class="btn" title="Stop after this day (Esc)" onClick={() => void call("stop", undefined)}>
                  Stop
                </button>
              )}
            </div>
          ) : game.phase === "regular" ? (
            <>
              <span class="label">Sim</span>
              <button type="button" class="btn primary" onClick={() => onSim(1)}>
                Day
              </button>
              <button type="button" class="btn" onClick={() => onSim(7)}>
                Week
              </button>
              <button type="button" class="btn" onClick={() => onSim(30)}>
                Month
              </button>
              <button type="button" class="btn" onClick={() => onSim("end")}>
                To end
              </button>
              {speed}
              {stops && onStops && <StopsMenu stops={stops} onChange={onStops} />}
            </>
          ) : game.phase === "postseason" ? (
            <button type="button" class="btn primary" onClick={onPlayoffs}>
              Play the postseason
            </button>
          ) : game.phase === "done" ? (
            <>
              <a class="btn" href="#playoffs">
                Champions
              </a>
              <button type="button" class="btn primary" onClick={() => onWinter?.("beginOffseason")}>
                Start the offseason
              </button>
            </>
          ) : game.winter ? (
            <>
              {game.winter.phase === "draft" && game.winter.userOnClock && (
                <a class="btn" href="#winter">
                  You're on the clock
                </a>
              )}
              {game.winter.phase === "freeAgency" && (game.winter.week ?? 0) < (game.winter.weeks ?? 0) && (
                <button type="button" class="btn" onClick={() => onWinter?.("winterWeek")}>
                  Next week
                </button>
              )}
              {game.owner?.fired ? (
                <a class="btn primary" href="#owner">
                  Find a new job
                </a>
              ) : (
                <button type="button" class="btn primary" onClick={() => onWinter?.("advance")}>
                  {game.winter.action}
                </button>
              )}
            </>
          ) : null}
        </div>
      )}
    </header>
  );
}

/** "Stop when...": the sim's own pause points. */
function StopsMenu({ stops, onChange }: { stops: StopRules; onChange: (s: StopRules) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const count = (stops.streak > 0 ? 1 : 0) + (stops.injury ? 1 : 0) + (stops.offer ? 1 : 0) + (stops.deadline ? 1 : 0) + (stops.staff ? 1 : 0);
  const set = (patch: Partial<StopRules>) => onChange({ ...stops, ...patch });
  return (
    <div class="stops" ref={ref}>
      <button type="button" class="btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)} title="Pause points">
        Stops <span class="count">{count}</span>
      </button>
      {open && (
        <div class="stops-panel" role="group" aria-label="Stop the sim when">
          <div class="h">Stop the sim when</div>
          <label>
            <input type="checkbox" checked={stops.streak > 0} onChange={(e) => set({ streak: (e.target as HTMLInputElement).checked ? 3 : 0 })} />
            <span>
              We lose{" "}
              <select
                aria-label="Losing streak length"
                value={stops.streak || 3}
                disabled={stops.streak === 0}
                onChange={(e) => set({ streak: Number((e.target as HTMLSelectElement).value) })}
              >
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>{" "}
              in a row
            </span>
          </label>
          <label>
            <input type="checkbox" checked={stops.injury} onChange={(e) => set({ injury: (e.target as HTMLInputElement).checked })} />
            <span>A big leaguer of ours gets hurt badly enough for the injured list</span>
          </label>
          <label>
            <input type="checkbox" checked={stops.offer} onChange={(e) => set({ offer: (e.target as HTMLInputElement).checked })} />
            <span>A club makes us a trade offer</span>
          </label>
          <label>
            <input type="checkbox" checked={stops.deadline} onChange={(e) => set({ deadline: (e.target as HTMLInputElement).checked })} />
            <span>It's trade deadline day (July 31), with the day still to play</span>
          </label>
          <label>
            <input type="checkbox" checked={stops.staff} onChange={(e) => set({ staff: (e.target as HTMLInputElement).checked })} />
            <span>My staff has something urgent</span>
          </label>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigation

function Rail({ status, route }: { status: Status; route: Route }) {
  const user = status.userTeamId ?? null;
  const userTeam = status.teams?.find((t) => t.id === user);
  const items: { to: Route; label: string; on: boolean; tag?: string }[] = [
    ...(status.phase === "offseason" ? [{ to: { page: "winter" } as Route, label: "Offseason", on: route.page === "winter" }] : []),
    { to: { page: "home" }, label: "Front office", on: route.page === "home" },
    ...(userTeam
      ? [{ to: { page: "team", teamId: userTeam.id, tab: "roster" } as Route, label: "My club", tag: userTeam.abbrev, on: route.page === "team" && (route.teamId ?? user) === user }]
      : []),
    { to: { page: "standings", level: "MLB" }, label: "Standings", on: route.page === "standings" },
    { to: { page: "stats", level: "MLB", kind: "hitters" }, label: "Stats", on: route.page === "stats" },
    { to: { page: "scores", day: null }, label: "Scores", on: route.page === "scores" || route.page === "box" },
    { to: { page: "moves", mine: false }, label: "Transactions", on: route.page === "moves" },
    ...(userTeam
      ? [
          {
            to: { page: "trades", partnerId: null } as Route,
            label: "Trades",
            on: route.page === "trades",
            tag: status.offers ? `${status.offers} offer${status.offers === 1 ? "" : "s"}` : undefined,
          },
          { to: { page: "scouting" } as Route, label: "Scouting", on: route.page === "scouting" },
          { to: { page: "finances", teamId: null } as Route, label: "Finances", on: route.page === "finances" },
        ]
      : []),
    ...(status.owner
      ? [
          {
            to: { page: "owner" } as Route,
            label: "Owner",
            on: route.page === "owner",
            tag: status.owner.fired ? "Fired" : String(status.owner.confidence),
          },
        ]
      : []),
    ...(userTeam && status.settings?.advice !== false
      ? [
          {
            to: { page: "staff" } as Route,
            label: "Staff",
            on: route.page === "staff",
            tag: status.staffUnread ? `${status.staffUnread} new` : undefined,
          },
        ]
      : []),
    { to: { page: "history" }, label: "History", on: route.page === "history" },
    ...(status.phase === "done" || status.phase === "postseason" || status.phase === "offseason"
      ? [{ to: { page: "playoffs" } as Route, label: "Postseason", on: route.page === "playoffs" }]
      : []),
  ];
  return (
    <aside class="rail">
      <nav aria-label="Sections">
        {items.map((it) => (
          <a key={it.label} href={href(it.to)} class={it.on ? "on" : ""} aria-current={it.on ? "page" : undefined}>
            {it.label}
            {it.tag && <span class="club-tag">{it.tag}</span>}
          </a>
        ))}
        <div class="sep" />
        <a href="#office" class={route.page === "office" ? "on" : ""}>
          League office
        </a>
      </nav>
    </aside>
  );
}
