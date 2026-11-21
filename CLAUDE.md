# CLAUDE.md

Agent instructions for the CAIRN repository. Read this before any other file.

---

## 0. HARD CONSTRAINTS — READ FIRST

CAIRN is a competition entry for **Hacksphere 2026 (COMPSPHERE 2026)**, built during a
**24-hour hackathon window**. Three rules override every other consideration in this file.

### 0.1 Originality — no code before the window opens

All implementation code must be written **inside** the official 24-hour window. The judges
inspect the public repository's commit history as proof of work.

- **Do not write implementation code, config, or scaffolding before the window opens.**
  The `docs/` tree is planning material and is allowed. Everything else is not.
- The first commit of real code must fall inside the window.
- Commit frequently and with meaningful messages. The commit graph is evidence.
- No copying from a previous project, a template repo, or a prior CAIRN attempt.

If you are asked to implement something and the window has not opened, say so and stop.

### 0.2 Conceptual consistency — build exactly what was proposed

The Phase 1 proposal is a binding contract. Scope is **five features, no more, no fewer**.
Pivoting mid-build is penalised.

| # | Feature | Package |
|---|---------|---------|
| 1 | Append-only attestation registry (on-chain) | `packages/contracts` |
| 2 | Publish CLI (`cairn publish`) | `packages/cli` + `packages/core` |
| 3 | Independent attester node | `apps/attester` |
| 4 | Verify CLI / CI gate (`cairn verify`) | `packages/cli` |
| 5 | Transparency dashboard | `apps/web` + `apps/indexer` |

Explicitly **out of scope** for the 24-hour build (see `docs/ROADMAP.md`):
attester staking and slashing, zero-knowledge build-reproducibility proofs,
registries other than npm, browser extension, mainnet deployment.

If an idea is good but not in the table above, write it in `docs/ROADMAP.md`. Do not build it.

### 0.3 No fake mockups

Every feature demonstrated at pitching must genuinely work. Hardcoded demo paths,
stubbed responses dressed as real ones, and screenshots standing in for running software
are heavily penalised.

- No mock data in any code path that the demo touches.
- If something is not finished, it is cut from the demo — not faked.
- Fixtures used for *testing* are fine and belong in `test/fixtures/`. They must never be
  reachable from a production code path.

---

## 1. What CAIRN is

CAIRN proves that an installed software dependency is byte-for-byte what its maintainer
published, and blocks the build if it is not.

The model is **Certificate Transparency applied to package artifacts**. Certificate
authorities could mis-issue and nobody could prove it; the answer was not a better CA but a
public, append-only log that made mis-issuance detectable by anyone. Package registries sit
in the same position today — a single trusted issuer whose records are mutable and whose
compromise is invisible downstream.

Four moving parts:

1. A maintainer signs a reproducible digest of a release and writes it to an append-only
   contract.
2. Independent attester nodes re-fetch the published artifact, recompute the digest, and
   co-sign on-chain if it matches.
3. An attestation counts only once **M of N** attesters agree.
4. `cairn verify` resolves a lockfile, digests every artifact it is about to install, checks
   on-chain quorum state, and fails the build on anything unattested, under-quorum, or
   divergent.

**The central claim, which must survive Q&A:** CAIRN never decides whether code is
*malicious*. It detects **divergence** — the same version string resolving to different
bytes than were attested. That is the mechanical signature of republication, tag
re-pointing and account takeover, and it is observable from the first victim onward rather
than after a CVE is published.

---

## 2. Repository layout

```
cairn/
├── CLAUDE.md                  ← you are here
├── README.md
├── docs/                      ← specs; written before the window, read during it
├── package.json               ← workspace root, private
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── apps/
│   ├── web/                   Next.js 16 dashboard (App Router)
│   ├── indexer/               Express + viem event watcher → MongoDB
│   └── attester/              Independent attester daemon
└── packages/
    ├── core/                  ★ digest, canonicalisation, EIP-712 types, chain client
    ├── cli/                   `cairn` binary (publish, verify)
    ├── contracts/             Hardhat project (Solidity 0.8.26)
    └── config/                shared tsconfig / eslint presets
```

### `packages/core` is the keystone

Digest computation lives in `core` and **nowhere else**. The CLI and the attester must
produce identical digests for the same artifact; if that logic is duplicated and the two
copies drift, CAIRN reports false divergence and the entire premise collapses on stage.

Any change to digest logic is a change to `core`, with fixture tests updated in the same
commit.

---

## 3. Commands

```bash
pnpm install                  # workspace install (always from repo root)

pnpm build                    # turbo build, all packages
pnpm dev                      # turbo dev, parallel watch mode
pnpm test                     # vitest across TS packages + hardhat tests
pnpm lint
pnpm typecheck

# contracts
pnpm --filter @cairn/contracts hardhat compile
pnpm --filter @cairn/contracts hardhat test
pnpm --filter @cairn/contracts hardhat node          # local chain, port 8545
pnpm --filter @cairn/contracts deploy:local

# local end-to-end loop (each in its own terminal)
pnpm chain                    # Hardhat node on :8545
pnpm deploy:local             # writes packages/contracts/deployments/31337.json
pnpm seed:local               # publishes real npm artifacts (no corroboration)
pnpm attesters:up             # three separate attester processes, :4001-4003
pnpm cairn publish --package <name@version>   # needs CAIRN_PRIVATE_KEY

# local registry (demo fixture — see docs/DEMO-RUNBOOK.md)
pnpm registry:up              # Verdaccio on :4873
pnpm registry:reset            # wipe local registry state (stop it first)

# the CLI, during development
pnpm --filter @cairn/cli dev -- publish --help
npx cairn verify --lockfile fixtures/demo/consumer/package-lock.json
pnpm test:integration         # full demo path, cold start to BLOCK (stack must be stopped)
```

Always run pnpm from the repo root unless using `--filter`. Never `npm install` inside a
workspace package; it will corrupt the lockfile.

---

## 4. Stack and versions

| Layer | Choice | Notes |
|-------|--------|-------|
| Runtime | Node.js 22 (>=22.10) | `.nvmrc` pinned; Hardhat 3 requires >=22.10 |
| Package manager | pnpm 12 + workspaces | `packageManager` field pins the exact version; run `corepack enable` |
| Build orchestration | Turborepo | caching on; `turbo.json` defines the graph |
| Language | TypeScript 5.x, `strict: true` | ESM throughout (`"type": "module"`) |
| Contracts | Solidity 0.8.26, Hardhat (TS) | OpenZeppelin for `ECDSA`, `EIP712` |
| Chain (dev) | **Hardhat Network, local only** | Testnet deployment deferred — see §4.1 |
| Chain client | viem | not ethers; viem everywhere, including Hardhat tests |
| Frontend | Next.js 16 App Router, Tailwind, wagmi + viem | |
| API | Express 4, MongoDB (Atlas or local Docker) | |
| Testing | Vitest (TS), Hardhat + viem (contracts) | |
| Validation | zod at every external boundary | |

### 4.1 Chain target

Development runs against **local Hardhat Network only**. Do not add testnet RPC URLs,
faucet steps, or deployment scripts for a public chain until that decision is made.

Keep deployment chain-agnostic so the switch is a config change, not a refactor:
all addresses and the chain ID come from env, never hardcoded.

> **Pitching caveat:** the Phase 2 rubric scores a live public deployment above a localhost
> demo. Before the window ends, the team must decide whether to ship to a public testnet.
> Write the deploy path so that decision costs minutes, not hours.

---

## 5. Conventions

### TypeScript
- ESM only. No CommonJS, no `require`.
- `strict: true`, `noUncheckedIndexedAccess: true`. No `any` — use `unknown` and narrow.
- Validate every external input (registry responses, API bodies, env, lockfiles) with zod
  at the boundary. Internal functions trust their types.
- Errors: throw typed error classes from `@cairn/core/errors`. Never throw bare strings.
- No default exports except Next.js pages/layouts, which require them.

### Solidity
- Custom errors, not `require` strings.
- `immutable` for anything set once at construction.
- Checks-Effects-Interactions, even where no external call exists today.
- NatSpec on every external and public function.
- **No proxy, no upgradeability, no owner-controlled mutation of attestation records.**
  Immutability is the product. A judge who finds an upgrade path has found the flaw that
  invalidates the pitch.

### Naming
- Packages: `@cairn/<name>`.
- Files: `kebab-case.ts`. Types and classes: `PascalCase`. Everything else: `camelCase`.
- Solidity files: `PascalCase.sol`, matching the contract name.

### Git
- Conventional commits: `feat(core): …`, `fix(cli): …`, `docs: …`, `test(contracts): …`.
- Small, frequent commits. The history is graded.
- `main` is the demo branch; it must build at every commit after the first hour.

---

## 6. Invariants — do not break these

1. **Digest determinism.** Two independent runs over the same artifact, on different
   machines, from different sources (raw tarball vs extracted directory), produce the same
   `artifactDigest`. Fixture tests enforce this. If you touch canonicalisation, you run them.

2. **Append-only.** `AttestationRegistry` has no update path and no delete path. Submitting
   twice for the same `packageId` reverts. There is no admin override. No proxy.

3. **Single source of digest truth.** Only `packages/core` computes digests.

4. **Quorum is evaluated on-chain.** The CLI's verdict is derived from contract state read
   at verify time, never from the indexer's cache. The indexer is a read-through convenience
   for the dashboard; it is never authoritative for a gate decision.

5. **The gate fails closed.** If quorum state cannot be read, `cairn verify` exits non-zero.
   An unreachable chain must never produce a PASS.

6. **No network calls in unit tests.** Registry and chain interactions are injected
   interfaces, faked in tests. Integration tests that do hit the network live under
   `test/integration/` and are excluded from the default `pnpm test` run.

---

## 7. Known traps

- **npm forbids republishing a version.** You therefore cannot stage a tampering demo on the
  real registry. The demo runs against a local **Verdaccio** instance configured to allow
  overwrite. See `docs/DEMO-RUNBOOK.md`. Discovering this at 03:00 would cost the demo.
- **Tarball repacking is not tampering.** gzip settings, mtimes and entry order differ
  harmlessly between fetches. This is exactly why the digest is a Merkle tree over a
  *normalised file tree*, not a hash of the tarball bytes. Both are recorded; only a
  mismatch in `artifactDigest` is a real divergence. See `docs/SPEC-DIGEST.md` §6.
- **Next.js route handlers cannot hold a chain subscription.** The event watcher is a
  long-lived process and lives in `apps/indexer`, never in `apps/web`. If asked why there
  are two backends, this is the answer.
- **Hardhat Network resets on restart.** Attestations vanish. Keep a seed script
  (`packages/contracts/scripts/seed.ts`) that repopulates demo state in one command.
- **`package-lock.json` v2 and v3 differ.** Parse the `packages` map, not `dependencies`.
  Reject v1 with a clear error rather than guessing.
- **pnpm's own lockfile is not the target.** `cairn verify` reads **npm** lockfiles; the
  repo happening to use pnpm is unrelated. Do not conflate them.

---

## 8. Specs

Detailed specifications live in `docs/`. Read the relevant one before implementing.

| Document | Covers |
|----------|--------|
| `docs/ARCHITECTURE.md` | Component boundaries, data flow, trust model |
| `docs/SPEC-DIGEST.md` | Canonicalisation + Merkle digest — **read before touching `core`** |
| `docs/SPEC-CONTRACTS.md` | Storage layout, events, errors, EIP-712 types |
| `docs/SPEC-CLI.md` | `publish` / `verify`, policy file, exit codes |
| `docs/SPEC-ATTESTER.md` | Attester loop, divergence reporting |
| `docs/SPEC-INDEXER-API.md` | Event ingestion, Mongo schema, REST surface |
| `docs/SPEC-DASHBOARD.md` | Pages, states, what must be real |
| `docs/BUILD-PLAN-24H.md` | Hour-by-hour schedule and three-way task split |
| `docs/DEMO-RUNBOOK.md` | The live demo, step by step, with fallbacks |
| `docs/TESTING.md` | Test strategy and the determinism harness |
| `docs/ROADMAP.md` | Post-MVP work — park good ideas here |
| `docs/PREBUILD-CHECKLIST.md` | What to do before the window opens |

---

## 9. Working style for this repo

- **Ship the vertical slice first.** A thin end-to-end path (publish → attest → verify →
  BLOCK) beats four polished components that do not connect. Get the slice green by the
  halfway mark, then deepen.
- **Deploy from hour one.** The dashboard should be reachable and showing "no attestations
  yet" long before it has anything to show. Deployment discovered at hour 23 is the classic
  way to lose a demo.
- **When blocked for more than 20 minutes, cut scope, not sleep.** Record the cut in
  `docs/ROADMAP.md` and move on.
- Prefer the boring implementation. This is a 24-hour build judged on whether it works.
