"use client";
// Direct contract reads from the browser. The indexer is a cache; this is the authority.
import { attestationRegistryAbi, quorumPolicyAbi } from "@cairn/core/abi";
import { rpcTransport } from "@cairn/core/rpc";
import { createPublicClient, type Address, type Hex } from "viem";
import { RPC_URL } from "./config";

// One URL or a comma-separated failover list (NEXT_PUBLIC_RPC_URL).
const client = createPublicClient({ transport: rpcTransport(RPC_URL, { retryCount: 1, timeout: 8000 }) });

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
