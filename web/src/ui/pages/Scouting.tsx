import { useApi, bump, call } from "../../api/client";
import type { Status } from "../../api/protocol";
import { ErrorNote, Loading, notify, Section } from "../components/Common";
import { playerHref } from "../router";

const $ = (x: number) => (x >= 10 ? `$${x.toFixed(1)}M` : `$${x.toFixed(2)}M`);

export function Scouting({ status }: { status: Status }) {
  const view = useApi("scouting", undefined);
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  const set = async (scouting: number, analytics: number) => {
    const res = await call("setDepartments", { scouting, analytics });
    if (!res.ok) notify(res.reason ?? "Can't change that now.", true);
    bump();
  };
  const room = v.budget.budget - v.budget.payroll - v.budget.staff;

  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">Front office</div>
          <h1>Scouting and analytics</h1>
          <div class="sub">
            Every grade you see is your scouts' report, not the truth. The other 29 clubs see players through their own scouts, too.
          </div>
        </div>
        <div class="counts">
          <span>
            Staff <b>{$(v.budget.staff)}</b>
          </span>
          <span>
            Payroll <b>{$(v.budget.payroll)}</b>
          </span>
          <span class={room < 0 ? "over" : ""}>
            Room <b>{$(room)}</b> of {$(v.budget.budget)}
          </span>
        </div>
      </div>
      {!v.editable && <div class="note">Department budgets are set each winter (or before Opening Day). You can change them in the offseason.</div>}

      <div class="grid-2">
        <Section title="Scouting department" aside={`${v.scouting.label}, ${$(v.scouting.cost)} a year`}>
          <div class="tier-pick" role="radiogroup" aria-label="Scouting department level">
            {v.tiers.scouting.map((t) => (
              <button
                type="button"
                role="radio"
                aria-checked={t.tier === v.scouting.tier}
                key={t.tier}
                class={t.tier === v.scouting.tier ? "on" : ""}
                disabled={!v.editable}
                onClick={() => set(t.tier, v.analytics.tier)}
              >
                <span class="t">{t.label}</span>
                <span class="c">{$(t.cost)}</span>
                <span class="s">±{t.sigma.toFixed(1)}</span>
              </button>
            ))}
          </div>
          <div class="small dim">
            The ± is the typical miss on a tool your scouts are grading cold. Speed and arm strength are easy to clock; the hit tool
            and command are the hardest reads. Familiarity cuts the miss a lot:
          </div>
          <div class="tbl-wrap">
            <table class="tbl">
              <tbody>
                {v.accuracy.map((a) => (
                  <tr key={a.label}>
                    <td>{a.label}</td>
                    <td class="num">±{a.sigma.toFixed(1)}</td>
                    <td class="wrap">
                      <span class="miss-bar" style={{ width: `${Math.min(100, a.sigma * 9)}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Analytics department" aside={`${v.analytics.label}, ${$(v.analytics.cost)} a year`}>
          <div class="tier-pick" role="radiogroup" aria-label="Analytics department level">
            {v.tiers.analytics.map((t) => (
              <button
                type="button"
                role="radio"
                aria-checked={t.tier === v.analytics.tier}
                key={t.tier}
                class={t.tier === v.analytics.tier ? "on" : ""}
                disabled={!v.editable}
                onClick={() => set(v.scouting.tier, t.tier)}
              >
                <span class="t">{t.label}</span>
                <span class="c">{$(t.cost)}</span>
                <span class="s">{Math.round(t.trust * 100)}%</span>
              </button>
            ))}
          </div>
          <p class="dim small" style={{ margin: 0 }}>
            Analytics reads players from what they've actually done, translated to the major-league scale. Yours works from{" "}
            <b>{v.analytics.basis}</b>. Better departments use metrics that settle faster and say more about skill (xwOBA over wOBA,
            SIERA over ERA), and you trust them more: the percentage is how far your read leans on analytics once a player has a big
            sample. The overall grades you see (Now) blend the two; the scouts alone project the future.
          </p>
          <p class="dim small" style={{ margin: 0 }}>
            On roster tables, a small <span class="ana-up">▲</span> or <span class="ana-down">▼</span> next to a player's Now grade means
            his numbers have pulled your read noticeably above or below what your scouts see.
          </p>
        </Section>
      </div>

      <Section title="Scouting looks" aside={`${v.looksLeft} of ${v.looksPerWindow} left ${status.phase === "offseason" ? "this phase" : "this week"}`}>
        <p class="dim" style={{ margin: 0, maxWidth: "70ch" }}>
          Send a scout to see a player from his page (or from the draft board and the international list). Each look narrows your
          report: one look cuts the miss by about a fifth, three by about 40%, five by about half, and two looks turn up his medical
          history. Looks refill every week in season and at each phase of the winter; better departments get more.
        </p>
        {v.scouted.length === 0 ? (
          <div class="empty">You haven't sent anyone yet.</div>
        ) : (
          <div class="traits">
            {v.scouted.map((x) =>
              x.playerId >= 0 ? (
                <a key={x.playerId} class="trait" href={playerHref(x.playerId)}>
                  {x.pos} {x.name} ({x.team}) · {x.looks} look{x.looks === 1 ? "" : "s"}
                </a>
              ) : (
                <span key={x.playerId} class="trait">
                  {x.pos} {x.name} ({x.team}) · {x.looks} look{x.looks === 1 ? "" : "s"}
                </span>
              ),
            )}
          </div>
        )}
      </Section>
    </>
  );
}
