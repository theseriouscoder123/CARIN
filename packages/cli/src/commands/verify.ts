import { readFile } from "node:fs/promises";
import {
  CairnError,
  computeTarballHash,
  digestArtifact,
  packageId as computePackageId,
  type OnChainRecord,
  type PayloadStore
} from "@cairn/core";
import type { Address, Hex } from "viem";
import type { ArtifactSource } from "../artifacts.js";
import { checkIntegrity } from "../artifacts.js";
import { diffTrees, type DeltaEntry } from "../delta.js";
import { parseLockfile, type LockedDependency } from "../lockfile.js";
import { UNSUPPRESSIBLE, allowEntryFor, type Policy, type Verdict } from "../policy.js";

/** Reads authoritative on-chain state. Never the indexer (CLAUDE.md invariant 4). */
export interface RecordReader {
  getRecord(packageId: Hex): Promise<OnChainRecord>;
  /** Optional batched read (Multicall3); used for the whole lockfile when present. */
  getRecords?(packageIds: readonly Hex[]): Promise<Map<Hex, OnChainRecord>>;
}

/** Digest results keyed by tarball SHA-256, so unchanged artifacts are not re-canonicalised. */
export interface DigestCache {
  get(tarballHash: Hex): Hex | undefined;
  set(tarballHash: Hex, artifactDigest: Hex): void;
}

/** Records prefetched for the whole lockfile, or the error that prevented it. */
type Prefetched = { records: Map<Hex, OnChainRecord> } | { error: string } | undefined;

export interface VerifyDeps {
  artifacts: ArtifactSource;
  /** Undefined when the chain could not be reached: every dependency becomes UNKNOWN. */
  chain: RecordReader | undefined;
  chainError?: string | undefined;
  payloads?: PayloadStore | undefined;
  digests?: DigestCache | undefined;
  readFile?: (path: string) => Promise<string>;
  onProgress?: (done: number, total: number) => void;
}

export interface VerifyOptions {
  lockfile: string;
  policy: Policy;
  only: string[];
  concurrency: number;
}

export interface DependencyResult {
  name: string;
  version: string;
  packageId: Hex | null;
  verdict: Verdict;
  /** Counts toward the exit code (false when allowlisted or below the fail threshold). */
  failing: boolean;
  warning: boolean;
  allowed?: { reason: string; expires: string } | undefined;
  attestedDigest?: Hex | undefined;
  observedDigest?: Hex | undefined;
  publisher?: Address | undefined;
  corroborations?: number | undefined;
  threshold?: number | undefined;
  attesterCount?: number | undefined;
  divergences: { attester: Address; observedDigest: Hex }[];
  delta?: DeltaEntry[] | undefined;
  integrityMatch?: boolean | undefined;
  reason?: string | undefined;
  resolved: string;
}

export interface VerifyReport {
  schema: "cairn.verify.v1";
  lockfile: string;
  checked: number;
  summary: Partial<Record<Verdict, number>>;
  policy: { source: string; failOn: Verdict[]; minCorroborations: number };
  notes: string[];
  results: DependencyResult[];
  exitCode: 0 | 1 | 2;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, tick: () => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
      tick();
    }
  });
  await Promise.all(workers);
  return out;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Classify one dependency (SPEC-CLI §3.1). The digest is always computed from the bytes
 * this machine received — never from the registry's integrity field or any cache of
 * someone else's answer.
 */
async function verifyOne(dep: LockedDependency, deps: VerifyDeps, policy: Policy, prefetched: Prefetched): Promise<Omit<DependencyResult, "failing" | "warning" | "allowed">> {
  const base = { name: dep.name, version: dep.version, resolved: dep.resolved, divergences: [] as DependencyResult["divergences"] };

  let id: Hex;
  try {
    id = computePackageId("npm", dep.name, dep.version);
  } catch (err) {
    return { ...base, packageId: null, verdict: "UNATTESTED", reason: message(err) };
  }
  if (!dep.registrySource) {
    return { ...base, packageId: id, verdict: "UNATTESTED", reason: `non-registry source (${dep.resolved.split(":")[0]})` };
  }
  if (deps.chain === undefined) {
    return { ...base, packageId: id, verdict: "UNKNOWN", reason: deps.chainError ?? "chain unreachable" };
  }

  // Read the chain and the artifact concurrently; both are needed for any verdict.
  const [recordRes, artifactRes] = await Promise.allSettled([
    prefetched === undefined
      ? deps.chain.getRecord(id)
      : "error" in prefetched
        ? Promise.reject(new Error(prefetched.error))
        : (prefetched.records.get(id) ?? deps.chain.getRecord(id)),
    deps.artifacts.fetch(dep.resolved, dep.integrity)
  ]);
  if (recordRes.status === "rejected") {
    return { ...base, packageId: id, verdict: "UNKNOWN", reason: `chain read failed: ${message(recordRes.reason)}` };
  }
  const record = recordRes.value;
  if (!record.exists) return { ...base, packageId: id, verdict: "UNATTESTED" };

  const attested = {
    attestedDigest: record.artifactDigest,
    publisher: record.publisher,
    corroborations: record.corroborations,
    threshold: record.threshold,
    attesterCount: record.attesterCount,
    divergences: record.divergences.map((d) => ({ attester: d.attester, observedDigest: d.observedDigest }))
  };
  if (artifactRes.status === "rejected") {
    return { ...base, ...attested, packageId: id, verdict: "UNKNOWN", reason: `artifact fetch failed: ${message(artifactRes.reason)}` };
  }

  const bytes = artifactRes.value.bytes;
  let observedDigest: Hex;
  let tree: ReturnType<typeof digestArtifact>["tree"] | undefined;
  try {
    const tarballHash = computeTarballHash(bytes);
    const cached = deps.digests?.get(tarballHash);
    if (cached) observedDigest = cached;
    else {
      const d = digestArtifact(bytes);
      observedDigest = d.artifactDigest;
      tree = d.tree;
      deps.digests?.set(tarballHash, observedDigest);
    }
  } catch (err) {
    return { ...base, ...attested, packageId: id, verdict: "UNKNOWN", reason: `artifact unreadable: ${message(err)}` };
  }
  const result = { ...base, ...attested, packageId: id, observedDigest, integrityMatch: checkIntegrity(bytes, dep.integrity) };

  if (observedDigest.toLowerCase() !== record.artifactDigest.toLowerCase()) {
    let delta: DeltaEntry[] | undefined;
    try {
      const payload = await deps.payloads?.get(record.payloadDigest);
      if (payload) delta = diffTrees(payload.entries, (tree ?? digestArtifact(bytes).tree).entries);
    } catch {
      delta = undefined; // a missing or tampered payload only costs us the delta
    }
    return { ...result, verdict: "DIVERGENT", delta };
  }
  if (record.divergences.length > 0) return { ...result, verdict: "CONTESTED" };
  const needed = Math.max(record.threshold, policy.minCorroborations);
  if (!record.hasQuorum || record.corroborations < needed) return { ...result, verdict: "UNDER_QUORUM" };
  return { ...result, verdict: "PASS" };
}

/** `cairn verify` (SPEC-CLI §3). Pure orchestration; rendering is separate. */
export async function runVerify(opts: VerifyOptions, deps: VerifyDeps): Promise<VerifyReport> {
  let text: string;
  try {
    text = await (deps.readFile ?? ((p: string) => readFile(p, "utf8")))(opts.lockfile);
  } catch (cause) {
    throw new CairnError("LOCKFILE", `cannot read lockfile ${opts.lockfile}`, { cause });
  }
  let all = parseLockfile(text);
  if (opts.only.length > 0) {
    const patterns = opts.only.map(globToRegex);
    all = all.filter((d) => patterns.some((p) => p.test(d.name)));
  }

  // One batched chain read for every registry dependency, at a single block.
  let prefetched: Prefetched;
  if (deps.chain?.getRecords) {
    const ids: Hex[] = [];
    for (const d of all) {
      if (!d.registrySource) continue;
      try {
        ids.push(computePackageId("npm", d.name, d.version));
      } catch {
        // invalid identities are reported per dependency
      }
    }
    try {
      prefetched = { records: await deps.chain.getRecords(ids) };
    } catch (err) {
      prefetched = { error: message(err) }; // fail closed: every dependency becomes UNKNOWN
    }
  }

  let done = 0;
  const raw = await pool(all, opts.concurrency, (d) => verifyOne(d, deps, opts.policy, prefetched), () => deps.onProgress?.(++done, all.length));

  const results: DependencyResult[] = raw.map((r) => {
    const allow = allowEntryFor(opts.policy, r.name, r.version);
    const allowed = allow !== undefined && !UNSUPPRESSIBLE.includes(r.verdict) && r.verdict !== "PASS";
    const inFail = opts.policy.failOn.includes(r.verdict);
    return {
      ...r,
      failing: inFail && !allowed,
      warning: !inFail && r.verdict !== "PASS" && !allowed,
      allowed: allowed ? { reason: allow.reason, expires: allow.expires } : undefined
    };
  });

  const summary: Partial<Record<Verdict, number>> = {};
  for (const r of results) summary[r.verdict] = (summary[r.verdict] ?? 0) + 1;

  const failing = results.filter((r) => r.failing);
  // A fired gate (1) outranks "the tool could not decide" (2); both are non-zero.
  const exitCode: 0 | 1 | 2 = failing.some((r) => r.verdict !== "UNKNOWN") ? 1 : failing.length > 0 ? 2 : 0;

  return {
    schema: "cairn.verify.v1",
    lockfile: opts.lockfile,
    checked: results.length,
    summary,
    policy: { source: opts.policy.source, failOn: opts.policy.failOn, minCorroborations: opts.policy.minCorroborations },
    notes: [...opts.policy.notes, ...(deps.chain === undefined && deps.chainError ? [deps.chainError] : [])],
    results,
    exitCode
  };
}
