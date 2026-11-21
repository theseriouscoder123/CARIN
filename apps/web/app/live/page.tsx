"use client";
import { packageId as computePackageId } from "@cairn/core/identity";
import Link from "next/link";
import { useEffect, useState } from "react";
import { chainStatus, hasCorroborated, readRecord, type ChainRecord } from "@/lib/chain";
import { EXPLORER_URL, REGISTRY_ADDR, RPC_LABEL } from "@/lib/config";
import { ago, short } from "@/lib/format";
import type { AttestersResponse, Health, Hex } from "@/lib/types";
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
      ? { page: "bg-red-950/70 ring-red-500", text: "text-red-100", glyph: "✗", word: "DIVERGENT", sub: "Republished with different bytes than were attested. Quorum revoked — the build is blocked." }
      : status === "VERIFIED"
        ? { page: "bg-emerald-950/50 ring-emerald-500", text: "text-emerald-100", glyph: "✓", word: "VERIFIED", sub: `${confirmed} of ${set.length} independent attesters re-downloaded it and confirmed the digest.` }
        : status === "PENDING"
          ? { page: "bg-amber-950/40 ring-amber-500", text: "text-amber-100", glyph: "◷", word: "PENDING", sub: `Waiting for independent attesters · ${confirmed} of ${record?.threshold ?? 2} needed so far.` }
          : { page: "bg-neutral-900/60 ring-neutral-700", text: "text-neutral-200", glyph: "…", word: "WAITING", sub: "Waiting for the next attestation to appear on-chain." };

  if (!packageId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-5xl font-bold">Live view</p>
        <p className="text-2xl text-neutral-400">{feed.error ? `Indexer unreachable: ${feed.error}` : "No attestation yet. Run cairn publish and it will appear here."}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-8 rounded-3xl p-8 ring-2 transition-colors duration-700 ${theme.page}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-lg uppercase tracking-widest text-neutral-400">{pinned ? "pinned package" : "following the newest demo release"}</p>
          <h1 className="mt-2 text-5xl font-bold break-all md:text-6xl">
            {target?.name ?? short(packageId, 8, 6)}
            {target?.version ? <span className="text-neutral-400">@{target.version}</span> : null}
          </h1>
        </div>
        <Link href={`/packages/${packageId}`} className="rounded-lg bg-neutral-100 px-5 py-3 text-lg font-semibold text-neutral-900 hover:bg-white">
          full record →
        </Link>
      </div>

      <div className={`flex flex-wrap items-center gap-6 ${theme.text}`}>
        <span className="text-8xl font-black leading-none md:text-9xl" aria-hidden>
          {theme.glyph}
        </span>
        <div>
          <p className="text-6xl font-black tracking-tight md:text-7xl">{theme.word}</p>
          <p className="mt-2 max-w-3xl text-2xl">{theme.sub}</p>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {set.map((a) => {
          const st = tile(a.address);
          const look =
            st === "diverged"
              ? "border-red-500 bg-red-900/60 text-red-50"
              : st === "corroborated"
                ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                : "border-neutral-700 bg-neutral-900/70 text-neutral-300";
          return (
            <div key={a.address} className={`rounded-2xl border-2 p-6 transition-colors duration-500 ${look}`}>
              <div className="flex items-center justify-between">
                <p className="text-3xl font-bold">{a.label ?? short(a.address)}</p>
                <span className={`text-5xl ${st === "waiting" ? "animate-pulse" : ""}`} aria-hidden>
                  {st === "diverged" ? "✗" : st === "corroborated" ? "✓" : "◷"}
                </span>
              </div>
              <p className="mt-2 font-mono text-base opacity-80">{short(a.address, 6, 4)}</p>
              <p className="mt-4 text-xl font-semibold">
                {st === "diverged" ? "observed different bytes" : st === "corroborated" ? "re-fetched · digest matches" : "re-fetching…"}
              </p>
            </div>
          );
        })}
      </div>

      {record?.exists ? (
        <div className="grid gap-4 text-lg md:grid-cols-2">
          <div className="rounded-xl bg-black/30 p-4">
            <p className="text-neutral-400">attested digest</p>
            <p className="font-mono break-all text-emerald-300">{record.artifactDigest}</p>
          </div>
          <div className="rounded-xl bg-black/30 p-4">
            <p className="text-neutral-400">{record.divergences.length > 0 ? "observed by the attesters" : "observed"}</p>
            <p className={`font-mono break-all ${record.divergences.length > 0 ? "text-red-300" : "text-emerald-300"}`}>
              {record.divergences[0]?.observedDigest ?? (confirmed > 0 ? record.artifactDigest : "—")}
            </p>
          </div>
        </div>
      ) : null}

      <p className="text-base text-neutral-400">
        Read from the AttestationRegistry in this browser via <span className="font-mono">{RPC_LABEL}</span>
        {record ? ` at block ${record.blockNumber}` : ""} · updated {chain.updatedAt ? ago(chain.updatedAt.toISOString()) : "—"}
        {EXPLORER_URL && registry ? (
          <>
            {" · "}
            <a href={`${EXPLORER_URL}/address/${registry}`} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
              contract on the explorer
            </a>
          </>
        ) : null}
        {chain.error ? <span className="text-amber-300"> · last chain read failed: {chain.error}</span> : null}
      </p>
    </div>
  );
}
