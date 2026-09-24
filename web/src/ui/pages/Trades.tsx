import { useEffect, useMemo, useState } from "preact/hooks";
import { bump, call, useApi } from "../../api/client";
import type { Status, TradeCheckView, TradeSide } from "../../api/protocol";
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
    setGive(new Set());
    setGet(new Set());
    setCheck(null);
  }, [partner]);

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
            <SideTable side={sides.data.mine} picked={give} toggle={toggle(give, setGive)} filter={filters[0]} />
          </Section>
          <Section title={`${sides.data.theirs.team.city} ${sides.data.theirs.team.nickname}`} aside={filterSeg(1)}>
            <SideTable side={sides.data.theirs} picked={get} toggle={toggle(get, setGet)} filter={filters[1]} />
          </Section>
        </div>
      )}
    </>
  );
}
