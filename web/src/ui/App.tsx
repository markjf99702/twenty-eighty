import { useEffect, useState } from "preact/hooks";
import { bump, call } from "../api/client";
import type { Status } from "../api/protocol";
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
import { Trades } from "./pages/Trades";
import { Transactions } from "./pages/Transactions";
import { Winter } from "./pages/Winter";

export interface SimState {
  done: number;
  total: number;
  label?: string;
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [booting, setBooting] = useState("Opening the front office");
  const [sim, setSim] = useState<SimState | null>(null);
  const route = useRoute();

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
    let lastBump = 0;
    try {
      const st = await call("sim", { days }, (done, total) => {
        setSim({ done, total });
        if (done - lastBump >= 5) {
          lastBump = done;
          bump();
          void refresh();
        }
      });
      setStatus(st);
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
    <div class="app">
      <Board status={status} sim={sim} onSim={runSim} onPlayoffs={playoffs} onWinter={winterStep} />
      <Rail status={status} route={route} />
      <main>
        <Page route={route} status={status} onStatus={setStatus} onWinter={winterStep} />
      </main>
      <Toasts />
    </div>
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
      return <Winter status={status} onWinter={onWinter} />;
    case "trades":
      return <Trades partnerId={route.partnerId} status={status} />;
    case "history":
      return <History status={status} />;
    case "scouting":
      return <Scouting status={status} />;
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
}: {
  status: Status | null;
  sim: SimState | null;
  onSim?: (days: number | "end") => void;
  onPlayoffs?: () => void;
  onWinter?: (kind: "beginOffseason" | "advance" | "winterWeek") => void;
}) {
  const game = status?.hasGame ? status : null;
  const user = game?.teams?.find((t) => t.id === game.userTeamId);
  return (
    <header class="board">
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
              {sim.total > 1 && (
                <button type="button" class="btn" onClick={() => void call("stop", undefined)}>
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
              <button type="button" class="btn primary" onClick={() => onWinter?.("advance")}>
                {game.winter.action}
              </button>
            </>
          ) : null}
        </div>
      )}
    </header>
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
          { to: { page: "trades", partnerId: null } as Route, label: "Trades", on: route.page === "trades" },
          { to: { page: "scouting" } as Route, label: "Scouting", on: route.page === "scouting" },
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
