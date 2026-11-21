import type { Address, Hex } from "viem";
import type { CanonicalEntry, CanonicalTree } from "./canonicalise.js";
import { CairnError } from "./errors.js";
import { sha256, toHex32 } from "./hash.js";
import type { Ecosystem } from "./identity.js";
import { DIGEST_SPEC } from "./merkle.js";

export const PAYLOAD_SCHEMA = "cairn.attestation.v1";
export const TOOL_VERSION = "cairn/0.1.0";

/** Off-chain attestation payload (SPEC-DIGEST §6). Only its digest goes on-chain. */
export interface AttestationPayload {
  schema: typeof PAYLOAD_SCHEMA;
  ecosystem: Ecosystem;
  name: string;
  version: string;
  artifactDigest: Hex;
  tarballHash: Hex;
  entryCount: number;
  entries: CanonicalEntry[];
  publisher: Address;
  producedAt: string;
  toolVersion: string;
  digestSpec: string;
}

export function buildAttestationPayload(args: {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  tree: CanonicalTree;
  artifactDigest: Hex;
  tarballHash: Hex;
  publisher: Address;
  producedAt: Date;
}): AttestationPayload {
  return {
    schema: PAYLOAD_SCHEMA,
    ecosystem: args.ecosystem,
    name: args.name,
    version: args.version,
    artifactDigest: args.artifactDigest,
    tarballHash: args.tarballHash,
    entryCount: args.tree.entries.length,
    entries: args.tree.entries,
    publisher: args.publisher,
    producedAt: args.producedAt.toISOString(),
    toolVersion: TOOL_VERSION,
    digestSpec: DIGEST_SPEC
  };
}

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit (JS default sort, identical to
 * RFC 8785 for the ASCII keys we use), no insignificant whitespace, arrays in order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new CairnError("CANONICAL_JSON", "non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      throw new CairnError("CANONICAL_JSON", `cannot canonicalise a ${typeof value}`);
  }
}

/** `payloadDigest` = SHA-256 of the canonical JSON serialisation. */
export function computePayloadDigest(payload: AttestationPayload): Hex {
  return toHex32(sha256(Buffer.from(canonicalJson(payload), "utf8")));
}
