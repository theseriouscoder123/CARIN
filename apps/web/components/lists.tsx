"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ago, short } from "@/lib/format";
import type { Attestation, AttestersResponse, DivergenceItem, Stats } from "@/lib/types";
import { indexer, refreshAll, usePoll } from "@/lib/use-poll";
import { Card, Digest, StatusBadge, States, TxRef } from "./ui";

export function statusDetail(a: Pick<Attestation, "status" | "corroborations" | "divergenceCount">, threshold?: number) {
  if (a.status === "DIVERGENT") return `${a.divergenceCount} divergence${a.divergenceCount === 1 ? "" : "s"}`;
  if (a.status === "PENDING") return threshold ? `${a.corroborations} of ${threshold}` : `${a.corroborations} corroborations`;
  return `${a.corroborations} corroborations`;
}

export function StatCards() {
  const s = usePoll<Stats>(() => indexer<Stats>("/stats"), "stats");
  return (
    <States state={s} what="stats" rows={1}>
      {(d) => (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Stat label="Attestations" value={d.totalAttestations} />
          <Stat label="Verified" value={d.quorumReached} tone="text-emerald-300" />
          <Stat label="Pending" value={d.pending} tone="text-amber-300" />
          <Stat label="Divergent" value={d.divergent} tone={d.divergent > 0 ? "text-red-300" : undefined} />
          <Stat label="Quorum" value={`${d.threshold} of ${d.activeAttesters}`} />
        </div>
      )}
    </States>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <p className="text-sm uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={`mt-1 text-4xl font-semibold tabular-nums ${tone ?? "text-neutral-100"}`}>{value}</p>
    </div>
  );
}

/**
 * Red banner at the top of the overview while any package is divergent, plus a toast the
 * moment a new divergence lands — it must be impossible to miss on stage.
 */
export function DivergenceAlert() {
  const d = usePoll<{ items: DivergenceItem[] }>(() => indexer("/divergences?limit=50"), "divergences-alert");
  const seen = useRef<Set<string> | null>(null);
  const [toast, setToast] = useState<DivergenceItem | null>(null);

  useEffect(() => {
    if (!d.data) return;
    const ids = new Set(d.data.items.map((i) => i.txHash));
    if (seen.current !== null) {
      const fresh = d.data.items.find((i) => !seen.current!.has(i.txHash));
      if (fresh) {
        refreshAll();
        setToast(fresh);
        setTimeout(() => setToast(null), 8000);
      }
    }
    seen.current = ids;
  }, [d.data]);

  const pkgs = new Map<string, DivergenceItem>();
  for (const i of d.data?.items ?? []) if (!pkgs.has(i.packageId)) pkgs.set(i.packageId, i);

  return (
    <>
      {pkgs.size > 0 ? (
        <div role="alert" className="rounded-xl border-2 border-red-500 bg-red-950/70 p-5 shadow-[0_0_40px_-10px] shadow-red-600">
          <p className="text-2xl font-bold text-red-100">✗ Divergence detected</p>
          <ul className="mt-3 space-y-2">
            {[...pkgs.values()].map((i) => (
              <li key={i.packageId} className="text-lg text-red-100">
                <Link href={`/packages/${i.packageId}`} className="font-semibold underline decoration-red-400 underline-offset-4">
                  {i.name}@{i.version}
                </Link>{" "}
                — attesters observed <span className="font-mono">{short(i.observedDigest)}</span>, attested{" "}
                <span className="font-mono">{short(i.expectedDigest)}</span>. Quorum revoked; <span className="font-mono">cairn verify</span> blocks it.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {toast ? (
        <div role="status" className="fixed right-6 bottom-6 z-50 max-w-md rounded-lg border border-red-500 bg-red-900 p-4 text-red-50 shadow-2xl">
          <p className="font-bold">✗ New divergence on-chain</p>
          <p className="mt-1 text-sm">
            {toast.name}@{toast.version} — reported by <span className="font-mono">{short(toast.attester)}</span>
          </p>
        </div>
      ) : null}
    </>
  );
}

export function PackageTable({ items, threshold }: { items: Attestation[]; threshold?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="text-sm uppercase tracking-wide text-neutral-400">
          <tr>
            <th className="py-2 pr-4">Package</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">artifactDigest</th>
            <th className="py-2 pr-4">Publisher</th>
            <th className="py-2">Submitted</th>
          </tr>
        </thead>
        <tbody className="text-lg">
          {items.map((a) => (
            <tr key={a._id} className={`border-t border-neutral-800 ${a.status === "DIVERGENT" ? "bg-red-950/40" : ""}`}>
              <td className="py-3 pr-4">
                <Link href={`/packages/${a._id}`} className="font-semibold hover:underline">
                  {a.name}
                  <span className="text-neutral-400">@{a.version}</span>
                </Link>
              </td>
              <td className="py-3 pr-4">
                <StatusBadge status={a.status} detail={statusDetail(a, threshold)} />
              </td>
              <td className="py-3 pr-4 text-base">
                <Digest value={a.artifactDigest} />
              </td>
              <td className="py-3 pr-4 font-mono text-base text-neutral-300">{short(a.publisher)}</td>
              <td className="py-3 text-base text-neutral-400">{ago(a.submittedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecentPackages({ limit = 8 }: { limit?: number }) {
  const p = usePoll<{ items: Attestation[] }>(() => indexer(`/packages?limit=${limit}`), `recent-${limit}`);
  const s = usePoll<Stats>(() => indexer<Stats>("/stats"), "stats-threshold");
  return (
    <Card title="Recent attestations" right={<Link href="/packages" className="text-sky-300 hover:underline">all packages →</Link>}>
      <States
        state={p}
        what="attestations"
        isEmpty={(d) => d.items.length === 0}
        empty={
          <>
            No attestations yet. Run <span className="font-mono text-neutral-200">cairn publish</span> to create the first one.
          </>
        }
      >
        {(d) => <PackageTable items={d.items} threshold={s.data?.threshold} />}
      </States>
    </Card>
  );
}

export function AttesterCards({ large = false }: { large?: boolean }) {
  const a = usePoll<AttestersResponse>(() => indexer("/attesters"), "attesters");
  return (
    <States state={a} what="attesters" isEmpty={(d) => d.attesters.length === 0} empty="No attesters registered in the quorum policy yet.">
      {(d) => (
        <>
          <div className={`grid gap-4 ${large ? "md:grid-cols-3" : "md:grid-cols-3"}`}>
            {d.attesters.map((t) => (
              <div key={t.address} className={`rounded-xl border p-4 ${t.online ? "border-emerald-900 bg-emerald-950/20" : "border-neutral-800 bg-neutral-900/60"}`}>
                <div className="flex items-center justify-between">
                  <p className="text-lg font-semibold">{t.label ?? "unlabelled attester"}</p>
                  <span className={`text-sm font-semibold ${t.online ? "text-emerald-300" : "text-neutral-400"}`}>{t.online ? "● online" : "○ offline"}</span>
                </div>
                <p className="mt-1 font-mono text-sm text-neutral-400" title={t.address}>
                  {t.address}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-neutral-400">corroborations</dt>
                  <dd className="text-right tabular-nums text-emerald-300">{t.corroborationCount}</dd>
                  <dt className="text-neutral-400">divergences reported</dt>
                  <dd className={`text-right tabular-nums ${t.divergenceCount > 0 ? "text-red-300" : ""}`}>{t.divergenceCount}</dd>
                  <dt className="text-neutral-400">last on-chain action</dt>
                  <dd className="text-right">{ago(t.lastSeenAt)}</dd>
                  {t.health ? (
                    <>
                      <dt className="text-neutral-400">synced to block</dt>
                      <dd className="text-right tabular-nums">{t.health.lastProcessedBlock}</dd>
                      <dt className="text-neutral-400">registry / chain</dt>
                      <dd className="text-right">
                        {t.health.registryReachable ? "✓" : "✗"} / {t.health.chainReachable ? "✓" : "✗"}
                      </dd>
                      {large ? (
                        <>
                          <dt className="text-neutral-400">uptime</dt>
                          <dd className="text-right tabular-nums">{t.health.uptimeSeconds}s</dd>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </dl>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-neutral-500">
            Attester set and threshold ({d.threshold} of {d.attesters.length}) are read from QuorumPolicy events; online status from each
            attester process&apos;s own /health endpoint.
            {d.unreachable.length > 0 ? ` ${d.unreachable.length} configured health endpoint(s) unreachable.` : ""}
          </p>
        </>
      )}
    </States>
  );
}

export function DivergenceFeed() {
  const d = usePoll<{ items: DivergenceItem[] }>(() => indexer("/divergences?limit=20"), "divergence-feed");
  return (
    <Card title="Divergence feed">
      <States state={d} what="divergences" isEmpty={(x) => x.items.length === 0} empty="No divergences recorded. Every attested artifact still matches what attesters observe.">
        {(x) => (
          <ul className="space-y-3">
            {x.items.map((i) => (
              <li key={i.txHash} className="rounded-md border border-red-900 bg-red-950/30 p-3">
                <Link href={`/packages/${i.packageId}`} className="font-semibold text-red-100 hover:underline">
                  ✗ {i.name}@{i.version}
                </Link>
                <p className="mt-1 text-sm text-neutral-300">
                  attester <span className="font-mono">{short(i.attester)}</span> observed <span className="font-mono">{short(i.observedDigest)}</span> · block{" "}
                  {i.blockNumber} · {ago(i.timestamp)} · tx <TxRef hash={i.txHash} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </States>
    </Card>
  );
}
