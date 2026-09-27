import { useEffect, useState } from "preact/hooks";
import { call } from "../api/client";
import type { Status } from "../api/protocol";
import { drive, type DriveCopy } from "./drive";

/** Re-render whenever Drive's state changes; returns the shared Drive. */
export function useDrive() {
  const [, setN] = useState(0);
  useEffect(() => drive.subscribe(() => setN((n) => n + 1)), []);
  return drive;
}

let syncing = false;

/** Send this device's league to Drive if it changed since its last upload. Saving here never waits for this. */
export async function syncLeague(leagueId: string | undefined): Promise<void> {
  if (syncing || !drive.connected || !drive.hasToken()) return;
  syncing = true;
  try {
    const r = await call("driveCode", { since: drive.pushedAt(leagueId) });
    if (r) await drive.push(r.code, r.meta);
  } catch {
    // Try again at the next change or check.
  } finally {
    syncing = false;
  }
}

/** Carry on from a copy in Drive: this device's league goes up first, then the copy replaces it here. */
export async function openCopy(copy: DriveCopy, current: string | undefined): Promise<Status> {
  await syncLeague(current);
  const code = await drive.download(copy.fileId);
  const st = await call("openCode", { code });
  drive.markOpened(copy);
  return st;
}

const SKIP_KEY = "twenty-eighty.driveSkip";

function skipped(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SKIP_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/** Don't offer this copy (or anything older) again. */
export function skipCopy(copy: DriveCopy): void {
  try {
    localStorage.setItem(SKIP_KEY, JSON.stringify({ ...skipped(), [copy.league]: copy.saved }));
  } catch {
    /* storage blocked */
  }
}

/** Another device's copy of this league that's newer than the one here, if there is one. */
export function newerCopy(status: Status): DriveCopy | null {
  if (!drive.connected || !drive.copies || !status.leagueId) return null;
  const skip = skipped()[status.leagueId] ?? 0;
  return drive.copies.find((c) => c.league === status.leagueId && !c.mine && c.saved > (status.savedAt ?? 0) && c.saved > skip) ?? null;
}

/** The newest copy of each league in Drive. */
export function leaguesInDrive(): DriveCopy[] {
  const seen = new Set<string>();
  return (drive.copies ?? []).filter((c) => !seen.has(c.league) && seen.add(c.league));
}
