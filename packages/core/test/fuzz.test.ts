// Hostile-input fuzzing for the archive parser. Tarballs are attacker-controlled, so for
// ANY input canonicalisation must either return a tree or throw a typed CairnError —
// never an untyped exception, never a hang. Seeded, so failures reproduce exactly.
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CairnError, canonicaliseTarball, computeArtifactDigest } from "../src/index.js";
import { writeTar } from "./helpers/tar.js";

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

function attempt(bytes: Uint8Array): "tree" | "typed-error" {
  try {
    const tree = canonicaliseTarball(bytes);
    computeArtifactDigest(tree);
    return "tree";
  } catch (err) {
    if (err instanceof CairnError) return "typed-error";
    throw new Error(`untyped failure on ${bytes.length}-byte input: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }
}

const BASE = writeTar(
  [
    { path: "package/package.json", data: '{"name":"x","version":"1.0.0"}' },
    { path: "package/index.js", data: "module.exports = 1;\n".repeat(40) },
    { path: "package/lib/a.js", data: "a" },
    { path: "package/bin/cli", data: "#!/bin/sh\n", mode: 0o755 },
    { path: "package/link", type: "2", linkname: "index.js" }
  ],
  { gzip: false }
);

describe("archive parser under hostile input", () => {
  it("random bytes, raw and gzipped (1500 cases)", () => {
    const rand = prng(1);
    for (let i = 0; i < 1500; i++) {
      const len = Math.floor(rand() * 4096);
      const bytes = Uint8Array.from({ length: len }, () => Math.floor(rand() * 256));
      attempt(bytes);
      attempt(gzipSync(bytes));
    }
  });

  it("byte-flipped, truncated and spliced valid archives (2500 cases)", () => {
    const rand = prng(2);
    const outcomes = { tree: 0, "typed-error": 0 };
    for (let i = 0; i < 2500; i++) {
      let bytes = Uint8Array.from(BASE);
      const op = i % 4;
      if (op === 0) {
        for (let k = 0; k < 1 + Math.floor(rand() * 8); k++) bytes[Math.floor(rand() * bytes.length)] = Math.floor(rand() * 256);
      } else if (op === 1) {
        bytes = bytes.subarray(0, Math.floor(rand() * bytes.length));
      } else if (op === 2) {
        // overwrite a header field region (name, mode, size, typeflag, linkname, prefix)
        const block = 512 * Math.floor(rand() * (bytes.length / 512));
        const field = [0, 100, 124, 156, 157, 345][Math.floor(rand() * 6)] ?? 0;
        for (let k = 0; k < 12; k++) bytes[block + field + k] = Math.floor(rand() * 256);
      } else {
        // splice a random block from elsewhere into the stream
        const from = 512 * Math.floor(rand() * (bytes.length / 512));
        const to = 512 * Math.floor(rand() * (bytes.length / 512));
        bytes.copyWithin(to, from, from + 512);
      }
      outcomes[attempt(bytes)]++;
      attempt(gzipSync(bytes));
    }
    // sanity: the corpus exercises both outcomes, not just one failure mode
    expect(outcomes.tree).toBeGreaterThan(0);
    expect(outcomes["typed-error"]).toBeGreaterThan(0);
  });

  it("pathological headers: huge sizes, base-256 sizes, endless pax records", () => {
    const huge = Uint8Array.from(BASE);
    huge.set(new TextEncoder().encode("77777777777\0"), 124); // size field ≈ 8 GiB
    expect(attempt(huge)).toBe("typed-error");
    const b256 = Uint8Array.from(BASE);
    b256.fill(0xff, 124, 136); // GNU base-256, absurd value
    expect(attempt(b256)).toBe("typed-error");
    const pax = writeTar([{ path: "package/a.js", data: "x" }], { gzip: false, pax: true });
    const broken = Uint8Array.from(pax);
    broken.set(new TextEncoder().encode("99999 path="), 512); // pax length past the record
    expect(attempt(broken)).toBe("typed-error");
  });
});
