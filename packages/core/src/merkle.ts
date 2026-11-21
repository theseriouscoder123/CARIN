import type { Hex } from "viem";
import { compareUtf8, type CanonicalEntry, type CanonicalTree } from "./canonicalise.js";
import { DuplicatePathError, EmptyArtifactError } from "./errors.js";
import { fromHex32, sha256, toHex32 } from "./hash.js";

/** Version tag recorded in every payload; bump only with a deliberate spec change. */
export const DIGEST_SPEC = "cairn-merkle-v1";

const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

/**
 * RFC 6962 leaf hash over a canonical entry (SPEC-DIGEST §4.2):
 * `SHA256(0x00 || u32be(len(path)) || path || kind || modeClass || contentHash)`.
 * Binding path, kind and mode into each leaf is what makes the digest sensitive to
 * renames, content swaps and chmod — not just to content.
 */
export function leafHash(entry: CanonicalEntry): Buffer {
  const path = Buffer.from(entry.path, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(path.length, 0);
  const kind = Uint8Array.of(entry.kind === "file" ? 0x00 : 0x01);
  const mode = Uint8Array.of(entry.modeClass);
  return sha256(LEAF_PREFIX, len, path, kind, mode, fromHex32(entry.contentHash));
}

/** RFC 6962 interior node: `SHA256(0x01 || left || right)`. */
export function nodeHash(left: Uint8Array, right: Uint8Array): Buffer {
  return sha256(NODE_PREFIX, left, right);
}

/** Largest power of two strictly less than n (n >= 2). */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/**
 * Merkle Tree Hash per RFC 6962 §2.1 — power-of-two split, not "duplicate the odd
 * node", which admits a second-preimage ambiguity.
 */
export function merkleTreeHash(leaves: readonly Uint8Array[]): Buffer {
  const n = leaves.length;
  if (n === 0) return sha256();
  if (n === 1) return Buffer.from(leaves[0] as Uint8Array);
  const k = splitPoint(n);
  return nodeHash(merkleTreeHash(leaves.slice(0, k)), merkleTreeHash(leaves.slice(k)));
}

/**
 * `artifactDigest` — the Merkle root over the canonical tree. Re-sorts defensively so
 * the result never depends on how the caller ordered entries.
 */
export function computeArtifactDigest(tree: CanonicalTree): Hex {
  if (tree.entries.length === 0) throw new EmptyArtifactError();
  const sorted = [...tree.entries].sort((a, b) => compareUtf8(a.path, b.path));
  for (let i = 1; i < sorted.length; i++) {
    const path = sorted[i]?.path;
    if (path !== undefined && path === sorted[i - 1]?.path) throw new DuplicatePathError(path);
  }
  return toHex32(merkleTreeHash(sorted.map(leafHash)));
}
