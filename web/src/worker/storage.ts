/**
 * The one save slot, in IndexedDB, gzip-compressed when the browser supports
 * it. Storage can be unavailable (private windows, blocked site data), so
 * every call fails soft and the game keeps running in memory.
 */

const DB = "twenty-eighty";
const STORE = "saves";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function gzip(text: string): Promise<Blob | string> {
  if (typeof CompressionStream === "undefined") return text;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

async function gunzip(data: Blob | string): Promise<string> {
  if (typeof data === "string") return data;
  const stream = data.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export async function writeSave(text: string): Promise<boolean> {
  try {
    const data = await gzip(text);
    await tx("readwrite", (s) => s.put(data, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function readSave(): Promise<string | null> {
  try {
    const data = await tx<Blob | string | undefined>("readonly", (s) => s.get(KEY));
    return data === undefined ? null : await gunzip(data);
  } catch {
    return null;
  }
}

export async function hasSave(): Promise<boolean> {
  try {
    const n = await tx<number>("readonly", (s) => s.count(KEY));
    return n > 0;
  } catch {
    return false;
  }
}

export async function clearSave(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(KEY));
  } catch {
    // nothing to clear
  }
}

// ---------------------------------------------------------------------------
// League codes: a save as compressed text, for Google Drive (and Import).

const CODE_PREFIX = "twenty-eighty league 1\n";

export const isLeagueCode = (text: string) => text.startsWith(CODE_PREFIX);

/** The save, gzip-compressed and base64-encoded behind a short header. */
export async function encodeLeague(json: string): Promise<string> {
  const data = await gzip(json);
  if (typeof data === "string") return data; // no compression here: plain JSON still imports
  const bytes = new Uint8Array(await data.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return CODE_PREFIX + btoa(bin);
}

/** A league code (or plain save JSON) back to save JSON. */
export async function decodeLeague(text: string): Promise<string> {
  if (!isLeagueCode(text)) return text;
  const bin = atob(text.slice(CODE_PREFIX.length).trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return gunzip(new Blob([bytes]));
}
