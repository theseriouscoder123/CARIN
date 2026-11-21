"use client";
import { INDEXER_URL } from "@/lib/config";
import type { Health } from "@/lib/types";
import { HttpError, indexer, usePoll } from "@/lib/use-poll";

/**
 * Persistent stale/unreachable banner (SPEC-DASHBOARD §3). A 503 still carries the health
 * body, so the banner can say exactly how far behind the data is.
 */
export function HealthBanner() {
  const h = usePoll<Health>(async () => {
    try {
      return await indexer<Health>("/health");
    } catch (err) {
      if (err instanceof HttpError && err.status === 503) {
        const res = await fetch(`${INDEXER_URL}/api/v1/health`, { cache: "no-store" });
        return (await res.json()) as Health;
      }
      throw err;
    }
  }, "health");

  if (h.data === undefined && h.error) {
    return (
      <div role="alert" className="bg-red-900/80 px-4 py-2 text-center text-sm text-red-50">
        ✗ Indexer unreachable at <span className="font-mono">{INDEXER_URL}</span> — lists below cannot load. Package pages still read the chain directly.
      </div>
    );
  }
  if (h.data && !h.data.ok) {
    return (
      <div role="alert" className="bg-amber-700/80 px-4 py-2 text-center text-sm text-amber-50">
        ⚠ Indexer is {h.data.lag} block{h.data.lag === 1 ? "" : "s"} behind. Showing cached data as of block {h.data.lastIndexedBlock}.
      </div>
    );
  }
  return null;
}

/** Footer line: where the data comes from, and as of which block. */
export function SourceLine() {
  const h = usePoll<Health>(() => indexer<Health>("/health"), "health-footer");
  if (!h.data) return null;
  return (
    <p className="font-mono text-xs text-neutral-500">
      chain {h.data.chainId} · registry {h.data.registry} · indexed to block {h.data.lastIndexedBlock} of {h.data.headBlock} · store: {h.data.store}
    </p>
  );
}
