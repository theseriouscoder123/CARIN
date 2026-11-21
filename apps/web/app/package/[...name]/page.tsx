"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { IconExternal, IconKey, IconTerminal } from "@/components/icons";
import { Card, CopyButton, Digest, ErrorBox, Skeleton, StatusBadge, Tip } from "@/components/ui";
import { ReleaseGate, ReleaseSidebar, ReleaseTabs, VerdictPanel, packageHref, useRelease } from "@/components/version-detail";
import { EXPLORER_URL } from "@/lib/config";
import { ago } from "@/lib/format";
import type { Attestation, NameDetail } from "@/lib/types";
import { indexer, usePoll } from "@/lib/use-poll";

function VersionsTable({ d, selected }: { d: NameDetail; selected?: string }) {
  return (
    <Card flush title={`All versions (${d.versionCount})`}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="border-b border-line bg-code/60">
            <tr>
              <th className="th">Version</th>
              <th className="th">Status</th>
              <th className="th">Attesters</th>
              <th className="th">Artifact digest</th>
              <th className="th text-right">Attested</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.versions.map((v) => (
              <tr key={v._id} className={`hover:bg-hover ${v.version === selected ? "bg-primary-soft/60" : ""} ${v.status === "DIVERGENT" ? "bg-bad-soft/50" : ""}`}>
                <td className="td font-mono">
                  <Link href={packageHref(d.name, v.version)} className="font-semibold text-primary hover:underline">
                    {v.version}
                  </Link>
                  {v.version === d.latestVersion ? <span className="ml-2 rounded bg-nav px-1.5 py-px text-[10px] font-semibold text-white">LATEST</span> : null}
                </td>
                <td className="td">
                  <StatusBadge status={v.status} size="sm" />
                </td>
                <td className="td font-mono tabular-nums">{v.corroborations}</td>
                <td className="td text-xs">
                  <Digest value={v.artifactDigest} />
                </td>
                <td className="td text-right text-xs text-muted" title={new Date(v.submittedAt).toUTCString()}>
                  {ago(v.submittedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Release({ d, v }: { d: NameDetail; v: Attestation }) {
  const r = useRelease(v._id);
  const router = useRouter();
  const cmd = `cairn status ${d.name}@${v.version}`;

  return (
    <div className="space-y-6">
      {/* title row */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-1.5 font-mono text-xs text-muted">
            <Link href="/packages" className="hover:text-primary">
              npm
            </Link>
            /<span className="text-ink-2">{d.name}</span>
          </div>
          <h1 className="flex flex-wrap items-center gap-3 text-[28px] leading-9 font-bold tracking-tight break-all md:text-[32px]">
            {d.name}
            <span className="rounded border border-line bg-white px-2 py-0.5 font-mono text-[15px] font-medium text-ink-2">{v.version}</span>
            <StatusBadge status={r.status} />
          </h1>
          <p className="mt-1.5 font-mono text-xs text-muted">
            {d.versionCount} version{d.versionCount === 1 ? "" : "s"} attested · latest {d.latestVersion} · updated {ago(d.lastSubmittedAt)}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Version
          <select value={v.version} onChange={(e) => router.replace(packageHref(d.name, e.target.value), { scroll: false })} className="input py-1.5 font-mono">
            {d.versions.map((x) => (
              <option key={x._id} value={x.version}>
                {x.version}
                {x.status === "DIVERGENT" ? "  ✗ divergent" : x.status === "PENDING" ? "  ◷ pending" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ReleaseGate r={r}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="min-w-0 space-y-5 lg:col-span-8">
            <VerdictPanel r={r} />
            <div className="flex items-center gap-3 rounded-lg border border-nav-line bg-nav px-4 py-3 font-mono text-[13px] text-slate-100">
              <IconTerminal size={15} className="shrink-0 text-teal" />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-teal">$ </span>
                {cmd}
              </span>
              <CopyButton value={cmd} className="text-slate-400 hover:text-white" />
            </div>
            <ReleaseTabs r={r} extraTab={{ key: "versions", label: "Versions", count: d.versionCount }} extra={<VersionsTable d={d} selected={v.version} />} />
          </div>

          <aside className="space-y-5 lg:sticky lg:top-20 lg:col-span-4 lg:self-start">
            <ReleaseSidebar r={r} />
            <Card title="Publisher identity" icon={<IconKey size={16} />}>
              <div className="flex items-center gap-2 rounded border border-line bg-code px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={d.pinnedPublisher ?? undefined}>
                  {d.pinnedPublisher ?? "—"}
                </span>
                {d.pinnedPublisher ? <CopyButton value={d.pinnedPublisher} /> : null}
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <span className="rounded border border-teal/40 bg-teal/10 px-1.5 py-px font-mono text-[10px] font-semibold text-teal-ink">PINNED</span>
                {d.pinnedAt ? `since ${new Date(d.pinnedAt).toISOString().slice(0, 10)}` : null}
                <Tip>The first attestation of a name pins its publisher key. Versions signed by any other key revert on-chain.</Tip>
              </p>
              {EXPLORER_URL && d.pinnedPublisher ? (
                <a href={`${EXPLORER_URL}/address/${d.pinnedPublisher}`} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-between text-[13px] text-primary hover:underline">
                  Publisher on explorer <IconExternal size={13} />
                </a>
              ) : null}
            </Card>
            <Card flush title="Recent versions">
              <ul className="divide-y divide-line">
                {d.versions.slice(0, 5).map((x) => (
                  <li key={x._id} className={`flex items-center gap-2 px-5 py-2.5 ${x.version === v.version ? "bg-primary-soft/60" : ""}`}>
                    <Link href={packageHref(d.name, x.version)} className="font-mono text-[13px] font-semibold text-primary hover:underline">
                      {x.version}
                    </Link>
                    <span className="text-xs text-muted">{ago(x.submittedAt)}</span>
                    <span className="ml-auto">
                      <StatusBadge status={x.status} size="sm" />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </aside>
        </div>
      </ReleaseGate>
    </div>
  );
}

function PackageNamePage() {
  const params = useParams<{ name: string[] }>();
  const search = useSearchParams();
  const name = (params.name ?? []).map((s) => decodeURIComponent(s)).join("/");
  const detail = usePoll<NameDetail>(() => indexer(`/name?name=${encodeURIComponent(name)}`), `name-${name}`);

  if (detail.data === undefined) {
    if (detail.error) {
      return (
        <ErrorBox
          what={name}
          error={detail.error}
          hint={
            <>
              Not attested on CAIRN yet? Check an exact version on the{" "}
              <Link href="/verify" className="link">
                verify page
              </Link>
              .
            </>
          }
        />
      );
    }
    return <Skeleton rows={8} />;
  }
  const d = detail.data;
  const want = search.get("v") ?? d.latestVersion;
  const selected = d.versions.find((v) => v.version === want) ?? d.versions[0];
  if (!selected) return <ErrorBox what={name} error="no versions recorded" />;
  return <Release key={selected._id} d={d} v={selected} />;
}

export default function PackageNameRoute() {
  return (
    <Suspense fallback={<Skeleton rows={8} />}>
      <PackageNamePage />
    </Suspense>
  );
}
