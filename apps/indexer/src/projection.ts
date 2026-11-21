import type { Address, Hex } from "viem";
import type { AttestationDoc, IndexedEvent } from "./types.js";

/** Chain order: block, then log index. */
export function byChainOrder(a: IndexedEvent, b: IndexedEvent): number {
  return a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;
}

/**
 * Fold one package's events into its summary document. Every field comes from an
 * emitted event; the only rule applied here is the contract's own: a recorded divergence
 * means no quorum (AttestationRegistry._hasQuorum).
 */
export function projectAttestation(events: readonly IndexedEvent[]): AttestationDoc | undefined {
  const sorted = [...events].sort(byChainOrder);
  const submitted = sorted.find((e) => e.type === "AttestationSubmitted");
  if (submitted === undefined || submitted.packageId === undefined) return undefined;

  let corroborations = 0;
  let quorumFromEvents = false;
  let divergenceCount = 0;
  for (const e of sorted) {
    if (e.type === "AttesterCorroborated") {
      corroborations = Number(e.data.corroborations);
      quorumFromEvents = e.data.quorumReached === true;
    } else if (e.type === "DivergenceReported") {
      divergenceCount++;
    }
  }
  const quorumReached = quorumFromEvents && divergenceCount === 0;
  const last = sorted[sorted.length - 1] ?? submitted;
  const d = submitted.data;
  return {
    _id: submitted.packageId,
    ecosystem: String(d.ecosystem),
    name: String(d.name),
    version: String(d.version),
    artifactDigest: d.artifactDigest as Hex,
    tarballHash: d.tarballHash as Hex,
    payloadDigest: d.payloadDigest as Hex,
    publisher: submitted.actor as Address,
    submittedAt: submitted.timestamp,
    blockNumber: submitted.blockNumber,
    txHash: submitted.txHash,
    corroborations,
    quorumReached,
    divergenceCount,
    status: divergenceCount > 0 ? "DIVERGENT" : quorumReached ? "VERIFIED" : "PENDING",
    lastActivityBlock: last.blockNumber
  };
}

/** Current attester set and threshold, folded from QuorumPolicy events. */
export function projectPolicy(events: readonly IndexedEvent[]): { attesters: Address[]; threshold: number } {
  const set = new Map<string, Address>();
  let threshold = 0;
  for (const e of [...events].sort(byChainOrder)) {
    if (e.type === "AttesterAdded" && e.actor) set.set(e.actor.toLowerCase(), e.actor);
    if (e.type === "AttesterRemoved" && e.actor) set.delete(e.actor.toLowerCase());
    if (e.type === "ThresholdChanged") threshold = Number(e.data.newThreshold);
  }
  return { attesters: [...set.values()], threshold };
}
