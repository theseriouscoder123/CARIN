# Architecture

## 1. Trust model

This is the part judges will probe. State it precisely.

### What CAIRN assumes

- **At least M of N attesters are honest and independent.** This is the core assumption.
  Everything else follows from it.
- **The chain is live and its history is immutable.** Standard blockchain assumption.
- **SHA-256 is collision-resistant.**

### What CAIRN does *not* assume

- That the registry is honest. A registry serving different bytes than were attested is
  precisely what CAIRN detects.
- That the maintainer's key is uncompromised. A compromised maintainer can publish a new
  version, but cannot silently alter an already-attested one, because the record is
  append-only and attesters observe the live artifact.
- That any single attester is honest. One dishonest attester cannot forge quorum; it can
  only withhold its signature or submit a false divergence, both of which are visible
  on-chain and attributable.
- That the CAIRN operators are honest. There is no privileged write path to attestation
  records.

### Known weaknesses in the MVP — say these before a judge does

| Weakness | Why it exists | Roadmap answer |
|---|---|---|
| Attester set is admin-managed | 24-hour scope; no staking economics | Staked, permissionless attesters (`ROADMAP.md` §2.1) |
| Attesters have no skin in the game | No slashing contract | Bonded stake + slashing on provable false attestation |
| First-publication trust-on-first-use | Nothing to compare the first release against | Reproducible-build proofs tie artifact to source |
| npm only | Adapter written for one ecosystem | Adapter interface already isolates this (§4.3) |
| Attesters fetch from the same registry | A registry could serve attesters different bytes than users | Geographically and network-diverse attesters; client-side digest reporting |

That last row is the sharpest question available to a hostile judge. The honest answer:
CAIRN raises the cost of a targeted attack from "compromise one account" to "serve
consistent malicious bytes to N independent observers *and* the victim, without any of
them cross-checking" — and because the victim's own `cairn verify` computes the digest
locally from what it actually received, a registry serving split content is caught at the
gate rather than by the attesters.

---

## 2. Component map

```
┌─ actors ──────────────────────────────────────────────────────────────┐
│  Package Maintainer                    Developer / CI Pipeline        │
└───────┬────────────────────────────────────────────┬──────────────────┘
        │ 1. sign release                            │ 9. install / CI run
        ▼                                            ▼
┌─ client tier (TypeScript) ────────────────────────────────────────────┐
│  cairn publish                          cairn verify                  │
│  canonicalise → digest → sign           lockfile → digest tree → gate │
└───────┬──────────────┬──────────────────────────────┬────────────────┘
        │ 2. publish   │ 3. payload                   │ 10. read quorum
        ▼              ▼                              │
┌─ external ────────────────────────┐                 │
│  npm registry      IPFS / store   │                 │
└───────┬───────────────────────────┘                 │
        │ 5. re-fetch                                 │
        ▼                                             │
┌─ off-chain services (Node.js) ────────────────────┐ │
│  Attester ×N   Divergence Monitor   Indexer API   │ │
└───────┬───────────────────────────────┬───────────┘ │
        │ 6. co-sign                    │ 7. events   │
        ▼                               ▲             ▼
┌─ on-chain (Solidity) ─────────────────────────────────────────────────┐
│  AttestationRegistry.sol        QuorumPolicy.sol                      │
│  append-only · no update        M-of-N threshold · attester set       │
└───────────────────────────────────────┬───────────────────────────────┘
                                        │ 8. timeline
                                        ▼
                            Transparency Dashboard (Next.js)
```

---

## 3. Data flow

### 3.1 Publication (steps 1–4)

1. Maintainer runs `cairn publish` against a built tarball.
2. The CLI canonicalises the artifact and computes `artifactDigest` (Merkle root) and
   `tarballHash` (SHA-256 of raw bytes). See `SPEC-DIGEST.md`.
3. The full attestation payload — file manifest, tool versions, timestamps — is written to
   content-addressed storage; only its digest is anchored on-chain.
4. The CLI signs an EIP-712 `Attestation` struct and submits it to
   `AttestationRegistry.submit()`.

### 3.2 Corroboration (steps 5–6)

5. Each attester node watches `AttestationSubmitted` events. On a new event it
   independently fetches the artifact **from the public registry**, not from the publisher,
   and recomputes the digest using the same `@cairn/core` routine.
6. On match it calls `corroborate()`; on mismatch it calls `reportDivergence()` with the
   digest it observed. `QuorumPolicy` evaluates accumulated corroborations against the
   threshold.

The attester never trusts the publisher's claimed digest as input to its own computation.
It computes independently and compares afterwards.

### 3.3 Indexing (steps 7–8)

7. The registry emits events; `apps/indexer` consumes them via a long-lived viem watcher
   into MongoDB.
8. The dashboard renders package timelines, quorum state, attester identities and
   divergence alerts from the indexer's read API.

The indexer is **a cache, never an authority.** It exists so the dashboard is fast. No
gate decision is ever derived from it.

### 3.4 Enforcement (steps 9–11)

9. A developer or CI job runs `cairn verify`.
10. The CLI parses the lockfile, resolves every artifact it is about to install, computes
    each digest locally, and reads quorum state **directly from the contract**.
11. It emits a per-dependency verdict and exits non-zero on failure, failing the pipeline.

---

## 4. Boundaries and interfaces

### 4.1 `packages/core` — the keystone

Exports, and nothing beyond them:

```ts
// digest
canonicalise(input: TarballSource): Promise<CanonicalTree>
computeArtifactDigest(tree: CanonicalTree): Hex      // Merkle root, RFC 6962 style
computeTarballHash(bytes: Uint8Array): Hex

// identity
packageId(eco: Ecosystem, name: string, version: string): Hex

// signing
ATTESTATION_TYPES, CORROBORATION_TYPES, domain(chainId, verifyingContract)
signAttestation(account, payload): Promise<Hex>

// chain reads (shared by CLI, attester, indexer)
createCairnClient(config): CairnClient
```

Every consumer imports digest logic from here. There is no second implementation.

### 4.2 Registry adapter

Ecosystem-specific behaviour is confined to one interface:

```ts
interface RegistryAdapter {
  readonly ecosystem: Ecosystem
  resolve(name: string, version: string): Promise<ArtifactRef>
  fetch(ref: ArtifactRef): Promise<Uint8Array>
  normalise(entryPath: string): string | null   // null = exclude from tree
}
```

`NpmAdapter` is the only implementation in scope. Adding PyPI later is a new file, not a
refactor — this is the claim made in the proposal's scalability section, so the interface
must actually hold it.

### 4.3 Chain access

All three off-chain consumers (CLI, attester, indexer) read through one viem-based client
in `core`. Contract addresses and chain ID come from environment, never hardcoded, so the
local-Hardhat → public-testnet switch is configuration.

---

## 5. Why two backends

`apps/indexer` is a separate Express process rather than Next.js route handlers because the
event watcher holds a **long-lived chain subscription**. Serverless route handlers cannot
keep one alive between invocations.

The dashboard's read endpoints *could* live in Next.js route handlers; the watcher could
not. Keeping both in `indexer` keeps the data path in one place. This is the prepared
answer to "why do you have two backends?"

---

## 6. Failure modes

| Failure | Behaviour | Rationale |
|---|---|---|
| Chain unreachable during `verify` | Exit non-zero, verdict `UNKNOWN` | Fail closed. A PASS must never be produced by absence of evidence. |
| Indexer down | Dashboard degrades; gate unaffected | Indexer is not authoritative. |
| Registry 404 during attestation | Attester retries with backoff, then records `UNREACHABLE` | Absence is not divergence. |
| Digest mismatch | `reportDivergence()` on-chain, dashboard alert, `verify` BLOCKs | The core detection path. |
| Attester disagreement | No quorum → `UNDER_QUORUM` → BLOCK under default policy | Disagreement is itself a signal. |
| Duplicate submission | Contract reverts `AttestationExists` | Append-only invariant. |

---

## 7. What is deliberately absent

No proxy contract. No upgradeability. No admin mutation of attestation records. No
off-chain "trusted" fast path that bypasses quorum. No mock data reachable from a
production code path.

Each of these is a design decision, not an omission, and each is defensible in Q&A.
