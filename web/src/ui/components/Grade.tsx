import { band, gradeWord, scout } from "../format";

/** A grade chip, shown the way scouts write it (nearest 5). */
export function Grade({ g, large, title }: { g: number; large?: boolean; title?: string }) {
  return (
    <span class={`gc ${band(g)}${large ? " lg" : ""}`} title={title ?? `${scout(g)}: ${gradeWord(g)}`}>
      {scout(g)}
    </span>
  );
}

/** "45/60" present/future chip, colored by the future grade. */
export function PresentFuture({ present, future }: { present: number; future: number }) {
  return (
    <span class={`gc pf ${band(present)}`} title={`Present ${scout(present)} (${gradeWord(present)}), future ${scout(future)} (${gradeWord(future)})`}>
      {scout(present)}/{scout(future)}
    </span>
  );
}

const x = (g: number) => ((Math.min(80, Math.max(20, g)) - 20) / 60) * 100;
const TICKS = [30, 40, 50, 60, 70];

/**
 * The 20-80 bar: filled to the present grade, dashed out to the future grade,
 * with a tick every 10 points (one standard deviation) and 50 marked.
 */
export function GradeBar({ present, future, label }: { present: number; future: number; label: string }) {
  const grows = scout(future) > scout(present);
  return (
    <div class="gradebar" role="img" aria-label={`${label}: present ${scout(present)}, future ${scout(future)}`}>
      <div class="gb-track">
        {TICKS.map((t) => (
          <span key={t} class={`gb-tick${t === 50 ? " mid" : ""}`} style={{ left: `${x(t)}%` }} />
        ))}
        <span class={`gb-fill ${band(present)}`} style={{ width: `${x(present)}%` }} />
        {grows && <span class="gb-future" style={{ left: `${x(present)}%`, width: `${x(future) - x(present)}%` }} />}
      </div>
    </div>
  );
}

export function GradeChips({ grades }: { grades: [string, number][] }) {
  return (
    <span class="chips">
      {grades.map(([label, g]) => (
        <Grade key={label} g={g} title={`${label} ${scout(g)}: ${gradeWord(g)}`} />
      ))}
    </span>
  );
}

export function ScaleLegend() {
  const steps = [20, 30, 40, 50, 60, 70, 80];
  return (
    <div class="scale-legend" aria-label="The 20-80 scale">
      {steps.map((g) => (
        <div key={g}>
          <Grade g={g} />
          <div>{gradeWord(g)}</div>
        </div>
      ))}
    </div>
  );
}
