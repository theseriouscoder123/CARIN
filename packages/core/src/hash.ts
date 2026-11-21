import { createHash } from "node:crypto";
import type { Hex } from "viem";

/** SHA-256 over the concatenation of `parts`, as raw bytes. */
export function sha256(...parts: Uint8Array[]): Buffer {
  const h = createHash("sha256");
  for (const part of parts) h.update(part);
  return h.digest();
}

/** Lowercase, `0x`-prefixed hex — directly usable as a Solidity `bytes32`. */
export function toHex32(bytes: Uint8Array): Hex {
  if (bytes.length !== 32) throw new RangeError(`expected 32 bytes, got ${bytes.length}`);
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

/** Decode a `0x`-prefixed 32-byte hex string to raw bytes. */
export function fromHex32(hex: Hex): Buffer {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new RangeError(`not a bytes32 hex string: ${hex}`);
  return Buffer.from(hex.slice(2), "hex");
}

/**
 * `tarballHash` — SHA-256 of the raw tarball bytes exactly as served (SPEC-DIGEST §2).
 * A mismatch here alone means *repack*, not divergence.
 */
export function computeTarballHash(bytes: Uint8Array): Hex {
  return toHex32(sha256(bytes));
}
