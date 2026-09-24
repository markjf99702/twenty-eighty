import { useState } from "preact/hooks";
import { bump, call, useApi } from "../../api/client";
import type { CareerLine, PlayerView, StatLine, Status } from "../../api/protocol";
import { ErrorNote, Loading, notify, Section } from "../components/Common";
import { Grade, GradeBar, PresentFuture } from "../components/Grade";
import { RosterMoves, StatusBadges } from "../components/PlayerTable";
import { LEVEL_NAMES, fixed, gradeWord, ip, pct, rate3, scout, whole } from "../format";
import { teamHref } from "../router";

const HANDS: Record<string, string> = { L: "left", R: "right", S: "both sides" };

export function PlayerPage({ playerId, status }: { playerId: number; status: Status }) {
  const view = useApi("player", { playerId }, [playerId]);
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  const p = v.summary;
  const s = p.status;
  const pitcher = p.pitcher;

  return (
    <>
      <div class="player-head">
        <div>
          <div class="eyebrow">
            {p.pos} · {v.team ? <a href={teamHref(v.team.id)}>{v.team.city} {v.team.nickname}</a> : "Free agent"}
            {v.team ? ` · ${LEVEL_NAMES[p.level]}` : ""}
          </div>
          <h1>
            {p.name}
            <StatusBadges p={p} />
          </h1>
          <div class="bio">
            <span>Age {p.age} (born {v.born})</span>
            <span>
              Bats {HANDS[p.bats]}, throws {HANDS[p.throws]}
            </span>
            {v.velocity !== null && <span>Fastball {v.velocity.toFixed(0)} mph</span>}
          </div>
        </div>
        <div class="ovr-block">
          <div>
            <span class="k">Now</span>
            <Grade g={p.ovr} large />
          </div>
          <div>
            <span class="k">Future</span>
            <Grade g={p.fv} large />
          </div>
        </div>
      </div>

      {s.injury && (
        <div class="note alert">
          {s.il ? `On the ${s.il.replace("IL", "")}-day injured list` : "Day to day"}: {s.injury.name.toLowerCase()}, about {s.injury.daysLeft} day
          {s.injury.daysLeft === 1 ? "" : "s"} left.
        </div>
      )}

      <div class="grid-2">
        <Section
          title="Scouting report"
          aside={
            <span class={`confidence ${v.scouting.confidence}`} title={v.scouting.familiarity}>
              Your scouts · ±{v.scouting.sigma.toFixed(1)} · {v.scouting.confidence} confidence
            </span>
          }
        >
          <div class="report">
            {v.pitches.map((x) => (
              <div class="tool-row" key={x.type}>
                <span class="t">
                  {x.name}
                  <small>{Math.round(100 * x.usage)}% of pitches</small>
                </span>
                <PresentFuture present={x.present} future={x.future} />
                <GradeBar present={x.present} future={x.future} label={x.name} />
                <span class="lbl">{describe(x.present, x.future)}</span>
              </div>
            ))}
            {v.tools.map((t) => (
              <div class="tool-row" key={t.label}>
                <span class="t">
                  {t.label}
                  {t.note && <small>{t.note}</small>}
                </span>
                <PresentFuture present={t.present} future={t.future} />
                <GradeBar present={t.present} future={t.future} label={t.label} />
                <span class="lbl">{describe(t.present, t.future)}</span>
              </div>
            ))}
          </div>
          <div class="traits">
            {v.traits.map((t) => (
              <span class="trait" key={t}>
                {t}
              </span>
            ))}
          </div>
        </Section>

        <div class="section" style={{ gap: "22px" }}>
          <YourRead v={v} />

          <Section title="Contract">
            <div class="facts">
              <div>
                <span class="k">Deal</span>
                <span class="v">{p.contract?.label ?? (v.retired ? `Retired (${v.retired})` : "Free agent")}</span>
              </div>
              {p.contract && p.contract.type === "guaranteed" && (
                <div>
                  <span class="k">Years left</span>
                  <span class="v">{p.contract.years}</span>
                </div>
              )}
              {v.surplus !== null && (
                <div>
                  <span class="k" title="Projected wins over his years of control at $8M a win, minus salary">
                    Trade value
                  </span>
                  <span class="v">
                    {v.surplus < 0 ? "-" : ""}${Math.abs(v.surplus).toFixed(1)}M
                  </span>
                </div>
              )}
            </div>
            {(v.draft || v.awards.length > 0) && (
              <div class="small dim" style={{ display: "grid", gap: "2px" }}>
                {v.draft && <span>{v.draft}</span>}
                {v.awards.map((a) => (
                  <span key={a}>{a}</span>
                ))}
              </div>
            )}
          </Section>

          <Section title="Status">
            <div class="facts">
              <div>
                <span class="k">Level</span>
                <span class="v">{LEVEL_NAMES[p.level]}</span>
              </div>
              <div>
                <span class="k">40-man</span>
                <span class="v">{s.fortyMan ? "Yes" : "No"}</span>
              </div>
              <div>
                <span class="k">Options left</span>
                <span class="v">
                  {s.canBeOptioned || s.optionedThisYear ? s.optionsLeft : "None"}
                  {s.optionedThisYear ? " (used this year)" : ""}
                </span>
              </div>
              <div>
                <span class="k">Service time</span>
                <span class="v" title="Years.days; 172 days is a year">
                  {s.service}
                </span>
              </div>
            </div>
          </Section>

          {!pitcher && v.defense.length > 0 && (
            <Section title="Defense" aside="by position">
              <div class="tbl-wrap">
                <table class="tbl">
                  <tbody>
                    {v.defense.map((d) => (
                      <tr key={d.pos}>
                        <td class="name">{d.pos}</td>
                        <td>
                          <Grade g={d.grade} />
                        </td>
                        <td class="dim">
                          {gradeWord(d.grade)}
                          {d.natural ? "" : " (out of position)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {p.actions && (
            <Section title="Roster moves">
              <RosterMoves p={p} />
            </Section>
          )}
        </div>
      </div>

      <Section title={`${status.year} stats`}>
        {v.stats.length === 0 ? <div class="empty">No games yet this season.</div> : pitcher ? <PitchingStats rows={v.stats} /> : <HittingStats rows={v.stats} />}
      </Section>

      {v.career.length > 0 && (
        <Section title="Career">
          <Career lines={v.career} teams={v.careerTeams} pitcher={pitcher} />
        </Section>
      )}

      <Section title="Transactions">
        {v.transactions.length === 0 ? (
          <div class="empty">Nothing this season.</div>
        ) : (
          <div class="wire">
            {v.transactions.map((t, i) => (
              <div class="wire-item" key={i} style={{ gridTemplateColumns: "52px minmax(0, 1fr)" }}>
                <span class="date">{t.date}</span>
                <span>{t.text}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function describe(present: number, future: number): string {
  const a = gradeWord(present);
  return scout(future) > scout(present) ? `${a} → ${gradeWord(future).toLowerCase()}` : a;
}

function HittingStats({ rows }: { rows: StatLine[] }) {
  return (
    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>Level</th>
            <th>Team</th>
            <th class="num">G</th>
            <th class="num">PA</th>
            <th class="num">AVG</th>
            <th class="num">OBP</th>
            <th class="num">SLG</th>
            <th class="num">HR</th>
            <th class="num">R</th>
            <th class="num">RBI</th>
            <th class="num">SB</th>
            <th class="num">BB%</th>
            <th class="num">K%</th>
            <th class="num">wOBA</th>
            <th class="num" title="Expected wOBA (tracked in the majors)">xwOBA</th>
            <th class="num">wRC+</th>
            <th class="num" title="Average exit velocity">EV</th>
            <th class="num">Brl%</th>
            <th class="num" title="Fielding runs above average (tracked in the majors)">Fld</th>
            <th class="num">WAR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ level, team, hitting: h }) =>
            h ? (
              <tr key={level}>
                <td>{LEVEL_NAMES[level]}</td>
                <td>{team}</td>
                <td class="num">{h.line.G}</td>
                <td class="num">{h.PA}</td>
                <td class="num">{rate3(h.AVG)}</td>
                <td class="num">{rate3(h.OBP)}</td>
                <td class="num">{rate3(h.SLG)}</td>
                <td class="num">{h.line.HR}</td>
                <td class="num">{h.line.R}</td>
                <td class="num">{h.line.RBI}</td>
                <td class="num">{h.line.SB}</td>
                <td class="num">{pct(h.BBpct)}</td>
                <td class="num">{pct(h.Kpct)}</td>
                <td class="num">{rate3(h.wOBA)}</td>
                <td class="num">{level === "MLB" ? rate3(h.xwOBA) : "—"}</td>
                <td class="num">{whole(h.wRCplus)}</td>
                <td class="num">{fixed(h.avgEV)}</td>
                <td class="num">{pct(h.barrelPct)}</td>
                <td class="num">{level === "MLB" ? fixed(h.fieldingRuns) : "—"}</td>
                <td class="num">{fixed(h.WAR)}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
}

function PitchingStats({ rows }: { rows: StatLine[] }) {
  return (
    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>Level</th>
            <th>Team</th>
            <th class="num">G</th>
            <th class="num">GS</th>
            <th class="num">W</th>
            <th class="num">L</th>
            <th class="num">SV</th>
            <th class="num">IP</th>
            <th class="num">ERA</th>
            <th class="num">FIP</th>
            <th class="num">xFIP</th>
            <th class="num">SIERA</th>
            <th class="num">K%</th>
            <th class="num">BB%</th>
            <th class="num">WHIP</th>
            <th class="num">Whiff%</th>
            <th class="num">CSW%</th>
            <th class="num">GB%</th>
            <th class="num">ERA-</th>
            <th class="num">WAR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ level, team, pitching: x }) =>
            x ? (
              <tr key={level}>
                <td>{LEVEL_NAMES[level]}</td>
                <td>{team}</td>
                <td class="num">{x.line.G}</td>
                <td class="num">{x.line.GS}</td>
                <td class="num">{x.line.W}</td>
                <td class="num">{x.line.L}</td>
                <td class="num">{x.line.SV}</td>
                <td class="num">{ip(x.IP)}</td>
                <td class="num">{fixed(x.ERA, 2)}</td>
                <td class="num">{fixed(x.FIP, 2)}</td>
                <td class="num">{fixed(x.xFIP, 2)}</td>
                <td class="num">{fixed(x.SIERA, 2)}</td>
                <td class="num">{pct(x.Kpct)}</td>
                <td class="num">{pct(x.BBpct)}</td>
                <td class="num">{fixed(x.WHIP, 2)}</td>
                <td class="num">{pct(x.whiffPct)}</td>
                <td class="num">{pct(x.cswPct)}</td>
                <td class="num">{pct(x.GBpct)}</td>
                <td class="num">{whole(x.ERAminus)}</td>
                <td class="num">{fixed(x.WAR)}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
}

function Career({ lines, teams, pitcher }: { lines: CareerLine[]; teams: Record<number, string>; pitcher: boolean }) {
  const team = (id: number | null) => (id === null ? "—" : (teams[id] ?? "—"));
  const mlb = lines.filter((l) => l.level === "MLB");
  if (pitcher) {
    const rows = lines.filter((l) => l.pit);
    const tot = mlb.reduce(
      (a, l) => {
        const x = l.pit!;
        return { G: a.G + x.G, W: a.W + x.W, L: a.L + x.L, SV: a.SV + x.SV, outs: a.outs + x.outs, ER: a.ER + x.ER, SO: a.SO + x.SO, BB: a.BB + x.BB, WAR: a.WAR + x.WAR };
      },
      { G: 0, W: 0, L: 0, SV: 0, outs: 0, ER: 0, SO: 0, BB: 0, WAR: 0 },
    );
    return (
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Year</th>
              <th>Level</th>
              <th>Team</th>
              <th class="num">G</th>
              <th class="num">GS</th>
              <th class="num">W-L</th>
              <th class="num">SV</th>
              <th class="num">IP</th>
              <th class="num">ERA</th>
              <th class="num">FIP</th>
              <th class="num">SO</th>
              <th class="num">BB</th>
              <th class="num">WAR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={`${l.year}-${l.level}`}>
                <td class="num">{l.year}</td>
                <td>{LEVEL_NAMES[l.level]}</td>
                <td>{team(l.teamId)}</td>
                <td class="num">{l.pit!.G}</td>
                <td class="num">{l.pit!.GS}</td>
                <td class="num">
                  {l.pit!.W}-{l.pit!.L}
                </td>
                <td class="num">{l.pit!.SV}</td>
                <td class="num">{ip(l.pit!.outs / 3)}</td>
                <td class="num">{fixed(l.pit!.ERA, 2)}</td>
                <td class="num">{fixed(l.pit!.FIP, 2)}</td>
                <td class="num">{l.pit!.SO}</td>
                <td class="num">{l.pit!.BB}</td>
                <td class="num">{fixed(l.pit!.WAR)}</td>
              </tr>
            ))}
            {mlb.length > 1 && (
              <tr>
                <td class="name" colSpan={3}>
                  Major league totals
                </td>
                <td class="num">{tot.G}</td>
                <td />
                <td class="num">
                  {tot.W}-{tot.L}
                </td>
                <td class="num">{tot.SV}</td>
                <td class="num">{ip(tot.outs / 3)}</td>
                <td class="num">{tot.outs ? fixed((27 * tot.ER) / tot.outs, 2) : "—"}</td>
                <td />
                <td class="num">{tot.SO}</td>
                <td class="num">{tot.BB}</td>
                <td class="num">{fixed(tot.WAR)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }
  const rows = lines.filter((l) => l.bat);
  const tot = mlb.reduce(
    (a, l) => {
      const x = l.bat!;
      return { G: a.G + x.G, PA: a.PA + x.PA, AB: a.AB + x.AB, H: a.H + x.H, HR: a.HR + x.HR, RBI: a.RBI + x.RBI, SB: a.SB + x.SB, WAR: a.WAR + x.WAR };
    },
    { G: 0, PA: 0, AB: 0, H: 0, HR: 0, RBI: 0, SB: 0, WAR: 0 },
  );
  return (
    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>Year</th>
            <th>Level</th>
            <th>Team</th>
            <th class="num">G</th>
            <th class="num">PA</th>
            <th class="num">AVG</th>
            <th class="num">HR</th>
            <th class="num">RBI</th>
            <th class="num">SB</th>
            <th class="num">BB</th>
            <th class="num">SO</th>
            <th class="num">wRC+</th>
            <th class="num">WAR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={`${l.year}-${l.level}`}>
              <td class="num">{l.year}</td>
              <td>{LEVEL_NAMES[l.level]}</td>
              <td>{team(l.teamId)}</td>
              <td class="num">{l.bat!.G}</td>
              <td class="num">{l.bat!.PA}</td>
              <td class="num">{rate3(l.bat!.AB ? l.bat!.H / l.bat!.AB : 0)}</td>
              <td class="num">{l.bat!.HR}</td>
              <td class="num">{l.bat!.RBI}</td>
              <td class="num">{l.bat!.SB}</td>
              <td class="num">{l.bat!.BB}</td>
              <td class="num">{l.bat!.SO}</td>
              <td class="num">{l.bat!.wRCplus}</td>
              <td class="num">{fixed(l.bat!.WAR)}</td>
            </tr>
          ))}
          {mlb.length > 1 && (
            <tr>
              <td class="name" colSpan={3}>
                Major league totals
              </td>
              <td class="num">{tot.G}</td>
              <td class="num">{tot.PA}</td>
              <td class="num">{rate3(tot.AB ? tot.H / tot.AB : 0)}</td>
              <td class="num">{tot.HR}</td>
              <td class="num">{tot.RBI}</td>
              <td class="num">{tot.SB}</td>
              <td />
              <td />
              <td />
              <td class="num">{fixed(tot.WAR)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Scouts vs. analytics, the blend you act on, and the button that sends a scout. */
function YourRead({ v }: { v: PlayerView }) {
  const sc = v.scouting;
  const [busy, setBusy] = useState(false);
  const look = async () => {
    setBusy(true);
    const res = await call("scoutPlayer", { playerId: v.summary.id });
    if (res.ok) notify(`Your scouts took another look at ${v.summary.name}.`);
    else notify(res.reason ?? "No scouts available.", true);
    setBusy(false);
    bump();
  };
  const a = sc.analytics;
  return (
    <Section title="Your read" aside={sc.familiarity}>
      <div class="read-row">
        <div>
          <span class="k">Scouts</span>
          <Grade g={sc.scoutsGrade} large />
        </div>
        <div>
          <span class="k">Analytics</span>
          {a ? <Grade g={a.grade} large /> : <span class="gc lg g50" title="No sample yet">—</span>}
        </div>
        <div>
          <span class="k">Your read</span>
          <Grade g={sc.blendGrade} large />
        </div>
      </div>
      <div class="small dim">
        {a
          ? `Analytics works from ${a.basis}: ${a.sample} ${v.summary.pitcher ? "batters faced" : "plate appearances"} this season and last, ${Math.round(100 * a.reliability)}% reliable, so your read leans ${Math.round(100 * a.weight)}% on it.`
          : "No performance sample yet, so your read is the scouts' alone."}
      </div>
      {sc.canLook && (
        <div class="actions" style={{ alignItems: "center" }}>
          <button type="button" class="btn small" disabled={busy || sc.looksLeft <= 0} onClick={look}>
            Send a scout
          </button>
          <span class="small dim">
            {sc.looks > 0 ? `${sc.looks} look${sc.looks === 1 ? "" : "s"} so far. ` : ""}
            {sc.looksLeft} left {v.summary.teamId === null ? "" : "this week"}.
          </span>
        </div>
      )}
    </Section>
  );
}
