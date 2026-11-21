# SPEC — Canonicalisation and Artifact Digest

**Read this before writing a line of `packages/core`.**

This is the hardest correctness problem in CAIRN and the one that can silently destroy the
demo. Two independent parties — the publisher's CLI and an attester on another machine —
must derive an **identical** digest from the same release. If they do not, CAIRN reports
false divergence, and the central claim ("we detect tampering") becomes "we produce noise".

---

## 1. Why a raw hash of the tarball is not enough

npm artifacts are gzipped tarballs. Between two fetches of *the same logical release*, the
following can differ without any tampering:

- gzip compression level and the gzip header (including an embedded mtime)
- tar entry ordering
- file mtimes, uid/gid, uname/gname
- tar block padding
- whether the registry re-compressed on ingest or proxy

A naive `sha256(tarballBytes)` therefore produces false positives. That is unacceptable:
a tool that cries wolf gets uninstalled.

Conversely, hashing only file *contents* while ignoring paths would let an attacker move a
payload between files without changing the digest.

The solution is a **Merkle tree over a normalised file tree**, where path, mode class and
content are all bound into each leaf.

---

## 2. Two digests, two meanings

CAIRN records both, and they answer different questions.

| Field | Definition | Meaning on mismatch |
|---|---|---|
| `artifactDigest` | Merkle root over the normalised file tree | **Divergence.** The content changed. CRITICAL. |
| `tarballHash` | `SHA-256` of the raw tarball bytes as served | Repack. Same content, different packaging. INFO. |

Behaviour:

- `artifactDigest` matches, `tarballHash` differs → **repack**, recorded, not an alert.
- `artifactDigest` differs → **divergence**, regardless of `tarballHash`. Alert and BLOCK.

This distinction is worth presenting in the pitch. It demonstrates that the design
anticipates benign variation, which is exactly what separates a tool someone would actually
run in CI from a hackathon toy.

---

## 3. Canonicalisation

Input: tarball bytes, or an already-extracted directory. Both paths **must** produce the
same tree — this is a tested invariant.

### 3.1 Entry extraction

1. Gunzip, then parse the tar stream.
2. For each entry, derive a **normalised path**:
   - Strip the leading `package/` component that npm adds. If a different single root
     component wraps every entry, strip that instead. If entries have no common root, use
     paths as-is.
   - Reject and abort on any path containing `..`, an absolute path, a NUL byte, or a
     drive letter. These are path-traversal attempts, not packaging quirks.
   - Normalise separators to `/`.
   - Apply Unicode **NFC** normalisation to the path string.
   - Do **not** lowercase. Paths are case-sensitive.
3. Classify the entry type:

| tar typeflag | Treated as | Included |
|---|---|---|
| `0` / `\0` (regular) | `file` | yes |
| `5` (directory) | — | **no** (implied by file paths) |
| `2` (symlink) | `symlink` | yes — content is the link target string |
| `1` (hardlink) | `symlink` | yes — content is the target path string |
| anything else (char/block/fifo) | — | **no**, and record a warning |

Directories carry no content and their presence is implied by the files within them.
Including them would make the digest sensitive to whether a packer emitted directory
entries, which varies.

### 3.2 Mode normalisation

Full POSIX modes are not stable across platforms and packers. Collapse to a single bit:

```
modeClass = (mode & 0o111) !== 0 ? 1 : 0     // 1 = executable, 0 = regular
```

Symlinks always use `modeClass = 0`.

### 3.3 Exclusions

**None by default.** Everything in the tarball is part of the artifact, because everything
in the tarball is what gets installed.

Do not exclude `package.json`, lockfiles, or anything that "shouldn't matter". The
temptation to exclude noisy files is how a tool acquires a blind spot an attacker uses.

### 3.4 The canonical tree

```ts
type CanonicalEntry = {
  path: string          // normalised, NFC, '/'-separated, no leading './'
  kind: 'file' | 'symlink'
  modeClass: 0 | 1
  contentHash: Hex      // sha256 of raw bytes (file) or of UTF-8 target (symlink)
  size: number          // informational only; NOT hashed
}

type CanonicalTree = {
  entries: CanonicalEntry[]   // sorted; see §4.1
  warnings: string[]
}
```

Duplicate normalised paths are a **fatal error**, not a last-wins merge. A tarball
containing the same path twice is malformed or hostile.

---

## 4. The Merkle digest

The tree construction follows **RFC 6962** (Certificate Transparency), deliberately. Using
the same construction as the system CAIRN is modelled on is both correct and rhetorically
useful.

### 4.1 Ordering

Sort entries by the **UTF-8 byte sequence** of `path`, ascending.

Use byte comparison, not locale-aware string comparison. In JavaScript:

```ts
entries.sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')))
```

`String.prototype.localeCompare` is locale-dependent and **must not** be used. `<` on
JS strings compares UTF-16 code units, which diverges from UTF-8 byte order for characters
outside the BMP. Either mistake produces machine-dependent digests.

### 4.2 Leaf hash

```
leafHash(e) = SHA256( 0x00
                    || uint32be(byteLength(e.path))
                    || utf8(e.path)
                    || uint8(e.kind === 'file' ? 0x00 : 0x01)
                    || uint8(e.modeClass)
                    || e.contentHash )          // 32 raw bytes
```

The `0x00` prefix is RFC 6962 leaf-domain separation. The explicit path length prevents
concatenation ambiguity between adjacent fields.

### 4.3 Internal node

```
nodeHash(l, r) = SHA256( 0x01 || l || r )
```

### 4.4 Root

```
MTH([])      = SHA256("")                       // empty tree; 32 zero-length input
MTH([e])     = leafHash(e)
MTH(D[0:n])  = nodeHash( MTH(D[0:k]), MTH(D[k:n]) )
               where k is the largest power of two strictly less than n
```

This is RFC 6962 §2.1 exactly. Note it is **not** a naive "duplicate the last node when odd"
tree — that construction admits a known second-preimage ambiguity. Use the power-of-two
split.

An artifact with zero entries is an error, not an empty tree. Reject it.

### 4.5 Output encoding

`artifactDigest` is the 32-byte root, hex-encoded, `0x`-prefixed, lowercase — directly
usable as a Solidity `bytes32`.

---

## 5. Package identity

```
packageId = keccak256( utf8( `${ecosystem}:${name}@${version}` ) )
```

- `ecosystem` is lowercase, e.g. `npm`.
- `name` is the registry name verbatim, including any scope (`@scope/pkg`).
- `version` is the exact resolved version string, **not** a range. Normalise per semver
  (`1.2.3`, not `v1.2.3`, not `1.2.3+build` unless the registry itself carries it).

keccak256 rather than SHA-256 here purely because it is cheap in the EVM; this value is an
index, not a security primitive.

---

## 6. Attestation payload

The on-chain record anchors only digests. The full payload lives in content-addressed
storage so an auditor can reconstruct and re-verify years later.

```jsonc
{
  "schema": "cairn.attestation.v1",
  "ecosystem": "npm",
  "name": "@scope/example",
  "version": "1.4.2",
  "artifactDigest": "0x…",
  "tarballHash": "0x…",
  "entryCount": 142,
  "entries": [
    { "path": "package.json", "kind": "file", "modeClass": 0, "contentHash": "0x…", "size": 1183 }
  ],
  "publisher": "0x…",
  "producedAt": "2026-…T…Z",
  "toolVersion": "cairn/0.1.0",
  "digestSpec": "cairn-merkle-v1"
}
```

`payloadDigest` = SHA-256 of the canonical JSON serialisation (sorted keys, no insignificant
whitespace) — **that** 32-byte value is what goes on-chain. For IPFS it is also the
multihash digest of a CIDv1/raw/sha2-256, so the CID can be reconstructed off-chain from
the on-chain field alone. No need to store a variable-length CID string in contract storage.

`digestSpec` is a version string. If the algorithm ever changes, old attestations remain
verifiable under their original spec. Do not skip this field; it costs nothing now and
makes the system upgradeable without mutating records.

---

## 7. Required tests

These live in `packages/core/test/` and are non-negotiable. See `TESTING.md`.

1. **Source equivalence** — digest(tarball bytes) === digest(extracted directory).
2. **Repack invariance** — re-gzip at a different compression level, change all mtimes,
   reverse tar entry order → `artifactDigest` unchanged, `tarballHash` changed.
3. **Content sensitivity** — flip one byte in one file → digest changes.
4. **Path sensitivity** — rename a file, contents identical → digest changes.
5. **Move sensitivity** — swap the contents of two files → digest changes. (Guards against
   a content-only tree.)
6. **Mode sensitivity** — toggle the executable bit → digest changes.
7. **Unicode stability** — a path in NFD and the same path in NFC produce the same digest.
8. **Ordering stability** — shuffle input entry order 20 times → identical digest each time.
9. **Golden vectors** — a committed fixture with a hardcoded expected root. This catches
   accidental algorithm drift during refactors, which is otherwise invisible.
10. **Traversal rejection** — a tarball containing `../evil` aborts with a typed error.
11. **Duplicate path rejection** — aborts with a typed error.

Tests 2 and 5 are the ones that actually matter; a careless implementation passes
everything else and fails these.

---

## 8. Implementation notes

- Stream the tar parse; do not buffer entire tarballs in memory beyond what is needed for
  per-file hashing. Some packages are large.
- Hash file content incrementally as entries stream through.
- Cache by `tarballHash` so `cairn verify` over a large lockfile does not refetch or
  rehash. Cache location: `~/.cache/cairn/` (respect `XDG_CACHE_HOME`).
- Use `node:crypto` for SHA-256 and viem's `keccak256` for `packageId`. No alternative
  crypto libraries — one more dependency is one more supply-chain risk, which would be a
  poor look for this project specifically.
- Make canonicalisation pure and synchronous given bytes. Only I/O is async. This keeps it
  trivially testable.
