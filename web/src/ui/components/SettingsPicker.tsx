import type { GameSettings } from "../../api/protocol";

type Difficulty = GameSettings["difficulty"];
type StatView = GameSettings["statView"];

const DIFFICULTIES: { key: Difficulty; label: string; text: string }[] = [
  {
    key: "easy",
    label: "Easy",
    text: "Your scouts see players almost as they are, trade partners deal close to fair, the budget is bigger, and the owner is patient (no firing in your first three seasons).",
  },
  {
    key: "normal",
    label: "Normal",
    text: "The game as designed: your scouts can be wrong, other clubs want an edge in every trade, and the owner holds you to real goals.",
  },
  {
    key: "hard",
    label: "Hard",
    text: "Blurrier scouting, rivals who read players better and drive harder bargains, a tighter budget, and an impatient owner.",
  },
];

const VIEWS: { key: StatView; label: string; text: string }[] = [
  { key: "basics", label: "Basics", text: "The familiar numbers: batting average, home runs, RBI, wins, ERA. Grades come with words (\"60 · plus\")." },
  { key: "full", label: "Full", text: "Everything: wRC+, xwOBA, FIP, ERA-, WAR and the analysts' reads." },
];

/** How the game plays: difficulty, how much stat detail, and staff advice. */
export function SettingsPicker({ value, onChange }: { value: GameSettings; onChange: (s: GameSettings) => void }) {
  return (
    <div class="settings-picker">
      <fieldset>
        <legend>Challenge</legend>
        <div class="choice-row">
          {DIFFICULTIES.map((d) => (
            <label key={d.key} class={`choice${value.difficulty === d.key ? " on" : ""}`}>
              <input type="radio" name="difficulty" checked={value.difficulty === d.key} onChange={() => onChange({ ...value, difficulty: d.key })} />
              <span class="t">{d.label}</span>
              <span class="s">{d.text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Stats</legend>
        <div class="choice-row two">
          {VIEWS.map((v) => (
            <label key={v.key} class={`choice${value.statView === v.key ? " on" : ""}`}>
              <input type="radio" name="statView" checked={value.statView === v.key} onChange={() => onChange({ ...value, statView: v.key })} />
              <span class="t">{v.label}</span>
              <span class="s">{v.text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label class="check">
        <input type="checkbox" checked={value.advice} onChange={(e) => onChange({ ...value, advice: (e.target as HTMLInputElement).checked })} />
        Staff advice: notes from your assistant GM, scouts, analysts and business office when there's something worth doing
      </label>
    </div>
  );
}
