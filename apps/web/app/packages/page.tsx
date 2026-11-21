"use client";
import { useState } from "react";
import { PackageTable } from "@/components/lists";
import { Card, States } from "@/components/ui";
import type { Attestation, Stats, Status } from "@/lib/types";
import { indexer, usePoll } from "@/lib/use-poll";

const FILTERS: (Status | "ALL")[] = ["ALL", "DIVERGENT", "PENDING", "VERIFIED"];

export default function PackagesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "ALL">("ALL");
  const [limit, setLimit] = useState(50);
  const params = new URLSearchParams({ limit: String(limit) });
  if (q.trim()) params.set("q", q.trim());
  if (status !== "ALL") params.set("status", status);
  const key = params.toString();
  const p = usePoll<{ items: Attestation[]; nextCursor: number | null }>(() => indexer(`/packages?${key}`), key);
  const s = usePoll<Stats>(() => indexer<Stats>("/stats"), "stats-packages");

  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-bold">Packages</h1>
      <div className="flex flex-wrap gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by package name"
          className="min-w-72 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-lg outline-none focus:border-sky-500"
        />
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatus(f)}
            className={`rounded-lg px-4 py-3 text-lg font-semibold ring-1 ${status === f ? "bg-neutral-100 text-neutral-900 ring-neutral-100" : "ring-neutral-700 hover:ring-neutral-500"}`}
          >
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      <Card>
        <States
          state={p}
          what="packages"
          isEmpty={(d) => d.items.length === 0}
          empty={q || status !== "ALL" ? "No packages match this filter." : <>No attestations yet. Run <span className="font-mono">cairn publish</span> to create the first one.</>}
          rows={6}
        >
          {(d) => (
            <>
              <PackageTable items={d.items} threshold={s.data?.threshold} />
              {d.nextCursor !== null ? (
                <button type="button" onClick={() => setLimit((l) => l + 50)} className="mt-4 text-sky-300 hover:underline">
                  Show more
                </button>
              ) : null}
            </>
          )}
        </States>
      </Card>
    </div>
  );
}
