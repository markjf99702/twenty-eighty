import { useEffect, useState } from "preact/hooks";
import { bump, call, useApi } from "../../api/client";
import type { FinanceView, LedgerView, Status } from "../../api/protocol";
import { ErrorNote, Loading, notify, Section } from "../components/Common";
import { href } from "../router";

const $m = (x: number) => `${x < 0 ? "-" : ""}$${Math.abs(x).toFixed(1)}M`;
const thousands = (n: number) => n.toLocaleString("en-US");

function interestWord(x: number): string {
  if (x >= 1.25) return "Baseball fever";
  if (x >= 1.1) return "Buzzing";
  if (x >= 0.95) return "Steady";
  if (x >= 0.8) return "Cooling";
  return "Apathy";
}

/** Season-long gate and concessions against ticket price, with today's price and the business office's marked. */
function PriceChart({ t, draft }: { t: FinanceView["ticket"]; draft: number }) {
  const W = 600;
  const H = 170;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const xs = t.curve.map((c) => c.price);
  // The curve is flat near its peak, so the axis spans just its range (labeled, so nothing's hidden).
  const money = t.curve.map((c) => c.money);
  const step = 10;
  const bottom = Math.floor(Math.min(...money) / step) * step;
  const top = Math.max(bottom + 2 * step, Math.ceil(Math.max(...money) / step) * step);
  const x = (p: number) => pad.l + ((p - xs[0]!) / (xs.at(-1)! - xs[0]!)) * (W - pad.l - pad.r);
  const y = (m: number) => pad.t + (1 - (m - bottom) / (top - bottom)) * (H - pad.t - pad.b);
  const path = t.curve.map((c, i) => `${i ? "L" : "M"}${x(c.price).toFixed(1)},${y(c.money).toFixed(1)}`).join(" ");
  const xTicks = xs.filter((p) => p % 10 === 0);
  const yTicks = [bottom, Math.round((bottom + top) / 2), top];
  return (
    <svg class="price-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gate and concessions by ticket price">
      <rect x={x(t.gouge)} y={pad.t} width={x(xs.at(-1)!) - x(t.gouge)} height={H - pad.t - pad.b} class="gouge" />
      {yTicks.map((m) => (
        <g key={m}>
          <line x1={pad.l} x2={W - pad.r} y1={y(m)} y2={y(m)} class="grid" />
          <text x={pad.l - 6} y={y(m) + 4} text-anchor="end">
            ${m}M
          </text>
        </g>
      ))}
      {xTicks.map((p) => (
        <text key={p} x={x(p)} y={H - 8} text-anchor="middle">
          ${p}
        </text>
      ))}
      <path d={path} class="curve" />
      <line x1={x(t.best)} x2={x(t.best)} y1={pad.t} y2={H - pad.b} class="best" />
      <line x1={x(draft)} x2={x(draft)} y1={pad.t} y2={H - pad.b} class="now" />
    </svg>
  );
}

function Tickets({ v }: { v: FinanceView }) {
  const t = v.ticket;
  const [draft, setDraft] = useState(t.price);
  useEffect(() => setDraft(t.price), [t.price]);
  const at = t.curve.find((c) => c.price === draft) ?? t.curve[0]!;
  const bestAt = t.curve.find((c) => c.price === t.best);
  const save = async (price: number | "auto") => {
    const res = await call("setTicketPrice", { price });
    if (!res.ok) notify(res.reason ?? "Can't set that price.", true);
    else notify(price === "auto" ? "The business office will set prices." : `Tickets now average $${price}.`);
    bump();
  };
  return (
    <Section title="Tickets" aside={t.auto ? "Set by the business office" : "Set by you"}>
      <div class="price-row">
        <label class="price-input">
          <span class="k">Average ticket</span>
          <input
            type="range"
            min={t.curve[0]!.price}
            max={t.curve.at(-1)!.price}
            step={1}
            value={draft}
            disabled={!t.editable}
            onInput={(e) => setDraft(Number((e.target as HTMLInputElement).value))}
            aria-label="Average ticket price in dollars"
          />
          <span class="v">${draft}</span>
        </label>
        {t.editable && (
          <div class="price-actions">
            <button type="button" class="btn primary" disabled={draft === t.price && !t.auto} onClick={() => save(draft)}>
              Set ${draft}
            </button>
            <button type="button" class="btn" disabled={t.auto} onClick={() => save("auto")}>
              Let the business office decide
            </button>
          </div>
        )}
      </div>
      <div class="read-row">
        <div>
          <span class="k">Fans a game</span>
          <b>{thousands(at.perGame)}</b>
        </div>
        <div>
          <span class="k">Gate and concessions, full season</span>
          <b>{$m(at.money)}</b>
        </div>
        <div>
          <span class="k">Going rate here</span>
          <b>${t.reference}</b>
        </div>
        {bestAt && (
          <div>
            <span class="k">Business office's price</span>
            <b>
              ${t.best} ({$m(bestAt.money)})
            </b>
          </div>
        )}
      </div>
      <PriceChart t={t} draft={draft} />
      <div class="small dim">
        <span class="swatch now" /> Your price <span class="swatch best" /> The business office's price <span class="swatch gouge" /> Above ${t.gouge}, fans
        notice: fan interest slips next year. Cheaper seats fill the park, and full houses build interest. Projections assume the
        club's current form; the price applies to every home game from now on.
      </div>
    </Section>
  );
}

function Ledger({ l, title, aside }: { l: LedgerView; title: string; aside?: string }) {
  const rows = (items: [string, number][]) =>
    items
      .filter(([, x]) => x !== 0)
      .map(([k, x]) => (
        <tr key={k}>
          <td>{k}</td>
          <td class="num">{$m(x)}</td>
        </tr>
      ));
  return (
    <Section title={title} aside={aside}>
      <div class="grid-2 ledger">
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Revenue</th>
                <th class="num">$M</th>
              </tr>
            </thead>
            <tbody>
              {rows([
                ["Gate", l.revenue.gate],
                ["Concessions and parking", l.revenue.concessions],
                ["Local media", l.revenue.media],
                ["Sponsorship", l.revenue.sponsorship],
                ["National contracts", l.revenue.national],
                ["Postseason gate", l.revenue.postseason],
              ])}
              <tr class="total">
                <td>Total</td>
                <td class="num">{$m(l.revenue.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Expenses</th>
                <th class="num">$M</th>
              </tr>
            </thead>
            <tbody>
              {rows([
                ["Player payroll", l.expenses.payroll],
                ["Dead money", l.expenses.deadMoney],
                ["Scouting and analytics", l.expenses.staff],
                ["Operations", l.expenses.operations],
                ["Signing bonuses", l.expenses.bonuses],
              ])}
              <tr class="total">
                <td>Total</td>
                <td class="num">{$m(l.expenses.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="profit-line">
        {l.profit >= 0 ? "Profit" : "Loss"} <b class={l.profit >= 0 ? "good" : "bad"}>{$m(l.profit)}</b>
        {l.homeGames > 0 && (
          <span class="dim">
            {" "}
            · {thousands(l.attendance)} fans in {l.homeGames} home games ({thousands(l.perGame)} a game)
          </span>
        )}
      </div>
    </Section>
  );
}

export function Finances({ teamId, status }: { teamId: number | null; status: Status }) {
  const view = useApi("finances", teamId === null ? {} : { teamId }, [teamId]);
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  const winter = status.phase === "offseason";
  const spend = v.payroll + v.staff;
  const current = winter
    ? `${v.current.year} books so far`
    : v.played >= 1
      ? `${v.current.year} books`
      : `${v.current.year} so far`;
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">{v.mine ? "Front office" : `${v.team.city} ${v.team.nickname}`}</div>
          <h1>{v.mine ? "Finances" : `${v.team.nickname} finances`}</h1>
          <div class="sub">
            Owned by {v.owner.name} ({v.owner.styleLabel.toLowerCase()}). {v.market.toFixed(1)} million in the metro, {thousands(v.capacity)}{" "}
            seats.
          </div>
        </div>
        <div class="counts">
          <span class={spend > v.budget ? "over" : ""}>
            Payroll and staff <b>{$m(spend)}</b> of {$m(v.budget)}
          </span>
          <span>
            Cash <b>{$m(v.cash)}</b>
          </span>
        </div>
      </div>

      {!v.mine && (
        <div class="note">
          Estimates, as the business press reports them. <a href={href({ page: "finances", teamId: null })}>Back to your club's books</a>.
        </div>
      )}

      <div class="grid-2">
        <Ledger
          l={v.current}
          title={current}
          aside={winter ? "Winter signing bonuses count toward next season" : v.played < 1 ? `${Math.round(v.played * 100)}% of the season played` : undefined}
        />
        <Section title="The fan base" aside={interestWord(v.interest)}>
          <div class="read-row">
            <div>
              <span class="k">Fan interest</span>
              <b>{v.interest.toFixed(2)}</b>
            </div>
            <div>
              <span class="k">Full-season revenue at this price</span>
              <b>{$m(v.projectedRevenue)}</b>
            </div>
            <div>
              <span class="k">Operations</span>
              <b>{$m(v.operations)}</b>
            </div>
          </div>
          <p class="dim small" style={{ margin: 0 }}>
            Interest (1.00 is typical) moves every winter with the club's season: winning, the postseason and full ballparks build it;
            losing and gouging on tickets wear it down. It drives the gate and local media deals, and so next year's budget: each
            winter the owner budgets a share of what the club expects to take in after operations. Cash above a $100M reserve goes to
            the owner.
          </p>
        </Section>
      </div>

      {v.mine && <Tickets v={v} />}

      <Section title="Year by year">
        {v.history.length === 0 ? (
          <div class="empty">The first season's books close after the World Series.</div>
        ) : (
          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Year</th>
                  <th class="num">W-L</th>
                  <th class="num">Fans/G</th>
                  <th class="num">Revenue</th>
                  <th class="num">Payroll</th>
                  <th class="num">Profit</th>
                  <th class="num">To owner</th>
                  <th class="num">Cash</th>
                  <th class="num">Budget</th>
                  <th class="num">Interest</th>
                </tr>
              </thead>
              <tbody>
                {v.history.map((h) => (
                  <tr key={h.year}>
                    <td>{h.year}</td>
                    <td class="num">
                      {h.wins}-{h.losses}
                    </td>
                    <td class="num">{thousands(h.perGame)}</td>
                    <td class="num">{$m(h.revenue.total)}</td>
                    <td class="num">{$m(h.expenses.payroll + h.expenses.deadMoney)}</td>
                    <td class={`num ${h.profit >= 0 ? "" : "bad"}`}>{$m(h.profit)}</td>
                    <td class="num">{$m(h.distribution)}</td>
                    <td class="num">{$m(h.cash)}</td>
                    <td class="num">${h.budget}M</td>
                    <td class="num">{h.interest.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Around the league" aside={winter ? "Last season" : "This season so far"}>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Club</th>
                <th class="num">Metro</th>
                <th class="num">Fans/G</th>
                <th class="num">Revenue</th>
                <th class="num">Payroll</th>
                <th class="num">Budget</th>
                <th class="num">Interest</th>
              </tr>
            </thead>
            <tbody>
              {v.league.map((r) => (
                <tr key={r.team.id} class={r.mine ? "mine" : ""}>
                  <td class="name">
                    <a href={href({ page: "finances", teamId: r.mine ? null : r.team.id })}>
                      {r.team.city} {r.team.nickname}
                    </a>
                  </td>
                  <td class="num">{r.market.toFixed(1)}M</td>
                  <td class="num">{r.perGame ? thousands(r.perGame) : "—"}</td>
                  <td class="num">{$m(r.revenue)}</td>
                  <td class="num">{$m(r.payroll)}</td>
                  <td class="num">${r.budget}M</td>
                  <td class="num">{r.interest.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
