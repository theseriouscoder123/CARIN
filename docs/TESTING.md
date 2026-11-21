# Testing Strategy

A 24-hour build cannot afford comprehensive tests. It also cannot afford a silent
correctness bug in the digest, because that bug destroys the demo and the premise at the
same time. The strategy is therefore deliberately lopsided.

---

## 1. Where effort goes

| Area | Coverage | Why |
|---|---|---|
| `core` digest determinism | **Exhaustive** | A mismatch between CLI and attester produces false divergence. This is the one bug that cannot be recovered from on stage. |
| Contract invariants | **High** | Append-only is the product claim. A judge may read the Solidity. |
| CLI verdict logic | Medium | Wrong verdicts are visible but recoverable |
| Attester loop | Medium | Focus on the match/mismatch/unreachable branches |
| Indexer | Light | Idempotency and reorg only |
| Dashboard | Smoke only | Manual testing is faster here, and the demo path is rehearsed anyway |

Do not spread coverage evenly. Spend it where failure is unrecoverable.

---

## 2. Tooling

- **Vitest** for all TypeScript packages. Fast, ESM-native, no config fight.
- **Hardhat + viem** for contracts. Not ethers — one chain library across the repo.
- `pnpm test` runs unit tests only. Integration tests are excluded by default and run with
  `pnpm test:integration`.
- No network access in unit tests. Registry and chain are injected interfaces with fakes.

---

## 3. The determinism harness

This is the most important test suite in the repository. It lives in
`packages/core/test/determinism.test.ts` and implements `SPEC-DIGEST.md` §7.

```ts
// the shape these tests must take
const tgz   = readFixture('greeting-1.0.0.tgz')
const dir   = extractToTemp(tgz)

expect(digestOf(tgz)).toBe(digestOf(dir))                  // source equivalence
expect(digestOf(repack(tgz, { level: 1, mtime: 0 })))
  .toBe(digestOf(tgz))                                     // repack invariance
expect(digestOf(flipOneByte(tgz))).not.toBe(digestOf(tgz)) // content sensitivity
expect(digestOf(swapContents(tgz, 'a.js', 'b.js')))
  .not.toBe(digestOf(tgz))                                 // move sensitivity
```

The two that catch real bugs are **repack invariance** and **move sensitivity**. A
careless implementation — hashing the tarball, or hashing a bag of content hashes without
binding paths — passes the other nine and fails these.

### Golden vectors

Commit `packages/core/test/fixtures/golden.json`:

```jsonc
{
  "digestSpec": "cairn-merkle-v1",
  "cases": [
    { "fixture": "greeting-1.0.0.tgz", "artifactDigest": "0x…", "entryCount": 3 }
  ]
}
```

Generated once, then frozen. This catches accidental algorithm drift during refactors,
which is otherwise invisible — every test still passes against the new, wrong algorithm
because they all use the same code to compute both sides.

If a golden vector changes, that is either a bug or a deliberate spec version bump. Never
regenerate goldens to make a test pass.

### Cross-package parity

`packages/core/test/parity.test.ts` asserts that the EIP-712 type hash constants in
`@cairn/core` equal those compiled into the contract. Drift here produces signature
failures that are extremely unpleasant to debug under time pressure.

Also assert that the attester and the CLI call **the same exported function** — not two
functions that happen to agree today.

---

## 4. Contract tests

Per `SPEC-CONTRACTS.md` §6. The non-obvious ones worth writing explicitly:

- **Divergence does not revert.** It must be recorded, not rejected. Reverting would
  discard the evidence the whole system exists to capture.
- **Divergence poisons quorum.** `hasQuorum` returns false even at M corroborations when a
  divergence is on record.
- **No mutation surface.** Iterate the ABI and assert no function can alter a stored
  attestation. Thirty seconds to write, and it is the direct answer to "how do we know it's
  really immutable?"
- **Removed attester, unchanged history.** Removing an attester from `QuorumPolicy` must
  not alter any past corroboration.

---

## 5. Integration tests

`test/integration/`, excluded from `pnpm test`. Requires a running Hardhat node and
Verdaccio.

One test matters: **the full demo path, automated.**

```
publish → 3 attesters corroborate → quorum → verify PASS
       → tamper and republish
       → recheck → divergence on-chain
       → verify BLOCK with exit code 1
```

Write it at H+15 once the demo path works manually. It then becomes the regression guard
for everything after, and it is the script the demo follows — so a green integration run at
H+22 is direct evidence the demo will work.

---

## 6. CI

GitHub Actions on every push:

```
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Keep it under three minutes. A slow pipeline gets bypassed under time pressure, and a
bypassed pipeline is worse than none because it creates false confidence.

The commit history and green CI badge are both visible to judges. They are evidence of
process, which the rubric notices even where it does not score it directly.

---

## 7. What not to test

Skip, deliberately:

- Dashboard component unit tests — manual plus the rehearsed demo path is better value here
- Exhaustive CLI argument parsing — Commander is already tested
- Mongo query construction — thin wrapper, low risk
- Anything requiring a mocking framework more elaborate than a hand-written fake

If a test takes longer to write than the bug would take to find manually during the
rehearsal, it is not worth writing today. Record it in `ROADMAP.md` instead.
