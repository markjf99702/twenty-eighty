import { useState } from "preact/hooks";
import type { Status } from "../../api/protocol";

/**
 * The winter's next step (the scoreboard's and the winter page's). Finishing the draft lets the scouting director
 * make every pick you haven't, which can't be taken back, so while you still have picks it asks first, the way a
 * designation does.
 */
export function WinterNext({ status, onAdvance, disabled }: { status: Status; onAdvance: () => void; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  const w = status.winter;
  if (!w) return null;
  const picks = w.phase === "draft" ? (w.picksLeft ?? 0) : 0;
  if (asking && picks > 0) {
    return (
      <div class="confirm winter-confirm">
        <span>Let your scouting director make {picks === 1 ? "your last pick" : `your ${picks} remaining picks`}?</span>
        <button
          type="button"
          class="btn primary"
          onClick={() => {
            setAsking(false);
            onAdvance();
          }}
        >
          {w.action}
        </button>
        <button type="button" class="btn" onClick={() => setAsking(false)}>
          Not yet
        </button>
      </div>
    );
  }
  return (
    <button type="button" class="btn primary" disabled={disabled} onClick={() => (picks > 0 ? setAsking(true) : onAdvance())}>
      {w.action}
    </button>
  );
}
