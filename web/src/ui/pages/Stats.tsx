import { useState } from "preact/hooks";
import { useApi } from "../../api/client";
import type { HitterRow, PitcherRow, Status } from "../../api/protocol";
import { LEVELS, type Level } from "../../../../src/players/types";
import { ErrorNote, Loading, Section, Seg } from "../components/Common";
import { type Column, Table } from "../components/Table";
import { LEVEL_NAMES, fixed, ip, pct, rate3, whole } from "../format";
import { go, playerHref } from "../router";
import { useBasics } from "../settings";

// Minor league games skip the per-ball expected-stat and fielding bookkeeping (it's the slow part).
const MLB_ONLY = new Set(["xwOBA", "Fld"]);

function hitterColumns(level: Level): Column<HitterRow>[] {
  const n = (key: string, label: string, get: (h: HitterRow) => number, fmt: (x: number) => string, title?: string, asc = false): Column<HitterRow> => ({
    key,
    label,
    title,
    cls: "num",
    sort: get,
    asc,
    render: (h) => fmt(get(h)),
  });
  const int = (x: number) => String(x);
  const cols: Column<HitterRow>[] = [
    { key: "name", label: "Name", cls: "name", sort: (h) => h.name, asc: true, render: (h) => <a href={playerHref(h.id)}>{h.name}</a> },
    { key: "team", label: "Team", sort: (h) => h.team, asc: true, render: (h) => h.team },
    { key: "pos", label: "Pos", sort: (h) => h.pos, asc: true, render: (h) => h.pos },
    n("G", "G", (h) => h.line.G, int),
    n("PA", "PA", (h) => h.PA, int),
    n("AVG", "AVG", (h) => h.AVG, rate3),
    n("OBP", "OBP", (h) => h.OBP, rate3),
    n("SLG", "SLG", (h) => h.SLG, rate3),
    n("HR", "HR", (h) => h.line.HR, int),
    n("R", "R", (h) => h.line.R, int),
    n("RBI", "RBI", (h) => h.line.RBI, int),
    n("SB", "SB", (h) => h.line.SB, int),
    n("BB", "BB%", (h) => h.BBpct, (x) => pct(x)),
    n("K", "K%", (h) => h.Kpct, (x) => pct(x), undefined, true),
    n("ISO", "ISO", (h) => h.ISO, rate3),
    n("BABIP", "BABIP", (h) => h.BABIP, rate3),
    n("wOBA", "wOBA", (h) => h.wOBA, rate3, "Weighted on-base average, with weights from this league's run environment"),
    n("xwOBA", "xwOBA", (h) => h.xwOBA, rate3, "Expected wOBA from exit velocity and launch angle"),
    n("wRC", "wRC+", (h) => h.wRCplus, whole, "Park-adjusted runs created, 100 = league average"),
    n("EV", "EV", (h) => h.avgEV, (x) => fixed(x), "Average exit velocity (mph)"),
    n("HH", "HardHit%", (h) => h.hardHitPct, (x) => pct(x), "Batted balls at 95+ mph"),
    n("Brl", "Brl%", (h) => h.barrelPct, (x) => pct(x), "Barrels per batted ball"),
    n("Chase", "Chase%", (h) => h.chasePct, (x) => pct(x), "Swings at pitches outside the zone", true),
    n("BsR", "BsR", (h) => h.baserunningRuns, (x) => fixed(x), "Baserunning runs"),
    n("Fld", "Fld", (h) => h.fieldingRuns, (x) => fixed(x), "Fielding runs above average"),
    n("WAR", "WAR", (h) => h.WAR, (x) => fixed(x), "Wins above replacement"),
  ];
  return cols.filter((c) => level === "MLB" || !MLB_ONLY.has(c.key));
}

function pitcherColumns(level: Level): Column<PitcherRow>[] {
  const n = (key: string, label: string, get: (p: PitcherRow) => number, fmt: (x: number) => string, title?: string, asc = false): Column<PitcherRow> => ({
    key,
    label,
    title,
    cls: "num",
    sort: get,
    asc,
    render: (p) => fmt(get(p)),
  });
  const int = (x: number) => String(x);
  const f2 = (x: number) => fixed(x, 2);
  const cols: Column<PitcherRow>[] = [
    { key: "name", label: "Name", cls: "name", sort: (p) => p.name, asc: true, render: (p) => <a href={playerHref(p.id)}>{p.name}</a> },
    { key: "team", label: "Team", sort: (p) => p.team, asc: true, render: (p) => p.team },
    { key: "role", label: "Role", sort: (p) => p.role, asc: true, render: (p) => p.role },
    n("G", "G", (p) => p.line.G, int),
    n("GS", "GS", (p) => p.line.GS, int),
    n("W", "W", (p) => p.line.W, int),
    n("L", "L", (p) => p.line.L, int),
    n("SV", "SV", (p) => p.line.SV, int),
    n("IP", "IP", (p) => p.IP, ip),
    n("ERA", "ERA", (p) => p.ERA, f2, undefined, true),
    n("FIP", "FIP", (p) => p.FIP, f2, "Fielding-independent pitching (K, BB, HBP, HR)", true),
    n("xFIP", "xFIP", (p) => p.xFIP, f2, "FIP with a league-average HR/FB rate", true),
    n("SIERA", "SIERA", (p) => p.SIERA, f2, "Skill-interactive ERA", true),
    n("K", "K%", (p) => p.Kpct, (x) => pct(x)),
    n("BB", "BB%", (p) => p.BBpct, (x) => pct(x), undefined, true),
    n("KBB", "K-BB%", (p) => p.KminusBB, (x) => pct(x)),
    n("WHIP", "WHIP", (p) => p.WHIP, f2, undefined, true),
    n("HR9", "HR/9", (p) => p.HR9, f2, undefined, true),
    n("GB", "GB%", (p) => p.GBpct, (x) => pct(x)),
    n("Whiff", "Whiff%", (p) => p.whiffPct, (x) => pct(x), "Misses per swing"),
    n("CSW", "CSW%", (p) => p.cswPct, (x) => pct(x), "Called strikes plus whiffs per pitch"),
    n("EV", "EV", (p) => p.avgEV, (x) => fixed(x), "Average exit velocity allowed", true),
    n("xwOBA", "xwOBA", (p) => p.xwOBA, rate3, "Expected wOBA allowed", true),
    n("ERAm", "ERA-", (p) => p.ERAminus, whole, "Park-adjusted ERA, 100 = average, lower is better", true),
    n("FIPm", "FIP-", (p) => p.FIPminus, whole, "Park-adjusted FIP, 100 = average, lower is better", true),
    n("SO", "SO", (p) => p.line.SO, int),
    n("WAR", "WAR", (p) => p.WAR, (x) => fixed(x), "FIP-based wins above replacement"),
  ];
  return cols.filter((c) => level === "MLB" || !MLB_ONLY.has(c.key));
}

const POSITIONS = ["All", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];

/** Basics mode shows the familiar numbers (strikeouts as a count rather than a rate). */
const BASIC_HITTING = new Set(["name", "team", "pos", "G", "PA", "AVG", "OBP", "SLG", "HR", "R", "RBI", "SB", "WAR"]);
const BASIC_PITCHING = new Set(["name", "team", "role", "G", "GS", "W", "L", "SV", "IP", "ERA", "SO", "WHIP", "WAR"]);

export function StatsPage({ level, kind, status }: { level: Level; kind: "hitters" | "pitchers"; status: Status }) {
  const view = useApi("stats", { level, kind }, [level, kind]);
  const basics = useBasics();
  const [advanced, setAdvanced] = useState(false);
  const simple = basics && !advanced;
  const hitCols = hitterColumns(level).filter((c) => (simple ? BASIC_HITTING.has(c.key) : c.key !== "SO"));
  const pitCols = pitcherColumns(level).filter((c) => (simple ? BASIC_PITCHING.has(c.key) : c.key !== "SO"));
  const [qualified, setQualified] = useState(true);
  const [team, setTeam] = useState("All");
  const [pos, setPos] = useState("All");
  const d = view.data;
  const teams = [...(status.teams ?? [])].map((t) => t.abbrev).sort();
  const userAbbrev = status.teams?.find((t) => t.id === status.userTeamId)?.abbrev;

  const hitters = (d?.hitters ?? []).filter(
    (h) => (!qualified || h.PA >= d!.qualifyingPA) && (team === "All" || h.team === team) && (pos === "All" || h.pos === pos),
  );
  const pitchers = (d?.pitchers ?? []).filter(
    (p) => (!qualified || p.IP >= d!.qualifyingIP) && (team === "All" || p.team === team) && (pos === "All" || p.role === pos),
  );

  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">{status.year} · {LEVEL_NAMES[level]}</div>
          <h1>{kind === "hitters" ? "Hitting" : "Pitching"}</h1>
        </div>
        <div class="toolbar">
          <Seg label="Level" value={level} options={LEVELS.map((l) => [l, LEVEL_NAMES[l]])} onChange={(l) => go({ page: "stats", level: l, kind })} />
          <Seg
            label="Players"
            value={kind}
            options={[
              ["hitters", "Hitters"],
              ["pitchers", "Pitchers"],
            ]}
            onChange={(k) => {
              setPos("All");
              go({ page: "stats", level, kind: k });
            }}
          />
        </div>
      </div>

      <div class="toolbar">
        <label class="check">
          <input type="checkbox" checked={qualified} onChange={(e) => setQualified((e.target as HTMLInputElement).checked)} />
          Qualified only {d ? `(${kind === "hitters" ? `${d.qualifyingPA} PA` : `${d.qualifyingIP} IP`})` : ""}
        </label>
        <select class="sel" aria-label="Team" value={team} onChange={(e) => setTeam((e.target as HTMLSelectElement).value)}>
          <option value="All">All clubs</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select class="sel" aria-label={kind === "hitters" ? "Position" : "Role"} value={pos} onChange={(e) => setPos((e.target as HTMLSelectElement).value)}>
          {(kind === "hitters" ? POSITIONS : ["All", "SP", "RP"]).map((p) => (
            <option key={p} value={p}>
              {p === "All" ? (kind === "hitters" ? "All positions" : "Starters and relievers") : p}
            </option>
          ))}
        </select>
        {basics && (
          <label class="check">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced((e.target as HTMLInputElement).checked)} />
            Show advanced stats
          </label>
        )}
      </div>

      {view.error && <ErrorNote error={view.error} />}
      {!d && !view.error && <Loading what="stats" />}
      {d && kind === "hitters" && (
        <Table
          key={`h-${level}`}
          columns={hitCols}
          rows={hitters}
          rowKey={(h) => h.id}
          sortKey="WAR"
          limit={60}
          ranked
          rowClass={(h) => (h.team === userAbbrev ? "mine" : "")}
          empty={qualified ? "Nobody qualifies yet. Uncheck “Qualified only” to see everyone." : "No games played yet."}
        />
      )}
      {d && kind === "pitchers" && (
        <Table
          key={`p-${level}`}
          columns={pitCols}
          rows={pitchers}
          rowKey={(p) => p.id}
          sortKey="WAR"
          limit={60}
          ranked
          rowClass={(p) => (p.team === userAbbrev ? "mine" : "")}
          empty={qualified ? "Nobody qualifies yet. Uncheck “Qualified only” to see everyone." : "No games played yet."}
        />
      )}

      {d && d.context.runsPerGame > 0 && (
        <Section title="League run environment" aside="every constant is derived from this season's own games">
          <div class="facts">
            <div>
              <span class="k">Runs / game</span>
              <span class="v">{fixed(d.context.runsPerGame, 2)}</span>
            </div>
            <div>
              <span class="k">AVG / OBP / SLG</span>
              <span class="v">
                {rate3(d.context.lgAvg)}/{rate3(d.context.lgObp)}/{rate3(d.context.lgSlg)}
              </span>
            </div>
            <div>
              <span class="k">League ERA</span>
              <span class="v">{fixed(d.context.lgEra, 2)}</span>
            </div>
            <div>
              <span class="k">League wOBA</span>
              <span class="v">{rate3(d.context.lgWoba)}</span>
            </div>
            <div>
              <span class="k">wOBA weights</span>
              <span class="v small">
                {Object.entries(d.context.weights)
                  .map(([k, w]) => `${k} ${w.toFixed(2)}`)
                  .join(" · ")}
              </span>
            </div>
            <div>
              <span class="k">FIP constant</span>
              <span class="v">{fixed(d.context.fipConstant, 2)}</span>
            </div>
            <div>
              <span class="k">Runs per win</span>
              <span class="v">{fixed(d.context.runsPerWin, 2)}</span>
            </div>
          </div>
        </Section>
      )}
    </>
  );
}
