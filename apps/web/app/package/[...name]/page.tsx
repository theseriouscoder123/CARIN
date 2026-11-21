"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Card, Digest, ErrorBox, Skeleton, StatusBadge } from "@/components/ui";
import { VersionDetail, packageHref } from "@/components/version-detail";
import { EXPLORER_URL } from "@/lib/config";
import { ago, short } from "@/lib/format";
import type { NameDetail } from "@/lib/types";
import { indexer, usePoll } from "@/lib/use-poll";

function PackageNamePage() {
  const params = useParams<{ name: string[] }>();
  const search = useSearchParams();
  const router = useRouter();
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
              Not attested on CAIRN yet? Check its status on the <Link href="/verify" className="text-sky-300 underline">verify page</Link>, or
              attest it with <span className="font-mono">cairn publish</span>.
            </>
          }
        />
      );
    }
    return <Skeleton rows={6} />;
  }

  const d = detail.data;
  const selectedVersion = search.get("v") ?? d.latestVersion;
  const selected = d.versions.find((v) => v.version === selectedVersion) ?? d.versions[0];

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-neutral-400">{d.ecosystem} package</p>
          <h1 className="mt-1 text-4xl font-bold break-all">{d.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="text-neutral-400" htmlFor="version">
              version
            </label>
            <select
              id="version"
              value={selected?.version}
              onChange={(e) => router.replace(packageHref(d.name, e.target.value))}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-lg"
            >
              {d.versions.map((v) => (
                <option key={v._id} value={v.version}>
                  {v.version} — {v.status.toLowerCase()}
                </option>
              ))}
            </select>
            {selected ? <StatusBadge status={selected.status} detail={`${selected.corroborations} corroborations`} /> : null}
          </div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm">
          <p className="font-mono text-neutral-400"># check a project that depends on it</p>
          <p className="font-mono">cairn verify --lockfile package-lock.json</p>
          <Link href="/docs" className="mt-1 inline-block text-sky-300 hover:underline">
            install the CLI →
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {/* versions */}
          <Card title={`Versions (${d.versionCount})`} right={<span className="text-sm text-neutral-400">newest first</span>}>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-sm uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="py-2 pr-4">Version</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Corroborations</th>
                    <th className="py-2 pr-4">artifactDigest</th>
                    <th className="py-2">Attested</th>
                  </tr>
                </thead>
                <tbody>
                  {d.versions.map((v) => (
                    <tr
                      key={v._id}
                      className={`border-t border-neutral-800 ${v.version === selected?.version ? "bg-sky-950/40" : ""} ${v.status === "DIVERGENT" ? "text-red-100" : ""}`}
                    >
                      <td className="py-2 pr-4 font-mono">
                        <Link href={packageHref(d.name, v.version)} className="hover:underline">
                          {v.version}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={v.status} />
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{v.corroborations}</td>
                      <td className="py-2 pr-4 text-sm">
                        <Digest value={v.artifactDigest} />
                      </td>
                      <td className="py-2 text-sm text-neutral-400">{ago(v.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* the selected release, in full */}
          {selected ? (
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold">
                {d.name}
                <span className="text-neutral-400">@{selected.version}</span>
              </h2>
              <VersionDetail key={selected._id} packageId={selected._id} embedded />
            </div>
          ) : null}
        </div>

        {/* sidebar: name-level facts */}
        <aside className="space-y-4">
          <Card title="About this package">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-neutral-400">Pinned publisher key</dt>
                <dd className="font-mono break-all">{d.pinnedPublisher ?? "—"}</dd>
                <dd className="mt-1 text-xs text-neutral-500">Only this key can attest new versions of {d.name}.</dd>
              </div>
              <div>
                <dt className="text-neutral-400">Versions attested</dt>
                <dd>
                  {d.versionCount} · <span className="text-emerald-300">{d.verified} verified</span>
                  {d.pending > 0 ? <span className="text-amber-300"> · {d.pending} pending</span> : null}
                  {d.divergent > 0 ? <span className="text-red-300"> · {d.divergent} divergent</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-400">First attested</dt>
                <dd>{d.firstAttestedAt ? new Date(d.firstAttestedAt).toUTCString() : "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-400">Latest version</dt>
                <dd className="font-mono">{d.latestVersion}</dd>
              </div>
              {EXPLORER_URL && d.pinnedPublisher ? (
                <div>
                  <a href={`${EXPLORER_URL}/address/${d.pinnedPublisher}`} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                    Publisher on the explorer ↗
                  </a>
                </div>
              ) : null}
            </dl>
          </Card>
          <Card title="Status across versions">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={d.worstStatus} detail={d.worstStatus === "DIVERGENT" ? "at least one version" : undefined} />
            </div>
            <p className="mt-3 text-sm text-neutral-400">
              A divergent version means the registry served different bytes for it than were attested. Other versions are unaffected —
              each release is verified on its own.
            </p>
            <p className="mt-2 font-mono text-xs text-neutral-500">as of block {d.asOfBlock} · publisher {short(d.publisher)}</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

export default function PackageNameRoute() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <PackageNamePage />
    </Suspense>
  );
}
