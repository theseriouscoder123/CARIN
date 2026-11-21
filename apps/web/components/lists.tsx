"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ago, short } from "@/lib/format";
import type { Attestation, AttestersResponse, DivergenceItem, Stats } from "@/lib/types";
import { releaseHref } from "@/lib/links";
import { indexer, refreshAll, usePoll } from "@/lib/use-poll";
import { IconAlert, IconArrowRight, IconCheck, IconX } from "./icons";
import { Card, CopyButton, HashPill, StatusBadge, States, Tip, TxRef } from "./ui";

export function statusDetail(a: Pick<Attestation, "status" | "corroborations" | "divergenceCount">, threshold?: number) {
  if (a.status === "DIVERGENT") return `${a.divergenceCount} divergence${a.divergenceCount === 1 ? "" : "s"}`;
  if (a.status === "PENDING") return threshold ? `${a.corroborations} of ${threshold}` : `${a.corroborations} corroborations`;
  return `${a.corroborations} corroborations`;
}

export function useStats() {
  return usePoll<Stats>(() => indexer<Stats>("/stats"), "stats");
}

/** Headline numbers for the dark hero. */
export function HeroStats() {
  const s = useStats();
  const d = s.data;
  const cell = (label: string, value: string | number | undefined, tone = "text-white", tip?: string) => (
    <div className="rounded border border-nav-line bg-nav-2 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase" title={tip}>
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value ?? <span className="inline-block h-7 w-12 animate-pulse rounded bg-nav-line" />}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      {cell("Attested releases", d?.totalAttestations)}
      {cell("Quorum verified", d?.quorumReached, "text-teal", "Confirmed by a quorum of independent attesters")}
      {cell("Divergent", d?.divergent, d && d.divergent > 0 ? "text-[#ff8a8a]" : "text-white", "Attesters observed different bytes than were attested")}
      {cell("Quorum rule", d ? `${d.threshold} of ${d.activeAttesters}` : undefined, "text-white", "Attesters that must agree before a release counts as verified")}
    </div>
  );
}

/**
 * Advisory banner while any package is divergent, plus a toast the moment a new divergence
 * lands — it must be impossible to miss on stage.
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
  const latest = [...pkgs.values()][0];

  return (
    <>
      {latest ? (
        <div role="alert" className="overflow-hidden rounded-lg border border-bad/40 bg-white">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4 border-bad bg-bad-soft px-5 py-3">
            <span className="flex items-center gap-2 font-semibold text-bad-ink">
              <IconAlert size={18} /> Divergence detected
            </span>
            <Link href={releaseHref(latest)} className="font-mono text-sm font-semibold text-ink hover:underline">
              {latest.name}@{latest.version}
            </Link>
            <span className="flex items-center gap-2 text-xs text-ink-2">
              attested <HashPill value={latest.expectedDigest} tone="ok" /> observed <HashPill value={latest.observedDigest} tone="bad" />
            </span>
            <span className="ml-auto flex items-center gap-3 text-xs text-muted">
              {pkgs.size > 1 ? (
                <span title="The record is append-only — every divergent release stays visible">+{pkgs.size - 1} earlier</span>
              ) : null}
              <Link href={releaseHref(latest)} className="inline-flex items-center gap-1 font-semibold text-bad-ink hover:underline">
                View advisory <IconArrowRight size={13} />
              </Link>
            </span>
          </div>
        </div>
      ) : null}
      {toast ? (
        <div role="status" className="fixed right-6 bottom-6 z-50 max-w-sm rounded-lg border border-bad bg-white p-4 shadow-pop">
          <p className="flex items-center gap-2 font-semibold text-bad-ink">
            <IconX size={16} strokeWidth={3} /> New divergence on-chain
          </p>
          <p className="mt-1 font-mono text-xs text-ink-2">
            {toast.name}@{toast.version} · reported by {short(toast.attester)}
          </p>
        </div>
      ) : null}
    </>
  );
}

/** Registry-style rows: name + version + status on top, evidence underneath. */
export function PackageRows({ items, threshold, attesterCount }: { items: Attestation[]; threshold?: number; attesterCount?: number }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => (
        <li key={a._id} className={`px-5 py-3.5 hover:bg-hover ${a.status === "DIVERGENT" ? "border-l-2 border-l-bad bg-bad-soft/40" : ""}`}>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Link href={releaseHref({ name: a.name, version: a.version, packageId: a._id })} className="text-[15px] font-semibold break-all text-primary hover:underline">
              {a.name}
            </Link>
            <span className="rounded bg-code px-1.5 py-0.5 font-mono text-xs text-ink-2">{a.version}</span>
            <StatusBadge status={a.status} />
            <span className="ml-auto text-xs whitespace-nowrap text-muted" title={new Date(a.submittedAt).toUTCString()}>
              {ago(a.submittedAt)}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              digest <HashPill value={a.artifactDigest} tone={a.status === "DIVERGENT" ? "bad" : "default"} />
            </span>
            <span className={a.status === "DIVERGENT" ? "text-bad-ink" : ""}>
              {a.status === "DIVERGENT" ? statusDetail(a, threshold) : `${a.corroborations}${attesterCount ? ` of ${attesterCount}` : ""} attesters`}
            </span>
            <span className="font-mono" title={a.publisher}>
              publisher {short(a.publisher)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RecentPackages({ limit = 10 }: { limit?: number }) {
  const p = usePoll<{ items: Attestation[] }>(() => indexer(`/packages?limit=${limit}`), `recent-${limit}`);
  const s = useStats();
  return (
    <Card
      flush
      title="Recent attestations"
      right={
        <Link href="/packages" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
          All packages <IconArrowRight size={13} />
        </Link>
      }
    >
      <States
        state={p}
        what="attestations"
        rows={6}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <>
            No attestations yet. Run <span className="font-mono text-ink">cairn publish</span> to create the first one.
          </>
        }
      >
        {(d) => <PackageRows items={d.items} threshold={s.data?.threshold} attesterCount={s.data?.activeAttesters} />}
      </States>
    </Card>
  );
}

export function useAttesters() {
  return usePoll<AttestersResponse>(() => indexer("/attesters"), "attesters");
}

/** Compact attester list for sidebars. */
export function AttesterList() {
  const a = useAttesters();
  return (
    <Card
      flush
      title={
        <>
          Attester quorum
          {a.data ? <span className="rounded bg-primary-soft px-1.5 font-mono text-[11px] text-primary">{a.data.threshold} of {a.data.attesters.length}</span> : null}
        </>
      }
      right={
        <Link href="/attesters" className="text-[13px] font-semibold text-primary hover:underline">
          Details
        </Link>
      }
    >
      <States state={a} what="attesters" rows={3} isEmpty={(d) => d.attesters.length === 0} empty="No attesters registered yet.">
        {(d) => (
          <ul className="divide-y divide-line">
            {d.attesters.map((t) => (
              <li key={t.address} className="flex items-center gap-3 px-5 py-2.5">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${t.online ? "bg-ok" : d.healthConfigured ? "bg-line-strong" : "bg-teal"}`}
                  title={t.online ? "online" : d.healthConfigured ? "offline" : "active on-chain (health endpoint not exposed)"}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px] font-semibold">{t.label ?? short(t.address)}</p>
                  <p className="text-xs text-muted">last action {ago(t.lastSeenAt)}</p>
                </div>
                <div className="text-right text-xs tabular-nums">
                  <p className="text-ok-ink">{t.corroborationCount} ✓</p>
                  <p className={t.divergenceCount > 0 ? "text-bad-ink" : "text-muted"}>{t.divergenceCount} ✗</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </States>
    </Card>
  );
}

export function DivergenceFeed() {
  const d = usePoll<{ items: DivergenceItem[] }>(() => indexer("/divergences?limit=20"), "divergence-feed");
  return (
    <Card flush title="Divergence reports" icon={<IconAlert size={16} />}>
      <States state={d} what="divergences" rows={2} isEmpty={(x) => x.items.length === 0} empty="No divergences recorded.">
        {(x) => (
          <ul className="divide-y divide-line">
            {x.items.map((i) => (
              <li key={i.txHash} className="px-5 py-3">
                <Link href={releaseHref(i)} className="font-mono text-[13px] font-semibold text-bad-ink hover:underline">
                  {i.name}@{i.version}
                </Link>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  observed <HashPill value={i.observedDigest} tone="bad" /> by <span className="font-mono">{short(i.attester)}</span> · {ago(i.timestamp)} ·{" "}
                  <TxRef hash={i.txHash} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </States>
    </Card>
  );
}

export interface ActivityItem {
  id: string;
  type: "AttestationSubmitted" | "AttesterCorroborated" | "DivergenceReported";
  packageId?: `0x${string}`;
  name: string | null;
  version: string | null;
  actor?: `0x${string}`;
  actorLabel: string | null;
  data: Record<string, string | number | boolean>;
  blockNumber: number;
  txHash: `0x${string}`;
  timestamp: string;
}

/** Flash rows that appeared since the previous poll. */
export function useFresh(ids: string[] | undefined): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const key = ids?.join(",");
  useEffect(() => {
    if (!ids) return;
    if (seen.current !== null) {
      const added = ids.filter((id) => !seen.current!.has(id));
      if (added.length > 0) {
        setFresh(new Set(added));
        setTimeout(() => setFresh(new Set()), 3500);
      }
    }
    seen.current = new Set(ids);
  }, [key]);
  return fresh;
}

export const EVENT_META: Record<ActivityItem["type"], { label: string; cls: string }> = {
  AttestationSubmitted: { label: "SUBMITTED", cls: "bg-primary-soft text-primary border-primary/20" },
  AttesterCorroborated: { label: "CORROBORATED", cls: "bg-ok-soft text-ok-ink border-ok/20" },
  DivergenceReported: { label: "DIVERGENCE", cls: "bg-bad text-white border-bad" }
};

/** Live stream of on-chain events, newest first; new rows flash in. */
export function ActivityFeed({ limit = 10 }: { limit?: number }) {
  const feed = usePoll<{ items: ActivityItem[] }>(() => indexer(`/events?limit=${limit}`), `events-${limit}`, 3000);
  const fresh = useFresh(feed.data?.items.map((i) => i.id));

  return (
    <Card
      flush
      title={
        <>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-teal" />
          </span>
          Live on-chain activity
        </>
      }
      right={
        <Link href="/live" className="text-[13px] font-semibold text-primary hover:underline">
          Monitor
        </Link>
      }
    >
      <States state={feed} what="activity" isEmpty={(d) => d.items.length === 0} empty="No on-chain activity yet." rows={5}>
        {(d) => (
          <ol className="divide-y divide-line">
            {d.items.map((e) => {
              const m = EVENT_META[e.type];
              const who = e.actorLabel ?? short(e.actor);
              const pkg = e.name ? `${e.name}@${e.version}` : short(e.packageId);
              return (
                <li key={e.id} className={`px-5 py-2.5 ${fresh.has(e.id) ? (e.type === "DivergenceReported" ? "flash-bad" : "flash") : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className={`rounded border px-1.5 py-px font-mono text-[10px] font-semibold ${m.cls}`}>{m.label}</span>
                    <span className="ml-auto text-[11px] text-muted" title={`block ${e.blockNumber}`}>
                      {ago(e.timestamp)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[13px]">
                    {e.packageId ? (
                      <Link href={releaseHref(e)} className="font-mono text-ink hover:text-primary hover:underline">
                        {pkg}
                      </Link>
                    ) : (
                      <span className="font-mono">{pkg}</span>
                    )}
                    {e.type !== "AttestationSubmitted" ? <span className="text-muted"> · {who}</span> : null}
                    {e.type === "AttesterCorroborated" && e.data.quorumReached === true ? <span className="text-ok-ink"> · quorum</span> : null}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </States>
    </Card>
  );
}

/** "Enforce in CI" card with the real action reference. */
export function CiCard() {
  const yaml = `- uses: theseriouscoder123/CARIN@v1\n  with:\n    lockfile: package-lock.json`;
  return (
    <Card
      title="Enforce in CI"
      right={
        <Tip align="right">
          The job fails when any dependency is divergent, under quorum or (optionally) unattested, and writes a verdict table to the job summary.
        </Tip>
      }
    >
      <div className="overflow-hidden rounded border border-nav-line bg-nav">
        <div className="flex items-center justify-between border-b border-nav-line px-3 py-1.5 font-mono text-[11px] text-slate-400">
          .github/workflows/ci.yml
          <CopyButton value={yaml} className="text-slate-400 hover:text-white" />
        </div>
        <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-slate-100">{yaml}</pre>
      </div>
      <div className="mt-3 flex items-center justify-between text-[13px]">
        <span className="flex items-center gap-1.5 text-muted">
          <IconCheck size={13} className="text-ok" /> No npm credentials needed
        </span>
        <Link href="/docs#ci" className="font-semibold text-primary hover:underline">
          Setup guide
        </Link>
      </div>
    </Card>
  );
}
