import { bump, call, useApi } from "../../api/client";
import type { GoalView, OwnerView, Status } from "../../api/protocol";
import { ErrorNote, Loading, notify, Section } from "../components/Common";
import { signed } from "../format";
import { href } from "../router";

const WEIGHT: [number, string][] = [
  [1.3, "Top priority"],
  [0.9, "Matters"],
  [0, "Nice to have"],
];
const weightWord = (w: number) => WEIGHT.find(([min]) => w >= min)![1];

/** Where the owner's confidence stands, with the firing line marked. */
export function ConfidenceMeter({ value, mood }: { value: number; mood: string }) {
  const tone = value < 30 ? "bad" : value < 45 ? "warn" : "ok";
  return (
    <div class="meter-wrap">
      <div class="meter-head">
        <span class="meter-v">{value}</span>
        <span class={`meter-mood ${tone}`}>{mood}</span>
      </div>
      <div class="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label="Owner's confidence">
        <span class={`fill ${tone}`} style={{ width: `${value}%` }} />
        <i style={{ left: "20%" }} title="Below 20, the owner starts looking for a new GM" />
      </div>
      <div class="meter-scale">
        <span>0</span>
        <span style={{ left: "20%" }}>Firing line</span>
        <span>100</span>
      </div>
    </div>
  );
}

export function GoalList({ goals }: { goals: GoalView[] }) {
  if (goals.length === 0) return <div class="empty">No goals set yet. The owner sets them in the spring.</div>;
  return (
    <div class="goals">
      {goals.map((g, i) => (
        <div class="goal" key={i}>
          <div>
            <div class="goal-label">{g.label}</div>
            <div class="small dim">
              {weightWord(g.weight)} · {g.progress}
            </div>
          </div>
          <span class={`goal-status ${g.status.replace(" ", "-")}`}>{g.status}</span>
        </div>
      ))}
    </div>
  );
}

export function JobOffers({ view, onStatus }: { view: OwnerView; onStatus?: (s: Status) => void }) {
  const take = async (teamId: number, name: string) => {
    try {
      const st = await call("acceptJob", { teamId });
      notify(`You're the new GM of the ${name}.`);
      onStatus?.(st);
      bump();
      location.hash = href({ page: "owner" });
    } catch (err) {
      notify((err as Error).message, true);
    }
  };
  return (
    <Section title="You've been let go" aside="Three clubs called">
      <p class="dim" style={{ margin: 0, maxWidth: "70ch" }}>
        The {view.team.nickname} have gone in a different direction. Clubs with openings want to talk. Pick one to keep going; the
        winter picks up where it left off with your new club.
      </p>
      <div class="offers">
        {view.offers.map((o) => (
          <div class="offer" key={o.team.id}>
            <div class="offer-name">
              {o.team.city} {o.team.nickname}
            </div>
            <div class="small dim">
              {o.record} last season · {o.market.toFixed(1)}M metro · ${o.budget}M budget · farm {o.farm.toFixed(1)}
            </div>
            <div class="small">
              {o.owner.name}, <b>{o.owner.styleLabel.toLowerCase()}</b>: {o.owner.pitch}
            </div>
            <button type="button" class="btn primary" onClick={() => take(o.team.id, `${o.team.city} ${o.team.nickname}`)}>
              Take the job
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function Owner({ onStatus }: { onStatus: (s: Status) => void }) {
  const view = useApi("owner", undefined);
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">
            {v.team.city} {v.team.nickname} · ownership
          </div>
          <h1>{v.owner.name}</h1>
          <div class="sub">
            <b>{v.owner.styleLabel}</b>. {v.owner.pitch} {v.patience} with a GM who struggles.
          </div>
        </div>
        <div class="counts">
          <span>
            GM since <b>{v.hired}</b>
          </span>
          <span>
            Seasons <b>{v.seasons}</b>
          </span>
        </div>
      </div>

      {v.fired && <JobOffers view={v} onStatus={onStatus} />}

      <div class="grid-2">
        <Section title="Confidence in you" aside={v.expectedWins !== null ? `Projected ${v.expectedWins} wins in ${v.goalYear}` : undefined}>
          <ConfidenceMeter value={v.confidence} mood={v.mood} />
          <p class="dim small" style={{ margin: 0 }}>
            Each winter the owner reviews your season: the goals below, your wins against the preseason projection, the postseason,
            and whether you kept to the budget. Fall below 20 and you're out (a first-year GM gets some rope).
          </p>
        </Section>
        <Section title={`${v.goalYear} goals`}>
          <GoalList goals={v.goals} />
        </Section>
      </div>

      <div class="grid-2">
        <Section title="From the owner's office">
          {v.messages.length === 0 ? (
            <div class="empty">No word yet.</div>
          ) : (
            <div class="letters">
              {v.messages.map((m, i) => (
                <div class={`letter tone-${m.tone}`} key={i}>
                  <div class="small dim">{m.date}</div>
                  <div>{m.text}</div>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="Season reviews">
          {v.reviews.length === 0 ? (
            <div class="empty">Your first review comes after the World Series.</div>
          ) : (
            v.reviews.map((r) => (
              <div class="review" key={r.year}>
                <div class="review-head">
                  <b>{r.year}</b>
                  <span>
                    {r.before} → <b>{r.after}</b> ({signed(r.after - r.before)})
                  </span>
                </div>
                <div class="tbl-wrap">
                  <table class="tbl">
                    <tbody>
                      {r.goals.map((g, i) => (
                        <tr key={`g${i}`}>
                          <td class="wrap">
                            <span class={`goal-status ${g.met ? "met" : "missed"}`}>{g.met ? "met" : "missed"}</span> {g.label}
                          </td>
                          <td>{g.actual}</td>
                          <td class={`num ${g.delta >= 0 ? "good" : "bad"}`}>{signed(g.delta, 1)}</td>
                        </tr>
                      ))}
                      {r.notes.map((n, i) => (
                        <tr key={`n${i}`}>
                          <td class="wrap" colSpan={2}>
                            {n.text}
                          </td>
                          <td class={`num ${n.delta >= 0 ? "good" : "bad"}`}>{signed(n.delta, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </Section>
      </div>
    </>
  );
}
