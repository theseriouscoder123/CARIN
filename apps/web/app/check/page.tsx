"use client";
import { packageId as computePackageId } from "@cairn/core/identity";
import { parseLockfile, type LockedDependency } from "@cairn/core/lockfile";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, ErrorBox, StatusBadge } from "@/components/ui";
import { readStatuses } from "@/lib/chain";
import { INDEXER_URL, REGISTRY_ADDR, RPC_LABEL } from "@/lib/config";
import { packageHref } from "@/lib/links";
import type { Health, Hex } from "@/lib/types";

type CheckStatus = "VERIFIED" | "PENDING" | "DIVERGENT" | "UNATTESTED";
interface Row {
  name: string;
  version: string;
  status: CheckStatus;
  corroborations: number;
  note?: string;
}

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Check a whole lockfile against the public log — parsed in this browser by the same
 * @cairn/core parser the CLI uses, never uploaded; status read from the chain in batches.
 */
export default function CheckPage() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [rows, setRows] = useState<Row[]>();
  const [filter, setFilter] = useState("");
  const [only, setOnly] = useState<CheckStatus | "ALL">("ALL");

  async function check(input: string) {
    setBusy(true);
    setError(undefined);
    setRows(undefined);
    try {
      if (input.length > MAX_BYTES) throw new Error("lockfile is larger than 20 MB");
      setProgress("parsing the lockfile in your browser…");
      const deps: LockedDependency[] = parseLockfile(input);
      const ids = new Map<string, Hex>();
      const out: Row[] = [];
      for (const d of deps) {
        if (!d.registrySource) {
          out.push({ name: d.name, version: d.version, status: "UNATTESTED", corroborations: 0, note: "non-registry source" });
          continue;
        }
        try {
          ids.set(`${d.name}@${d.version}`, computePackageId("npm", d.name, d.version) as Hex);
        } catch {
          out.push({ name: d.name, version: d.version, status: "UNATTESTED", corroborations: 0, note: "not a valid npm identity" });
        }
      }
      let registry = REGISTRY_ADDR;
      if (!registry) registry = ((await (await fetch(`${INDEXER_URL}/api/v1/health`)).json()) as Health).registry;
      setProgress(`reading on-chain status for ${ids.size} packages via ${RPC_LABEL}…`);
      const statuses = await readStatuses(registry, [...ids.values()], (done) => setProgress(`read ${done} of ${ids.size} from the chain…`));
      for (const d of deps) {
        const id = ids.get(`${d.name}@${d.version}`);
        if (!id) continue;
        const s = statuses.get(id);
        const status: CheckStatus = !s?.exists ? "UNATTESTED" : s.divergences > 0 ? "DIVERGENT" : s.hasQuorum ? "VERIFIED" : "PENDING";
        out.push({ name: d.name, version: d.version, status, corroborations: s?.corroborations ?? 0 });
      }
      const rank: Record<CheckStatus, number> = { DIVERGENT: 0, PENDING: 1, VERIFIED: 2, UNATTESTED: 3 };
      out.sort((a, b) => rank[a.status] - rank[b.status] || (a.name < b.name ? -1 : 1));
      setRows(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  async function loadExample() {
    const res = await fetch("/examples/real-world-package-lock.json");
    const body = await res.text();
    setText(body);
    await check(body);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const body = await file.text();
    setText(body);
    await check(body);
  }

  const counts = useMemo(() => {
    const c: Record<CheckStatus, number> = { VERIFIED: 0, PENDING: 0, DIVERGENT: 0, UNATTESTED: 0 };
    for (const r of rows ?? []) c[r.status]++;
    return c;
  }, [rows]);
  const total = rows?.length ?? 0;
  const attested = counts.VERIFIED + counts.PENDING + counts.DIVERGENT;
  const pct = total === 0 ? 0 : Math.round((attested / total) * 1000) / 10;
  const visible = (rows ?? []).filter((r) => (only === "ALL" || r.status === only) && r.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold">Check a lockfile</h1>
        <p className="mt-2 max-w-3xl text-lg text-neutral-400">
          See how much of a project CAIRN protects. Your <span className="font-mono">package-lock.json</span> is parsed in this browser and
          never uploaded; every package&apos;s status is read straight from the contract.
        </p>
      </div>

      <Card>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer.files[0]);
          }}
          className="space-y-3"
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Drop a package-lock.json here, or paste its contents"
            rows={6}
            spellCheck={false}
            className="w-full rounded-lg border border-dashed border-neutral-600 bg-neutral-950 p-4 font-mono text-sm outline-none focus:border-sky-500"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || text.trim() === ""}
              onClick={() => void check(text)}
              className="rounded-lg bg-sky-500 px-6 py-3 text-lg font-semibold text-neutral-950 hover:bg-sky-400 disabled:opacity-50"
            >
              {busy ? "Checking…" : "Check"}
            </button>
            <label className="cursor-pointer rounded-lg px-4 py-3 ring-1 ring-neutral-700 hover:ring-neutral-500">
              Choose file
              <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            <button type="button" disabled={busy} onClick={() => void loadExample()} className="text-sky-300 hover:underline disabled:opacity-50">
              Try a real project (express + webpack + eslint + jest)
            </button>
            {progress ? <span className="text-sm text-amber-300">{progress}</span> : null}
          </div>
        </div>
      </Card>

      {error ? <ErrorBox what="this lockfile" error={error} hint="npm lockfiles v2/v3 are supported (npm 7+). Regenerate v1 lockfiles with npm install --package-lock-only." /> : null}

      {rows ? (
        <>
          <div className="grid gap-4 md:grid-cols-[260px_1fr]">
            <Card>
              <div className="flex flex-col items-center gap-2">
                <svg viewBox="0 0 120 120" className="h-40 w-40" role="img" aria-label={`${pct}% of dependencies attested`}>
                  <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth="12" className="text-neutral-800" />
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${(pct / 100) * 314.16} 314.16`}
                    transform="rotate(-90 60 60)"
                    className={counts.DIVERGENT > 0 ? "text-red-400" : "text-emerald-400"}
                  />
                  <text x="60" y="66" textAnchor="middle" className="fill-current text-neutral-100" fontSize="22" fontWeight="700">
                    {pct}%
                  </text>
                </svg>
                <p className="text-center text-lg">
                  <b>{attested}</b> of <b>{total}</b> dependencies attested
                </p>
              </div>
            </Card>
            <Card>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {(["VERIFIED", "PENDING", "DIVERGENT", "UNATTESTED"] as CheckStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setOnly(only === s ? "ALL" : s)}
                    className={`rounded-xl border p-4 text-left ${only === s ? "border-sky-500" : "border-neutral-800"}`}
                  >
                    <p className="text-sm uppercase tracking-wide text-neutral-400">{s.toLowerCase()}</p>
                    <p className="mt-1 text-4xl font-semibold tabular-nums">{counts[s]}</p>
                  </button>
                ))}
              </div>
              {counts.DIVERGENT > 0 ? (
                <p className="mt-4 rounded-md bg-red-950/50 p-3 text-red-100">
                  ✗ {counts.DIVERGENT} dependenc{counts.DIVERGENT === 1 ? "y has" : "ies have"} on-chain divergence reports — a CI run of
                  <span className="font-mono"> cairn verify</span> would block this build.
                </p>
              ) : null}
            </Card>
          </div>

          <Card
            title="Dependencies"
            right={
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="filter by name"
                className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
            }
          >
            <div className="max-h-[32rem] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-neutral-900 text-sm uppercase tracking-wide text-neutral-400">
                  <tr>
                    <th className="py-2 pr-4">Package</th>
                    <th className="py-2 pr-4">Version</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2">Corroborations</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, 500).map((r) => (
                    <tr key={`${r.name}@${r.version}`} className="border-t border-neutral-800">
                      <td className="py-2 pr-4">
                        {r.status === "UNATTESTED" ? (
                          r.name
                        ) : (
                          <Link href={packageHref(r.name, r.version)} className="hover:underline">
                            {r.name}
                          </Link>
                        )}
                        {r.note ? <span className="ml-2 text-xs text-neutral-500">{r.note}</span> : null}
                      </td>
                      <td className="py-2 pr-4 font-mono text-sm">{r.version}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="py-2 tabular-nums">{r.status === "UNATTESTED" ? "—" : r.corroborations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length > 500 ? <p className="mt-2 text-sm text-neutral-400">showing 500 of {visible.length} — narrow the filter</p> : null}
            </div>
          </Card>
        </>
      ) : null}

      <Card title="What this page checks — and what it does not">
        <p className="text-lg text-neutral-300">
          It reads <b>attestation status</b> from the chain: whether each exact version was attested, whether independent attesters reached
          quorum, and whether any reported a divergence. It does <b>not</b> download your dependencies and digest them.
        </p>
        <p className="mt-3 text-lg text-neutral-300">For byte-level verification of the files your machine actually installs, run the CLI:</p>
        <pre className="mt-3 rounded-md bg-neutral-950 p-4 font-mono text-base text-neutral-200">cairn verify --lockfile package-lock.json</pre>
        <Link href="/docs" className="mt-2 inline-block text-sky-300 hover:underline">
          Install the CLI →
        </Link>
      </Card>
    </div>
  );
}
