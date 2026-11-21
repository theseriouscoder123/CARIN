"use client";
import Link from "next/link";
import { useState } from "react";
import { Card, StatusBadge, States } from "@/components/ui";
import { packageHref } from "@/components/version-detail";
import { ago } from "@/lib/format";
import type { NameGroup, Status } from "@/lib/types";
import { indexer, usePoll } from "@/lib/use-poll";

const FILTERS: (Status | "ALL")[] = ["ALL", "DIVERGENT", "PENDING", "VERIFIED"];

/** Registry-style list: one row per package name, every version behind it. */
export default function PackagesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "ALL">("ALL");
  const [limit, setLimit] = useState(50);
  const params = new URLSearchParams({ limit: String(limit) });
  if (q.trim()) params.set("q", q.trim());
  const key = params.toString();
  const names = usePoll<{ items: NameGroup[]; total: number }>(() => indexer(`/names?${key}`), `names-${key}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-4xl font-bold">Packages</h1>
        {names.data ? <p className="text-neutral-400">{names.data.total} packages with attested releases</p> : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search packages — express, chalk, @scope/name"
          className="min-w-72 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-lg outline-none focus:border-sky-500"
          autoFocus
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
          state={names}
          what="packages"
          isEmpty={(d) => d.items.filter((g) => status === "ALL" || g.worstStatus === status).length === 0}
          empty={q || status !== "ALL" ? "No packages match this search." : <>No attestations yet. Run <span className="font-mono">cairn publish</span> to create the first one.</>}
          rows={8}
        >
          {(d) => (
            <>
              <ul className="divide-y divide-neutral-800">
                {d.items
                  .filter((g) => status === "ALL" || g.worstStatus === status)
                  .map((g) => (
                    <li key={g.name} className={`flex flex-wrap items-center gap-x-6 gap-y-2 py-4 ${g.worstStatus === "DIVERGENT" ? "bg-red-950/20" : ""}`}>
                      <div className="min-w-64 flex-1">
                        <Link href={packageHref(g.name)} className="text-xl font-semibold hover:underline">
                          {g.name}
                        </Link>
                        <p className="mt-1 text-sm text-neutral-400">
                          latest <span className="font-mono text-neutral-200">{g.latestVersion}</span> · {g.versionCount} version
                          {g.versionCount === 1 ? "" : "s"} attested · {ago(g.lastSubmittedAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={g.worstStatus} detail={g.worstStatus === "DIVERGENT" ? `${g.divergent} divergent` : `${g.verified} verified`} />
                        {g.worstStatus === "DIVERGENT" && g.verified > 0 ? <span className="text-sm text-neutral-400">{g.verified} verified</span> : null}
                      </div>
                    </li>
                  ))}
              </ul>
              {d.total > d.items.length ? (
                <button type="button" onClick={() => setLimit((l) => l + 50)} className="mt-4 text-sky-300 hover:underline">
                  Show more ({d.total - d.items.length} remaining)
                </button>
              ) : null}
            </>
          )}
        </States>
      </Card>
    </div>
  );
}
