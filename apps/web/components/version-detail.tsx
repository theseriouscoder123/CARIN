"use client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { CodeBlock, Card, CopyButton, Digest, ErrorBox, HashPill, PageHeader, Skeleton, StatusBadge, Tabs, Tip, TxRef } from "@/components/ui";
import { chainStatus, hasCorroborated, readRecord, type ChainRecord, type ChainStatus } from "@/lib/chain";
import { EXPLORER_URL, REGISTRY_ADDR, RPC_LABEL } from "@/lib/config";
import { ago, chainName, same, short } from "@/lib/format";
import type { AttestersResponse, Health, Hex, PackageDetail, TimelineEvent } from "@/lib/types";
import { indexer, usePoll, type PollState } from "@/lib/use-poll";
import { IconAlert, IconBox, IconCheck, IconClock, IconExternal, IconServer, IconShield, IconX } from "./icons";

import { packageHref } from "@/lib/links";
export { packageHref };

export interface Release {
  packageId: Hex;
  valid: boolean;
  d: PackageDetail | undefined;
  c: ChainRecord | undefined;
  detail: PollState<PackageDetail>;
  chain: PollState<{ record: ChainRecord; corroborated: Record<string, boolean | undefined> }>;
  timeline: PollState<{ events: TimelineEvent[] }>;
  attesters: AttestersResponse | undefined;
  health: Health | undefined;
  registry: Hex | undefined;
  status: ChainStatus;
  corroborated: Record<string, boolean | undefined>;
  who: (addr?: string) => string;
}

/**
 * Everything known about one release: the indexer's view, and the authoritative record read
 * from the contract in this browser (including which attesters have co-signed).
 */
export function useRelease(raw: string): Release {
  const packageId = raw.toLowerCase() as Hex;
  const valid = /^0x[0-9a-f]{64}$/.test(packageId);

  const detail = usePoll<PackageDetail>(valid ? () => indexer(`/packages/${packageId}`) : null, `d-${packageId}`);
  const timeline = usePoll<{ events: TimelineEvent[] }>(valid ? () => indexer(`/packages/${packageId}/timeline`) : null, `t-${packageId}`);
  const attesters = usePoll<AttestersResponse>(() => indexer("/attesters"), "attesters");
  const health = usePoll<Health>(() => indexer("/health"), "health");

  // The configured registry wins; only if none is configured do we use the indexer's.
  const registry = (REGISTRY_ADDR ?? health.data?.registry) as Hex | undefined;
  const set = attesters.data?.attesters ?? [];
  const chain = usePoll<{ record: ChainRecord; corroborated: Record<string, boolean | undefined> }>(
    valid && registry
      ? async () => {
          const [record, flags] = await Promise.all([
            readRecord(registry, packageId),
            Promise.all(set.map((a) => hasCorroborated(registry, packageId, a.address).catch(() => undefined)))
          ]);
          return { record, corroborated: Object.fromEntries(set.map((a, i) => [a.address.toLowerCase(), flags[i]])) };
        }
      : null,
    `c-${packageId}-${registry}-${set.length}`
  );

  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of attesters.data?.attesters ?? []) if (a.label) m.set(a.address.toLowerCase(), a.label);
    return m;
  }, [attesters.data]);

  const c = chain.data?.record;
  const d = detail.data;
  return {
    packageId,
    valid,
    d,
    c,
    detail,
    chain,
    timeline,
    attesters: attesters.data,
    health: health.data,
    registry,
    status: c ? chainStatus(c) : (d?.status ?? "PENDING"),
    corroborated: chain.data?.corroborated ?? {},
    who: (addr?: string) => (addr ? (labels.get(addr.toLowerCase()) ?? short(addr)) : "—")
  };
}

/** Loading / error gate shared by every composition of the panels. */
export function ReleaseGate({ r, children }: { r: Release; children: ReactNode }) {
  if (!r.valid) return <ErrorBox what="this package" error={`"${r.packageId}" is not a packageId (0x + 64 hex characters).`} />;
  if (!r.d && !r.c) {
    if (r.detail.error && r.chain.error) return <ErrorBox what="this package" error={`indexer: ${r.detail.error}; chain: ${r.chain.error}`} />;
    return <Skeleton rows={6} />;
  }
  return <>{children}</>;
}

/** The headline verdict — the advisory panel when divergent. */
export function VerdictPanel({ r }: { r: Release }) {
  const { c, status } = r;
  const confirmed = Object.values(r.corroborated).filter(Boolean).length;
  const total = c?.attesterCount ?? r.attesters?.attesters.length ?? 0;

  if (status === "DIVERGENT" && c) {
    const first = c.divergences[0];
    return (
      <section role="alert" className="overflow-hidden rounded-lg border border-bad/50 bg-white">
        <div className="flex flex-wrap items-center gap-3 bg-bad px-5 py-3 text-white">
          <IconAlert size={20} />
          <p className="text-[15px] font-bold tracking-wide">DIVERGENCE DETECTED</p>
          <span className="ml-auto rounded bg-white/15 px-2 py-0.5 font-mono text-[11px] font-semibold">QUORUM REVOKED · BUILD BLOCKED</span>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-[15px] text-ink">
            Attesters received different bytes from the registry for this exact version than its publisher attested.{" "}
            <b>{c.divergences.length}</b> independent attester{c.divergences.length === 1 ? "" : "s"} re-downloaded it and reported the mismatch on-chain;{" "}
            <span className="font-mono text-[13px]">cairn verify</span> fails any build that installs it.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded border border-ok/30 bg-ok-soft p-3">
              <p className="label flex items-center gap-1.5 !text-ok-ink">
                <IconCheck size={12} strokeWidth={3} /> Attested by the publisher
              </p>
              <Digest value={c.artifactDigest} full className="mt-1.5 text-xs text-ok-ink" />
            </div>
            <div className="rounded border border-bad/30 bg-bad-soft p-3">
              <p className="label flex items-center gap-1.5 !text-bad-ink">
                <IconX size={12} strokeWidth={3} /> Observed by {r.who(first?.attester)}
              </p>
              <Digest value={first?.observedDigest} full className="mt-1.5 text-xs text-bad-ink" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  const look =
    status === "VERIFIED"
      ? { box: "border-ok/40 bg-ok-soft", icon: <IconShield size={26} />, ink: "text-ok-ink", title: "Verified", sub: `${c?.corroborations ?? r.d?.corroborations ?? confirmed} of ${total} independent attesters re-downloaded this release and confirmed its digest.` }
      : status === "PENDING"
        ? { box: "border-warn/40 bg-warn-soft", icon: <IconClock size={26} />, ink: "text-warn-ink", title: "Awaiting quorum", sub: `${c?.corroborations ?? r.d?.corroborations ?? 0} of ${c?.threshold ?? "?"} required attester confirmations so far.` }
        : { box: "border-line-strong bg-code", icon: <IconBox size={26} />, ink: "text-muted", title: "Not attested", sub: "No attestation exists on-chain for this exact version." };

  return (
    <section className={`flex flex-wrap items-center gap-4 rounded-lg border px-5 py-4 ${look.box}`}>
      <span className={look.ink}>{look.icon}</span>
      <div className="min-w-48 flex-1">
        <p className={`text-lg font-bold ${look.ink}`}>{look.title}</p>
        <p className="text-[13px] text-ink-2">{look.sub}</p>
        {!c ? <p className="mt-1 text-xs text-warn-ink">{r.chain.error ? "Indexer view only — the chain could not be read." : "Indexer view — confirming on the chain…"}</p> : null}
      </div>
      {c?.exists ? (
        <div className="w-full rounded border border-line bg-white px-3 py-2 sm:w-auto">
          <p className="label flex items-center gap-1">
            Artifact digest
            <Tip>Merkle root over the release&apos;s normalised file tree — repacking the tarball does not change it; changing any file does.</Tip>
          </p>
          <Digest value={c.artifactDigest} className="mt-0.5 text-xs" />
        </div>
      ) : null}
    </section>
  );
}

/** One tile per attester: co-signed, diverged or waiting — read from the contract. */
export function AttesterConsensus({ r }: { r: Release }) {
  const set = r.attesters?.attesters ?? [];
  if (set.length === 0 || !r.c?.exists) return null;
  return (
    <Card title="Attester consensus" icon={<IconServer size={16} />} right={<span className="font-mono text-xs text-muted">threshold {r.c.threshold} of {r.c.attesterCount}</span>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {set.map((a) => {
          const diverged = r.c?.divergences.some((d) => same(d.attester, a.address));
          const ok = r.corroborated[a.address.toLowerCase()];
          const look = diverged
            ? { cls: "border-bad/40 bg-bad-soft", ink: "text-bad-ink", icon: <IconX size={14} strokeWidth={3} />, text: "Different bytes" }
            : ok
              ? { cls: "border-ok/30 bg-ok-soft", ink: "text-ok-ink", icon: <IconCheck size={14} strokeWidth={3} />, text: "Digest matches" }
              : { cls: "border-line bg-code", ink: "text-muted", icon: <IconClock size={14} />, text: ok === false ? "Not yet reported" : "Checking…" };
          return (
            <div key={a.address} className={`rounded border p-3 ${look.cls}`}>
              <p className="truncate font-mono text-[13px] font-semibold text-ink">{a.label ?? short(a.address)}</p>
              <p className="font-mono text-[11px] text-muted" title={a.address}>
                {short(a.address, 6, 4)}
              </p>
              <p className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${look.ink}`}>
                {look.icon}
                {look.text}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** The cryptographic identifiers recorded for the release. */
export function HashesCard({ r }: { r: Release }) {
  const c = r.c;
  const d = r.d;
  const rows: [string, string | undefined, string][] = [
    ["Artifact digest", c?.artifactDigest ?? d?.artifactDigest, "Merkle root over the normalised file tree. The value every verification compares."],
    ["Tarball SHA-256", c?.tarballHash ?? d?.tarballHash, "Hash of the exact .tgz bytes. Recorded for reference; repacking changes it harmlessly."],
    ["Payload digest", c?.payloadDigest ?? d?.payloadDigest, "Hash of the per-file manifest the maintainer signed — used to show which files changed."],
    ["Package ID", r.packageId, 'keccak256("npm:name@version") — the key in the on-chain registry.']
  ];
  return (
    <Card title="Recorded hashes" right={<span className="rounded border border-line bg-code px-1.5 py-0.5 font-mono text-[10px] text-muted">IMMUTABLE</span>}>
      <dl className="space-y-3">
        {rows.map(([k, v, tip]) => (
          <div key={k}>
            <dt className="label flex items-center gap-1">
              {k}
              <Tip>{tip}</Tip>
            </dt>
            <dd className="mt-1 flex items-center gap-2 rounded border border-line bg-code px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-2" title={v}>
                {v ?? "—"}
              </span>
              {v ? <CopyButton value={v} /> : null}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Indexer vs chain, field by field — the indexer is a cache, the chain is the authority. */
export function EvidenceTable({ r }: { r: Release }) {
  const { d, c } = r;
  const notIndexed = r.detail.error && r.detail.status === 404;
  return (
    <Card
      flush
      title={
        <>
          Indexer vs chain
          <Tip>The dashboard&apos;s indexer is a convenience cache. Each field is re-read from the contract in your browser; any mismatch means trust the chain.</Tip>
        </>
      }
      right={
        <span className="font-mono text-[11px] text-muted" title={RPC_LABEL}>
          {c ? `chain read at block #${c.blockNumber}` : "reading chain…"}
        </span>
      }
    >
      {r.chain.error && !c ? <ErrorBox what="the on-chain record" error={r.chain.error} hint="The indexer view below is unverified until the chain can be read." /> : null}
      {!REGISTRY_ADDR && r.registry ? (
        <p className="flex items-center gap-1.5 px-5 pt-3 text-xs text-warn-ink">
          <IconAlert size={12} /> Registry address came from the indexer (NEXT_PUBLIC_REGISTRY_ADDR unset).
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="border-b border-line bg-code/60">
            <tr>
              <th className="th">Field</th>
              <th className="th">Indexer</th>
              <th className="th">Chain</th>
              <th className="th text-right">Match</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <Row label="artifactDigest" a={d?.artifactDigest} b={c?.exists ? c.artifactDigest : undefined} digest />
            <Row label="tarballHash" a={d?.tarballHash} b={c?.exists ? c.tarballHash : undefined} digest />
            <Row label="payloadDigest" a={d?.payloadDigest} b={c?.exists ? c.payloadDigest : undefined} digest />
            <Row label="publisher" a={d?.publisher} b={c?.exists ? c.publisher : undefined} digest />
            <Row label="corroborations" a={d ? String(d.corroborations) : undefined} b={c?.exists ? String(c.corroborations) : undefined} />
            <Row label="divergences" a={d ? String(d.divergenceCount) : undefined} b={c ? String(c.divergences.length) : undefined} />
            <Row label="quorum" a={d ? String(d.quorumReached) : undefined} b={c?.exists ? String(c.hasQuorum) : undefined} />
          </tbody>
        </table>
      </div>
      {notIndexed ? <p className="px-5 py-3 text-xs text-warn-ink">Not indexed yet{c?.exists ? " — the chain already has it." : "."}</p> : null}
    </Card>
  );
}

function Row({ label, a, b, digest = false }: { label: string; a?: string; b?: string; digest?: boolean }) {
  const both = a !== undefined && b !== undefined;
  const agree = both && (digest ? same(a, b) : a === b);
  const cell = (v?: string): ReactNode => (v === undefined ? <span className="text-muted">—</span> : digest ? <Digest value={v} /> : <span className="font-mono">{v}</span>);
  return (
    <tr>
      <td className="td font-mono text-ink-2">{label}</td>
      <td className="td">{cell(a)}</td>
      <td className="td">{cell(b)}</td>
      <td className="td text-right">
        {both ? (
          agree ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-ok-ink">
              <IconCheck size={12} strokeWidth={3} /> agree
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-bad-ink" title="Trust the chain">
              <IconX size={12} strokeWidth={3} /> mismatch
            </span>
          )
        ) : null}
      </td>
    </tr>
  );
}

/** Every divergence report, expected vs observed. */
export function DivergenceList({ r }: { r: Release }) {
  const c = r.c;
  if (!c || c.divergences.length === 0) return null;
  return (
    <Card flush title={`Divergence reports (${c.divergences.length})`} icon={<IconAlert size={16} />} className="border-bad/30">
      <ul className="divide-y divide-line">
        {c.divergences.map((v, i) => (
          <li key={`${v.attester}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-xs">
            <span className="font-mono font-semibold text-ink">{r.who(v.attester)}</span>
            <span className="flex items-center gap-1.5 text-muted">
              expected <HashPill value={c.artifactDigest} tone="ok" />
            </span>
            <span className="flex items-center gap-1.5 text-muted">
              observed <HashPill value={v.observedDigest} tone="bad" />
            </span>
            <span className="ml-auto text-muted">{ago(new Date(Number(v.reportedAt) * 1000).toISOString())}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
        Which files changed: <span className="font-mono text-ink-2">cairn verify</span> prints the per-file delta where the attested payload is available.
      </p>
    </Card>
  );
}

const TL: Record<TimelineEvent["type"], { label: string; cls: string; dot: string }> = {
  AttestationSubmitted: { label: "SUBMITTED", cls: "bg-primary-soft text-primary border-primary/20", dot: "bg-primary" },
  PackageNameClaimed: { label: "NAME PINNED", cls: "bg-code text-ink-2 border-line-strong", dot: "bg-muted" },
  AttesterCorroborated: { label: "CORROBORATED", cls: "bg-ok-soft text-ok-ink border-ok/20", dot: "bg-ok" },
  DivergenceReported: { label: "DIVERGENCE", cls: "bg-bad text-white border-bad", dot: "bg-bad" }
};

/** On-chain events for this release, newest first. */
export function TimelineList({ r }: { r: Release }) {
  const t = r.timeline;
  return (
    <Card flush title="Activity" right={<span className="font-mono text-[11px] text-muted">replayed from contract events</span>}>
      {t.data ? (
        <ol className="divide-y divide-line">
          {t.data.events.map((e) => {
            const m = TL[e.type];
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13px]">
                <span className={`h-2 w-2 shrink-0 rounded-full ${m.dot}`} />
                <span className={`w-28 shrink-0 rounded border px-1.5 py-px text-center font-mono text-[10px] font-semibold ${m.cls}`}>{m.label}</span>
                <span className="min-w-0 flex-1">
                  {e.type === "AttestationSubmitted" || e.type === "PackageNameClaimed" ? "publisher " : ""}
                  <span className="font-mono">{r.who(e.actor)}</span>
                  {e.type === "AttesterCorroborated" ? (
                    <span className="text-muted">
                      {" "}
                      · {String(e.data.corroborations)} total{e.data.quorumReached === true ? " · quorum reached" : ""}
                    </span>
                  ) : null}
                  {e.type === "DivergenceReported" ? (
                    <span className="text-bad-ink">
                      {" "}
                      · observed <span className="font-mono">{short(String(e.data.observedDigest))}</span>
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-muted" title={new Date(e.timestamp).toUTCString()}>
                  #{e.blockNumber} · {ago(e.timestamp)}
                </span>
                <TxRef hash={e.txHash} className="text-xs" />
              </li>
            );
          })}
        </ol>
      ) : t.error ? (
        <ErrorBox what="the timeline" error={t.error} />
      ) : (
        <Skeleton rows={3} />
      )}
    </Card>
  );
}

export function RawRecords({ r }: { r: Release }) {
  const json = JSON.stringify({ indexer: r.d ?? null, chain: r.c ?? null }, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2);
  return (
    <details className="group rounded-lg border border-line bg-card">
      <summary className="cursor-pointer px-5 py-3 text-[15px] font-semibold">Raw records (JSON)</summary>
      <div className="border-t border-line p-4">
        <CodeBlock code={json} dark={false} />
      </div>
    </details>
  );
}

/** Sidebar facts for the selected release. */
export function ReleaseSidebar({ r }: { r: Release }) {
  const c = r.c;
  const submittedTx = r.timeline.data?.events.find((e) => e.type === "AttestationSubmitted")?.txHash ?? r.d?.txHash;
  return (
    <>
      <Card title="Verification" icon={<IconShield size={16} />}>
        <div className="mb-3">
          <StatusBadge status={r.status} size="lg" />
        </div>
        <dl className="grid grid-cols-2 gap-2">
          <Fact k="Corroborations" v={c?.exists ? `${c.corroborations} of ${c.attesterCount}` : "—"} />
          <Fact k="Threshold" v={c ? String(c.threshold) : "—"} />
          <Fact k="Divergences" v={c ? String(c.divergences.length) : "—"} tone={c && c.divergences.length > 0 ? "text-bad-ink" : undefined} />
          <Fact k="Quorum" v={c?.exists ? (c.hasQuorum ? "reached" : "not reached") : "—"} tone={c?.hasQuorum ? "text-ok-ink" : undefined} />
        </dl>
      </Card>
      <Card title="Ledger" icon={<IconServer size={16} />}>
        <dl className="grid grid-cols-2 gap-2">
          <Fact k="Network" v={r.health ? chainName(r.health.chainId) : "—"} />
          <Fact k="Read at block" v={c ? `#${c.blockNumber.toString()}` : "—"} />
          <Fact k="Attested" v={c?.exists ? ago(new Date(Number(c.submittedAt) * 1000).toISOString()) : "—"} />
          <Fact k="Publisher" v={c?.exists ? short(c.publisher) : "—"} mono />
        </dl>
        <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-[13px]">
          {EXPLORER_URL && submittedTx ? (
            <a href={`${EXPLORER_URL}/tx/${submittedTx}`} target="_blank" rel="noreferrer" className="flex items-center justify-between text-primary hover:underline">
              Attestation transaction <IconExternal size={13} />
            </a>
          ) : null}
          {EXPLORER_URL && r.registry ? (
            <a href={`${EXPLORER_URL}/address/${r.registry}`} target="_blank" rel="noreferrer" className="flex items-center justify-between text-primary hover:underline">
              Registry contract <IconExternal size={13} />
            </a>
          ) : null}
        </div>
      </Card>
    </>
  );
}

export function Fact({ k, v, tone, mono = false }: { k: string; v: ReactNode; tone?: string; mono?: boolean }) {
  return (
    <div className="rounded border border-line bg-code/50 px-2.5 py-2">
      <dt className="text-[10px] font-semibold tracking-wider text-muted uppercase">{k}</dt>
      <dd className={`mt-0.5 truncate text-[13px] font-semibold ${mono ? "font-mono" : ""} ${tone ?? "text-ink"}`}>{v}</dd>
    </div>
  );
}

export type ReleaseTab = "overview" | "evidence" | "activity";

/** Overview / Evidence / Activity for one release. */
export function ReleaseTabs({ r, extra, extraTab }: { r: Release; extra?: ReactNode; extraTab?: { key: "versions"; label: string; count: number } }) {
  const [tab, setTab] = useState<ReleaseTab | "versions">("overview");
  const tabs: { key: ReleaseTab | "versions"; label: string; count?: number }[] = [{ key: "overview", label: "Overview" }];
  if (extraTab) tabs.push(extraTab);
  tabs.push({ key: "evidence", label: "Evidence" }, { key: "activity", label: "Activity", count: r.timeline.data?.events.length });
  return (
    <div className="space-y-5">
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "overview" ? (
        <div className="space-y-5">
          <AttesterConsensus r={r} />
          <DivergenceList r={r} />
          <HashesCard r={r} />
        </div>
      ) : null}
      {tab === "versions" ? extra : null}
      {tab === "evidence" ? (
        <div className="space-y-5">
          <EvidenceTable r={r} />
          <RawRecords r={r} />
        </div>
      ) : null}
      {tab === "activity" ? <TimelineList r={r} /> : null}
    </div>
  );
}

/** Standalone release page (by packageId) — used when the name is not known. */
export function VersionDetail({ packageId }: { packageId: string }) {
  const r = useRelease(packageId);
  const d = r.d;
  return (
    <ReleaseGate r={r}>
      <div className="space-y-6">
        <PageHeader
          crumbs={
            d ? (
              <>
                <span>npm</span>/
                <Link href={packageHref(d.name)} className="text-primary hover:underline">
                  {d.name}
                </Link>
              </>
            ) : (
              <span>release</span>
            )
          }
          title={
            d ? (
              <span className="flex flex-wrap items-center gap-3 break-all">
                {d.name}
                <span className="rounded bg-code px-2 py-0.5 font-mono text-base font-medium text-ink-2">{d.version}</span>
              </span>
            ) : (
              <span className="font-mono text-lg break-all">{r.packageId}</span>
            )
          }
        />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="min-w-0 space-y-5 lg:col-span-8">
            <VerdictPanel r={r} />
            <ReleaseTabs r={r} />
          </div>
          <aside className="space-y-5 lg:col-span-4">
            <ReleaseSidebar r={r} />
          </aside>
        </div>
      </div>
    </ReleaseGate>
  );
}

