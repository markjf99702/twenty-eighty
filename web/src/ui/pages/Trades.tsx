import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { bump, call, useApi } from "../../api/client";
import type { BlockRow, OfferView, RoomMove, Status, TradeCheckView, TradeSide } from "../../api/protocol";
import { ErrorNote, Loading, notify, Section, Seg } from "../components/Common";
import { Headline, NowGrade, outlookColumns } from "../components/Outlook";
import { type Column, Table } from "../components/Table";
import { StaffTake } from "../components/StaffTake";
import { LEVEL_NAMES, statBrief } from "../format";
import { BLOCK_SLUGS, type BlockSlug, go, playerHref } from "../router";
import { useBasics } from "../settings";
import { takePreset, tradeFor } from "../tradePreset";

type Filter = "all" | "forty" | "mlb" | "farm";
type Row = TradeSide["players"][number];
type Move = RoomMove["move"];

const FORTY_MAN = 40;
const money = (x: number) => `${x < 0 ? "-" : ""}$${Math.abs(x).toFixed(1)}M`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function shows(p: Row, filter: Filter): boolean {
  if (filter === "forty") return p.status.fortyMan;
  if (filter === "mlb") return p.level === "MLB" || p.status.il !== null;
  if (filter === "farm") return p.level !== "MLB";
  return true;
}

function SideTable({ side, picked, toggle, filter }: { side: TradeSide; picked: Set<number>; toggle: (id: number) => void; filter: Filter }) {
  const basics = useBasics();
  const rows = side.players.filter((p) => shows(p, filter));
  const columns: Column<Row>[] = [
    {
      key: "pick",
      label: "",
      render: (p) => <input type="checkbox" aria-label={`Include ${p.name}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} />,
    },
    {
      key: "name",
      label: "Name",
      cls: "name",
      sort: (p) => p.name,
      asc: true,
      render: (p) => (
        <>
          <a href={playerHref(p.id)}>{p.name}</a>
          <span class="stat-brief">{statBrief(p, basics)}</span>
        </>
      ),
    },
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
    {
      key: "forty",
      label: "40",
      title: "On the 40-man roster",
      cls: "ctr",
      sort: (p) => (p.status.fortyMan ? 1 : 0),
      render: (p) => (p.status.fortyMan ? <span class="on40">●</span> : ""),
    },
    ...outlookColumns(rows, (p) => p),
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

/**
 * The user's 40-man players who could go along with the deal to make room:
 * option a big leaguer to AAA (in season) or designate anyone for assignment.
 */
function MakeRoom({
  side,
  give,
  moves,
  setMove,
  check,
}: {
  side: TradeSide;
  give: Set<number>;
  moves: Map<number, Move>;
  setMove: (id: number, move: Move | null) => void;
  check: TradeCheckView;
}) {
  const fortyMan = check.fortyMan ?? 0;
  const inSeason = check.active !== null && check.active !== undefined;
  const active = check.active ?? 0;
  const limit = check.activeLimit ?? 26;
  const fortyOver = fortyMan - FORTY_MAN;
  const activeOver = inSeason ? active - limit : 0;
  const rows = side.players.filter((p) => !give.has(p.id) && p.status.fortyMan && p.status.il === null);
  const chosen = rows.filter((p) => moves.has(p.id));
  const canOption = (p: Row) => inSeason && Boolean(p.actions?.some((a) => a.kind === "option" && a.ok));

  const columns: Column<Row>[] = [
    {
      key: "move",
      label: "Move",
      render: (p) => (
        <select
          class="sel"
          aria-label={`Move for ${p.name}`}
          value={moves.get(p.id) ?? ""}
          onChange={(e) => setMove(p.id, ((e.target as HTMLSelectElement).value || null) as Move | null)}
        >
          <option value="">Keep</option>
          {canOption(p) && <option value="option">Option to AAA</option>}
          <option value="dfa">Designate</option>
        </select>
      ),
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
      asc: true,
      render: (p) => <span class={p.surplus < 0 ? "neg" : ""}>{money(p.surplus)}</span>,
    },
    { key: "lvl", label: "Lvl", render: (p) => LEVEL_NAMES[p.level] },
    ...outlookColumns(rows, (p) => p),
    { key: "opt", label: "Opt", title: "Option years left", cls: "num", sort: (p) => p.status.optionsLeft, render: (p) => p.status.optionsLeft },
    { key: "contract", label: "Contract", render: (p) => <span class="dim">{p.contract?.label ?? "—"}</span> },
  ];

  let guide: string;
  if (fortyOver > 0) {
    guide = `Designate ${plural(fortyOver, "player")} for assignment and the deal can go through. Other clubs get a shot at him on waivers; if nobody claims him, he stays in your system at AAA, off the 40-man.`;
  } else if (activeOver > 0) {
    guide = `The 40-man fits. You'd have ${active} active (the limit is ${limit}), so option or designate ${activeOver} here, or sort it out after the deal.`;
  } else guide = "Everything fits.";

  return (
    <Section title="Make room" aside="Moves made with the deal">
      <div class="room-head">
        <div class={fortyOver > 0 ? "over" : ""}>
          <span class="k">40-man after</span>
          <span class="v">
            {fortyMan}
            <small>/{FORTY_MAN}</small>
          </span>
        </div>
        {inSeason && (
          <div class={activeOver > 0 ? "over" : ""}>
            <span class="k">Active after</span>
            <span class="v">
              {active}
              <small>/{limit}</small>
            </span>
          </div>
        )}
        <p>{guide}</p>
      </div>
      {chosen.length > 0 && (
        <div class="traits picked" aria-label="Moves with the deal">
          {chosen.map((p) => (
            <button type="button" class="trait" key={p.id} onClick={() => setMove(p.id, null)} title="Keep him">
              {moves.get(p.id) === "dfa" ? "Designate" : "Option"} {p.pos} {p.name} ×
            </button>
          ))}
        </div>
      )}
      <Table columns={columns} rows={rows} rowKey={(p) => p.id} sortKey="surplus" sortAsc limit={12} rowClass={(p) => (moves.has(p.id) ? "mine" : "")} />
    </Section>
  );
}

function OfferSide({ label, players, total }: { label: string; players: OfferView["give"]; total: number }) {
  const basics = useBasics();
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
          <Headline p={p} />
          <NowGrade p={p} />
          <span class={`num${p.surplus < 0 ? " neg" : ""}`}>{money(p.surplus)}</span>
          <span class="dim contract">{p.contract?.label ?? ""}</span>
          <span class="line">{statBrief(p, basics) || "No stats yet this season."}</span>
        </div>
      ))}
    </div>
  );
}

/** Offers from other clubs, newest first. */
function Offers({ canTrade, onAdjust }: { canTrade: boolean; onAdjust: (o: OfferView, room: boolean) => void }) {
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
            {o.advice && <StaffTake advice={o.advice} brief />}
            <div class="grid-2">
              <OfferSide label="You send" players={o.give} total={o.value.give} />
              <OfferSide label="You get" players={o.get} total={o.value.get} />
            </div>
            {o.over ? (
              <p class="room-note">
                Taking it puts you at {FORTY_MAN + o.over} on the 40-man roster. Make room loads it below so you can pick who to designate with the deal.
              </p>
            ) : null}
            <div class="offer-actions">
              {o.over ? (
                <button type="button" class="btn primary" disabled={!canTrade} onClick={() => onAdjust(o, true)}>
                  Make room
                </button>
              ) : (
                <button type="button" class="btn primary" disabled={!canTrade} onClick={() => answer(o, true)}>
                  Accept
                </button>
              )}
              <button type="button" class="btn" onClick={() => answer(o, false)}>
                Decline
              </button>
              <button type="button" class="btn ghost" onClick={() => onAdjust(o, false)}>
                Adjust and counter
              </button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

const BLOCK_LABELS: Record<BlockSlug, string> = {
  all: "Everyone",
  sp: "Starting pitchers",
  rp: "Relievers",
  c: "Catchers",
  "1b": "First basemen",
  "2b": "Second basemen",
  "3b": "Third basemen",
  ss: "Shortstops",
  lf: "Left fielders",
  cf: "Center fielders",
  rf: "Right fielders",
  dh: "Designated hitters",
};

/** Veterans that clubs out of the race are shopping, best fit for your club first. */
function OnTheBlock({ slug, canTrade }: { slug: BlockSlug; canTrade: boolean }) {
  const basics = useBasics();
  const view = useApi("onTheBlock", undefined);
  const [asking, setAsking] = useState<number | null>(null);
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const all = view.data;
  const inSlug = (p: BlockRow, s: BlockSlug) => s === "all" || p.group.toLowerCase() === s;
  const rows = all.filter((p) => inSlug(p, slug));
  const clubs = new Set(all.map((p) => p.club.id)).size;

  const ask = async (p: BlockRow) => {
    if (asking !== null) return;
    setAsking(p.id);
    try {
      const a = await call("askingPrice", { partnerId: p.club.id, get: [p.id] });
      if (!a.ok) notify(a.reason ?? "They wouldn't say.", true);
      else {
        tradeFor(p.club.id, [p.id], a.give ?? []);
        if (a.text) notify(`${a.text} It's loaded in the builder: change it or propose it.`);
      }
    } finally {
      setAsking(null);
    }
  };

  const columns: Column<BlockRow>[] = [
    {
      key: "name",
      label: "Name",
      cls: "name",
      sort: (p) => p.name,
      asc: true,
      render: (p) => (
        <>
          <a href={playerHref(p.id)}>{p.name}</a>
          <span class="stat-brief">{statBrief(p, basics)}</span>
        </>
      ),
    },
    { key: "pos", label: "Pos", render: (p) => p.pos },
    { key: "age", label: "Age", cls: "num", sort: (p) => p.age, asc: true, render: (p) => p.age },
    {
      key: "club",
      label: "Club",
      sort: (p) => p.club.abbrev,
      asc: true,
      render: (p) => (
        <span title={`${p.club.city} ${p.club.nickname}`}>
          <a href={`#team-${p.club.id}`}>{p.club.abbrev}</a>
          {p.gamesOut !== null && <span class="dim small"> {p.gamesOut} GB</span>}
        </span>
      ),
    },
    {
      key: "fit",
      label: "Fit",
      title: "Wins a season he'd add over who plays there for you now, by your read",
      cls: "num",
      sort: (p) => p.fit,
      render: (p) => <span class={p.fit >= 0.5 ? "up" : p.fit < 0 ? "neg" : "dim"}>{`${p.fit > 0 ? "+" : ""}${p.fit.toFixed(1)}`}</span>,
    },
    {
      key: "surplus",
      label: "Value",
      title: "Surplus value by your read: projected wins over his years of control at $8M a win, minus salary",
      cls: "num",
      sort: (p) => p.surplus,
      render: (p) => <span class={p.surplus < 0 ? "neg" : ""}>{money(p.surplus)}</span>,
    },
    ...outlookColumns(rows, (p) => p),
    { key: "contract", label: "Contract", render: (p) => <span class="dim">{p.contract?.label ?? "—"}</span> },
    {
      key: "deal",
      label: "",
      render: (p) => (
        <span class="block-actions">
          <button type="button" class="btn small" disabled={!canTrade} aria-label={`Trade for ${p.name}`} onClick={() => tradeFor(p.club.id, [p.id])}>
            Trade for
          </button>
          <button type="button" class="btn small ghost" disabled={!canTrade || asking !== null} onClick={() => ask(p)}>
            {asking === p.id ? "Asking…" : "What would they want?"}
          </button>
        </span>
      ),
    },
  ];

  return (
    <Section
      title="On the block"
      aside={
        <select class="sel" aria-label="Show" value={slug} onChange={(e) => go({ page: "trades", partnerId: null, block: (e.target as HTMLSelectElement).value as BlockSlug })}>
          {BLOCK_SLUGS.map((s) => (
            <option key={s} value={s}>
              {BLOCK_LABELS[s]} ({all.filter((p) => inSlug(p, s)).length})
            </option>
          ))}
        </select>
      }
    >
      <p class="block-about">
        {all.length === 0
          ? "Nobody is shopping players yet. Clubs put their veterans on the block once they fall out of the race."
          : `${plural(clubs, "club")} out of the race ${clubs === 1 ? "is" : "are"} shopping these veterans. Fit is how many wins a season each would add over who plays there for you now, by your read. Any club will listen on anyone, though: pick a club above to build any deal.`}
      </p>
      {all.length > 0 &&
        (rows.length === 0 ? (
          <p class="dim">Nobody at that spot is on the block right now.</p>
        ) : (
          <Table columns={columns} rows={rows} rowKey={(p) => p.id} sortKey="fit" limit={25} />
        ))}
    </Section>
  );
}

export function Trades({ partnerId, block, status }: { partnerId: number | null; block?: BlockSlug; status: Status }) {
  const user = status.userTeamId ?? null;
  const partners = (status.teams ?? []).filter((t) => t.id !== user).sort((a, b) => a.city.localeCompare(b.city));
  const partner = partnerId ?? partners[0]?.id ?? 0;
  const sides = useApi("tradeSides", { partnerId: partner }, [partner]);
  const theirName = sides.data?.theirs.team.nickname ?? partners.find((t) => t.id === partner)?.nickname ?? "other club";
  const [give, setGive] = useState<Set<number>>(new Set());
  const [get, setGet] = useState<Set<number>>(new Set());
  const [filters, setFilters] = useState<[Filter, Filter]>(["all", "all"]);
  const [moves, setMoves] = useState<Map<number, Move>>(new Map());
  const [check, setCheck] = useState<TradeCheckView | null>(null);

  // A new club clears the deal; a deal sent from elsewhere (an offer, a roster, the block) loads it.
  const shown = useRef<number | null>(null);
  useEffect(() => {
    if (block) return;
    const p = takePreset(partner);
    if (p || shown.current !== partner) {
      setGive(new Set(p?.give ?? []));
      setGet(new Set(p?.get ?? []));
      setMoves(new Map());
      setCheck(null);
    }
    shown.current = partner;
  }, [partner, block]);

  const adjust = (o: OfferView, room: boolean) => {
    const deal = { partner: o.team.id, give: o.give.map((p) => p.id), get: o.get.map((p) => p.id) };
    if (deal.partner === partner) {
      setGive(new Set(deal.give));
      setGet(new Set(deal.get));
    } else tradeFor(deal.partner, deal.get, deal.give);
    notify(
      room
        ? "The offer is loaded below: pick who to designate under Make room, then propose it."
        : "The offer is loaded below: change either side and propose it.",
    );
  };

  // A player going out in the deal can't also be moved to make room.
  const roomMoves = useMemo<RoomMove[]>(
    () => [...moves].filter(([id]) => !give.has(id)).map(([playerId, move]) => ({ playerId, move })),
    [moves, give],
  );
  const setMove = (id: number, move: Move | null) => {
    const next = new Map(moves);
    if (move) next.set(id, move);
    else next.delete(id);
    setMoves(next);
  };

  const key = useMemo(
    () => `${[...give].join(",")}|${[...get].join(",")}|${roomMoves.map((m) => `${m.playerId}:${m.move}`).join(",")}`,
    [give, get, roomMoves],
  );
  useEffect(() => {
    if (give.size === 0 && get.size === 0) {
      setCheck(null);
      return;
    }
    let live = true;
    call("trade", { partnerId: partner, give: [...give], get: [...get], moves: roomMoves, execute: false }).then((c) => live && setCheck(c));
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

  const [asking, setAsking] = useState(false);
  const askThem = async () => {
    setAsking(true);
    try {
      const a = await call("askingPrice", { partnerId: partner, get: [...get] });
      if (!a.ok) notify(a.reason ?? "They wouldn't say.", true);
      else {
        setGive(new Set(a.give ?? []));
        setMoves(new Map());
        if (a.text) notify(a.text);
      }
    } finally {
      setAsking(false);
    }
  };

  const propose = async () => {
    const res = await call("trade", { partnerId: partner, give: [...give], get: [...get], moves: roomMoves, execute: true });
    if (res.done) {
      notify(["Trade complete.", ...(res.moves ?? [])].join(" "));
      if (res.warning) notify(res.warning, true);
      setGive(new Set());
      setGet(new Set());
      setMoves(new Map());
      setCheck(null);
      bump();
    } else notify(res.reason ?? "They said no.", true);
  };

  if (user === null) return <div class="empty">Trades are for the club you run.</div>;
  const filterSeg = (i: 0 | 1, side: TradeSide) => (
    <Seg<Filter>
      label="Show"
      value={filters[i]}
      options={[
        ["all", "All"],
        ["forty", `40-man (${side.players.filter((p) => p.status.fortyMan).length})`],
        ["mlb", "Big leaguers"],
        ["farm", "Farm"],
      ]}
      onChange={(f) => setFilters(i === 0 ? [f, filters[1]] : [filters[0], f])}
    />
  );

  const head = (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">Trade desk</div>
          <h1>{block ? "On the block" : "Make a deal"}</h1>
          <div class="sub">Clubs value players by surplus: projected wins over the years they control him, minus what they'll pay him.</div>
        </div>
        <select class="sel" aria-label="Trade partner" value={block ? "" : partner} onChange={(e) => go({ page: "trades", partnerId: Number((e.target as HTMLSelectElement).value) })}>
          {block && (
            <option value="" disabled>
              Pick a club
            </option>
          )}
          {partners.map((t) => (
            <option key={t.id} value={t.id}>
              {t.city} {t.nickname}
            </option>
          ))}
        </select>
      </div>
      <div class="desk-switch">
        <Seg<"desk" | "block">
          label="Trade desk"
          value={block ? "block" : "desk"}
          options={[
            ["desk", "Make a deal"],
            ["block", "On the block"],
          ]}
          onChange={(v) => go(v === "block" ? { page: "trades", partnerId: null, block: "all" } : { page: "trades", partnerId: shown.current ?? partner })}
        />
      </div>
      {!status.canTrade && <div class="note warn">{status.tradeNote}</div>}
      {status.canTrade && status.deadline && (
        <div class="note">
          {status.deadline.daysLeft === 0
            ? "It's deadline day: trades close after today's games."
            : `The trade deadline is ${status.deadline.date}, ${status.deadline.daysLeft} day${status.deadline.daysLeft === 1 ? "" : "s"} away.`}
        </div>
      )}
    </>
  );
  if (block) {
    return (
      <>
        {head}
        <OnTheBlock slug={block} canTrade={Boolean(status.canTrade)} />
      </>
    );
  }

  return (
    <>
      {head}
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
          <span class="k">Their answer</span>
          {check === null ? (
            <span class="dim">Pick players from both sides.</span>
          ) : check.ok ? (
            <span class="yes">The {theirName} would say yes.</span>
          ) : check.over ? (
            <span class="no">
              The {theirName} would say yes once you make room: designate {plural(check.over, "more player", "more players")} below.
            </span>
          ) : (
            <span class="no">{check.reason}</span>
          )}
        </div>
        <span class="trade-bar-actions">
          {get.size > 0 && (
            <button type="button" class="btn" disabled={!status.canTrade || asking} onClick={askThem} title="Fill your side with what they'd ask for">
              {asking ? "Asking…" : "What would they want?"}
            </button>
          )}
          <button type="button" class="btn primary" disabled={!check?.ok || !status.canTrade} onClick={propose}>
            Propose trade
          </button>
        </span>
      </div>
      {check?.advice && <StaffTake advice={check.advice} />}

      {sides.data && check && ((check.fortyMan ?? 0) > FORTY_MAN || (check.active ?? 0) > (check.activeLimit ?? Infinity) || roomMoves.length > 0) && (
        <MakeRoom side={sides.data.mine} give={give} moves={moves} setMove={setMove} check={check} />
      )}

      {sides.error && <ErrorNote error={sides.error} />}
      {!sides.data && !sides.error && <Loading />}
      {sides.data && (
        <div class="grid-2">
          <Section title={`Your ${sides.data.mine.team.nickname}`} aside={filterSeg(0, sides.data.mine)}>
            <Picked side={sides.data.mine} picked={give} toggle={toggle(give, setGive)} />
            <SideTable side={sides.data.mine} picked={give} toggle={toggle(give, setGive)} filter={filters[0]} />
          </Section>
          <Section title={`${sides.data.theirs.team.city} ${sides.data.theirs.team.nickname}`} aside={filterSeg(1, sides.data.theirs)}>
            <Picked side={sides.data.theirs} picked={get} toggle={toggle(get, setGet)} />
            <SideTable side={sides.data.theirs} picked={get} toggle={toggle(get, setGet)} filter={filters[1]} />
          </Section>
        </div>
      )}
    </>
  );
}
