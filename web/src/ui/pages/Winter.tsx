import { useState } from "preact/hooks";
import { bump, call, useApi } from "../../api/client";
import type { DevRow, OffseasonPhase, OffseasonView, PlayerSummary, Status } from "../../api/protocol";
import { ErrorNote, Loading, notify, Section } from "../components/Common";
import { Grade, GradeChips } from "../components/Grade";
import { type Column, Table } from "../components/Table";
import { fixed, LEVEL_NAMES } from "../format";
import { playerHref } from "../router";

type WinterAction = "beginOffseason" | "advance" | "winterWeek";

const STEPS: { phase: OffseasonPhase; label: string; date: string }[] = [
  { phase: "review", label: "Review", date: "Oct 30" },
  { phase: "tenders", label: "Tenders", date: "Nov 18" },
  { phase: "draft", label: "Draft", date: "Dec 8" },
  { phase: "freeAgency", label: "Free agency", date: "Dec 12" },
  { phase: "international", label: "International", date: "Feb 9" },
  { phase: "spring", label: "Spring", date: "Mar 1" },
];

const $ = (x: number) => (x >= 10 ? `$${x.toFixed(1)}M` : `$${x.toFixed(2)}M`);

export function Winter({ status, onWinter }: { status: Status; onWinter: (kind: WinterAction) => void }) {
  const view = useApi("offseason", undefined);
  if (status.phase !== "offseason") {
    return (
      <>
        <div class="page-head">
          <h1>Offseason</h1>
        </div>
        <div class="empty">The offseason starts after the World Series.</div>
      </>
    );
  }
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  const current = STEPS.findIndex((s) => s.phase === v.phase);

  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">
            {v.year}-{String((v.year + 1) % 100).padStart(2, "0")} offseason
          </div>
          <h1>{status.winter?.label}</h1>
        </div>
        <div class="counts">
          <span class={v.payroll.payroll + v.payroll.staff > v.payroll.budget ? "over" : ""}>
            Payroll <b>{$(v.payroll.payroll)}</b> + staff {$(v.payroll.staff)} of {$(v.payroll.budget)}
          </span>
          <span class={v.payroll.fortyMan > 40 ? "over" : ""}>
            40-man <b>{v.payroll.fortyMan}</b>/40
          </span>
        </div>
      </div>

      <ol class="winter-steps" aria-label="Offseason calendar">
        {STEPS.map((s, i) => (
          <li key={s.phase} class={i < current ? "done" : i === current ? "on" : ""} aria-current={i === current ? "step" : undefined}>
            <span class="d">{s.date}</span>
            <span class="l">{s.label}</span>
          </li>
        ))}
      </ol>

      {v.phase === "review" && <Review v={v} />}
      {(v.phase === "review" || v.phase === "tenders") && <Tenders v={v} />}
      {v.phase === "draft" && <Draft v={v} />}
      {v.phase === "freeAgency" && <FreeAgency v={v} onWinter={onWinter} />}
      {v.phase === "international" && <International v={v} />}
      {v.phase === "spring" && <Spring status={status} />}

      <div class="start-bar">
        <span class="dim">{NEXT[v.phase]}</span>
        <button type="button" class="btn primary" onClick={() => onWinter("advance")}>
          {status.winter?.action}
        </button>
      </div>
    </>
  );
}

const NEXT: Record<OffseasonPhase, string> = {
  review: "Next: the tender deadline, where arbitration-eligible players get contracts or become free agents.",
  tenders: "Tendering locks in the salaries below; non-tendered players and expiring veterans become free agents.",
  draft: "Finishing the draft lets your scouting director make any picks you haven't.",
  freeAgency: "Finishing free agency plays out the remaining weeks; your standing offers stay in play.",
  international: "Closing the signing period lets the other clubs (and your scouts) spend what's left.",
  spring: "Your assistant GM set the Opening Day roster. Adjust it on My club before the season starts.",
};

// ---------------------------------------------------------------------------

function DevTable({ rows, title }: { rows: DevRow[]; title: string }) {
  return (
    <Section title={title}>
      <div class="tbl-wrap">
        <table class="tbl">
          <tbody>
            {rows.map((r) => (
              <tr key={r.player.id}>
                <td class="name">
                  <a href={playerHref(r.player.id)}>{r.player.name}</a>
                </td>
                <td>{r.player.pos}</td>
                <td class="dim">{r.team}</td>
                <td class="num">{r.player.age}</td>
                <td class="nowrap">
                  <Grade g={r.before} /> <span class="muted">→</span> <Grade g={r.after} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Review({ v }: { v: OffseasonView }) {
  const r = v.review!;
  return (
    <>
      {r.champion && (
        <div class="champion">
          <span class="k">{v.year} champions</span>
          <span class="v">{r.champion}</span>
          {r.record && (
            <span class="small" style={{ color: "var(--board-dim)" }}>
              Your club: {r.record}, {r.finish?.toLowerCase()}
            </span>
          )}
        </div>
      )}
      <Section title="Awards">
        <div class="tbl-wrap">
          <table class="tbl">
            <tbody>
              {r.awards.map((a) => (
                <tr key={`${a.name}-${a.league}`}>
                  <td class="nowrap">
                    {a.league} {a.name}
                  </td>
                  <td class="name">
                    <a href={playerHref(a.playerId)}>{a.player}</a> <span class="muted">{a.team}</span>
                  </td>
                  <td class="dim wrap">{a.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <div class="grid-2">
        <DevTable rows={r.risers} title="Winter risers" />
        <DevTable rows={r.fallers} title="Aging and slumping" />
      </div>
      {r.retirements.length > 0 && (
        <Section title="Retirements" aside={`${r.retirements.length} notable`}>
          <div class="traits">
            {r.retirements.map((x) => (
              <a key={x.playerId} class="trait" href={playerHref(x.playerId)}>
                {x.name} ({x.team}, {x.age})
              </a>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function Tenders({ v }: { v: OffseasonView }) {
  const t = v.tenders!;
  const set = async (playerId: number, tender: boolean) => {
    const res = await call("setTender", { playerId, tender });
    if (!res.ok) notify(res.reason ?? "Can't change that.", true);
    bump();
  };
  const total = t.rows.filter((r) => r.tender).reduce((s, r) => s + r.salary, 0);
  return (
    <div class="grid-2">
      <Section title="Arbitration" aside={`${$(total)} if all tendered as shown`}>
        {t.rows.length === 0 ? (
          <div class="empty">No arbitration cases this winter.</div>
        ) : (
          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Player</th>
                  <th class="num">Age</th>
                  <th class="num" title="Service time">Svc</th>
                  <th class="num" title="Projected WAR over a full season">WAR</th>
                  <th class="num">Award</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r) => (
                  <tr key={r.player.id}>
                    <td class="name">
                      <a href={playerHref(r.player.id)}>{r.player.name}</a> <span class="muted">{r.player.pos}</span>
                    </td>
                    <td class="num">{r.player.age}</td>
                    <td class="num">{r.player.status.service}</td>
                    <td class="num">{fixed(r.war)}</td>
                    <td class="num">{$(r.salary)}</td>
                    <td>
                      {v.phase === "review" || v.phase === "tenders" ? (
                        <div class="seg" role="group" aria-label={`Tender ${r.player.name}`}>
                          <button type="button" class={r.tender ? "on" : ""} aria-pressed={r.tender} onClick={() => set(r.player.id, true)}>
                            Tender
                          </button>
                          <button type="button" class={!r.tender ? "on" : ""} aria-pressed={!r.tender} onClick={() => set(r.player.id, false)}>
                            Non-tender
                          </button>
                        </div>
                      ) : r.tender ? (
                        "Tendered"
                      ) : (
                        "Non-tendered"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div class="small dim">
          Arbitration pays a rising share of a player's market value: about 22%, 38% and 58% in his three years of eligibility.
          Non-tendered players become free agents.
        </div>
      </Section>
      <Section title="Becoming free agents" aside={`${t.expiring.length}`}>
        {t.expiring.length === 0 ? (
          <div class="empty">None of your veterans' contracts are up.</div>
        ) : (
          <div class="traits">
            {t.expiring.map((p) => (
              <a key={p.id} class="trait" href={playerHref(p.id)}>
                {p.pos} {p.name}, {p.age}
              </a>
            ))}
          </div>
        )}
        <div class="small dim">Players with six years of service hit the open market. You can bid on them in free agency like anyone else.</div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function prospectColumns(extra: Column<PlayerSummary & { school?: string; bonus?: number }>[]): Column<PlayerSummary & { school?: string; bonus?: number }>[] {
  return [
    { key: "name", label: "Name", cls: "name", render: (p) => (p.id >= 0 ? <a href={playerHref(p.id)}>{p.name}</a> : p.name) },
    { key: "pos", label: "Pos", render: (p) => p.pos },
    { key: "age", label: "Age", cls: "num", sort: (p) => p.age, asc: true, render: (p) => p.age },
    { key: "bt", label: "B/T", cls: "ctr", render: (p) => `${p.bats}/${p.throws}` },
    { key: "ovr", label: "Now", cls: "ctr", sort: (p) => p.ovr, render: (p) => <Grade g={p.ovr} /> },
    { key: "fv", label: "FV", title: "Future value: his projected peak", cls: "ctr", sort: (p) => p.fv, render: (p) => <Grade g={p.fv} /> },
    { key: "tools", label: "Tools", title: "Present grades (Hit/Pow/Eye/Run/Fld/Arm or Stuff/Ctl/Cmd/Stam)", render: (p) => <GradeChips grades={p.grades} /> },
    ...extra,
  ];
}

function Draft({ v }: { v: OffseasonView }) {
  const d = v.draft!;
  const [busy, setBusy] = useState(false);
  const pick = async (playerId: number) => {
    setBusy(true);
    const res = await call("draftPick", { playerId });
    if (!res.ok) notify(res.reason ?? "Can't pick now.", true);
    else notify("Pick is in.");
    setBusy(false);
    bump();
  };
  const toMe = async () => {
    setBusy(true);
    await call("draftToMe", undefined);
    setBusy(false);
    bump();
  };
  const mine = d.onClock?.mine ?? false;
  const columns = prospectColumns([
    { key: "school", label: "From", render: (p) => p.school },
    { key: "conf", label: "Read", title: "How sure your scouts are", render: (p) => <span class={`confidence ${p.read.confidence}`}>{p.read.confidence}</span> },
    { key: "scout", label: "", render: (p) => <ScoutButton id={p.id} /> },
    {
      key: "go",
      label: "",
      render: (p) => (
        <button type="button" class="btn small primary" disabled={!mine || busy} onClick={() => pick(p.id)}>
          Draft
        </button>
      ),
    },
  ]);
  return (
    <>
      <div class={`note${mine ? " warn" : ""}`}>
        {d.onClock ? (
          mine ? (
            <b>
              You're on the clock: round {d.onClock.round}, pick #{d.onClock.pick}.
            </b>
          ) : (
            <>
              {d.onClock.team} is on the clock (round {d.onClock.round}, #{d.onClock.pick}).{" "}
              {d.myPicks.length > 0 ? `Your next pick is #${d.myPicks[0]}.` : "You're out of picks."}{" "}
              {d.myPicks.length > 0 && (
                <button type="button" class="btn small" disabled={busy} onClick={toMe}>
                  Sim to my pick
                </button>
              )}
            </>
          )
        ) : (
          "The draft is complete."
        )}
      </div>
      <div class="grid-2" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
        <Section title="Draft board" aside="Best available by projected peak">
          <Table columns={columns} rows={d.board} rowKey={(p) => p.id} limit={30} />
        </Section>
        <Section title="Picks">
          <div class="wire">
            {d.picks.map((pk) => (
              <div class={`wire-item${pk.mine ? " mine-row" : ""}`} key={pk.pick}>
                <span class="date">#{pk.pick}</span>
                <span class="club">{pk.team}</span>
                <a class="text" href={playerHref(pk.playerId)} style={{ color: "inherit" }}>
                  {pk.pos} {pk.name} <Grade g={pk.fv} title="Future value" />
                </a>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function OfferCell({ row, offer }: { row: NonNullable<OffseasonView["freeAgency"]>["agents"][number]; offer?: { years: number; salary: number } }) {
  const [years, setYears] = useState(offer?.years ?? row.askYears);
  const [salary, setSalary] = useState(String(offer?.salary ?? row.floor));
  const send = async () => {
    const res = await call("faOffer", { playerId: row.player.id, years, salary: Number(salary) });
    if (!res.ok) notify(res.reason ?? "Offer not allowed.", true);
    else notify(`Offer to ${row.player.name}: ${years} yr, $${Number(salary).toFixed(2)}M a year.`);
    bump();
  };
  const withdraw = async () => {
    await call("faWithdraw", { playerId: row.player.id });
    bump();
  };
  return (
    <div class="offer">
      <select class="sel" aria-label="Years" value={years} onChange={(e) => setYears(Number((e.target as HTMLSelectElement).value))}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((y) => (
          <option key={y} value={y}>
            {y} yr
          </option>
        ))}
      </select>
      <span class="money-input">
        $
        <input class="txt" inputMode="decimal" aria-label="Salary per year in millions" value={salary} onInput={(e) => setSalary((e.target as HTMLInputElement).value)} />M
      </span>
      <button type="button" class="btn small primary" onClick={send}>
        {offer ? "Update" : "Offer"}
      </button>
      {offer && (
        <button type="button" class="btn small ghost" onClick={withdraw}>
          Withdraw
        </button>
      )}
    </div>
  );
}

function FreeAgency({ v, onWinter }: { v: OffseasonView; onWinter: (kind: WinterAction) => void }) {
  const fa = v.freeAgency!;
  const offers = new Map(fa.offers.map((o) => [o.playerId, o]));
  const room = v.payroll.budget - v.payroll.payroll;
  type Row = (typeof fa.agents)[number];
  const columns: Column<Row>[] = [
    { key: "name", label: "Name", cls: "name", sort: (r) => r.player.name, asc: true, render: (r) => <a href={playerHref(r.player.id)}>{r.player.name}</a> },
    { key: "pos", label: "Pos", render: (r) => r.player.pos },
    { key: "age", label: "Age", cls: "num", sort: (r) => r.player.age, asc: true, render: (r) => r.player.age },
    { key: "ovr", label: "Now", cls: "ctr", sort: (r) => r.player.ovr, render: (r) => <Grade g={r.player.ovr} /> },
    { key: "war", label: "WAR", title: "Projected WAR over a full season", cls: "num", sort: (r) => r.war, render: (r) => fixed(r.war) },
    { key: "ask", label: "Asking", cls: "num", sort: (r) => r.askSalary, render: (r) => `${r.askYears} yr × ${$(r.askSalary)}` },
    { key: "floor", label: "Takes now", title: "The lowest annual salary he'd accept this week, at his asked-for years", cls: "num", sort: (r) => r.floor, render: (r) => $(r.floor) },
    { key: "offer", label: "Your offer", render: (r) => <OfferCell row={r} offer={offers.get(r.player.id)} /> },
  ];
  return (
    <>
      <div class="note">
        Week {Math.min(fa.week + 1, fa.weeks)} of {fa.weeks}. Offers are answered at the end of each week; a player takes the best one that
        clears his bar, and his demands soften as the winter goes on. You have {$(Math.max(0, room))} of room under your budget and{" "}
        {fa.offers.length} offer{fa.offers.length === 1 ? "" : "s"} out. Unless you've taken over roster moves on My club, your
        assistant GM also bids on players who'd upgrade your roster.{" "}
        {fa.week < fa.weeks && (
          <button type="button" class="btn small" onClick={() => onWinter("winterWeek")}>
            Play the week
          </button>
        )}
      </div>
      <Section title="Free agents" aside={`${fa.agents.length} available`}>
        <Table columns={columns} rows={fa.agents} rowKey={(r) => r.player.id} sortKey="war" limit={40} empty="Nobody left on the market." />
      </Section>
      <Section title="Signings" aside={`${fa.signings.length} this winter`}>
        {fa.signings.length === 0 ? (
          <div class="empty">No deals yet.</div>
        ) : (
          <div class="wire">
            {fa.signings.map((x) => (
              <div class="wire-item" key={x.playerId}>
                <span class="date">Wk {x.week + 1}</span>
                <span class="club">{x.team}</span>
                <a class="text" href={playerHref(x.playerId)} style={{ color: "inherit" }}>
                  {x.name}: {x.years} yr, {$(x.salary * x.years)} total
                </a>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function International({ v }: { v: OffseasonView }) {
  const s = v.international!;
  const [busy, setBusy] = useState(false);
  const sign = async (id: number) => {
    setBusy(true);
    const res = await call("intlSign", { playerId: id });
    if (!res.ok) notify(res.reason ?? "Can't sign him.", true);
    else notify("Signed.");
    setBusy(false);
    bump();
  };
  const columns = prospectColumns([
    { key: "bonus", label: "Bonus", cls: "num", sort: (p) => p.bonus ?? 0, render: (p) => $(p.bonus ?? 0) },
    { key: "conf", label: "Read", title: "How sure your scouts are", render: (p) => <span class={`confidence ${p.read.confidence}`}>{p.read.confidence}</span> },
    { key: "scout", label: "", render: (p) => <ScoutButton id={p.id} /> },
    {
      key: "go",
      label: "",
      render: (p) => (
        <button type="button" class="btn small primary" disabled={busy || (p.bonus ?? 0) > s.pool || s.signed >= s.maxSignings} onClick={() => sign(p.id)}>
          Sign
        </button>
      ),
    },
  ]);
  return (
    <>
      <div class="note">
        Bonus pool left: <b>{$(s.pool)}</b>. You've signed {s.signed} of up to {s.maxSignings}. These are 17-year-olds: years away, and
        where a lot of stars come from. They report to Single-A.
      </div>
      <div class="grid-2" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
        <Section title="Prospects" aside="Best first">
          <Table columns={columns} rows={s.prospects} rowKey={(p) => p.id} limit={30} empty="Everyone has signed." />
        </Section>
        <Section title="Signings">
          {s.signings.length === 0 ? (
            <div class="empty">None yet.</div>
          ) : (
            <div class="wire">
              {s.signings.map((x) => (
                <div class="wire-item" key={x.playerId}>
                  <span class="date">{$(x.bonus)}</span>
                  <span class="club">{x.team}</span>
                  <a class="text" href={playerHref(x.playerId)} style={{ color: "inherit" }}>
                    {x.name}
                  </a>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

function Spring({ status }: { status: Status }) {
  const user = status.userTeamId;
  return (
    <div class="note">
      Winter heals most injuries, and every club has trimmed its 40-man roster, picked 26 for Opening Day and sorted its farm
      system: {Object.values(LEVEL_NAMES).slice(1).join(", ")}.{" "}
      {user !== null && user !== undefined && (
        <>
          <a href={`#team-${user}`}>Check your roster</a> and <a href={`#team-${user}-depth`}>depth chart</a>, or{" "}
          <a href="#trades">make a trade</a>. Moves before Opening Day don't use option years.
        </>
      )}
    </div>
  );
}

/** Send a scout to see an amateur (uses one of your looks). */
function ScoutButton({ id }: { id: number }) {
  const look = async () => {
    const res = await call("scoutPlayer", { playerId: id });
    if (!res.ok) notify(res.reason ?? "No scouts available.", true);
    else notify("Your scouts took another look.");
    bump();
  };
  return (
    <button type="button" class="btn small" onClick={look} title="Send a scout: narrows your report on him">
      Scout
    </button>
  );
}
