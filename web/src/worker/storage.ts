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
