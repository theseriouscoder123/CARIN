import type { Address, Hex } from "viem";

export const EVENT_TYPES = [
  "AttestationSubmitted",
  "AttesterCorroborated",
  "DivergenceReported",
  "PackageNameClaimed",
  "AttesterAdded",
  "AttesterRemoved",
  "ThresholdChanged"
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** One chain log, exactly as emitted. bigints are stored as decimal strings. */
export interface IndexedEvent {
  /** `${txHash}:${logIndex}` — the idempotency key. */
  id: string;
  type: EventType;
  packageId?: Hex | undefined;
  actor?: Address | undefined;
  data: Record<string, string | number | boolean>;
  blockNumber: number;
  blockHash: Hex;
  txHash: Hex;
  logIndex: number;
  /** Block timestamp (ISO). */
  timestamp: string;
}

export type PackageStatus = "VERIFIED" | "PENDING" | "DIVERGENT";

/** The `attestations` document: a pure fold over a package's events. */
export interface AttestationDoc {
  _id: Hex;
  ecosystem: string;
  name: string;
  version: string;
  artifactDigest: Hex;
  tarballHash: Hex;
  payloadDigest: Hex;
  publisher: Address;
  submittedAt: string;
  blockNumber: number;
  txHash: Hex;
  corroborations: number;
  quorumReached: boolean;
  divergenceCount: number;
  status: PackageStatus;
  /** Ordering key of the newest event touching this package, for "recent" sorts. */
  lastActivityBlock: number;
}

export interface IndexMeta {
  chainId: number;
  registry: Address;
  lastIndexedBlock: number;
  lastIndexedHash: Hex | null;
}

export interface ListQuery {
  q?: string | undefined;
  status?: PackageStatus | undefined;
  limit: number;
  /** Opaque cursor: `${blockNumber}` of the last item of the previous page. */
  cursor?: number | undefined;
}
