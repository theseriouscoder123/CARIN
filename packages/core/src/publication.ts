import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { canonicaliseTarball, type CanonicalTree } from "./canonicalise.js";
import { CairnError } from "./errors.js";
import { computeTarballHash, sha256, toHex32 } from "./hash.js";
import { packageId, type Ecosystem } from "./identity.js";
import { computeArtifactDigest } from "./merkle.js";
import {
  buildAttestationPayload,
  canonicalJson,
  computePayloadDigest,
  type AttestationPayload
} from "./payload.js";

/** Everything needed to sign and submit an attestation, computed from artifact bytes. */
export interface Publication {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  packageId: Hex;
  tree: CanonicalTree;
  artifactDigest: Hex;
  tarballHash: Hex;
  payload: AttestationPayload;
  payloadDigest: Hex;
}

/**
 * Steps 2–3 of `cairn publish` (SPEC-CLI §2): canonicalise, digest, build and hash the
 * payload. Pure given its inputs; no I/O, no chain access.
 */
export function preparePublication(args: {
  bytes: Uint8Array;
  ecosystem: Ecosystem;
  name: string;
  version: string;
  publisher: Address;
  producedAt?: Date;
}): Publication {
  const id = packageId(args.ecosystem, args.name, args.version); // validates identity first
  const tree = canonicaliseTarball(args.bytes);
  const artifactDigest = computeArtifactDigest(tree);
  const tarballHash = computeTarballHash(args.bytes);
  const payload = buildAttestationPayload({
    ecosystem: args.ecosystem,
    name: args.name,
    version: args.version,
    tree,
    artifactDigest,
    tarballHash,
    publisher: args.publisher,
    producedAt: args.producedAt ?? new Date()
  });
  return {
    ecosystem: args.ecosystem,
    name: args.name,
    version: args.version,
    packageId: id,
    tree,
    artifactDigest,
    tarballHash,
    payload,
    payloadDigest: computePayloadDigest(payload)
  };
}

/** Content-addressed payload storage. The on-chain `payloadDigest` is the key. */
export interface PayloadStore {
  put(payload: AttestationPayload): Promise<{ digest: Hex; location: string }>;
  get(digest: Hex): Promise<AttestationPayload | undefined>;
}

/**
 * Local filesystem store: `<dir>/<payloadDigest>.json` holding the canonical JSON. Reads
 * re-hash the file, so a tampered payload is rejected rather than trusted.
 */
export class LocalPayloadStore implements PayloadStore {
  constructor(readonly dir: string) {}

  async put(payload: AttestationPayload) {
    const json = canonicalJson(payload);
    const digest = toHex32(sha256(Buffer.from(json, "utf8")));
    await mkdir(this.dir, { recursive: true });
    const location = join(this.dir, `${digest}.json`);
    await writeFile(location, json, "utf8");
    return { digest, location };
  }

  async get(digest: Hex): Promise<AttestationPayload | undefined> {
    let json: string;
    try {
      json = await readFile(join(this.dir, `${digest}.json`), "utf8");
    } catch {
      return undefined;
    }
    const actual = toHex32(sha256(Buffer.from(json, "utf8")));
    if (actual !== digest) {
      throw new CairnError("PAYLOAD_TAMPERED", `stored payload ${digest} hashes to ${actual}`);
    }
    return JSON.parse(json) as AttestationPayload;
  }
}
