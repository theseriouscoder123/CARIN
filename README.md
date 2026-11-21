# CAIRN

**Quorum-verified provenance for open-source dependencies.**

Your lockfile trusts one registry. CAIRN doesn't. Independent attesters verify every
package on-chain, so a tampered dependency is blocked in CI before it ever reaches your
build.

---

## The problem

More than **454,600 new malicious packages** were catalogued across the major open-source
registries during 2025 — a 75% rise year on year — and over 99% of them landed on npm.
Supply-chain compromise is now the **second most common initial attack vector** in
enterprise breaches, implicated in 15% of them, at an average cost of USD 4.91 million and
a mean lifecycle of 267 days. Compromise has moved to the account layer: **92%** of every
npm account-takeover advisory ever recorded was filed in 2025 alone.

Every defence currently deployed ultimately asks you to trust the registry operator — the
same party that can unpublish a version, re-point a tag, or be taken over. There is no
independently verifiable record of what a package version *actually was* at the moment it
was published.

Detection tooling is structurally blind to this. One research corpus of 106 supply-chain
campaigns recorded **zero CVEs assigned** across all of them while they were being actively
exploited: a deliberately malicious package is not a vulnerability in a package, so there
is no advisory to publish until someone has already been harmed.

## The approach

In 2013 the web faced a structurally identical problem. Certificate authorities could
mis-issue certificates and no relying party could prove it. The answer was not a more
trustworthy CA — it was **Certificate Transparency**: a public, append-only log that made
mis-issuance detectable by anyone, without requiring anyone to be trusted.

CAIRN builds the equivalent for package artifacts, with one addition the original design
could not economically achieve: **independent re-verification of the artifact itself.**

```
  maintainer ──sign──▶ append-only registry ◀──co-sign── attester ×N
                              │                              ▲
                              │                              │ re-fetch
                              ▼                              │
                      M-of-N quorum              public package registry
                              │                              ▲
                              ▼                              │ install
                    cairn verify ──▶ PASS / BLOCK ──▶ your CI pipeline
```

1. **Maintainers attest.** On release, the CLI computes a reproducible SHA-256 Merkle
   digest of the artifact, signs it with an EIP-712 typed signature, and writes it to an
   append-only smart contract.
2. **Independent attesters corroborate.** Nodes run by parties unrelated to the maintainer
   or the registry re-fetch the artifact, recompute the digest, and co-sign on-chain only
   if it matches. A mismatch is recorded as a divergence, not discarded.
   *(In this hackathon MVP the three attesters are separate processes with separate keys,
   but all run on the team's machine — see [Known limitations](docs/THREAT-MODEL.md#known-limitations-stated-not-hidden).)*
3. **Quorum decides.** An attestation is valid only once M of N attesters agree. Trust is
   distributed across the attester set rather than concentrated in any operator.
4. **CI enforces.** `cairn verify` resolves the lockfile, digests every artifact it is
   about to install, checks on-chain quorum state, and fails the build with a non-zero exit
   code on anything unattested, under-quorum, or divergent.

CAIRN never tries to decide whether code is *malicious*. It detects **divergence** — the
same version string resolving to different bytes than were attested. That is the mechanical
signature of republication, tag re-pointing and account takeover, and it is visible from
the first victim onward.

## What this is not

CAIRN complements rather than replaces existing build-provenance schemes. Two gaps remain,
and CAIRN targets both:

- Registry-native provenance and sigstore-style logs attest **where an artifact was built**.
  None has an independent party re-fetch the published artifact and confirm that what the
  registry *now serves* still matches what was built.
- Their transparency logs are operated by single organisations, which reintroduces exactly
  the trusted-party assumption they were designed to remove.

## Status

Competition entry for **Hacksphere 2026 / COMPSPHERE 2026**, built during a 24-hour
hackathon window. See `CLAUDE.md` §0 for the rules that govern this repository and
`docs/ROADMAP.md` for what is deliberately out of scope.

## Repository

```
apps/web         Next.js 16 transparency dashboard
apps/indexer     Express + viem event watcher → MongoDB (read-only API)
apps/attester    Independent attester daemon
packages/core    Digest, canonicalisation, EIP-712 types  ← the keystone
packages/cli     The `cairn` binary
packages/contracts  Solidity 0.8.26, Hardhat
fixtures/demo/   The tamper demo: fixture package, consumer project, scripts
test/integration The full demo path, automated
docs/            Specifications
```

## Live deployment

- Dashboard: https://cairn-two-ecru.vercel.app
- `AttestationRegistry` on Base Sepolia (chain 84532):
  [`0x6261c3ba0c08768e0c2b0ef6028a5ebf6f6b77ec`](https://sepolia.basescan.org/address/0x6261c3ba0c08768e0c2b0ef6028a5ebf6f6b77ec)
- `QuorumPolicy` (2-of-3):
  [`0x0b6326608c7df477c0389137485fafb50ac4346a`](https://sepolia.basescan.org/address/0x0b6326608c7df477c0389137485fafb50ac4346a)

Every attestation, corroboration and divergence the demo produces is a public transaction on
Base Sepolia. Live on Base Sepolia since block 61748176.

## Install the CLI

A single self-contained file on [GitHub Releases](https://github.com/theseriouscoder123/CARIN/releases)
(not on the npm registry), preconfigured for the public Base Sepolia deployment. Node.js 22+.

```bash
npx --yes https://github.com/theseriouscoder123/CARIN/releases/download/cli-v0.1.0/cairn-cli-0.1.0.tgz verify
```

Full guide: [cairn-two-ecru.vercel.app/docs](https://cairn-two-ecru.vercel.app/docs)

## Use it in CI

One step in any GitHub Actions workflow, after checkout:

```yaml
- uses: theseriouscoder123/CARIN@v1
  with:
    lockfile: package-lock.json      # npm lockfile v2/v3
    fail-on: under-quorum            # divergent | under-quorum | unattested
```

It digests every dependency from the bytes the runner downloads, reads quorum from the
contract on Base Sepolia, writes a verdict table to the job summary, and fails the job on a
divergent dependency. See it in action:
[demo workflow](.github/workflows/demo-tampered-dependency.yml) — a clean lockfile passes,
a republished dependency is blocked.

## Documentation

- [Pitch facts](docs/PITCH-FACTS.md) — every number measured on the live deployment
- [Threat model](docs/THREAT-MODEL.md) — what CAIRN defends against, and its known limits
- [Decision records](docs/DECISIONS.md) — every deliberate departure from the original specs
- [Indexer API (OpenAPI)](docs/openapi.yaml)
- [Demo runbook](docs/DEMO-RUNBOOK.md) · [Architecture](docs/ARCHITECTURE.md)

## Quick start

Requires Node 22 (`corepack enable` for pnpm 12). Docker is optional (MongoDB only).

```bash
pnpm install && pnpm build

# see the whole thing work, unattended, in about a minute:
pnpm test:integration          # cold-starts chain + registry + 3 attesters + indexer,
                               # runs publish → quorum → PASS → tamper → divergence → BLOCK
```

Or run it by hand, one terminal each:

```bash
pnpm chain                     # local Hardhat chain on :8545
pnpm registry:up               # local npm registry (Verdaccio) on :4873
pnpm deploy:local && pnpm seed:local
pnpm attesters:demo            # three independent attester processes, :4001-4003
pnpm dev                       # indexer :4100 + dashboard http://localhost:3000
```

```bash
# Hardhat's published dev account #1 — a well-known test key, local chain only
export CAIRN_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
pnpm demo:release                         # publish the demo package to the local registry
npx cairn publish fixtures/demo/cairn-demo-greeting-1.0.0.tgz
npx cairn verify --lockfile fixtures/demo/consumer/package-lock.json    # PASS, exit 0
pnpm demo:tamper && pnpm demo:recheck     # republish 1.0.0 with different bytes
npx cairn verify --lockfile fixtures/demo/consumer/package-lock.json    # BLOCKED, exit 1
```

MongoDB for the indexer (otherwise it keeps an in-memory index rebuilt from chain events):
`pnpm db:up`, then `MONGODB_URI=mongodb://127.0.0.1:27018 pnpm dev`.

Full walkthrough: `docs/DEMO-RUNBOOK.md`.

## Sources

1. Sonatype (2026). *State of the Software Supply Chain — Open Source Malware.*
2. ReversingLabs (2026). *Software Supply Chain Security Report.*
3. IBM Security (2025). *Cost of a Data Breach Report.*
4. Endor Labs (April 2026). *Analysis of npm account-takeover advisories in the OSV database.*
5. Phoenix Security (2026). *Malware Package Intelligence: open-source supply chain attack campaigns, 2024–2026.*
6. Laurie, B., Langley, A., Kasper, E. (2013). *RFC 6962: Certificate Transparency.* IETF.
