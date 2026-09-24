import { useState } from "preact/hooks";
import { bump, call } from "../../api/client";
import type { Status } from "../../api/protocol";
import { notify, Section } from "../components/Common";

/** Downloads are blocked where the app is embedded as a hosted page; the local build can export. */
const CAN_DOWNLOAD = !import.meta.env.VITE_NO_DOWNLOAD;

export function Office({ status, onStatus }: { status: Status; onStatus: (s: Status) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const exportSave = async () => {
    setBusy(true);
    try {
      const text = await call("exportSave", undefined);
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `twenty-eighty-${status.seed}-${status.year}-day${status.day}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const importSave = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const st = await call("importSave", { text: await file.text() });
      onStatus(st);
      bump();
      notify("Save loaded.");
      location.hash = "#home";
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const startOver = async () => {
    setBusy(true);
    const st = await call("deleteSave", undefined);
    onStatus(st);
    location.hash = "";
  };

  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">League office</div>
          <h1>Your league</h1>
        </div>
      </div>
      <div class="grid-2">
        <Section title="This universe">
          <div class="facts">
            <div>
              <span class="k">Seed</span>
              <span class="v">{status.seed}</span>
            </div>
            <div>
              <span class="k">Season</span>
              <span class="v">{status.year}</span>
            </div>
            <div>
              <span class="k">Minor league games</span>
              <span class="v">{status.minors ? "Played" : "Skipped"}</span>
            </div>
            <div>
              <span class="k">Autosave</span>
              <span class="v">{status.hasSave ? "On (this browser)" : "Unavailable"}</span>
            </div>
          </div>
          <p class="dim small" style={{ margin: 0, maxWidth: "62ch" }}>
            The game saves itself in this browser after every sim and roster move. Saves hold the whole league: every player,
            every stat line, the schedule and the random-number state, so a reloaded season plays out exactly as it would have.
          </p>
        </Section>

        <Section title="Save files">
          <div class="toolbar">
            {CAN_DOWNLOAD && (
              <button type="button" class="btn" disabled={busy} onClick={exportSave}>
                Export save
              </button>
            )}
            <label class="btn">
              Import save…
              <input type="file" accept=".json,application/json" hidden onChange={(e) => importSave((e.target as HTMLInputElement).files?.[0])} />
            </label>
          </div>
          {!CAN_DOWNLOAD && <p class="dim small" style={{ margin: 0 }}>Exporting needs the local version (npm run dev); importing works here.</p>}
        </Section>

        <Section title="Start over">
          <p class="dim" style={{ margin: 0, maxWidth: "62ch" }}>
            Generate a new universe and pick a new club. This deletes the saved game in this browser.
          </p>
          {confirming ? (
            <div class="confirm">
              <span>Delete this league for good?</span>
              <button type="button" class="btn danger" disabled={busy} onClick={startOver}>
                Yes, delete it
              </button>
              <button type="button" class="btn ghost" onClick={() => setConfirming(false)}>
                Keep playing
              </button>
            </div>
          ) : (
            <div>
              <button type="button" class="btn danger" onClick={() => setConfirming(true)}>
                New league…
              </button>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
