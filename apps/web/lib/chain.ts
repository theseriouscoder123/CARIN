"use client";
// Direct contract reads from the browser. The indexer is a cache; this is the authority.
import { attestationRegistryAbi, quorumPolicyAbi } from "@cairn/core/abi";
import { rpcTransport } from "@cairn/core/rpc";
import { createPublicClient, type Address, type Hex } from "viem";
import { RPC_URL } from "./config";

// One URL or a comma-separated failover list (NEXT_PUBLIC_RPC_URL).
// cacheTime 1s: the live view should not lag the chain by viem's default 4s block cache.
const client = createPublicClient({ transport: rpcTransport(RPC_URL, { retryCount: 1, timeout: 8000 }), cacheTime: 1000 });

export interface ChainRecord {
  exists: boolean;
  artifactDigest: Hex;
  tarballHash: Hex;
  payloadDigest: Hex;
  publisher: Address;
  submittedAt: bigint;
  corroborations: number;
  hasQuorum: boolean;
  threshold: number;
  attesterCount: number;
  divergences: { attester: Address; observedDigest: Hex; reportedAt: bigint }[];
  blockNumber: bigint;
}

/** Read one packageId's full state at a single block. */
export async function readRecord(registry: Address, packageId: Hex): Promise<ChainRecord> {
  let blockNumber: bigint;
  try {
    blockNumber = await client.getBlockNumber();
  } catch {
    throw new Error(`chain RPC unreachable at ${RPC_URL}`);
  }
  const at = { address: registry, abi: attestationRegistryAbi, blockNumber } as const;
  const policy = await client.readContract({ ...at, functionName: "quorumPolicy" });
  const p = { address: policy, abi: quorumPolicyAbi, blockNumber } as const;
  const [rec, hasQuorum, divergences, threshold, attesterCount] = await Promise.all([
    client.readContract({ ...at, functionName: "getAttestation", args: [packageId] }),
    client.readContract({ ...at, functionName: "hasQuorum", args: [packageId] }),
    client.readContract({ ...at, functionName: "getDivergences", args: [packageId] }),
    client.readContract({ ...p, functionName: "threshold" }),
    client.readContract({ ...p, functionName: "attesterCount" })
  ]);
  return {
    exists: rec.submittedAt !== 0n,
    artifactDigest: rec.artifactDigest,
    tarballHash: rec.tarballHash,
    payloadDigest: rec.payloadDigest,
    publisher: rec.publisher,
    submittedAt: rec.submittedAt,
    corroborations: rec.corroborations,
    hasQuorum,
    threshold,
    attesterCount,
    divergences: divergences.map((d) => ({ attester: d.attester, observedDigest: d.observedDigest, reportedAt: d.reportedAt })),
    blockNumber
  };
}

export type ChainStatus = "VERIFIED" | "PENDING" | "DIVERGENT" | "UNATTESTED";

export function chainStatus(r: ChainRecord): ChainStatus {
  if (!r.exists) return "UNATTESTED";
  if (r.divergences.length > 0) return "DIVERGENT";
  return r.hasQuorum ? "VERIFIED" : "PENDING";
}

/** Whether `attester` has corroborated `packageId` — read straight from the contract. */
export async function hasCorroborated(registry: Address, packageId: Hex, attester: Address): Promise<boolean> {
  return client.readContract({ address: registry, abi: attestationRegistryAbi, functionName: "hasCorroborated", args: [packageId, attester] });
}

/** Canonical Multicall3 address (deployed on Base Sepolia and most EVM chains). */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export interface StatusRecord {
  exists: boolean;
  hasQuorum: boolean;
  corroborations: number;
  divergences: number;
}

/**
 * Status for many packages at once, batched through Multicall3 (100 per request) where
 * deployed, falling back to individual reads on chains without it (a local Hardhat node).
 */
export async function readStatuses(registry: Address, ids: readonly Hex[], onProgress?: (done: number) => void): Promise<Map<Hex, StatusRecord>> {
  const out = new Map<Hex, StatusRecord>();
  const code = await client.getCode({ address: MULTICALL3 });
  const hasMulticall = code !== undefined && code !== "0x";
  const blockNumber = await client.getBlockNumber();
  const at = { address: registry, abi: attestationRegistryAbi } as const;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const calls = batch.flatMap((id) => [
      { ...at, functionName: "getAttestation", args: [id] } as const,
      { ...at, functionName: "hasQuorum", args: [id] } as const,
      { ...at, functionName: "getDivergences", args: [id] } as const
    ]);
    const results = hasMulticall
      ? await client.multicall({ contracts: calls, allowFailure: false, blockNumber, multicallAddress: MULTICALL3 })
      : await Promise.all(calls.map((c) => client.readContract({ ...c, blockNumber } as never)));
    batch.forEach((id, j) => {
      const rec = results[j * 3] as { submittedAt: bigint; corroborations: number };
      out.set(id, {
        exists: rec.submittedAt !== 0n,
        corroborations: rec.corroborations,
        hasQuorum: results[j * 3 + 1] as boolean,
        divergences: (results[j * 3 + 2] as readonly unknown[]).length
      });
    });
    onProgress?.(Math.min(i + batch.length, ids.length));
  }
  return out;
}
