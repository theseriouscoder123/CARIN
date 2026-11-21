"use client";
import { useParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { Card, Digest, ErrorBox, Skeleton, StatusBadge, TxRef } from "@/components/ui";
import { statusDetail } from "@/components/lists";
import { chainStatus, readRecord, type ChainRecord } from "@/lib/chain";
import { REGISTRY_ADDR, RPC_LABEL } from "@/lib/config";
import { ago, same, short } from "@/lib/format";
import type { AttestersResponse, Health, Hex, PackageDetail, TimelineEvent } from "@/lib/types";
import { indexer, usePoll } from "@/lib/use-poll";

export default function PackagePage() {
  const { packageId: raw } = useParams<{ packageId: string }>();
  const packageId = raw.toLowerCase() as Hex;
  const valid = /^0x[0-9a-f]{64}$/.test(packageId);

  const detail = usePoll<PackageDetail>(valid ? () => indexer(`/packages/${packageId}`) : null, `d-${packageId}`);
  const timeline = usePoll<{ events: TimelineEvent[] }>(valid ? () => indexer(`/packages/${packageId}/timeline`) : null, `t-${packageId}`);
  const attesters = usePoll<AttestersResponse>(() => indexer("/attesters"), "attesters-labels");
  const health = usePoll<Health>(() => indexer("/health"), "health-registry");

  // The chain read uses the configured registry; only if none is configured does it fall
  // back to the address the indexer reports — and the page says which it used.
  const registry = REGISTRY_ADDR ?? health.data?.registry;
  const chain = usePoll<ChainRecord>(valid && registry ? () => readRecord(registry, packageId) : null, `c-${packageId}-${registry}`);

  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of attesters.data?.attesters ?? []) if (a.label) m.set(a.address.toLowerCase(), a.label);
    return m;
  }, [attesters.data]);
  const who = (addr?: string) => (addr ? (labels.get(addr.toLowerCase()) ?? short(addr)) : "—");

  if (!valid) return <ErrorBox what="this package" error={`"${raw}" is not a packageId (0x + 64 hex characters).`} />;

  const d = detail.data;
  const c = chain.data;
  const notIndexed = detail.error && detail.status === 404;
  if (!d && !c) {
    if (detail.error && chain.error) return <ErrorBox what="this package" error={`indexer: ${detail.error}; chain: ${chain.error}`} />;
    if (notIndexed && c === undefined && chain.error === undefined && !registry) return <ErrorBox what="this package" error={detail.error ?? ""} />;
    return <Skeleton rows={6} />;
  }

  const status = c ? chainStatus(c) : (d?.status ?? "PENDING");
  const threshold = c?.threshold;
  const divergent = status === "DIVERGENT";

  return (
    <div className="space-y-6">
      {/* 1. header */}
      <div>
        <p className="text-sm uppercase tracking-wide text-neutral-400">{d?.ecosystem ?? "npm"} package</p>
        <h1 className="mt-1 text-4xl font-bold break-all">
          {d ? (
            <>
              {d.name}
              <span className="text-neutral-400">@{d.version}</span>
            </>
          ) : (
            <span className="font-mono text-2xl">{packageId}</span>
          )}
        </h1>
      </div>

      {/* 2. verdict */}
      <Card className={divergent ? "border-2 border-red-500 bg-red-950/40" : ""}>
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="space-y-3">
            <StatusBadge
              status={status}
              size="lg"
              detail={c && status !== "UNATTESTED" ? statusDetail({ status: status as "VERIFIED" | "PENDING" | "DIVERGENT", corroborations: c.corroborations, divergenceCount: c.divergences.length }, threshold) : undefined}
            />
            {divergent ? (
              <p className="max-w-2xl text-lg text-red-100">
                Attesters re-fetched this version and observed different bytes than were attested. Quorum is revoked on-chain and{" "}
                <span className="font-mono">cairn verify</span> blocks it.
              </p>
            ) : null}
          </div>
          {c && c.exists ? (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-lg">
              <dt className="text-neutral-400">corroborations</dt>
              <dd className="tabular-nums">
                {c.corroborations} / {c.attesterCount}
              </dd>
              <dt className="text-neutral-400">quorum threshold</dt>
              <dd className="tabular-nums">{c.threshold}</dd>
              <dt className="text-neutral-400">publisher</dt>
              <dd className="font-mono">{short(c.publisher)}</dd>
            </dl>
          ) : null}
        </div>
      </Card>

      {/* 3. digests: indexer says / chain says */}
      <Card
        title="Record — indexer vs chain"
        right={
          <span className="text-sm text-neutral-400">
            chain read from your browser via <span className="font-mono">{RPC_LABEL}</span>
            {c ? ` at block ${c.blockNumber}` : ""}
          </span>
        }
      >
        {chain.error && !c ? (
          <ErrorBox what="the on-chain record" error={chain.error} hint="The indexer view below is unverified until the chain can be read." />
        ) : null}
        {!REGISTRY_ADDR && registry ? (
          <p className="mb-3 text-sm text-amber-300">
            ⚠ NEXT_PUBLIC_REGISTRY_ADDR is not set, so the registry address ({short(registry)}) came from the indexer. Set it to make this check fully
            independent.
          </p>
        ) : null}
        <table className="w-full text-left">
          <thead className="text-sm uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="py-2 pr-4">Field</th>
              <th className="py-2 pr-4">Indexer says</th>
              <th className="py-2 pr-4">Chain says</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            <Row label="artifactDigest" a={d?.artifactDigest} b={c?.exists ? c.artifactDigest : undefined} digest />
            <Row label="tarballHash" a={d?.tarballHash} b={c?.exists ? c.tarballHash : undefined} digest />
            <Row label="payloadDigest" a={d?.payloadDigest} b={c?.exists ? c.payloadDigest : undefined} digest />
            <Row label="publisher" a={d?.publisher} b={c?.exists ? c.publisher : undefined} digest />
            <Row label="corroborations" a={d ? String(d.corroborations) : undefined} b={c?.exists ? String(c.corroborations) : undefined} />
            <Row label="divergences" a={d ? String(d.divergenceCount) : undefined} b={c ? String(c.divergences.length) : undefined} />
            <Row label="quorum" a={d ? String(d.quorumReached) : undefined} b={c?.exists ? String(c.hasQuorum) : undefined} />
          </tbody>
        </table>
        {notIndexed ? <p className="mt-3 text-sm text-amber-300">The indexer has not indexed this package{c?.exists ? " yet — the chain has it." : "."}</p> : null}
      </Card>

      {/* 5. divergence panel */}
      {c && c.divergences.length > 0 ? (
        <Card title="Divergences" className="border-red-800">
          <ul className="space-y-4">
            {c.divergences.map((v, i) => (
              <li key={`${v.attester}-${i}`} className="grid gap-2 rounded-md border border-red-900 bg-red-950/30 p-4 md:grid-cols-2">
                <div>
                  <p className="text-sm text-neutral-400">expected (attested)</p>
                  <Digest value={c.artifactDigest} full className="text-emerald-300" />
                </div>
                <div>
                  <p className="text-sm text-neutral-400">observed by {who(v.attester)}</p>
                  <Digest value={v.observedDigest} full className="text-red-300" />
                </div>
                <p className="text-sm text-neutral-400 md:col-span-2">
                  reported {ago(new Date(Number(v.reportedAt) * 1000).toISOString())} by <span className="font-mono">{v.attester}</span>
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-neutral-400">
            The per-file delta (which files were added or changed) is computed from the attested payload by{" "}
            <span className="font-mono">cairn verify</span>.
          </p>
        </Card>
      ) : null}

      {/* 4. timeline */}
      <Card title="Timeline" right={<span className="text-sm text-neutral-400">replayed from on-chain events, newest first</span>}>
        {timeline.data ? (
          <ol className="relative space-y-5 border-l border-neutral-700 pl-6">
            {timeline.data.events.map((e) => (
              <TimelineRow key={e.id} e={e} who={who} />
            ))}
          </ol>
        ) : timeline.error ? (
          <ErrorBox what="the timeline" error={timeline.error} />
        ) : (
          <Skeleton rows={3} />
        )}
      </Card>

      {/* 6. raw */}
      <details className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <summary className="cursor-pointer text-lg font-semibold">Raw records</summary>
        <pre className="mt-4 overflow-x-auto text-xs text-neutral-300">
          {JSON.stringify({ indexer: d ?? null, chain: c ?? null }, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2)}
        </pre>
      </details>
    </div>
  );
}

function Row({ label, a, b, digest = false }: { label: string; a?: string; b?: string; digest?: boolean }) {
  const agree = a !== undefined && b !== undefined && (digest ? same(a, b) : a === b);
  const both = a !== undefined && b !== undefined;
  const cell = (v?: string): ReactNode => (v === undefined ? <span className="text-neutral-500">—</span> : digest ? <Digest value={v} /> : <span className="font-mono">{v}</span>);
  return (
    <tr className="border-t border-neutral-800">
      <td className="py-2 pr-4 text-neutral-300">{label}</td>
      <td className="py-2 pr-4">{cell(a)}</td>
      <td className="py-2 pr-4">{cell(b)}</td>
      <td className="py-2 text-right">
        {both ? (
          agree ? (
            <span className="text-emerald-300" title="indexer and chain agree">
              ✓ agree
            </span>
          ) : (
            <span className="font-semibold text-red-300" title="the indexer disagrees with the chain — trust the chain">
              ✗ mismatch
            </span>
          )
        ) : null}
      </td>
    </tr>
  );
}

function TimelineRow({ e, who }: { e: TimelineEvent; who: (a?: string) => string }) {
  const meta: Record<TimelineEvent["type"], { dot: string; title: ReactNode }> = {
    AttestationSubmitted: { dot: "bg-sky-400", title: <>Attestation submitted by publisher {who(e.actor)}</> },
    PackageNameClaimed: { dot: "bg-neutral-400", title: <>Package name pinned to publisher {who(e.actor)}</> },
    AttesterCorroborated: {
      dot: "bg-emerald-400",
      title: (
        <>
          Corroborated by {who(e.actor)} — {String(e.data.corroborations)} total{e.data.quorumReached === true ? ", quorum reached" : ""}
        </>
      )
    },
    DivergenceReported: {
      dot: "bg-red-500",
      title: (
        <span className="text-red-200">
          Divergence reported by {who(e.actor)} — observed <span className="font-mono">{short(String(e.data.observedDigest))}</span>
        </span>
      )
    }
  };
  const m = meta[e.type];
  return (
    <li>
      <span className={`absolute -left-[7px] mt-2 h-3 w-3 rounded-full ${m.dot}`} />
      <p className="text-lg">{m.title}</p>
      <p className="text-sm text-neutral-400">
        block {e.blockNumber} · {ago(e.timestamp)} · tx <TxRef hash={e.txHash} />
      </p>
    </li>
  );
}
