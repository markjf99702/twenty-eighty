// Keeping leagues in the player's own Google Drive, so they can pick one up on
// another device. The drive.file scope lets Twenty-Eighty see only the files it
// made itself: a Twenty-Eighty folder holding one copy of each league per device
// ("Milwaukee Ironmen (iPhone).txt"). A league is one running simulation, so two
// copies can't be merged: each device writes only its own file, and the person
// chooses which copy to carry on from. Adapted from Terraville's drive.ts.

import type { DriveMeta } from "../api/protocol";

/**
 * The OAuth client every junkdrawer.works project shares. A client ID is not a
 * secret: Google accepts it only from the origins listed here.
 */
export const GOOGLE_CLIENT_ID = "897653851078-p5jrh2bto6h3bj0lc4jist3k1vsc1pj4.apps.googleusercontent.com";
// Twenty-Eighty lives at its own address now; junkdrawer.works/twenty-eighty/ forwards there.
export const DRIVE_ORIGINS = ["https://twenty-eighty.junkdrawer.works", "https://junkdrawer.works"];

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3/files";
const UP = "https://www.googleapis.com/upload/drive/v3/files";
const KEY = "twenty-eighty.drive";
const DEVICE_KEY = "twenty-eighty.device";
/** The key every junkdrawer.works project keeps its Google sign-in under: good for an hour, and it remembers the account. */
const SHARED = "junkdrawer.google";
/** Ids go into Drive queries, so only the plain ones Twenty-Eighty makes. */
const SAFE_ID = /^[a-z0-9]{6,32}$/;

interface SharedSignIn {
  token: string;
  /** When Google's token expires, in ms since 1970. */
  exp: number;
  scope?: string;
  email?: string;
}

/** One device's copy of one league, as listed in Drive. */
export interface DriveCopy {
  fileId: string;
  league: string;
  club: string;
  /** Where the league stands in it: "May 21, 2026". */
  when: string;
  /** When the league last changed, ms since 1970. */
  saved: number;
  device: string;
  label: string;
  /** Written by this device. */
  mine: boolean;
}

export type DriveStatus = "unavailable" | "off" | "signin" | "busy" | "ok" | "error";

interface State {
  on: boolean;
  token: string;
  exp: number;
  err: string;
  folder: string;
  /** League id to this device's file for it. */
  files: Record<string, string>;
  /** League id to the save time of the copy last uploaded (or opened). */
  pushed: Record<string, number>;
  /** When the last upload finished. */
  last: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
}

interface TokenClient {
  requestAccessToken(o?: { prompt?: string; login_hint?: string }): void;
}

export interface GisOAuth2 {
  initTokenClient(c: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type?: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes?(r: TokenResponse, ...scopes: string[]): boolean;
}

export interface DriveDeps {
  fetch: typeof fetch;
  storage: Storage | null;
  now: () => number;
  device: { id: string; label: string };
  origin: string;
  /** Loads Google's sign-in library. Tests pass a fake. */
  loadGis?: () => Promise<GisOAuth2>;
}

class DriveError extends Error {
  constructor(
    readonly kind: "auth" | "gone" | "other",
    message: string = kind,
  ) {
    super(message);
  }
}

function fresh(): State {
  return { on: false, token: "", exp: 0, err: "", folder: "", files: {}, pushed: {}, last: 0 };
}

function loadGoogle(): Promise<GisOAuth2> {
  const g = () => (window as unknown as { google?: { accounts?: { oauth2?: GisOAuth2 } } }).google?.accounts?.oauth2;
  if (g()) return Promise.resolve(g()!);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (g() ? resolve(g()!) : reject(new Error("no oauth2")));
    s.onerror = () => reject(new Error("load"));
    document.head.appendChild(s);
  });
}

export class Drive {
  private st: State = fresh();
  private client: TokenClient | null = null;
  private gis: GisOAuth2 | null = null;
  private loading = false;
  private queue = new Map<string, { code: string; meta: DriveMeta }>();
  private busy = false;
  private listeners = new Set<() => void>();
  /** Every copy in Drive the last time it was listed (null until then). */
  copies: DriveCopy[] | null = null;
  private listedAt = 0;
  /** Called when Google hands over a token, to upload whatever waited. */
  onSignedIn: (() => void) | null = null;

  constructor(private deps: DriveDeps) {
    try {
      Object.assign(this.st, JSON.parse(deps.storage?.getItem(KEY) ?? "{}"));
    } catch {
      /* start fresh */
    }
  }

  /** Drive saving works only where Google accepts the client ID. */
  available(): boolean {
    return DRIVE_ORIGINS.includes(this.deps.origin);
  }

  get connected(): boolean {
    return this.available() && this.st.on;
  }

  get error(): string {
    return this.st.err;
  }

  get lastUpload(): number {
    return this.st.last;
  }

  get device(): { id: string; label: string } {
    return this.deps.device;
  }

  /** The save time of this device's last upload of a league. */
  pushedAt(league: string | undefined): number {
    return league ? (this.st.pushed[league] ?? 0) : 0;
  }

  /** This device opened a copy: it holds nothing newer than that until it changes. */
  markOpened(copy: DriveCopy): void {
    this.st.pushed[copy.league] = Math.max(this.st.pushed[copy.league] ?? 0, copy.saved);
    this.save();
    this.emit();
  }

  hasToken(): boolean {
    if (!(this.st.token && this.deps.now() < this.st.exp) && this.st.on && this.useShared()) this.save();
    return !!this.st.token && this.deps.now() < this.st.exp;
  }

  // ---- the shared sign-in ---------------------------------------------------

  private readShared(): SharedSignIn | null {
    try {
      return JSON.parse(this.deps.storage?.getItem(SHARED) ?? "null") as SharedSignIn | null;
    } catch {
      return null;
    }
  }

  /** Take another junkdrawer.works project's sign-in, if it has more than a minute left. */
  private useShared(): boolean {
    const g = this.readShared();
    if (!g?.token || !(g.exp - 60_000 > this.deps.now()) || !String(g.scope ?? "").includes(SCOPE)) return false;
    this.st.token = g.token;
    this.st.exp = g.exp - 60_000;
    return true;
  }

  private share(): void {
    try {
      const email = this.readShared()?.email ?? "";
      const g: SharedSignIn = { token: this.st.token, exp: this.st.exp + 60_000, scope: SCOPE, email };
      this.deps.storage?.setItem(SHARED, JSON.stringify(g));
    } catch {
      /* storage full or blocked */
    }
  }

  private dropShared(token: string): void {
    try {
      if (this.readShared()?.token === token) this.deps.storage?.removeItem(SHARED);
    } catch {
      /* ignore */
    }
  }

  status(): DriveStatus {
    if (!this.available()) return "unavailable";
    if (!this.st.on) return "off";
    if (!this.hasToken()) return "signin";
    if (this.busy) return "busy";
    if (this.st.err) return "error";
    return "ok";
  }

  /** Call `fn` whenever anything here changes; returns the way to stop. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private save(): void {
    try {
      this.deps.storage?.setItem(KEY, JSON.stringify(this.st));
    } catch {
      /* storage full or blocked */
    }
  }

  /** Load Google's sign-in library ahead of a tap, so connect() can open its pop-up at once. */
  prepare(): void {
    if (!this.available() || this.client || this.loading) return;
    this.loading = true;
    (this.deps.loadGis ?? loadGoogle)().then(
      (g) => {
        this.loading = false;
        this.gis = g;
        this.client = g.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPE,
          callback: (r) => this.onToken(r),
          error_callback: (e) => {
            if (e?.type !== "popup_closed") {
              this.st.err = "Google sign-in didn't open. If the browser blocks pop-ups, allow them for this page.";
              this.save();
            }
            this.emit();
          },
        });
        this.emit();
      },
      () => {
        this.loading = false;
        this.st.err = "Couldn't load Google sign-in. Check the connection.";
        this.emit();
      },
    );
  }

  /** Whether Google's sign-in library is loaded, so a tap can open its window. */
  get ready(): boolean {
    return this.client !== null;
  }

  /**
   * Ask Google for access. Call it straight from a tap: Google's sign-in is a
   * pop-up. Returns false while the sign-in library is still loading.
   */
  connect(): boolean {
    // Signed in to another junkdrawer.works project within the hour: no Google window at all.
    if (this.available() && this.useShared()) {
      this.st.on = true;
      this.st.err = "";
      this.save();
      this.emit();
      this.onSignedIn?.();
      void this.flush();
      return true;
    }
    if (!this.client) {
      this.prepare();
      return false;
    }
    this.st.err = "";
    const hint = this.readShared()?.email;
    this.client.requestAccessToken(hint ? { prompt: "", login_hint: hint } : { prompt: this.st.on ? "" : "select_account" });
    return true;
  }

  private onToken(r: TokenResponse): void {
    if (!r || r.error || !r.access_token) {
      this.st.err = `Google didn't allow access${r?.error ? ` (${r.error})` : ""}.`;
    } else if (this.gis?.hasGrantedAllScopes && !this.gis.hasGrantedAllScopes(r, SCOPE)) {
      this.st.err = "Twenty-Eighty needs permission to keep its own files in your Drive. Try again and leave that box ticked.";
    } else {
      this.st.token = r.access_token;
      this.st.exp = this.deps.now() + (Math.max(Number(r.expires_in) || 3600, 120) - 60) * 1000;
      this.st.on = true;
      this.st.err = "";
      this.save();
      this.share();
      this.emit();
      this.onSignedIn?.();
      void this.flush();
      return;
    }
    this.save();
    this.emit();
  }

  /**
   * Stop saving on this device. The files in Drive stay. Nothing is revoked:
   * that would cancel Google's permission for every project on the shared client.
   */
  disconnect(): void {
    this.st = fresh();
    this.queue.clear();
    this.copies = null;
    this.listedAt = 0;
    this.save();
    this.emit();
  }

  // ---- uploads ------------------------------------------------------------

  /** Queue the newest copy of a league (only the latest per league is sent) and send what's waiting. */
  push(code: string, meta: DriveMeta): Promise<void> {
    if (!this.connected || !SAFE_ID.test(meta.league)) return Promise.resolve();
    this.queue.set(meta.league, { code, meta });
    return this.flush();
  }

  get pending(): number {
    return this.queue.size;
  }

  async flush(): Promise<void> {
    if (this.busy || !this.hasToken() || !this.queue.size) {
      this.emit();
      return;
    }
    this.busy = true;
    this.emit();
    try {
      while (this.queue.size && this.hasToken()) {
        const [league, job] = this.queue.entries().next().value as [string, { code: string; meta: DriveMeta }];
        this.queue.delete(league);
        try {
          await this.upload(job.code, job.meta);
          this.st.err = "";
        } catch (e) {
          // Keep it for the next save or sign-in, unless a newer one queued meanwhile.
          if (!this.queue.has(league)) this.queue.set(league, job);
          if ((e as DriveError).kind !== "auth") this.st.err = (e as Error).message || "Upload failed.";
          break;
        }
      }
    } finally {
      this.busy = false;
      this.save();
      this.emit();
    }
  }

  private async upload(code: string, meta: DriveMeta): Promise<void> {
    const dev = this.deps.device;
    const head = {
      name: `${meta.club || "League"} (${dev.label}).txt`,
      appProperties: {
        twentyEighty: "league",
        league: meta.league,
        device: dev.id,
        label: dev.label,
        club: meta.club.slice(0, 60),
        when: meta.when.slice(0, 60),
        saved: String(meta.saved),
      },
    };
    let id = this.st.files[meta.league] ?? "";
    if (!id) {
      const mine = await this.find(
        `appProperties has { key='league' and value='${meta.league}' } and appProperties has { key='device' and value='${dev.id}' } and trashed = false`,
        "id",
      );
      id = (mine[0]?.id as string | undefined) ?? "";
    }
    if (id) {
      try {
        const m = multipart(head, code);
        await this.api("PATCH", `${UP}/${id}?uploadType=multipart&fields=id`, m.body, m.type);
      } catch (e) {
        if ((e as DriveError).kind !== "gone") throw e;
        id = "";
      }
    }
    if (!id) {
      const make = async () => {
        const m = multipart({ ...head, mimeType: "text/plain", parents: [await this.folder()] }, code);
        return (await (await this.api("POST", `${UP}?uploadType=multipart&fields=id`, m.body, m.type)).json()).id as string;
      };
      try {
        id = await make();
      } catch (e) {
        // The folder was deleted: make a new one.
        if ((e as DriveError).kind !== "gone" || !this.st.folder) throw e;
        this.st.folder = "";
        id = await make();
      }
    }
    this.st.files[meta.league] = id;
    this.st.pushed[meta.league] = Math.max(this.st.pushed[meta.league] ?? 0, meta.saved);
    this.st.last = this.deps.now();
    // Keep the listing current without asking Drive again.
    if (this.copies) {
      const copy: DriveCopy = { fileId: id, league: meta.league, club: meta.club, when: meta.when, saved: meta.saved, device: dev.id, label: dev.label, mine: true };
      this.copies = [copy, ...this.copies.filter((c) => c.fileId !== id)].sort((a, b) => b.saved - a.saved);
    }
  }

  private async folder(): Promise<string> {
    if (this.st.folder) return this.st.folder;
    const found = await this.find("appProperties has { key='twentyEighty' and value='folder' } and trashed = false", "id");
    let id = found[0]?.id as string | undefined;
    if (!id) {
      const r = await this.api(
        "POST",
        `${API}?fields=id`,
        JSON.stringify({ name: "Twenty-Eighty", mimeType: "application/vnd.google-apps.folder", appProperties: { twentyEighty: "folder" } }),
        "application/json",
      );
      id = (await r.json()).id as string;
    }
    this.st.folder = id;
    return id;
  }

  // ---- reading -------------------------------------------------------------

  /** Every copy of every league in Drive, newest first. */
  async list(): Promise<DriveCopy[]> {
    const files = await this.find("appProperties has { key='twentyEighty' and value='league' } and trashed = false", "id,modifiedTime,appProperties");
    const dev = this.deps.device.id;
    const copies = files
      .map((f) => {
        const p = (f.appProperties ?? {}) as Record<string, string>;
        return {
          fileId: f.id as string,
          league: p.league ?? "",
          club: p.club || "A league",
          when: p.when || "",
          saved: Number(p.saved) || Date.parse(f.modifiedTime as string) || 0,
          device: p.device ?? "",
          label: p.label || "another device",
          mine: p.device === dev,
        };
      })
      .filter((c) => SAFE_ID.test(c.league))
      .sort((a, b) => b.saved - a.saved);
    this.copies = copies;
    this.listedAt = this.deps.now();
    this.emit();
    return copies;
  }

  /** List again if it's been a while (or never), when there's a token to do it with. */
  async refresh(maxAge = 60_000): Promise<void> {
    if (!this.connected || !this.hasToken() || this.deps.now() - this.listedAt < maxAge) return;
    try {
      await this.list();
      if (this.st.err) {
        this.st.err = "";
        this.save();
        this.emit();
      }
    } catch (e) {
      if ((e as DriveError).kind !== "auth") this.st.err = (e as Error).message;
      this.emit();
    }
  }

  /** The league code in one file. */
  async download(fileId: string): Promise<string> {
    return (await this.api("GET", `${API}/${fileId}?alt=media`)).text();
  }

  // ---- REST ----------------------------------------------------------------

  private async api(method: string, url: string, body?: string, type?: string): Promise<Response> {
    if (!this.hasToken()) throw new DriveError("auth");
    const headers: Record<string, string> = { Authorization: `Bearer ${this.st.token}` };
    if (type) headers["Content-Type"] = type;
    const r = await this.deps.fetch(url, { method, headers, body });
    if (r.status === 401) {
      this.dropShared(this.st.token);
      this.st.token = "";
      this.st.exp = 0;
      this.save();
      this.emit();
      throw new DriveError("auth");
    }
    if (r.status === 404) throw new DriveError("gone");
    if (!r.ok) {
      const t = await r.text();
      const m = /"message":\s*"([^"]+)"/.exec(t);
      throw new DriveError("other", `Google Drive said: ${m ? m[1] : r.status}`);
    }
    return r;
  }

  private async find(q: string, fields: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let page = "";
    do {
      const url = `${API}?spaces=drive&pageSize=1000&fields=nextPageToken,files(${fields})&q=${encodeURIComponent(q)}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`;
      const j = await (await this.api("GET", url)).json();
      out.push(...((j.files ?? []) as Record<string, unknown>[]));
      page = j.nextPageToken ?? "";
    } while (page);
    return out;
  }
}

function multipart(meta: object, body: string): { body: string; type: string } {
  const b = `twentyeighty${Math.random().toString(36).slice(2)}`;
  return {
    body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: text/plain\r\n\r\n${body}\r\n--${b}--`,
    type: `multipart/related; boundary=${b}`,
  };
}

/** A name for this device, shown next to its copies in Drive. */
export function deviceLabel(ua: string, touch: number): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux PC";
  return "Browser";
}

/** This browser's id and name, kept so its copies stay its own. */
function thisDevice(storage: Storage | null): { id: string; label: string } {
  const label = deviceLabel(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  try {
    let id = storage?.getItem(DEVICE_KEY) ?? "";
    if (!SAFE_ID.test(id)) {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      id = Array.from(bytes, (b) => (b % 36).toString(36)).join("");
      storage?.setItem(DEVICE_KEY, id);
    }
    return { id, label };
  } catch {
    return { id: "unsaved0device", label };
  }
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

const storage = safeStorage();
export const drive = new Drive({
  fetch: (...a) => fetch(...a),
  storage,
  now: () => Date.now(),
  device: thisDevice(storage),
  origin: location.origin,
});

/** "just now", "12 minutes ago", "3 hours ago", "Sep 24". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minute${Math.round(s / 60) === 1 ? "" : "s"} ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
