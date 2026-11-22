"use client";
import { packageId as computePackageId } from "@cairn/core/identity";
import Link from "next/link";
import { useState } from "react";
import { IconArrowRight, IconCheck, IconClock, IconInfo, IconX } from "@/components/icons";
import { Card, CodeBlock, Digest, PageHeader, StatusBadge, Tip } from "@/components/ui";
import { chainStatus, readRecord, type ChainRecord } from "@/lib/chain";
import { INDEXER_URL, REGISTRY_ADDR, RPC_LABEL } from "@/lib/config";
import { short } from "@/lib/format";
import { packageHref } from "@/lib/links";
import type { Health, Hex } from "@/lib/types";

type Step = { label: string; state: "running" | "done" | "failed"; detail?: string };

export default function VerifyPage() {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<{ id: Hex; record: ChainRecord; name: string; version: string } | null>(null);
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
    const n = name.trim();
    const v = version.trim();
    try {
      push({ label: `packageId = keccak256("npm:${n}@${v}")`, state: "running" });
      const id = computePackageId("npm", n, v) as Hex;
      finish("done", id);

      push({ label: "Locate AttestationRegistry", state: "running" });
      let registry = REGISTRY_ADDR;
      if (!registry) {
        const h = (await (await fetch(`${INDEXER_URL}/api/v1/health`)).json()) as Health;
        registry = h.registry;
        finish("done", `${registry} (reported by the indexer)`);
      } else finish("done", registry);

      push({ label: "Read record, quorum and divergences from the chain", state: "running" });
      const record = await readRecord(registry, id);
      finish("done", `${RPC_LABEL} · block #${record.blockNumber}`);
      setResult({ id, record, name: n, version: v });
    } catch (err) {
      finish("failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const status = result ? chainStatus(result.record) : null;
  const r = result?.record;

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={<span>verify / single package</span>}
        title="Verify a package"
        sub={
          <>
            Check one exact version against the contract — computed and read in your browser.{" "}
            <Tip>This reads the attested state. Digesting the bytes you would actually install is what the CLI does.</Tip>
          </>
        }
      />

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
          className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_auto]"
        >
          <label className="space-y-1">
            <span className="label">Package name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="express or @scope/name" className="input w-full py-2.5 font-mono" required />
          </label>
          <label className="space-y-1">
            <span className="label">Exact version</span>
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="4.21.2" className="input w-full py-2.5 font-mono" required />
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={busy} className="btn-primary w-full py-2.5 md:w-auto">
              {busy ? "Checking…" : "Verify"}
            </button>
          </div>
        </form>
      </Card>

      {steps.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-8">
            {result && status && r ? (
              <section
                className={`rounded-lg border p-5 ${
                  status === "DIVERGENT" ? "border-bad/50 bg-bad-soft" : status === "VERIFIED" ? "border-ok/40 bg-ok-soft" : status === "PENDING" ? "border-warn/40 bg-warn-soft" : "border-line-strong bg-code"
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={status} size="lg" />
                  <span className="font-mono text-[15px] font-semibold break-all">
                    {result.name}@{result.version}
                  </span>
                </div>
                {status === "UNATTESTED" ? (
                  <p className="mt-3 text-[14px] text-ink-2">No attestation exists on-chain for this exact version. cairn verify warns about it by default, and blocks it with --fail-on unattested.</p>
                ) : (
                  <dl className="mt-4 grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-[max-content_1fr]">
                    <dt className="label pt-0.5">Artifact digest</dt>
                    <dd>
                      <Digest value={r.artifactDigest} full className="text-xs" />
                    </dd>
                    <dt className="label pt-0.5">Attesters</dt>
                    <dd>
                      {r.corroborations} of {r.attesterCount} confirmed · threshold {r.threshold}
                    </dd>
                    <dt className="label pt-0.5">Publisher</dt>
                    <dd className="font-mono text-xs break-all">{r.publisher}</dd>
                    <dt className="label pt-0.5">Divergences</dt>
                    <dd className={r.divergences.length ? "font-semibold text-bad-ink" : ""}>
                      {r.divergences.length === 0 ? "none recorded" : r.divergences.map((d) => `${short(d.attester)} observed ${short(d.observedDigest)}`).join(" · ")}
                    </dd>
                  </dl>
                )}
                {status !== "UNATTESTED" ? (
                  <Link href={packageHref(result.name, result.version)} className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
                    Full record and evidence <IconArrowRight size={13} />
                  </Link>
                ) : null}
              </section>
            ) : null}
            <CodeBlock title="byte-level check of a whole project" prompt code={"cairn verify --lockfile package-lock.json"} />
          </div>

          <Card title="Trace" className="lg:col-span-4">
            <ol className="space-y-3">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-[13px]">
                  <span className={`mt-0.5 shrink-0 ${s.state === "done" ? "text-ok" : s.state === "failed" ? "text-bad" : "text-warn"}`}>
                    {s.state === "done" ? <IconCheck size={14} strokeWidth={3} /> : s.state === "failed" ? <IconX size={14} strokeWidth={3} /> : <IconClock size={14} />}
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-xs break-all">{s.label}</p>
                    {s.detail ? <p className="mt-0.5 font-mono text-[11px] break-all text-muted">{s.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-line bg-white px-4 py-3 text-[13px] text-ink-2">
          <IconInfo size={16} className="mt-0.5 shrink-0 text-primary" />
          <p>
            Checking a whole project? Use the{" "}
            <Link href="/check" className="link">
              lockfile audit
            </Link>{" "}
            or browse{" "}
            <Link href="/packages" className="link">
              attested packages
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
