// The determinism harness — SPEC-DIGEST §7 / TESTING.md §3. The most important suite in
// the repository: a CLI/attester disagreement here is false divergence on stage.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  ArchiveFormatError,
  DuplicatePathError,
  EmptyArtifactError,
  PathTraversalError,
  canonicalise,
  canonicaliseDirectory,
  canonicaliseTarball,
  computeArtifactDigest,
  computeTarballHash,
  readTar,
  type CanonicalTree
} from "../src/index.js";
import { writeTar, type WriteEntry } from "./helpers/tar.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const GREETING_TGZ = readFileSync(join(FIXTURES, "cairn-demo-greeting-1.0.0.tgz"));
const GREETING_SRC = join(FIXTURES, "greeting-src");

const digestOfBytes = (bytes: Uint8Array) => computeArtifactDigest(canonicaliseTarball(bytes));
const digestOfTree = (tree: CanonicalTree) => computeArtifactDigest(tree);

/** Re-express the npm fixture as writer entries so it can be repacked / mutated. */
function greetingEntries(): WriteEntry[] {
  return readTar(GREETING_TGZ).map((e) => ({
    path: e.path,
    data: e.data,
    mode: e.mode,
    type: "0" as const
  }));
}

const BASE: WriteEntry[] = [
  { path: "package/package.json", data: '{"name":"x","version":"1.0.0"}' },
  { path: "package/a.js", data: "module.exports = 'a';\n" },
  { path: "package/b.js", data: "module.exports = 'b';\n" },
  { path: "package/lib/util.js", data: "exports.u = 1;\n" },
  { path: "package/bin/cli.js", data: "#!/usr/bin/env node\n", mode: 0o755 }
];
const baseDigest = digestOfBytes(writeTar(BASE));

const tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "cairn-core-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function systemTarAvailable(): boolean {
  try {
    execFileSync("tar", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("1. source equivalence", () => {
  it("tarball bytes and the source directory produce the same digest", async () => {
    const fromTar = canonicaliseTarball(GREETING_TGZ);
    const fromDir = await canonicaliseDirectory(GREETING_SRC);
    expect(fromDir.entries.map((e) => e.path)).toEqual(fromTar.entries.map((e) => e.path));
    expect(digestOfTree(fromDir)).toBe(digestOfTree(fromTar));
  });

  it.skipIf(!systemTarAvailable())(
    "tarball and a directory extracted by the system tar produce the same digest",
    async () => {
      const dir = tmp();
      writeFileSync(join(dir, "in.tgz"), GREETING_TGZ);
      execFileSync("tar", ["-xzf", "in.tgz"], { cwd: dir });
      rmSync(join(dir, "in.tgz"));
      const fromDir = await canonicalise({ kind: "directory", path: dir });
      expect(digestOfTree(fromDir)).toBe(digestOfBytes(GREETING_TGZ));
    }
  );
});

describe("2. repack invariance", () => {
  it("different gzip level, mtimes, owners and entry order: same artifactDigest, new tarballHash", () => {
    const repacked = writeTar(
      greetingEntries()
        .reverse()
        .map((e) => ({ ...e, mtime: 1_700_000_000, uid: 1000, gid: 1000, uname: "dev", gname: "dev" })),
      { level: 1 }
    );
    expect(computeTarballHash(repacked)).not.toBe(computeTarballHash(GREETING_TGZ));
    expect(digestOfBytes(repacked)).toBe(digestOfBytes(GREETING_TGZ));
  });

  it("raw (un-gzipped) tar gives the same digest", () => {
    expect(digestOfBytes(writeTar(greetingEntries(), { gzip: false }))).toBe(
      digestOfBytes(GREETING_TGZ)
    );
  });

  it("presence of directory entries does not change the digest", () => {
    const withDirs = writeTar([
      { path: "package/", type: "5" },
      { path: "package/lib/", type: "5" },
      { path: "package/bin/", type: "5" },
      ...BASE
    ]);
    expect(digestOfBytes(withDirs)).toBe(baseDigest);
  });

  it("a different single root wrapper is stripped the same way as package/", () => {
    const rewrapped = BASE.map((e) => ({ ...e, path: e.path.replace(/^package\//, "x-1.0.0/") }));
    expect(digestOfBytes(writeTar(rewrapped))).toBe(baseDigest);
  });

  it("pax-encoded paths and ./-prefixed paths normalise identically", () => {
    expect(digestOfBytes(writeTar(BASE, { pax: true }))).toBe(baseDigest);
    const dotted = BASE.map((e) => ({ ...e, path: `./${e.path}` }));
    expect(digestOfBytes(writeTar(dotted))).toBe(baseDigest);
  });

  it("non-exec permission differences (0644 vs 0600) do not matter; exec class does", () => {
    const perms = BASE.map((e) => (e.mode === 0o755 ? { ...e, mode: 0o700 } : { ...e, mode: 0o600 }));
    expect(digestOfBytes(writeTar(perms))).toBe(baseDigest);
  });
});

describe("3. content sensitivity", () => {
  it("flipping one byte in one file changes the digest", () => {
    const entries = greetingEntries();
    const target = entries.find((e) => e.path.endsWith("index.js"));
    const bytes = Uint8Array.from(target?.data as Uint8Array);
    bytes[10] = (bytes[10] ?? 0) ^ 0x01;
    const mutated = entries.map((e) => (e === target ? { ...e, data: bytes } : e));
    expect(digestOfBytes(writeTar(mutated))).not.toBe(digestOfBytes(GREETING_TGZ));
  });

  it("adding a file (the postinstall tamper) changes the digest", () => {
    const tampered = writeTar([
      ...BASE,
      { path: "package/scripts/postinstall.js", data: "// simulated payload\n" }
    ]);
    expect(digestOfBytes(tampered)).not.toBe(baseDigest);
  });
});

describe("4. path sensitivity", () => {
  it("renaming a file with identical contents changes the digest", () => {
    const renamed = BASE.map((e) =>
      e.path === "package/a.js" ? { ...e, path: "package/a2.js" } : e
    );
    expect(digestOfBytes(writeTar(renamed))).not.toBe(baseDigest);
  });

  it("paths are case-sensitive", () => {
    const cased = BASE.map((e) => (e.path === "package/a.js" ? { ...e, path: "package/A.js" } : e));
    expect(digestOfBytes(writeTar(cased))).not.toBe(baseDigest);
  });
});

describe("5. move sensitivity", () => {
  it("swapping the contents of two files changes the digest", () => {
    const a = BASE.find((e) => e.path === "package/a.js")?.data;
    const b = BASE.find((e) => e.path === "package/b.js")?.data;
    const swapped = BASE.map((e) =>
      e.path === "package/a.js" ? { ...e, data: b } : e.path === "package/b.js" ? { ...e, data: a } : e
    );
    expect(digestOfBytes(writeTar(swapped))).not.toBe(baseDigest);
  });

  it("a symlink and a file with the same bytes are distinguished", () => {
    const asFile = writeTar([...BASE, { path: "package/link", data: "a.js" }]);
    const asLink = writeTar([...BASE, { path: "package/link", type: "2", linkname: "a.js" }]);
    expect(digestOfBytes(asFile)).not.toBe(digestOfBytes(asLink));
  });
});

describe("6. mode sensitivity", () => {
  it("toggling the executable bit changes the digest", () => {
    const toggled = BASE.map((e) => (e.path === "package/a.js" ? { ...e, mode: 0o755 } : e));
    expect(digestOfBytes(writeTar(toggled))).not.toBe(baseDigest);
  });
});

describe("7. unicode stability", () => {
  it("NFD and NFC spellings of a path produce the same digest", () => {
    const nfc = "package/caf\u00e9.js";
    const nfd = "package/cafe\u0301.js";
    expect(nfc).not.toBe(nfd);
    const a = writeTar([...BASE, { path: nfc, data: "x" }]);
    const b = writeTar([...BASE, { path: nfd, data: "x" }]);
    expect(digestOfBytes(a)).toBe(digestOfBytes(b));
  });

  it("sorts by UTF-8 bytes, not UTF-16 code units", () => {
    // U+FF5E (BMP, UTF-8 EF BD 9E) vs U+1F600 (astral, UTF-8 F0 9F 98 80).
    // UTF-16 order puts the astral char first (D83D < FF5E); UTF-8 order puts it last.
    const tree = canonicaliseTarball(
      writeTar([
        { path: "package/\u{1F600}.js", data: "1" },
        { path: "package/\uFF5E.js", data: "2" }
      ])
    );
    expect(tree.entries.map((e) => e.path)).toEqual(["\uFF5E.js", "\u{1F600}.js"]);
  });
});

describe("8. ordering stability", () => {
  it("20 shuffles of entry order yield the identical digest", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 20; i++) {
      const shuffled = [...BASE].sort(() => rand() - 0.5);
      expect(digestOfBytes(writeTar(shuffled))).toBe(baseDigest);
    }
  });
});

describe("9. golden vectors", () => {
  const golden = JSON.parse(readFileSync(join(FIXTURES, "golden.json"), "utf8")) as {
    digestSpec: string;
    cases: { fixture: string; artifactDigest: string; tarballHash: string; entryCount: number }[];
  };

  it("uses the current digest spec", () => {
    expect(golden.digestSpec).toBe("cairn-merkle-v1");
  });

  for (const c of golden.cases) {
    it(`${c.fixture} matches its frozen digest`, () => {
      const bytes = readFileSync(join(FIXTURES, c.fixture));
      const tree = canonicaliseTarball(bytes);
      expect(tree.entries).toHaveLength(c.entryCount);
      expect(computeArtifactDigest(tree)).toBe(c.artifactDigest);
      expect(computeTarballHash(bytes)).toBe(c.tarballHash);
    });
  }
});

describe("10. traversal rejection", () => {
  for (const bad of ["package/../evil.js", "../evil.js", "/etc/passwd", "C:/evil.js", "package\\..\\evil.js"]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(() => canonicaliseTarball(writeTar([...BASE, { path: bad, data: "x" }]))).toThrow(
        PathTraversalError
      );
    });
  }
});

describe("11. duplicate path rejection", () => {
  it("rejects the same path twice", () => {
    expect(() =>
      canonicaliseTarball(writeTar([...BASE, { path: "package/a.js", data: "evil" }]))
    ).toThrow(DuplicatePathError);
  });

  it("rejects paths that collide only after normalisation", () => {
    expect(() =>
      canonicaliseTarball(writeTar([...BASE, { path: "package/./a.js", data: "evil" }]))
    ).toThrow(DuplicatePathError);
  });
});

describe("malformed input", () => {
  it("rejects an archive with no digestible entries", () => {
    expect(() => canonicaliseTarball(writeTar([{ path: "package/", type: "5" }]))).toThrow(
      EmptyArtifactError
    );
  });

  it("rejects a corrupted header checksum", () => {
    const raw = writeTar(BASE, { gzip: false });
    raw[0] = (raw[0] ?? 0) ^ 0x01;
    expect(() => canonicaliseTarball(raw)).toThrow(ArchiveFormatError);
  });

  it("rejects a truncated archive", () => {
    const raw = writeTar(BASE, { gzip: false });
    expect(() => canonicaliseTarball(raw.subarray(0, 700))).toThrow(ArchiveFormatError);
  });

  it("skips device entries with a warning instead of hashing them", () => {
    const tree = canonicaliseTarball(writeTar([...BASE, { path: "package/dev", type: "3" }]));
    expect(computeArtifactDigest(tree)).toBe(baseDigest);
    expect(tree.warnings).toHaveLength(1);
  });

  it("treats contiguous-file entries (typeflag 7) as files, not as invisible", () => {
    const tree = canonicaliseTarball(writeTar([...BASE, { path: "package/hidden.js", type: "7", data: "x" }]));
    expect(tree.entries.map((e) => e.path)).toContain("hidden.js");
  });
});
