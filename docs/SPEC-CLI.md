# SPEC — CLI (`cairn`)

Package: `packages/cli`. Binary name: `cairn`. Commander + TypeScript, ESM.

The CLI is the only part of CAIRN a developer touches daily, and `cairn verify` is the
feature demonstrated live. Its output is part of the pitch — treat the terminal rendering
as UI, not as logging.

---

## 1. Global options

```
--rpc-url <url>          default: http://127.0.0.1:8545  (env CAIRN_RPC_URL)
--registry-url <url>     default: https://registry.npmjs.org  (env CAIRN_REGISTRY_URL)
--contract <address>     default: from deployments/<chainId>.json (env CAIRN_REGISTRY_ADDR)
--json                   machine-readable output; suppresses all human formatting
--no-color
-v, --verbose            repeatable
```

`--json` must emit **only** valid JSON on stdout. Diagnostics go to stderr. A CI
integration that has to strip banners from stdout is a broken CLI.

---

## 2. `cairn publish`

```
cairn publish [tarball]
  --package <name@version>   resolve and fetch from the registry instead of a local file
  --key <hex>                signing key (env CAIRN_PRIVATE_KEY; prefer the env var)
  --payload-store <target>   ipfs | local   (default: local in dev)
  --dry-run                  compute and print, submit nothing
```

Steps:

1. Obtain artifact bytes — from the path argument, or by resolving `--package`.
2. `canonicalise()` → `computeArtifactDigest()` and `computeTarballHash()`.
3. Build the attestation payload (`SPEC-DIGEST.md` §6), canonicalise its JSON, hash it.
4. Store the payload; keep `payloadDigest`.
5. Sign the EIP-712 `Attestation` with the current on-chain nonce for the signer.
6. Call `AttestationRegistry.submit(...)`.
7. Print digest, packageId, tx hash.

`--dry-run` runs 1–3 and prints the result. Useful for debugging determinism against an
attester without spending a transaction, and useful on stage.

### Output

```
  cairn publish

  package        @cairn-demo/greeting@1.0.0
  files          14
  artifactDigest 0x7f3a…c21e
  tarballHash    0x9b02…44af
  payloadDigest  0x1d5e…88b0
  publisher      0xf39F…2266

  ✓ submitted   tx 0x4ac1…9e03   block 142
```

---

## 3. `cairn verify`

The headline command.

```
cairn verify
  --lockfile <path>     default: ./package-lock.json
  --policy <path>       default: ./cairn.policy.json, else built-in defaults
  --fail-on <level>     divergent | under-quorum | unattested   (default: under-quorum)
  --only <pattern>      restrict to matching package names (repeatable)
  --concurrency <n>     default 8
  --offline             use only the local cache; never fetch
```

### Algorithm

1. Parse the lockfile. **`lockfileVersion` 2 or 3 only** — walk the `packages` map, not the
   legacy `dependencies` tree. On v1, exit code 2 with a clear message rather than guessing.
2. Build the dependency set: every entry with a `resolved` URL. Skip `link: true` entries
   (local workspace links) and the root entry.
3. For each dependency, with bounded concurrency:
   a. Fetch the artifact (cache keyed by `resolved` URL + `integrity`).
   b. Compute `artifactDigest` locally.
   c. Read the on-chain record and quorum state for its `packageId`.
   d. Assign a verdict.
4. Render the report; exit per §3.3.

**The digest is always computed from the bytes the verifying machine actually received.**
Never trust the registry's reported integrity field, and never trust the indexer. This is
what makes the gate resistant to a registry serving split content.

### 3.1 Verdicts

| Verdict | Condition |
|---|---|
| `PASS` | record exists, digest matches, quorum reached, no divergences |
| `UNDER_QUORUM` | record exists, digest matches, fewer than M corroborations |
| `UNATTESTED` | no record on-chain for this packageId |
| `DIVERGENT` | record exists and the locally computed digest differs — **the alarm** |
| `CONTESTED` | record exists, digest matches, but divergences are recorded by attesters |
| `UNKNOWN` | chain or registry unreachable — treated as failure (fail closed) |

### 3.2 Policy file

```jsonc
{
  "failOn": ["DIVERGENT", "CONTESTED", "UNDER_QUORUM"],
  "warnOn": ["UNATTESTED"],
  "minCorroborations": 2,
  "allow": [
    { "name": "legacy-pkg", "version": "1.0.0", "reason": "vendor EOL", "expires": "2026-12-31" }
  ]
}
```

Allowlist entries **require** a `reason` and an `expires`. An expired entry is ignored and
a warning printed. Permanent silent exceptions are how security tools die; make the
exception carry an expiry date or do not offer the feature.

### 3.3 Exit codes

| Code | Meaning |
|---|---|
| `0` | no verdict at or above the fail threshold |
| `1` | policy violation — the gate fired |
| `2` | operational error (bad lockfile, unreachable chain, config error) |

Distinguishing 1 from 2 matters: CI should treat them differently. "The tool broke" is not
"your dependency is compromised", and conflating them trains people to ignore both.

### 3.4 Output

```
  cairn verify   ·   412 dependencies   ·   npm

  ✓ 408  verified
  ⚠   3  unattested
  ✗   1  DIVERGENT

  ─────────────────────────────────────────────────────────────────
  ✗  @cairn-demo/greeting@1.0.0                            DIVERGENT

     attested   0x7f3a…c21e   by 0xf39F…2266  ·  3/3 corroborations
     observed   0xa014…77d9
     delta      lib/index.js  (content changed)
                scripts/postinstall.js  (added)

     This version was republished after attestation.
  ─────────────────────────────────────────────────────────────────

  ⚠  left-pad@1.3.0                                       UNATTESTED
  ⚠  tiny-utils@0.4.1                                     UNATTESTED
  ⚠  color-name@1.1.4                                     UNATTESTED

  BLOCKED — 1 divergent dependency
```

The `delta` block is what sells it. When the payload is retrievable, diff the attested
entry list against the observed tree and name the files that changed. Going from "hashes
differ" to "`scripts/postinstall.js` was added" is the difference between a plausible demo
and one an audience physically reacts to. Implement it if time allows; it is listed as a
stretch in the build plan, not a core requirement.

### 3.5 `--json` shape

```jsonc
{
  "schema": "cairn.verify.v1",
  "lockfile": "./package-lock.json",
  "checked": 412,
  "summary": { "PASS": 408, "UNATTESTED": 3, "DIVERGENT": 1 },
  "results": [
    {
      "name": "@cairn-demo/greeting",
      "version": "1.0.0",
      "packageId": "0x…",
      "verdict": "DIVERGENT",
      "attestedDigest": "0x…",
      "observedDigest": "0x…",
      "corroborations": 3,
      "threshold": 2,
      "divergences": []
    }
  ],
  "exitCode": 1
}
```

---

## 4. `cairn status`

```
cairn status <name@version>
```

One package: attestation record, publisher, corroboration count, quorum state, divergence
list. Thirty minutes of work, and invaluable while debugging the demo.

---

## 5. CI integration

Ship `.github/workflows/cairn.yml` in the demo fixture repo, not in CAIRN's own CI:

```yaml
- run: npm ci
- run: npx cairn verify --fail-on divergent
```

The pitch shows a **red GitHub Actions run** caused by a tampered dependency. A red check
mark in a familiar UI is more persuasive to a mixed audience than a terminal.

---

## 6. Implementation notes

- Commander for parsing; keep command modules thin and put logic in testable functions.
- Rendering lives in `src/render/`, pure functions from result objects to strings. Snapshot
  tests cover them. Never build output by interleaving `console.log` with business logic.
- Respect `NO_COLOR` and detect non-TTY stdout; disable colour and spinners automatically.
- Progress indication: a single updating line, not a line per dependency. 412 lines of
  scroll is noise.
- Cache at `${XDG_CACHE_HOME:-~/.cache}/cairn/artifacts/<sha256>`.
- Never print a private key, even at `-vvv`. Add a test asserting the key never appears in
  any output stream.
