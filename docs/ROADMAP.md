# Roadmap

Three tiers. Tier 1 is the hackathon scope and the only thing built in the window. Tiers 2
and 3 exist so good ideas have somewhere to go that is not the codebase at hour 19.

**Park ideas here.** Writing something in this file during the build is how scope stays
frozen without losing the thought.

---

## Tier 1 — the 24-hour MVP (in scope)

The five proposal features. See `CLAUDE.md` §0.2. Nothing is added to this list.

1. Append-only attestation registry (on-chain)
2. Publish CLI
3. Independent attester node
4. Verify CLI / CI gate
5. Transparency dashboard

---

## Tier 2 — the extensions cut from the proposal

These were named as out of scope in the Phase 1 document, which means mentioning them in
the pitch is consistent rather than contradictory. Present them as deliberate, not missing.

### 2.1 Staked attesters and slashing

**The MVP's weakest point.** Today the attester set is admin-managed and attesters have no
economic stake.

- Attesters bond collateral to join; the set becomes permissionless above a stake floor.
- Slashing on provable misbehaviour: signing a digest demonstrably different from what the
  registry served at that time, provable by any third party re-fetching and submitting a
  counter-attestation within a challenge window.
- Rewards funded by consumer subscriptions or sponsoring foundations, so running an
  attester is sustainable rather than charitable.
- Design problem worth naming: slashing requires an oracle for "what the registry served
  at time T", which is itself a trust question. A challenge-response game with a bonded
  challenger is the likely shape.

### 2.2 Multi-registry support

The `RegistryAdapter` interface (`ARCHITECTURE.md` §4.2) already isolates ecosystem
specifics. Order of value:

1. **PyPI** — multi-ecosystem campaigns targeting npm and PyPI simultaneously are already
   documented, so this is the highest-value second adapter.
2. **Maven Central** — different artifact model (jars, poms, classifiers); more work.
3. **crates.io**, **NuGet**, **Hugging Face** — Hugging Face is interesting because model
   artifacts are large, mutable in practice, and almost entirely unverified today.

Each adapter needs its own canonicalisation rules. Python wheels and sdists differ enough
that `normalise()` is not shared.

### 2.3 Reproducible-build proofs

Today CAIRN proves an artifact has not changed since attestation. It does not prove the
artifact corresponds to its claimed source.

- Attesters rebuild from the source repository in a pinned environment and attest that the
  rebuild matches the published artifact.
- Where a build is not bit-reproducible, attest a normalised form (strip timestamps, sort
  archive entries — the same canonicalisation discipline, one layer up).
- This closes the trust-on-first-use gap, which is currently the honest answer to "what
  about the first publication?"

---

## Tier 3 — the longer product

### 3.1 Economics and governance

- Subscription or usage pricing for teams running `verify` in CI at scale.
- Governance of the quorum threshold and the slashing rules; a foundation rather than a
  company, given the product is a public trust layer.
- Public-good funding for attesters operated by university security labs — low cost,
  high credibility, and a natural fit with the independence requirement.

### 3.2 Mainnet and cost

- L2 deployment; attestation volume across npm alone is large, so per-attestation gas
  dominates. Likely design: batch attestations into a periodic Merkle commitment with
  individual inclusion proofs, exactly as Certificate Transparency does with signed tree
  heads.
- Archival strategy for payloads — IPFS pinning is not durable on its own.

### 3.3 Ecosystem integration

- Package manager plugin so verification happens at install time rather than as a separate
  CI step. The lower the friction, the higher the adoption, and adoption is the whole game
  for a trust layer.
- Native CI actions for GitHub, GitLab, CircleCI.
- SBOM export (CycloneDX / SPDX) with CAIRN attestation references attached, which is what
  procurement frameworks will increasingly require.

### 3.4 Detection beyond divergence

CAIRN deliberately does not classify maliciousness. Adjacent signals it is well positioned
to surface without that:

- **Anomalous publication patterns** — a dormant package publishing after a long gap,
  maintainer key rotation immediately before a release, a first release from a new signer
  on an established package.
- **Attester disagreement as a signal in itself** — split results across geographically
  diverse attesters indicate a targeted or regional attack, which nothing else detects.
- **Install-time divergence telemetry** — aggregated, consented reports from `verify` runs
  turn every user into a passive observer, which is how CT's gossip protocol achieves
  global detection.

That last one is the most interesting long-term direction: the gate is already computing a
digest on every developer machine. Those computations are a detection network that nobody
is currently collecting.

---

## Parked during the build

> Add items here as they come up. Date them. Do not implement them.

| Date | Idea | Raised by |
|---|---|---|
| | | |
