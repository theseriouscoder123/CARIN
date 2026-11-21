"use client";
import { packageId as computePackageId } from "@cairn/core/identity";
import Link from "next/link";
import { useState } from "react";
import { Card, Digest, StatusBadge } from "@/components/ui";
import { chainStatus, readRecord, type ChainRecord } from "@/lib/chain";
import { INDEXER_URL, REGISTRY_ADDR, RPC_LABEL } from "@/lib/config";
import { short } from "@/lib/format";
import type { Health, Hex } from "@/lib/types";

type Step = { label: string; state: "running" | "done" | "failed"; detail?: string };

export default function VerifyPage() {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<{ id: Hex; record: ChainRecord } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setResult(null);
    const log: Step[] = [];
    const push = (s: Step) => {
      log.push(s);
      setSteps([...log]);
    };
    const finish = (state: Step["state"], detail?: string) => {
      const last = log[log.length - 1];
      if (last) Object.assign(last, { state, detail });
      setSteps([...log]);
    };
    try {
      push({ label: `computing packageId = keccak256("npm:${name}@${version}") in your browser`, state: "running" });
      const id = computePackageId("npm", name.trim(), version.trim()) as Hex;
      finish("done", id);

      push({ label: "locating the AttestationRegistry contract", state: "running" });
      let registry = REGISTRY_ADDR;
      if (!registry) {
        const h = (await (await fetch(`${INDEXER_URL}/api/v1/health`)).json()) as Health;
        registry = h.registry;
        finish("done", `${registry} (reported by the indexer — set NEXT_PUBLIC_REGISTRY_ADDR to pin it)`);
      } else finish("done", `${registry} (configured)`);

      push({ label: `reading the record, quorum and divergences straight from the chain at ${RPC_LABEL}`, state: "running" });
      const record = await readRecord(registry, id);
      finish("done", `read at block ${record.blockNumber}`);
      setResult({ id, record });
    } catch (err) {
      finish("failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const status = result ? chainStatus(result.record) : null;

  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-bold">Verify a package</h1>
      <p className="max-w-3xl text-lg text-neutral-400">
        Enter a package and exact version. This page computes its identity and reads the attestation record directly from the contract in your
        browser — no CAIRN server is asked for the verdict.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="flex flex-wrap gap-3"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="package name, e.g. left-pad or @cairn-demo/greeting"
          className="min-w-80 flex-[2] rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-lg outline-none focus:border-sky-500"
          required
        />
        <input
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="exact version, e.g. 1.3.0"
          className="min-w-48 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-lg outline-none focus:border-sky-500"
          required
        />
        <button type="submit" disabled={busy} className="rounded-lg bg-sky-500 px-6 py-3 text-lg font-semibold text-neutral-950 hover:bg-sky-400 disabled:opacity-50">
          {busy ? "Checking…" : "Check"}
        </button>
      </form>

      {steps.length > 0 ? (
        <Card title="What just happened">
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="text-lg">
                <span className={s.state === "done" ? "text-emerald-300" : s.state === "failed" ? "text-red-300" : "text-amber-300"}>
                  {s.state === "done" ? "✓" : s.state === "failed" ? "✗" : "…"}
                </span>{" "}
                {s.label}
                {s.detail ? <p className="ml-6 font-mono text-sm break-all text-neutral-400">{s.detail}</p> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {result && status ? (
        <Card className={status === "DIVERGENT" ? "border-2 border-red-500 bg-red-950/40" : ""}>
          <div className="space-y-4">
            <StatusBadge status={status} size="lg" />
            {status === "UNATTESTED" ? (
              <p className="text-lg text-neutral-300">No attestation exists on-chain for this exact version.</p>
            ) : (
              <dl className="grid gap-x-8 gap-y-2 text-lg md:grid-cols-[max-content_1fr]">
                <dt className="text-neutral-400">attested artifactDigest</dt>
                <dd>
                  <Digest value={result.record.artifactDigest} full />
                </dd>
                <dt className="text-neutral-400">corroborations</dt>
                <dd>
                  {result.record.corroborations} of {result.record.attesterCount} attesters (threshold {result.record.threshold})
                </dd>
                <dt className="text-neutral-400">publisher</dt>
                <dd className="font-mono">{result.record.publisher}</dd>
                <dt className="text-neutral-400">divergences</dt>
                <dd className={result.record.divergences.length ? "text-red-300" : ""}>
                  {result.record.divergences.length === 0
                    ? "none recorded"
                    : result.record.divergences.map((d) => `${short(d.attester)} saw ${short(d.observedDigest)}`).join(" · ")}
                </dd>
              </dl>
            )}
            {status !== "UNATTESTED" ? (
              <Link href={`/packages/${result.id}`} className="inline-block text-sky-300 hover:underline">
                full record and timeline →
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card title="What this page does — and does not — check">
        <p className="text-lg text-neutral-300">
          It reads the <em>attested</em> state: whether this version was attested, by whom, how many independent attesters confirmed it, and whether
          any reported divergence. It does <strong>not</strong> download the tarball and digest it in your browser.
        </p>
        <p className="mt-3 text-lg text-neutral-300">
          Byte-level verification — digesting exactly the bytes your machine would install and comparing them to the record — is what the CLI does:
        </p>
        <pre className="mt-3 rounded-md bg-neutral-950 p-4 font-mono text-base text-neutral-200">npx cairn verify --lockfile package-lock.json</pre>
      </Card>
    </div>
  );
}
