import { useState } from "preact/hooks";
import { bump, call, useApi } from "../../api/client";
import type { ExtensionOptionView } from "../../api/protocol";
import { notify, Section, Seg } from "./Common";

export const dollars = (x: number) => (Math.abs(x) >= 10 ? `$${Math.abs(x).toFixed(1)}M` : `$${Math.abs(x).toFixed(2)}M`);
export const gainText = (x: number) => `${x >= 0 ? "+" : "−"}${dollars(x)}`;

/** "Covers 1 pre-arbitration, 3 arbitration and 2 free-agent seasons." */
export function coversText(c: ExtensionOptionView["covers"]): string {
  const parts = [
    c.preArb ? `${c.preArb} pre-arbitration` : "",
    c.arb ? `${c.arb} arbitration` : "",
    c.free ? `${c.free} free-agent` : "",
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  const n = c.preArb + c.arb + c.free;
  return `Covers ${list} season${n === 1 ? "" : "s"}.`;
}

/** Talking extension with one of the user's players: pick a length, see the price and what it's worth by your read. */
export function ExtensionPanel({ playerId, name }: { playerId: number; name: string }) {
  const view = useApi("extension", { playerId }, [playerId]);
  const [years, setYears] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const v = view.data;
  if (!v) return null;
  const best = v.options.reduce<ExtensionOptionView | null>((b, o) => (!b || o.gain > b.gain ? o : b), null);
  const pick = v.options.find((o) => o.years === years) ?? best;

  const sign = async () => {
    if (!pick) return;
    const res = await call("signExtension", { playerId, years: pick.years });
    setConfirming(false);
    if (!res.ok) notify(res.reason ?? "He said no.", true);
    else {
      notify(`${name} signed: ${pick.years} years, ${dollars(pick.total)}, through ${pick.through}.`);
      setYears(null);
      bump();
    }
  };

  return (
    <Section title="Extension">
      {v.clock && <div class="small dim">{v.clock}</div>}
      {v.reason || !pick ? (
        <p class="ext-reason">{v.reason}</p>
      ) : (
        <div class="ext">
          <Seg<string>
            label="Length"
            value={String(pick.years)}
            options={v.options.map((o) => [String(o.years), `${o.years} yrs`])}
            onChange={(y) => {
              setYears(Number(y));
              setConfirming(false);
            }}
          />
          <div class="facts">
            <div>
              <span class="k">A year</span>
              <span class="v">{dollars(pick.salary)}</span>
            </div>
            <div>
              <span class="k">Total</span>
              <span class="v">{dollars(pick.total)}</span>
            </div>
            <div>
              <span class="k">Through</span>
              <span class="v">{pick.through}</span>
            </div>
            <div>
              <span class="k" title="Surplus value the deal adds over keeping him as he is, as your scouts and analysts see him">
                By your read
              </span>
              <span class={`v ${pick.gain >= 0 ? "up" : "neg"}`}>{gainText(pick.gain)}</span>
            </div>
          </div>
          <p class="small">
            {coversText(pick.covers)}
            {v.inSeason ? ` It starts now: his salary becomes ${dollars(pick.salary)} for the rest of this season.` : ""} If he gets better, he's a bargain; if he
            gets hurt or fades, you're still paying him.
          </p>
          {confirming ? (
            <div class="offer-actions">
              <span>
                Sign {name} for {pick.years} years, {dollars(pick.total)}?
              </span>
              <button type="button" class="btn primary" onClick={sign}>
                Sign him
              </button>
              <button type="button" class="btn" onClick={() => setConfirming(false)}>
                Not yet
              </button>
            </div>
          ) : (
            <div class="offer-actions">
              <button type="button" class="btn primary" onClick={() => setConfirming(true)}>
                Offer {pick.years} years
              </button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
