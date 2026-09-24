import { useEffect, useMemo, useState } from "preact/hooks";
import { bump, call, useApi } from "../../api/client";
import type { OfferView, Status, TradeCheckView, TradeSide } from "../../api/protocol";
import { ErrorNote, Loading, notify, Section, Seg } from "../components/Common";
import { Grade } from "../components/Grade";
import { type Column, Table } from "../components/Table";
import { LEVEL_NAMES } from "../format";
import { go, playerHref } from "../router";

type Filter = "mlb" | "farm" | "all";
type Row = TradeSide["players"][number];

const money = (x: number) => `${x < 0 ? "-" : ""}$${Math.abs(x).toFixed(1)}M`;

function SideTable({ side, picked, toggle, filter }: { side: TradeSide; picked: Set<number>; toggle: (id: number) => void; filter: Filter }) {
  const rows = side.players.filter((p) => filter === "all" || (filter === "mlb" ? p.level === "MLB" || p.status.il : p.level !== "MLB"));
  const columns: Column<Row>[] = [
    {
      key: "pick",
      label: "",
      render: (p) => <input type="checkbox" aria-label={`Include ${p.name}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} />,
    },
    { key: "name", label: "Name", cls: "name", sort: (p) => p.name, asc: true, render: (p) => <a href={playerHref(p.id)}>{p.name}</a> },
    { key: "pos", label: "Pos", render: (p) => p.pos },
    { key: "age", label: "Age", cls: "num", sort: (p) => p.age, asc: true, render: (p) => p.age },
    {
      key: "surplus",
      label: "Value",
      title: "Surplus value: projected wins over his years of control at $8M a win, minus salary",
      cls: "num",
      sort: (p) => p.surplus,
      render: (p) => <span class={p.surplus < 0 ? "neg" : ""}>{money(p.surplus)}</span>,
    },
    { key: "lvl", label: "Lvl", render: (p) => (p.status.il ? p.status.il : LEVEL_NAMES[p.level]) },
    { key: "ovr", label: "Now", cls: "ctr", sort: (p) => p.ovr, render: (p) => <Grade g={p.ovr} /> },
    { key: "fv", label: "FV", cls: "ctr", sort: (p) => p.fv, render: (p) => <Grade g={p.fv} /> },
    { key: "contract", label: "Contract", render: (p) => <span class="dim">{p.contract?.label ?? "—"}</span> },
  ];
  return <Table columns={columns} rows={rows} rowKey={(p) => p.id} sortKey="surplus" limit={25} rowClass={(p) => (picked.has(p.id) ? "mine" : "")} />;
}

/** The players picked on one side, whether or not they're in view in the table below. */
function Picked({ side, picked, toggle }: { side: TradeSide; picked: Set<number>; toggle: (id: number) => void }) {
  const rows = side.players.filter((p) => picked.has(p.id));
  if (rows.length === 0) return null;
  return (
    <div class="traits picked" aria-label="In the deal">
      {rows.map((p) => (
        <button type="button" class="trait" key={p.id} onClick={() => toggle(p.id)} title="Take him out of the deal">
          {p.pos} {p.name} · {money(p.surplus)} ×
        </button>
      ))}
    </div>
  );
}

/** A deal to load into the builder once the page switches to its club (from an offer's Adjust). */
let preset: { partner: number; give: number[]; get: number[] } | null = null;

function OfferSide({ label, players, total }: { label: string; players: OfferView["give"]; total: number }) {
  return (
    <div class="offer-side">
      <div class="k">
        {label} <span class="dim">({money(total)} by your read)</span>
      </div>
      {players.map((p) => (
        <div class="offer-player" key={p.id}>
          <span class="pos">{p.pos}</span>
          <a href={playerHref(p.id)}>{p.name}</a>
          <span class="dim">
            {p.age} · {p.status.il ? p.status.il : LEVEL_NAMES[p.level]}
          </span>
          <Grade g={p.ovr} />
          <Grade g={p.fv} />
          <span class={`num${p.surplus < 0 ? " neg" : ""}`}>{money(p.surplus)}</span>
          <span class="dim contract">{p.contract?.label ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

/** Offers from other clubs, newest first. */
function Offers({ canTrade, onAdjust }: { canTrade: boolean; onAdjust: (o: OfferView) => void }) {
  const view = useApi("offers", undefined);
  if (!view.data || view.data.length === 0) return null;
  const answer = async (o: OfferView, accept: boolean) => {
    const res = await call("answerOffer", { id: o.id, accept });
    if (!res.ok) notify(res.reason ?? "That didn't work.", true);
    else if (accept) {
      notify(`Done: the deal with the ${o.team.nickname} is made.`);
      if (res.warning) notify(res.warning, true);
    } else notify(`You passed on the ${o.team.nickname}' offer.`);
    bump();
  };
  return (
    <Section title="Offers on the table" aside={`${view.data.length} waiting`}>
      <div class="offer-list">
        {[...view.data].reverse().map((o) => (
          <div class="trade-offer" key={o.id}>
            <div class="offer-head">
              <b>
                {o.team.city} {o.team.nickname}
              </b>
              <span class="dim small">{o.expires}</span>
            </div>
            <p class="pitch">{o.pitch}</p>
            <div class="grid-2">
              <OfferSide label="You send" players={o.give} total={o.value.give} />
              <OfferSide label="You get" players={o.get} total={o.value.get} />
            </div>
            <div class="offer-actions">
              <button type="button" class="btn primary" disabled={!canTrade} onClick={() => answer(o, true)}>
                Accept
              </button>
              <button type="button" class="btn" onClick={() => answer(o, false)}>
                Decline
              </button>
              <button type="button" class="btn ghost" onClick={() => onAdjust(o)}>
                Adjust and counter
              </button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function Trades({ partnerId, status }: { partnerId: number | null; status: Status }) {
  const user = status.userTeamId ?? null;
  const partners = (status.teams ?? []).filter((t) => t.id !== user).sort((a, b) => a.city.localeCompare(b.city));
  const partner = partnerId ?? partners[0]?.id ?? 0;
  const sides = useApi("tradeSides", { partnerId: partner }, [partner]);
  const [give, setGive] = useState<Set<number>>(new Set());
  const [get, setGet] = useState<Set<number>>(new Set());
  const [filters, setFilters] = useState<[Filter, Filter]>(["all", "all"]);
  const [check, setCheck] = useState<TradeCheckView | null>(null);

  useEffect(() => {
    const p = preset && preset.partner === partner ? preset : null;
    preset = null;
    setGive(new Set(p?.give ?? []));
    setGet(new Set(p?.get ?? []));
    setCheck(null);
  }, [partner]);

  const adjust = (o: OfferView) => {
    const deal = { partner: o.team.id, give: o.give.map((p) => p.id), get: o.get.map((p) => p.id) };
    if (deal.partner === partner) {
      setGive(new Set(deal.give));
      setGet(new Set(deal.get));
    } else {
      preset = deal;
      go({ page: "trades", partnerId: deal.partner });
    }
    notify("The offer is loaded below: change either side and propose it.");
  };

  const key = useMemo(() => `${[...give].join(",")}|${[...get].join(",")}`, [give, get]);
  useEffect(() => {
    if (give.size === 0 && get.size === 0) {
      setCheck(null);
      return;
    }
    let live = true;
    call("trade", { partnerId: partner, give: [...give], get: [...get], execute: false }).then((c) => live && setCheck(c));
    return () => {
      live = false;
    };
  }, [key, partner]);

  const toggle = (set: Set<number>, update: (s: Set<number>) => void) => (id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const propose = async () => {
    const res = await call("trade", { partnerId: partner, give: [...give], get: [...get], execute: true });
    if (res.done) {
      notify("Trade complete.");
      if (res.warning) notify(res.warning, true);
      setGive(new Set());
      setGet(new Set());
      setCheck(null);
      bump();
    } else notify(res.reason ?? "They said no.", true);
  };

  if (user === null) return <div class="empty">Trades are for the club you run.</div>;
  const filterSeg = (i: 0 | 1) => (
    <Seg<Filter>
      label="Show"
      value={filters[i]}
      options={[
        ["all", "All"],
        ["mlb", "Big leaguers"],
        ["farm", "Farm"],
      ]}
      onChange={(f) => setFilters(i === 0 ? [f, filters[1]] : [filters[0], f])}
    />
  );

  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">Trade desk</div>
          <h1>Make a deal</h1>
          <div class="sub">Clubs value players by surplus: projected wins over the years they control him, minus what they'll pay him.</div>
        </div>
        <select class="sel" aria-label="Trade partner" value={partner} onChange={(e) => go({ page: "trades", partnerId: Number((e.target as HTMLSelectElement).value) })}>
          {partners.map((t) => (
            <option key={t.id} value={t.id}>
              {t.city} {t.nickname}
            </option>
          ))}
        </select>
      </div>
      {!status.canTrade && <div class="note warn">{status.tradeNote}</div>}
      {status.canTrade && status.deadline && (
        <div class="note">
          {status.deadline.daysLeft === 0
            ? "It's deadline day: trades close after today's games."
            : `The trade deadline is ${status.deadline.date}, ${status.deadline.daysLeft} day${status.deadline.daysLeft === 1 ? "" : "s"} away.`}
        </div>
      )}
      <Offers canTrade={Boolean(status.canTrade)} onAdjust={adjust} />

      <div class="trade-bar">
        <div>
          <span class="k">You send</span>
          <span class="v">{money(check?.give ?? 0)}</span>
        </div>
        <div>
          <span class="k">You get</span>
          <span class="v">{money(check?.get ?? 0)}</span>
        </div>
        <div class="verdict">
          {check === null ? (
            <span class="dim">Pick players from both sides.</span>
          ) : check.ok ? (
            <span class="yes">They'd take it.</span>
          ) : (
            <span class="no">{check.reason}</span>
          )}
        </div>
        <button type="button" class="btn primary" disabled={!check?.ok || !status.canTrade} onClick={propose}>
          Propose trade
        </button>
      </div>

      {sides.error && <ErrorNote error={sides.error} />}
      {!sides.data && !sides.error && <Loading />}
      {sides.data && (
        <div class="grid-2">
          <Section title={`Your ${sides.data.mine.team.nickname}`} aside={filterSeg(0)}>
            <Picked side={sides.data.mine} picked={give} toggle={toggle(give, setGive)} />
            <SideTable side={sides.data.mine} picked={give} toggle={toggle(give, setGive)} filter={filters[0]} />
          </Section>
          <Section title={`${sides.data.theirs.team.city} ${sides.data.theirs.team.nickname}`} aside={filterSeg(1)}>
            <Picked side={sides.data.theirs} picked={get} toggle={toggle(get, setGet)} />
            <SideTable side={sides.data.theirs} picked={get} toggle={toggle(get, setGet)} filter={filters[1]} />
          </Section>
        </div>
      )}
    </>
  );
}
