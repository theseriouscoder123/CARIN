"use client";
import { packageId as computePackageId } from "@cairn/core/identity";
import Link from "next/link";
import { useEffect, useState } from "react";
import { chainStatus, hasCorroborated, readRecord, type ChainRecord } from "@/lib/chain";
import { EXPLORER_URL, REGISTRY_ADDR, RPC_LABEL } from "@/lib/config";
import { ago, short } from "@/lib/format";
import type { AttestersResponse, Health, Hex } from "@/lib/types";
import { packageHref } from "@/lib/links";
import { IconActivity, IconArrowRight, IconCheck, IconClock, IconX } from "@/components/icons";
import { indexer, usePoll } from "@/lib/use-poll";

interface FeedEvent {
  type: string;
  packageId?: Hex;
  name: string | null;
  version: string | null;
  timestamp: string;
}

type TileState = "waiting" | "corroborated" | "diverged";

/**
 * Big-screen live view for the stage. Follows the newest demo release (or ?pkg=) and shows,
 * from contract reads made in this browser, each attester's co-signature landing and the
 * verdict flipping when a republication is caught.
 */
export default function LivePage() {
  // ?spec=name@version pins a package by identity, computed here in the browser — so the
  // stage can open the page BEFORE publishing and watch every state, with no indexer lag.
  // ?pkg=<packageId> pins by id.
  const [pinned, setPinned] = useState<Hex | undefined>();
  const [pinnedSpec, setPinnedSpec] = useState<{ name: string; version: string } | undefined>();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const spec = params.get("spec");
    if (spec && spec.lastIndexOf("@") > 0) {
      const at = spec.lastIndexOf("@");
      const name = spec.slice(0, at);
      const version = spec.slice(at + 1);
      try {
        setPinned(computePackageId("npm", name, version).toLowerCase() as Hex);
        setPinnedSpec({ name, version });
        return;
      } catch {
        // fall through to ?pkg / follow mode
      }
    }
    const q = params.get("pkg");
    if (q && /^0x[0-9a-fA-F]{64}$/.test(q)) setPinned(q.toLowerCase() as Hex);
  }, []);

  const feed = usePoll<{ items: FeedEvent[] }>(() => indexer("/events?limit=60"), "live-feed", 3000);
  const attesters = usePoll<AttestersResponse>(() => indexer("/attesters"), "live-attesters", 10_000);
  const health = usePoll<Health>(() => indexer("/health"), "live-health", 30_000);

  const submitted = (feed.data?.items ?? []).filter((e) => e.type === "AttestationSubmitted" && e.packageId);
  const target =
    pinned !== undefined
      ? {
          packageId: pinned,
          name: pinnedSpec?.name ?? submitted.find((e) => e.packageId === pinned)?.name ?? null,
          version: pinnedSpec?.version ?? submitted.find((e) => e.packageId === pinned)?.version ?? null
        }
      : (submitted.find((e) => e.name?.startsWith("@cairn-demo/")) ?? submitted[0]);
  const packageId = target?.packageId;
  const registry = REGISTRY_ADDR ?? health.data?.registry;
  const set = attesters.data?.attesters ?? [];

  const chain = usePoll<{ record: ChainRecord; corroborated: Record<string, boolean> }>(
    packageId && registry && set.length > 0
      ? async () => {
          const [record, flags] = await Promise.all([
            readRecord(registry, packageId),
            Promise.all(set.map((a) => hasCorroborated(registry, packageId, a.address)))
          ]);
          return { record, corroborated: Object.fromEntries(set.map((a, i) => [a.address.toLowerCase(), flags[i] ?? false])) };
        }
      : null,
    `live-chain-${packageId}-${registry}-${set.length}`,
    2500
  );

  const record = chain.data?.record;
  const status = record ? chainStatus(record) : undefined;
  const tile = (addr: string): TileState => {
    if (record?.divergences.some((d) => d.attester.toLowerCase() === addr.toLowerCase())) return "diverged";
    return chain.data?.corroborated[addr.toLowerCase()] ? "corroborated" : "waiting";
  };
  const confirmed = set.filter((a) => tile(a.address) === "corroborated").length;

  const theme =
    status === "DIVERGENT"
      ? { panel: "bg-bad", glyph: <IconX size={72} strokeWidth={3} />, word: "DIVERGENT", sub: "Republished with different bytes than were attested. Quorum revoked — the build is blocked." }
      : status === "VERIFIED"
        ? { panel: "bg-ok", glyph: <IconCheck size={72} strokeWidth={3} />, word: "VERIFIED", sub: `${confirmed} of ${set.length} independent attesters re-downloaded it and confirmed the digest.` }
        : status === "PENDING"
          ? { panel: "bg-warn", glyph: <IconClock size={72} strokeWidth={2.5} />, word: "PENDING", sub: `Waiting for independent attesters · ${confirmed} of ${record?.threshold ?? 2} needed so far.` }
          : { panel: "bg-nav", glyph: <IconClock size={72} strokeWidth={2} />, word: "WAITING", sub: "Waiting for the attestation to appear on-chain." };

  if (!packageId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <IconActivity size={40} className="text-muted" />
        <p className="text-3xl font-bold">Live consensus monitor</p>
        <p className="text-lg text-muted">
          {feed.error ? `Indexer unreachable: ${feed.error}` : feed.data ? "No attestation yet. Run cairn publish and it will appear here." : "Connecting to the log…"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 font-mono text-xs text-muted uppercase">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-teal" />
            </span>
            Live consensus · {pinned ? "pinned release" : "following the newest demo release"}
          </p>
          <h1 className="text-4xl leading-tight font-bold tracking-tight break-all md:text-5xl">
            {target?.name ?? short(packageId, 8, 6)}
            {target?.version ? <span className="ml-3 rounded border border-line bg-white px-2.5 py-0.5 align-middle font-mono text-2xl font-medium text-ink-2 md:text-3xl">{target.version}</span> : null}
          </h1>
        </div>
        <Link href={target?.name ? packageHref(target.name, target.version) : `/packages/${packageId}`} className="btn-outline">
          Full record <IconArrowRight size={14} />
        </Link>
      </div>

      <section className={`flex flex-wrap items-center gap-6 rounded-lg px-8 py-8 text-white transition-colors duration-700 ${theme.panel}`} aria-live="polite">
        <span className="shrink-0">{theme.glyph}</span>
        <div className="min-w-0">
          <p className="text-5xl font-black tracking-tight md:text-7xl">{theme.word}</p>
          <p className="mt-2 max-w-3xl text-xl text-white/90 md:text-2xl">{theme.sub}</p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {set.map((a) => {
          const st = tile(a.address);
          const look =
            st === "diverged"
              ? { box: "border-bad bg-bad-soft", ink: "text-bad-ink", icon: <IconX size={36} strokeWidth={3} />, text: "observed different bytes" }
              : st === "corroborated"
                ? { box: "border-ok bg-ok-soft", ink: "text-ok-ink", icon: <IconCheck size={36} strokeWidth={3} />, text: "re-fetched · digest matches" }
                : { box: "border-line-strong bg-white", ink: "text-muted", icon: <IconClock size={36} className="animate-pulse" />, text: record?.exists ? "re-fetching…" : "standing by" };
          return (
            <div key={a.address} className={`rounded-lg border-2 p-5 transition-colors duration-500 ${look.box}`}>
              <div className="flex items-center justify-between">
                <p className="font-mono text-2xl font-bold">{a.label ?? short(a.address)}</p>
                <span className={look.ink}>{look.icon}</span>
              </div>
              <p className="mt-1 font-mono text-sm text-muted">{short(a.address, 6, 4)}</p>
              <p className={`mt-3 text-lg font-semibold ${look.ink}`}>{look.text}</p>
            </div>
          );
        })}
      </div>

      {record?.exists ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-white p-4">
            <p className="label">Attested digest</p>
            <p className="mt-1 font-mono text-[15px] break-all text-ok-ink">{record.artifactDigest}</p>
          </div>
          <div className={`rounded-lg border p-4 ${record.divergences.length > 0 ? "border-bad/40 bg-bad-soft" : "border-line bg-white"}`}>
            <p className="label">Observed by attesters</p>
            <p className={`mt-1 font-mono text-[15px] break-all ${record.divergences.length > 0 ? "text-bad-ink" : "text-ok-ink"}`}>
              {record.divergences[0]?.observedDigest ?? (confirmed > 0 ? record.artifactDigest : "—")}
            </p>
          </div>
        </div>
      ) : null}

      <p className="font-mono text-xs text-muted">
        Read from the AttestationRegistry in this browser via {RPC_LABEL}
        {record ? ` at block #${record.blockNumber}` : ""} · updated {chain.updatedAt ? ago(chain.updatedAt.toISOString()) : "—"}
        {EXPLORER_URL && registry ? (
          <>
            {" · "}
            <a href={`${EXPLORER_URL}/address/${registry}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              contract on explorer
            </a>
          </>
        ) : null}
        {chain.error ? <span className="text-warn-ink"> · last chain read failed: {chain.error}</span> : null}
      </p>
    </div>
  );
}
