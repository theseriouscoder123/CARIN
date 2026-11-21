export type Status = "VERIFIED" | "PENDING" | "DIVERGENT";
export type Hex = `0x${string}`;

export interface Health {
  ok: boolean;
  headBlock: number;
  lastIndexedBlock: number;
  lag: number;
  store: string;
  chainId: number;
  registry: Hex;
  asOfBlock: number;
}

export interface Stats {
  totalAttestations: number;
  quorumReached: number;
  pending: number;
  divergent: number;
  activeAttesters: number;
  threshold: number;
  headBlock: number;
  indexerLag: number;
  asOfBlock: number;
}

export interface Attestation {
  _id: Hex;
  ecosystem: string;
  name: string;
  version: string;
  artifactDigest: Hex;
  tarballHash: Hex;
  payloadDigest: Hex;
  publisher: Hex;
  submittedAt: string;
  blockNumber: number;
  txHash: Hex;
  corroborations: number;
  quorumReached: boolean;
  divergenceCount: number;
  status: Status;
  lastActivityBlock: number;
}

export interface PackageDetail extends Attestation {
  divergences: { attester: Hex; observedDigest: Hex; expectedDigest: Hex; blockNumber: number; txHash: Hex; timestamp: string }[];
  corroborators: Hex[];
  asOfBlock: number;
}

export interface TimelineEvent {
  id: string;
  type: "AttestationSubmitted" | "AttesterCorroborated" | "DivergenceReported" | "PackageNameClaimed";
  packageId?: Hex;
  actor?: Hex;
  data: Record<string, string | number | boolean>;
  blockNumber: number;
  txHash: Hex;
  timestamp: string;
}

export interface AttesterView {
  address: Hex;
  label: string | null;
  active: boolean;
  online: boolean;
  corroborationCount: number;
  divergenceCount: number;
  lastSeenAt: string | null;
  health: {
    label: string;
    lastProcessedBlock: number;
    processedCount: number;
    divergencesReported: number;
    registryReachable: boolean;
    chainReachable: boolean;
    uptimeSeconds: number;
  } | null;
}

export interface AttestersResponse {
  threshold: number;
  attesters: AttesterView[];
  unreachable: { url: string; error?: string }[];
  healthConfigured: boolean;
  asOfBlock: number;
}

export interface DivergenceItem {
  packageId: Hex;
  name: string | null;
  version: string | null;
  attester: Hex;
  expectedDigest: Hex;
  observedDigest: Hex;
  blockNumber: number;
  txHash: Hex;
  timestamp: string;
}

/** One row per package name (GET /names). */
export interface NameGroup {
  name: string;
  ecosystem: string;
  latestVersion: string;
  latestPackageId: Hex;
  latestStatus: Status;
  worstStatus: Status;
  versionCount: number;
  verified: number;
  pending: number;
  divergent: number;
  publisher: Hex;
  lastActivityBlock: number;
  lastSubmittedAt: string;
}

/** Every version of one name plus name-level facts (GET /name?name=). */
export interface NameDetail extends NameGroup {
  pinnedPublisher: Hex | null;
  pinnedAt: string | null;
  firstAttestedAt: string;
  versions: Attestation[];
  asOfBlock: number;
}
