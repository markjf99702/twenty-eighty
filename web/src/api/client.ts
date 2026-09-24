/**
 * Typed RPC to the simulation worker, plus a tiny change counter the pages
 * watch so they refetch after a sim or a roster move.
 */
import { useEffect, useState } from "preact/hooks";
import type { Api, ApiName, RequestMessage, ResponseMessage } from "./protocol";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (day: number, total: number) => void;
};

const worker = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, Pending>();
let nextId = 1;

worker.onmessage = (e: MessageEvent<ResponseMessage>) => {
  const msg = e.data;
  const p = pending.get(msg.id);
  if (!p) return;
  if ("progress" in msg) {
    p.onProgress?.(msg.progress.day, msg.progress.total);
    return;
  }
  pending.delete(msg.id);
  if (msg.ok) p.resolve(msg.result);
  else p.reject(new Error(msg.error));
};

export function call<K extends ApiName>(
  name: K,
  payload: Api[K]["req"],
  onProgress?: (day: number, total: number) => void,
): Promise<Api[K]["res"]> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    const msg: RequestMessage = { id, name, payload };
    worker.postMessage(msg);
  });
}

// ---------------------------------------------------------------------------
// Change tracking

let revision = 0;
const listeners = new Set<(rev: number) => void>();

/** Tell every mounted page that the league changed. */
export function bump(): void {
  revision++;
  for (const l of listeners) l(revision);
}

export function useRevision(): number {
  const [rev, setRev] = useState(revision);
  useEffect(() => {
    listeners.add(setRev);
    return () => void listeners.delete(setRev);
  }, []);
  return rev;
}

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Fetch a view from the worker, refetching when the league changes or deps change. */
export function useApi<K extends ApiName>(name: K, payload: Api[K]["req"], deps: unknown[] = []): Loaded<Api[K]["res"]> {
  const rev = useRevision();
  const [state, setState] = useState<Loaded<Api[K]["res"]>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    call(name, payload).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (err: Error) => live && setState({ data: null, error: err.message, loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, name, ...deps]);
  return state;
}
