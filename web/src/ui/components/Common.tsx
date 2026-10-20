import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

export function Section({ title, aside, children }: { title: string; aside?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="section">
      <header>
        <h2>{title}</h2>
        {aside && <span class="aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" class={v === value ? "on" : ""} aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Loading({ what }: { what?: string }) {
  return <div class="loading">Loading{what ? ` ${what}` : ""}…</div>;
}

export function ErrorNote({ error }: { error: string }) {
  return <div class="note alert">{error}</div>;
}

// ---------------------------------------------------------------------------
// Toasts

type Toast = { id: number; text: string; bad: boolean };
let toastId = 0;
const toastListeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];

function emit() {
  for (const l of toastListeners) l(toasts);
}

function dismiss(id: number): void {
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}

export function notify(text: string, bad = false): void {
  const t = { id: ++toastId, text, bad };
  toasts = [...toasts, t].slice(-4);
  emit();
  // Long enough to read: a sentence about a roster move stays up longer than "Saved".
  setTimeout(() => dismiss(t.id), Math.max(bad ? 6000 : 3500, 60 * text.length));
}

/**
 * The toasts, in a corner; a tap puts one away. `overBar`: the page keeps a bar at the foot of the screen (the title
 * screen's start bar), so they stay above it.
 */
export function Toasts({ overBar = false }: { overBar?: boolean }) {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    toastListeners.add(setList);
    return () => void toastListeners.delete(setList);
  }, []);
  return (
    <div class={`toasts${overBar ? " over-bar" : ""}`} role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class={`toast${t.bad ? " bad" : ""}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
