import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EmptyArtifactError,
  computeArtifactDigest,
  leafHash,
  merkleTreeHash,
  nodeHash,
  type CanonicalEntry
} from "../src/index.js";

const H = (...parts: (Uint8Array | number[])[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(Uint8Array.from(p));
  return h.digest();
};

const contentHash = (s: string) => `0x${H(Buffer.from(s)).toString("hex")}` as const;

const entry = (path: string, body: string, modeClass: 0 | 1 = 0): CanonicalEntry => ({
  path,
  kind: "file",
  modeClass,
  contentHash: contentHash(body),
  size: body.length
});

describe("leaf hash", () => {
  it("matches a byte-for-byte hand construction of SPEC-DIGEST §4.2", () => {
    const e = entry("lib/a.js", "hello", 1);
    const path = Buffer.from("lib/a.js");
    const expected = H(
      [0x00],
      [0, 0, 0, path.length],
      path,
      [0x00], // kind = file
      [0x01], // modeClass = executable
      H(Buffer.from("hello"))
    );
    expect(leafHash(e).equals(expected)).toBe(true);
  });

  it("encodes symlinks with kind byte 0x01", () => {
    const file = entry("x", "t");
    const link: CanonicalEntry = { ...file, kind: "symlink" };
    expect(leafHash(file).equals(leafHash(link))).toBe(false);
  });
});

describe("RFC 6962 tree shape", () => {
  const l = [0, 1, 2, 3, 4].map((i) => H([i]));

  it("empty tree is SHA256 of the empty string", () => {
    expect(merkleTreeHash([]).equals(H([]))).toBe(true);
  });

  it("single leaf is the leaf itself", () => {
    expect(merkleTreeHash([l[0]!]).equals(l[0]!)).toBe(true);
  });

  it("three leaves split at 2 (power-of-two), not by duplicating the odd node", () => {
    const expected = nodeHash(nodeHash(l[0]!, l[1]!), l[2]!);
    expect(merkleTreeHash(l.slice(0, 3)).equals(expected)).toBe(true);
    const naive = nodeHash(nodeHash(l[0]!, l[1]!), nodeHash(l[2]!, l[2]!));
    expect(merkleTreeHash(l.slice(0, 3)).equals(naive)).toBe(false);
  });

  it("five leaves split at 4", () => {
    const left = nodeHash(nodeHash(l[0]!, l[1]!), nodeHash(l[2]!, l[3]!));
    expect(merkleTreeHash(l).equals(nodeHash(left, l[4]!))).toBe(true);
  });

  it("interior nodes are domain-separated from leaves with 0x01", () => {
    expect(nodeHash(l[0]!, l[1]!).equals(H([0x01], l[0]!, l[1]!))).toBe(true);
  });
});

describe("computeArtifactDigest", () => {
  it("is independent of input order", () => {
    const a = [entry("b", "2"), entry("a", "1"), entry("c", "3")];
    const b = [entry("c", "3"), entry("b", "2"), entry("a", "1")];
    expect(computeArtifactDigest({ entries: a, warnings: [] })).toBe(
      computeArtifactDigest({ entries: b, warnings: [] })
    );
  });

  it("is 0x-prefixed lowercase 32-byte hex", () => {
    expect(computeArtifactDigest({ entries: [entry("a", "1")], warnings: [] })).toMatch(
      /^0x[0-9a-f]{64}$/
    );
  });

  it("rejects an empty tree", () => {
    expect(() => computeArtifactDigest({ entries: [], warnings: [] })).toThrow(EmptyArtifactError);
  });
});
