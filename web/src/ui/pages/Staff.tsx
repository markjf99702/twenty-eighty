import { useEffect } from "preact/hooks";
import { call, useApi } from "../../api/client";
import type { AdviceView, Status } from "../../api/protocol";
import { ErrorNote, Loading, Section } from "../components/Common";
import { href } from "../router";
import { useSettings } from "../settings";

const DESK: Record<AdviceView["from"], string> = {
  assistant: "Roster",
  scouting: "Scouting",
  analytics: "Analytics",
  business: "Business",
};

export function AdviceItem({ a, compact }: { a: AdviceView; compact?: boolean }) {
  return (
    <div class={`advice${a.urgent ? " urgent" : ""}${a.read ? "" : " unread"}`}>
      <div class="advice-head">
        <span class="desk">{DESK[a.from]}</span>
        {a.urgent && <span class="badge hurt">Urgent</span>}
        <span class="dim small">{a.when}</span>
      </div>
      <div class="advice-title">{a.title}</div>
      {!compact && <p class="advice-text">{a.text}</p>}
      <div class="advice-foot">
        <span class="dim small">{a.who}</span>
        {a.href && (
          <a class="btn small" href={a.href}>
            Take a look
          </a>
        )}
      </div>
    </div>
  );
}

/** Notes from the user's staff, newest first. Viewing the page marks them read. */
export function Staff({ onStatus }: { onStatus?: (s: Status) => void }) {
  const view = useApi("advice", undefined);
  const settings = useSettings();
  useEffect(() => {
    if (!view.data?.some((a) => !a.read)) return;
    // Marked read once they've been shown; the highlight stays until the next visit.
    void call("readAdvice", undefined).then((st) => onStatus?.(st));
  }, [view.data]);
  if (view.error) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const notes = view.data;
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">Front office</div>
          <h1>Your staff</h1>
          <div class="sub">
            Notes from the people who work for you. They judge players the way your departments do, so a sharper scouting and analytics staff
            gives sharper advice.
          </div>
        </div>
      </div>
      {!settings.advice && (
        <div class="note warn">
          Staff advice is off, so no new notes will come in. Turn it back on in the <a href={href({ page: "office" })}>League office</a>.
        </div>
      )}
      <Section title="Notes" aside={`${notes.length} kept`}>
        {notes.length === 0 ? (
          <div class="empty">Quiet so far. Your staff speaks up when there's something worth doing: a call-up, a deadline deal, the gate.</div>
        ) : (
          <div class="advice-list">
            {notes.map((a) => (
              <AdviceItem key={a.key} a={a} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
