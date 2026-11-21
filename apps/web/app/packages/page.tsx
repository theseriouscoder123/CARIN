"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { IconSearch } from "@/components/icons";
import { Card, PageHeader, Skeleton, StatusBadge, States } from "@/components/ui";
import { ago, short } from "@/lib/format";
import { packageHref } from "@/lib/links";
import type { NameGroup, Status } from "@/lib/types";
import { indexer, usePoll } from "@/lib/use-poll";

const FILTERS: (Status | "ALL")[] = ["ALL", "VERIFIED", "PENDING", "DIVERGENT"];

/** Registry-style list: one row per package name, every version behind it. */
function PackagesList() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState<Status | "ALL">("ALL");
  const [limit, setLimit] = useState(50);
  const qs = new URLSearchParams({ limit: String(limit) });
  if (q.trim()) qs.set("q", q.trim());
  const key = qs.toString();
  const names = usePoll<{ items: NameGroup[]; total: number }>(() => indexer(`/names?${key}`), `names-${key}`);
  const shown = (names.data?.items ?? []).filter((g) => status === "ALL" || g.worstStatus === status);

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={<span>registry / npm</span>}
        title="Packages"
        right={names.data ? <p className="font-mono text-xs text-muted">{names.data.total} package{names.data.total === 1 ? "" : "s"} with attested releases</p> : null}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              router.replace(e.target.value.trim() ? `/packages?q=${encodeURIComponent(e.target.value.trim())}` : "/packages", { scroll: false });
            }}
            placeholder="Search packages — express, chalk, @scope/name"
            aria-label="Search packages"
            className="input w-full py-2.5 pl-9 text-[15px]"
            autoFocus
          />
        </div>
        <div className="flex overflow-hidden rounded border border-line-strong bg-white" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatus(f)}
              aria-pressed={status === f}
              className={`border-r border-line px-3.5 py-2.5 text-[13px] last:border-r-0 ${status === f ? "bg-nav font-semibold text-white" : "text-ink-2 hover:bg-code"}`}
            >
              {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <Card flush>
        <States
          state={names}
          what="packages"
          isEmpty={() => shown.length === 0}
          empty={q || status !== "ALL" ? "No packages match this search." : <>No attestations yet. Run <span className="font-mono">cairn publish</span> to create the first one.</>}
          rows={8}
        >
          {(d) => (
            <>
              <ul className="divide-y divide-line">
                {shown.map((g) => (
                  <li key={g.name} className={`px-5 py-4 hover:bg-hover ${g.worstStatus === "DIVERGENT" ? "border-l-2 border-l-bad" : ""}`}>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <Link href={packageHref(g.name)} className="text-[17px] font-semibold break-all text-primary hover:underline">
                        {g.name}
                      </Link>
                      <span className="rounded bg-code px-1.5 py-0.5 font-mono text-xs text-ink-2">{g.latestVersion}</span>
                      <StatusBadge status={g.latestStatus} />
                      {g.worstStatus === "DIVERGENT" && g.latestStatus !== "DIVERGENT" ? (
                        <span className="rounded border border-bad/30 bg-bad-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-bad-ink">
                          {g.divergent} DIVERGENT VERSION{g.divergent === 1 ? "" : "S"}
                        </span>
                      ) : null}
                      <span className="ml-auto text-xs text-muted" title={new Date(g.lastSubmittedAt).toUTCString()}>
                        {ago(g.lastSubmittedAt)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                      <span>
                        <b className="font-semibold text-ink-2">{g.versionCount}</b> version{g.versionCount === 1 ? "" : "s"} attested
                      </span>
                      <span className="text-ok-ink">{g.verified} verified</span>
                      {g.pending > 0 ? <span className="text-warn-ink">{g.pending} pending</span> : null}
                      {g.divergent > 0 ? <span className="text-bad-ink">{g.divergent} divergent</span> : null}
                      <span className="font-mono" title={g.publisher}>
                        publisher {short(g.publisher)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {d.total > d.items.length ? (
                <div className="border-t border-line px-5 py-3">
                  <button type="button" onClick={() => setLimit((l) => l + 50)} className="text-[13px] font-semibold text-primary hover:underline">
                    Show more · {d.total - d.items.length} remaining
                  </button>
                </div>
              ) : null}
            </>
          )}
        </States>
      </Card>
    </div>
  );
}

export default function PackagesPage() {
  return (
    <Suspense fallback={<Skeleton rows={8} />}>
      <PackagesList />
    </Suspense>
  );
}
