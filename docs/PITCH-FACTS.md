# Pitch facts — every number measured, every claim sourced

For the slides and the Q&A. Each figure below was produced by running the system, and says
where it came from. Re-measure rather than round up.

## Live, public, verifiable

| What | Where |
|---|---|
| Dashboard | https://cairn-two-ecru.vercel.app (big-screen view: `/live`) |
| AttestationRegistry (Base Sepolia, chain 84532) | [`0x6261c3ba0c08768e0c2b0ef6028a5ebf6f6b77ec`](https://sepolia.basescan.org/address/0x6261c3ba0c08768e0c2b0ef6028a5ebf6f6b77ec) |
| QuorumPolicy (2-of-3) | [`0x0b6326608c7df477c0389137485fafb50ac4346a`](https://sepolia.basescan.org/address/0x0b6326608c7df477c0389137485fafb50ac4346a) |
| Indexer API | https://cairn-indexer.onrender.com/api/v1/stats (MongoDB, read-only) |
| CI gate in action | GitHub Actions → *demo: tampered dependency* — clean job green, tampered job red ([example run](https://github.com/theseriouscoder123/CARIN/actions/runs/44921347066)) |
| Adoption | `uses: theseriouscoder123/CARIN@v1` |

## On-chain state (Base Sepolia, as of this document)

| Figure | Value | Source |
|---|---|---|
| Releases attested | **95** | indexer `/stats` |
| Verified by 3-attester quorum | **90** | indexer `/stats` |
| Divergent (caught republications) | **5** — every demo run, kept permanently | indexer `/stats` |
| Real npm releases in the public baseline | **86** (express, chalk, debug, semver, glob, yargs, …) | `fixtures/demo/baseline-packages.json` |

## Real-world usefulness

| Figure | Value | Source |
|---|---|---|
| Real project verified | express + webpack + eslint + jest — **437 unique dependencies** | `fixtures/demo/real-world/` |
| Coverage today | **89 of 437 (20.4%)** attested on-chain and fully verified | `cairn verify` on that lockfile |
| Time to verify all 437 against the public chain | **12.9 s** (cold cache: 11.1 s in an earlier run; warm: 6.2 s) | measured with the CLI |
| RPC requests for the whole tree's on-chain state | a handful — Multicall3, 100 packages per request (vs ~2,185 individually) | `CairnClient.getRecords` |

## The demo, measured

| Figure | Value | Source |
|---|---|---|
| Full tamper-to-block sequence, unattended, on Base Sepolia | **50–61 s** | `pnpm demo:rehearse:base-sepolia` (REHEARSAL GREEN) |
| Publish → all 3 independent corroborations on-chain | **5–7 s** | rehearsal timings |
| Same artifact, digest on local Hardhat vs Base Sepolia | **identical** (e.g. left-pad@1.3.0 `0x7aacfd0a…`) | seed runs on both chains |

## Cost (measured from Base Sepolia receipts)

| Operation | Gas | Fee at test prices |
|---|---|---|
| Attest a release (`submit`) | **135,501** | ~0.0000008 ETH |
| Corroborate (`corroborate`) | **65,502** | ~0.0000004 ETH |
| A release with 3 corroborations | ~330k gas | ~0.000002 ETH — around a cent at comparable mainnet gas prices, paid once per release, not per install |

## Engineering evidence

| Figure | Value |
|---|---|
| Automated tests | **205** — core 77, CLI 48, indexer 37 (incl. MongoDB 8.0), contracts 28, attester 15 |
| Digest determinism | all 11 spec cases + golden vector from a real `npm pack` |
| Hostile-input fuzzing of the archive parser | ~8,000 random / mutated archives; every one yields a tree or a typed error |
| End-to-end integration test | cold start → publish → quorum → PASS → tamper → divergence → BLOCK, green repeatedly (~55–70 s) |
| Contract immutability | ABI exposes only `submit` + `corroborate`; bytecode scanned for DELEGATECALL / SELFDESTRUCT / CALLCODE |
| Commits | 47+ in the window, first code commit 16:16 IST |
| Supply-chain hygiene | dependencies pinned past a 7-day release cooldown, install scripts allow-listed, SBOM (CycloneDX) per CI run |

## Honest limits (say them before a judge does)

- The three attesters are separate processes with separate keys, but **all run on our machine**.
- The attester set is **admin-managed**; the admin cannot alter or erase any attestation.
- A brand-new package name is **trust-on-first-use**.
- CAIRN detects **divergence**, not maliciousness.

Full detail: `docs/THREAT-MODEL.md`.
