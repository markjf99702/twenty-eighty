import { useEffect, useState } from "preact/hooks";
import { bump } from "../../api/client";
import type { Status } from "../../api/protocol";
import { ago, type Drive, drive, type DriveCopy } from "../drive";
import { leaguesInDrive, newerCopy, openCopy, skipCopy, syncLeague, useDrive } from "../sync";
import { notify, Section } from "./Common";

/** Green when this device's league is in Drive, amber while it's on its way, red when a tap is needed. */
function light(d: Drive, status: Status | null): { tone: "ok" | "wait" | "act"; text: string } {
  const s = d.status();
  const pending = !!status?.savedAt && status.savedAt > d.pushedAt(status.leagueId);
  if (s === "signin") return { tone: "act", text: "Google signs you out after an hour. Tap to sign in and save to Drive." };
  if (s === "error") return { tone: "act", text: d.error };
  if (s === "busy") return { tone: "wait", text: "Saving to Google Drive…" };
  if (pending) return { tone: "wait", text: "Changes waiting to go to Google Drive." };
  return { tone: "ok", text: d.lastUpload ? `Saved to Google Drive ${ago(d.lastUpload)}.` : "Connected to Google Drive." };
}

/** Sign in to Google (from a tap: its window is a pop-up). */
function connect(): void {
  if (!drive.connect()) notify("Getting Google sign-in ready. Tap again in a moment.");
}

/** The cloud in the scoreboard: how this device's league stands in Drive, and one tap to sync. */
export function DriveCloud({ status }: { status: Status }) {
  const d = useDrive();
  const l = light(d, status);
  if (!d.connected) return null;
  const tap = () => {
    if (d.status() === "signin") connect();
    else {
      void syncLeague(status.leagueId);
      void d.refresh(0);
    }
  };
  return (
    <button type="button" class={`cloud ${l.tone}`} title={l.text} aria-label={l.text} onClick={tap}>
      <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
        <path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.4 9.1 4.5 4.5 0 0 0 7 18z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
      </svg>
      <span class="dot" />
    </button>
  );
}

/** One copy in a list: whose device, where the league stands, and a way to carry on from it. */
function CopyRow({ copy, status, onOpen, here }: { copy: DriveCopy; status: Status | null; onOpen: (c: DriveCopy) => void; here: boolean }) {
  const [asking, setAsking] = useState(false);
  const replaces = !!status?.hasGame;
  return (
    <div class="copy">
      <div class="who">
        <b>{copy.club}</b>
        <span>{copy.when}</span>
        <span class="dim small">
          {copy.mine ? "This device" : copy.label} · saved {ago(copy.saved)}
        </span>
      </div>
      {here ? (
        <span class="dim small">Playing here</span>
      ) : asking ? (
        <div class="offer-actions">
          <span class="small">Replace the league on this device{status?.when ? ` (${status.when})` : ""}?</span>
          <button type="button" class="btn primary small" onClick={() => onOpen(copy)}>
            Yes, continue
          </button>
          <button type="button" class="btn ghost small" onClick={() => setAsking(false)}>
            No
          </button>
        </div>
      ) : (
        <button type="button" class="btn small" onClick={() => (replaces ? setAsking(true) : onOpen(copy))}>
          Continue from this
        </button>
      )}
    </div>
  );
}

function useOpen(status: Status | null, onStatus: (s: Status) => void) {
  const [busy, setBusy] = useState(false);
  const open = async (copy: DriveCopy) => {
    if (busy) return;
    setBusy(true);
    try {
      const st = await openCopy(copy, status?.leagueId);
      onStatus(st);
      bump();
      location.hash = "#home";
      notify(`Carrying on from ${copy.mine ? "this device's" : `the ${copy.label}'s`} copy: ${copy.club}, ${copy.when}.`);
    } catch (err) {
      notify((err as Error).message || "Couldn't open that copy.", true);
    } finally {
      setBusy(false);
    }
  };
  return { open, busy };
}

const ABOUT =
  "Keep a copy of your league in your Google Drive and pick it up on another device. Each device saves its own copy in a Twenty-Eighty folder, and you choose which one to carry on from. Twenty-Eighty can see only the files it makes there.";

/** The League office's Google Drive section. */
export function DrivePanel({ status, onStatus }: { status: Status; onStatus: (s: Status) => void }) {
  const d = useDrive();
  const l = light(d, status);
  const { open, busy } = useOpen(status, onStatus);
  useEffect(() => {
    if (!d.available()) return;
    d.prepare();
    void d.refresh(0);
  }, [d.connected]);
  if (!d.available()) return null;

  if (!d.connected) {
    return (
      <Section title="Google Drive">
        <p class="drive-about">{ABOUT}</p>
        {d.error && <p class="note warn">{d.error}</p>}
        <div>
          <button type="button" class="btn primary" onClick={connect}>
            Connect Google Drive
          </button>
        </div>
      </Section>
    );
  }
  const copies = d.copies ?? [];
  return (
    <Section title="Google Drive" aside={`On this device: ${d.device.label}`}>
      <p class={`drive-state ${l.tone}`}>
        <span class="dot" /> {l.text}
      </p>
      <div class="offer-actions">
        {d.status() === "signin" ? (
          <button type="button" class="btn primary" onClick={connect}>
            Sign in again
          </button>
        ) : (
          <button
            type="button"
            class="btn"
            disabled={d.status() === "busy"}
            onClick={() => {
              void syncLeague(status.leagueId);
              void d.refresh(0);
            }}
          >
            Save to Drive now
          </button>
        )}
        <button type="button" class="btn ghost" onClick={() => d.disconnect()}>
          Stop saving on this device
        </button>
      </div>
      {copies.length > 0 && (
        <div class="copies" aria-busy={busy}>
          <h3 class="copies-h">In your Drive</h3>
          {copies.map((c) => (
            <CopyRow key={c.fileId} copy={c} status={status} onOpen={open} here={c.mine && c.league === status.leagueId} />
          ))}
        </div>
      )}
      <p class="small dim">
        Stopping leaves the files in your Drive. Google's permission covers every junkdrawer.works project; to take it back, remove
        junkdrawer.works under Third-party apps &amp; services in your Google Account.
      </p>
    </Section>
  );
}

/** The title screen: carry on with a league from another device. */
export function DriveContinue({ onStarted }: { onStarted: (s: Status) => void }) {
  const d = useDrive();
  const [asked, setAsked] = useState(false);
  const { open, busy } = useOpen(null, onStarted);
  useEffect(() => {
    if (!d.available() || !(d.connected || asked)) return;
    d.prepare();
    void d.refresh(0);
  }, [d.connected, asked]);
  if (!d.available()) return null;

  if (!d.connected && !asked) {
    return (
      <p class="drive-ask">
        <button type="button" class="linkish" onClick={() => setAsked(true)}>
          Played on another device? Continue a league from Google Drive
        </button>
      </p>
    );
  }
  const leagues = leaguesInDrive();
  return (
    <section class="drive-continue">
      <h2 class="section-h">Continue from Google Drive</h2>
      {!d.connected ? (
        <>
          <p class="drive-about">{ABOUT}</p>
          {d.error && <p class="note warn">{d.error}</p>}
          <div>
            <button type="button" class="btn primary" onClick={connect}>
              Connect Google Drive
            </button>
          </div>
        </>
      ) : d.status() === "signin" ? (
        <div>
          <button type="button" class="btn primary" onClick={connect}>
            Sign in to Google Drive
          </button>
        </div>
      ) : d.copies === null ? (
        <p class="dim">Looking in your Drive…</p>
      ) : leagues.length === 0 ? (
        <p class="dim">No leagues in your Drive yet. Start one below and it's saved there as you play.</p>
      ) : (
        <div class="copies" aria-busy={busy}>
          {leagues.map((c) => (
            <CopyRow key={c.fileId} copy={c} status={null} onOpen={open} here={false} />
          ))}
        </div>
      )}
    </section>
  );
}

/** When another device has played further with this league. */
export function NewerCopy({ status, onStatus }: { status: Status; onStatus: (s: Status) => void }) {
  useDrive();
  const [, setGone] = useState(0);
  const { open, busy } = useOpen(status, onStatus);
  const copy = newerCopy(status);
  if (!copy) return null;
  return (
    <div class="note drive-banner" role="status">
      <span>
        Your {copy.label} has a newer copy of this league: <b>{copy.when}</b>, saved {ago(copy.saved)}. Carrying on from it replaces the
        league on this device{status.when ? ` (${status.when})` : ""}.
      </span>
      <span class="offer-actions">
        <button type="button" class="btn primary small" disabled={busy} onClick={() => open(copy)}>
          Continue from the {copy.label}
        </button>
        <button
          type="button"
          class="btn ghost small"
          onClick={() => {
            skipCopy(copy);
            setGone((n) => n + 1);
          }}
        >
          Keep this one
        </button>
      </span>
    </div>
  );
}
