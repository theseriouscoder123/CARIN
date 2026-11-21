"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { INDEXER_URL, POLL_MS } from "./config";

export interface PollState<T> {
  data: T | undefined;
  error: string | undefined;
  /** HTTP status of the last failed response, when there was one. */
  status: number | undefined;
  loading: boolean;
  updatedAt: Date | undefined;
}

export const REFRESH_EVENT = "cairn:refresh";

/** Ask every polling panel on the page to refresh now. */
export function refreshAll(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Poll a source while the tab is visible (SPEC-DASHBOARD §2). Keeps the last good data
 * on error, so a blip shows as stale — never as a blank panel or invented numbers.
 */
export function usePoll<T>(fetcher: (() => Promise<T>) | null, key: string, intervalMs = POLL_MS): PollState<T> & { refresh: () => void } {
  const [state, setState] = useState<PollState<T>>({ data: undefined, error: undefined, status: undefined, loading: fetcher !== null, updatedAt: undefined });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    const f = fetcherRef.current;
    if (!f) return;
    try {
      const data = await f();
      setState({ data, error: undefined, status: undefined, loading: false, updatedAt: new Date() });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : undefined;
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err), status, loading: false }));
    }
  }, []);

  useEffect(() => {
    setState((s) => ({ ...s, loading: fetcherRef.current !== null && s.data === undefined }));
    void run();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVis);
    // A significant event (e.g. a new divergence) asks every panel to refresh at once, so
    // the page never shows a red banner beside a stat card from the previous poll.
    const onRefresh = () => void run();
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
  }, [run, intervalMs, key]);

  return { ...state, refresh: () => void run() };
}

/** GET from the indexer API; non-2xx becomes an HttpError carrying the server's message. */
export async function indexer<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${INDEXER_URL}/api/v1${path}`, { cache: "no-store" });
  } catch {
    throw new Error(`indexer unreachable at ${INDEXER_URL}`);
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } } | undefined)?.error?.message ?? `HTTP ${res.status}`;
    throw new HttpError(res.status, msg);
  }
  return body as T;
}
