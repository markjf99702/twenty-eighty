import type { TradeAdviceView } from "../../api/protocol";

const VERDICT: Record<TradeAdviceView["verdict"], string> = { take: "Take it", consider: "Worth a look", pass: "Pass" };
const SURE: Record<TradeAdviceView["confidence"], string> = {
  high: "They know these players well",
  medium: "They're fairly sure about these players",
  low: "They're guessing about some of these players",
};

/** What the user's staff makes of a trade: a verdict, why, and how sure they are. */
export function StaffTake({ advice }: { advice: TradeAdviceView }) {
  return (
    <div class={`staff-take ${advice.verdict}`}>
      <div class="take-head">
        <span class="k">Your staff</span>
        <span class={`verdict ${advice.verdict}`}>{VERDICT[advice.verdict]}</span>
        <span class={`sure ${advice.confidence}`} title="How well your scouts know the players coming in: better departments and more looks make them surer">
          {SURE[advice.confidence]}
        </span>
      </div>
      <p class="take-line">{advice.headline}</p>
      {advice.notes.length > 0 && (
        <ul class="take-notes">
          {advice.notes.map((n, i) => (
            <li key={i}>
              <span class="who">{n.who}:</span> {n.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
