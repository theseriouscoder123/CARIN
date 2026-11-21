"use client";
import { packageId as computePackageId } from "@cairn/core/identity";
import { parseLockfile, type LockedDependency } from "@cairn/core/lockfile";
import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconArrowRight, IconCheck, IconDownload, IconFile, IconInfo, IconSearch, IconShield, IconTerminal, IconUpload, IconX } from "@/components/icons";
import { Card, CodeBlock, ErrorBox, PageHeader, StatusBadge, Tabs, Tip } from "@/components/ui";
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
interface Scan {
  source: string;
  rows: Row[];
  ms: number;
  registry: Hex;
}

const MAX_BYTES = 20 * 1024 * 1024;
const PAGE = 25;
const ORDER: CheckStatus[] = ["VERIFIED", "PENDING", "UNATTESTED", "DIVERGENT"];

/**
 * Audit a whole lockfile against the public log — parsed in this browser by the same
 * @cairn/core parser the CLI uses, never uploaded; status read from the chain in batches.
 */
export default function CheckPage() {
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [scan, setScan] = useState<Scan>();
  const [filter, setFilter] = useState("");
  const [only, setOnly] = useState<CheckStatus | "ALL">("ALL");
  const [page, setPage] = useState(0);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function check(input: string, source: string) {
    setBusy(true);
    setError(undefined);
    setScan(undefined);
    setPage(0);
    setOnly("ALL");
    const t0 = performance.now();
    try {
      if (input.length > MAX_BYTES) throw new Error("lockfile is larger than 20 MB");
      setProgress("Parsing lockfile…");
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
      setProgress(`Reading ${ids.size} records from the chain…`);
      const statuses = await readStatuses(registry, [...ids.values()], (done) => setProgress(`Read ${done} of ${ids.size} from the chain…`));
      for (const d of deps) {
        const id = ids.get(`${d.name}@${d.version}`);
        if (!id) continue;
        const s = statuses.get(id);
        const status: CheckStatus = !s?.exists ? "UNATTESTED" : s.divergences > 0 ? "DIVERGENT" : s.hasQuorum ? "VERIFIED" : "PENDING";
        out.push({ name: d.name, version: d.version, status, corroborations: s?.corroborations ?? 0 });
      }
      const rank: Record<CheckStatus, number> = { DIVERGENT: 0, PENDING: 1, VERIFIED: 2, UNATTESTED: 3 };
      out.sort((a, b) => rank[a.status] - rank[b.status] || (a.name < b.name ? -1 : 1));
      setScan({ source, rows: out, ms: Math.round(performance.now() - t0), registry });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  async function loadExample() {
    const body = await (await fetch("/examples/real-world-package-lock.json")).text();
    setText(body);
    await check(body, "example: express + webpack + eslint + jest");
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const body = await file.text();
    setText(body);
    await check(body, file.name);
  }

  const rows = scan?.rows;
  const counts = useMemo(() => {
    const c: Record<CheckStatus, number> = { VERIFIED: 0, PENDING: 0, DIVERGENT: 0, UNATTESTED: 0 };
    for (const r of rows ?? []) c[r.status]++;
    return c;
  }, [rows]);
  const total = rows?.length ?? 0;
  const attested = counts.VERIFIED + counts.PENDING + counts.DIVERGENT;
  const pct = total === 0 ? 0 : Math.round((attested / total) * 1000) / 10;
  const visible = (rows ?? []).filter((r) => (only === "ALL" || r.status === only) && r.name.toLowerCase().includes(filter.toLowerCase()));
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const pageRows = visible.slice(page * PAGE, page * PAGE + PAGE);

  function exportReport() {
    if (!scan) return;
    const report = {
      generatedAt: new Date().toISOString(),
      source: scan.source,
      registry: scan.registry,
      rpc: RPC_LABEL,
      summary: { total, attested, coveragePercent: pct, ...counts },
      dependencies: scan.rows
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "cairn-lockfile-audit.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader crumbs={<span>audit / lockfile</span>} title="Lockfile audit" sub="See how much of a project CAIRN protects — every dependency checked against on-chain attestations." />

      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary-soft px-4 py-3 text-[13px] text-ink-2">
        <IconInfo size={16} className="mt-0.5 shrink-0 text-primary" />
        <p>
          Your lockfile is parsed in this browser and never uploaded; status is read directly from the contract. For byte-level verification of what
          you actually install, run <span className="rounded bg-white px-1 font-mono text-xs">cairn verify</span>.
        </p>
      </div>

      <Card flush>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-2">
          <Tabs
            active={mode}
            onChange={setMode}
            tabs={[
              { key: "upload", label: "Upload file" },
              { key: "paste", label: "Paste JSON" }
            ]}
          />
          <span className="hidden items-center gap-1.5 font-mono text-[11px] text-muted sm:flex">
            <IconShield size={12} /> client-side · read via RPC
          </span>
        </div>
        <div className="p-5">
          {mode === "upload" ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void onFile(e.dataTransfer.files[0]);
              }}
              className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${drag ? "border-primary bg-primary-soft" : "border-line-strong bg-code/40"}`}
            >
              <span className="rounded-lg border border-primary/20 bg-primary-soft p-3 text-primary">
                <IconUpload size={24} />
              </span>
              <p className="text-[15px] font-semibold">
                Drag and drop your lockfile here or{" "}
                <button type="button" onClick={() => fileInput.current?.click()} className="text-primary underline underline-offset-2">
                  browse
                </button>
              </p>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <span className="rounded border border-line bg-white px-1.5 py-0.5 font-mono">package-lock.json</span>
                npm 7+ · lockfile v2 / v3
              </p>
              <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            </div>
          ) : (
            <div className="space-y-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the contents of package-lock.json"
                rows={8}
                spellCheck={false}
                className="input w-full font-mono text-xs"
              />
              <button type="button" disabled={busy || text.trim() === ""} onClick={() => void check(text, "pasted lockfile")} className="btn-primary">
                {busy ? "Checking…" : "Run audit"}
              </button>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy} onClick={() => void loadExample()} className="btn-outline">
              <IconFile size={14} /> Try a real project
            </button>
            <span className="text-xs text-muted">437 dependencies: express, webpack, eslint, jest</span>
            {progress ? (
              <span className="ml-auto flex items-center gap-2 font-mono text-xs text-warn-ink">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-warn border-t-transparent" />
                {progress}
              </span>
            ) : null}
          </div>
        </div>
        {scan ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-primary-soft/60 px-5 py-2.5 text-xs">
            <span className="flex items-center gap-1.5 font-mono font-semibold text-ink">
              <IconCheck size={14} className="text-ok" /> {scan.source}
            </span>
            <span className="text-muted">
              {total} packages · {(scan.ms / 1000).toFixed(1)}s
            </span>
            <button type="button" onClick={() => void check(text, scan.source)} disabled={busy} className="ml-auto font-semibold text-primary hover:underline">
              Re-scan
            </button>
          </div>
        ) : null}
      </Card>

      {error ? <ErrorBox what="this lockfile" error={error} hint="npm lockfiles v2/v3 are supported (npm 7+). Regenerate v1 lockfiles with npm install --package-lock-only." /> : null}

      {rows ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center justify-between rounded-lg border border-line bg-card px-5 py-4">
              <div>
                <p className="label">Coverage</p>
                <p className="mt-1 text-3xl font-bold tabular-nums">{pct}%</p>
                <p className="font-mono text-xs text-muted">
                  {attested} of {total} attested
                </p>
              </div>
              <svg viewBox="0 0 120 120" className="h-20 w-20" role="img" aria-label={`${pct}% attested`}>
                <circle cx="60" cy="60" r="48" fill="none" stroke="#e1e7ec" strokeWidth="12" />
                <circle
                  cx="60"
                  cy="60"
                  r="48"
                  fill="none"
                  stroke={counts.DIVERGENT > 0 ? "#cf3838" : "#0f9d58"}
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${(pct / 100) * 301.6} 301.6`}
                  transform="rotate(-90 60 60)"
                />
                <text x="60" y="66" textAnchor="middle" fontSize="18" fontWeight="600" fill="#404751" fontFamily="var(--font-jetbrains)">
                  {attested}/{total}
                </text>
              </svg>
            </div>
            <SummaryCard
              label="Quorum verified"
              icon={<IconCheck size={22} strokeWidth={3} />}
              value={counts.VERIFIED}
              word="Verified"
              tone="text-ok-ink"
              sub={counts.PENDING > 0 ? `+${counts.PENDING} awaiting quorum` : "independently confirmed"}
              active={only === "VERIFIED"}
              onClick={() => setOnly(only === "VERIFIED" ? "ALL" : "VERIFIED")}
            />
            <SummaryCard
              label="Unattested"
              icon={<span className="text-2xl font-bold">?</span>}
              value={counts.UNATTESTED}
              word="Unattested"
              tone="text-muted"
              sub="no record on-chain"
              active={only === "UNATTESTED"}
              onClick={() => setOnly(only === "UNATTESTED" ? "ALL" : "UNATTESTED")}
            />
            <SummaryCard
              label="Integrity breaches"
              icon={<IconX size={22} strokeWidth={3} />}
              value={counts.DIVERGENT}
              word="Divergent"
              tone={counts.DIVERGENT > 0 ? "text-bad" : "text-ink"}
              sub={counts.DIVERGENT > 0 ? "cairn verify would block this build" : "no tampered artifacts"}
              active={only === "DIVERGENT"}
              onClick={() => setOnly(only === "DIVERGENT" ? "ALL" : "DIVERGENT")}
              alert={counts.DIVERGENT > 0}
            />
          </div>

          <Card flush>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
              <div className="relative min-w-56 flex-1">
                <IconSearch size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                <input
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Search dependencies"
                  className="input w-full py-1.5 pl-8"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["ALL", ...ORDER] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setOnly(s);
                      setPage(0);
                    }}
                    className={`rounded border px-2.5 py-1 text-xs ${only === s ? "border-nav bg-nav font-semibold text-white" : "border-line-strong bg-white text-ink-2 hover:bg-code"}`}
                  >
                    {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()} ({s === "ALL" ? total : counts[s]})
                  </button>
                ))}
              </div>
              <button type="button" onClick={exportReport} className="btn-outline py-1.5 text-xs">
                <IconDownload size={13} /> Export report (JSON)
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-line bg-code/60">
                  <tr>
                    <th className="th">Package</th>
                    <th className="th">Version</th>
                    <th className="th">On-chain status</th>
                    <th className="th">
                      <span className="inline-flex items-center gap-1">
                        Attesters <Tip>Independent attesters that re-downloaded this exact version and confirmed its digest.</Tip>
                      </span>
                    </th>
                    <th className="th text-right">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pageRows.map((r) => (
                    <tr key={`${r.name}@${r.version}`} className={r.status === "DIVERGENT" ? "bg-bad-soft/50" : "hover:bg-hover"}>
                      <td className="td">
                        <span className={`font-mono font-semibold ${r.status === "UNATTESTED" ? "text-ink" : "text-primary"}`}>{r.name}</span>
                        {r.note ? <span className="ml-2 text-[11px] text-muted">{r.note}</span> : null}
                      </td>
                      <td className="td font-mono text-xs text-ink-2">{r.version}</td>
                      <td className="td">
                        <StatusBadge status={r.status} size="sm" />
                      </td>
                      <td className="td font-mono text-xs text-muted">{r.status === "UNATTESTED" ? "—" : `${r.corroborations} confirmed`}</td>
                      <td className="td text-right">
                        {r.status === "UNATTESTED" ? (
                          <span className="text-xs text-muted">—</span>
                        ) : (
                          <Link href={packageHref(r.name, r.version)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                            View <IconArrowRight size={12} />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-2.5 font-mono text-xs text-muted">
              <span>
                {visible.length === 0 ? "No matches" : `${page * PAGE + 1}–${Math.min(visible.length, (page + 1) * PAGE)} of ${visible.length}`}
              </span>
              <span className="flex items-center gap-3">
                Page {page + 1} of {pages}
                <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-line-strong px-2 py-0.5 disabled:opacity-40" aria-label="Previous page">
                  ‹
                </button>
                <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded border border-line-strong px-2 py-0.5 disabled:opacity-40" aria-label="Next page">
                  ›
                </button>
              </span>
            </div>
          </Card>
        </>
      ) : null}

      <Card title="Enforce in CI/CD" icon={<IconTerminal size={16} />} right={<span className="flex items-center gap-1.5 text-xs text-muted"><span className="h-1.5 w-1.5 rounded-full bg-ok" /> No npm credentials required</span>}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <CodeBlock title="local · pre-commit" prompt code={"cairn verify --lockfile package-lock.json"} />
            <p className="mt-2 text-xs text-muted">Exits non-zero if any dependency is divergent or under quorum — byte-level, against what your machine downloads.</p>
          </div>
          <div>
            <CodeBlock title=".github/workflows/ci.yml" code={"- uses: theseriouscoder123/CARIN@v1\n  with:\n    lockfile: package-lock.json\n    fail-on: under-quorum"} />
            <Link href="/docs#ci" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              Action docs <IconArrowRight size={12} />
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  icon,
  value,
  word,
  tone,
  sub,
  active,
  onClick,
  alert = false
}: {
  label: string;
  icon: ReactNode;
  value: number;
  word: string;
  tone: string;
  sub: string;
  active: boolean;
  onClick: () => void;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border bg-card px-5 py-4 text-left transition-colors hover:border-line-strong ${active ? "border-primary ring-1 ring-primary" : alert ? "border-bad/50" : "border-line"}`}
    >
      <p className="label flex items-center justify-between">
        {label}
        {alert ? <IconAlert size={14} className="text-bad" /> : null}
      </p>
      <p className={`mt-1 flex items-center gap-2 ${tone}`}>
        {icon}
        <span className="text-3xl font-bold tabular-nums">{value}</span>
        <span className="text-[15px] font-semibold">{word}</span>
      </p>
      <p className="mt-0.5 font-mono text-xs text-muted">{sub}</p>
    </button>
  );
}
