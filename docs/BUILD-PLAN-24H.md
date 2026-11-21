# 24-Hour Build Plan

Times are **relative to kick-off** (`H+0`). The dates were postponed, so pin these to wall
clock as soon as the new schedule is published, and recompute in IST — WIB is GMT+7, IST is
GMT+5:30, so **IST = WIB − 1:30**.

| Marker | Relative | Fill in |
|---|---|---|
| Check-in | H−0:30 | |
| Kick-off | H+0 | |
| Mandatory night checkpoint | ≈H+12 | |
| Final checkpoint window | H+23:30–24 | |
| Code freeze | **H+24** | |
| Pitch (batch TBC) | H+24:30 or H+28 | |

---

## 1. Roles

Three people, three lanes, minimal blocking.

| | Owner | Scope |
|---|---|---|
| **A** | Contracts & chain | Solidity, Hardhat, deploy + seed scripts, then the attester node |
| **B** | Core & CLI | Canonicalisation, Merkle digest, `cairn publish`, `cairn verify` |
| **C** | Services & UI | Indexer, Mongo, REST API, Next.js dashboard, deployment |

### Critical path

```
  scaffold ──▶ contract ABI ──┬──▶ indexer      ──▶ dashboard
       │                      └──▶ CLI chain reads
       └────▶ core digest ────┬──▶ cairn publish ──▶ cairn verify ──▶ BLOCK demo
                              └──▶ attester
```

Two artifacts block everyone else. Freeze them early and treat the freezes as hard gates:

- **ABI freeze at H+2.** A publishes function signatures, events and errors — stubs are
  fine, bodies can come later. B and C generate types from it and stop waiting.
- **Digest freeze at H+6.** Once frozen, any change to `@cairn/core` digest logic requires
  all three to agree, because it invalidates every attestation already created.

---

## 2. Schedule

### H+0 → H+1 · Scaffold together

All three on one screen. Do not split until `pnpm build` is green on all three machines.

- `pnpm init`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`
- Create all seven workspace packages with placeholder `index.ts` and correct `package.json`
- Hardhat init in `packages/contracts`; `create-next-app` in `apps/web`
- ESLint + Prettier from `packages/config`
- GitHub Actions: `pnpm install && pnpm build && pnpm test` on push
- First commit. **This is the commit that proves the build started in-window — make it
  substantial and timestamped early.**

> Everyone runs `pnpm install && pnpm build` before splitting. An environment difference
> found at H+1 costs minutes; found at H+9 it costs the project.

### H+1 → H+3 · Foundations

**A** — `AttestationRegistry.sol` and `QuorumPolicy.sol`: structs, storage, events, custom
errors, full function signatures with NatSpec, empty or minimal bodies. Compile. Export ABI.
**Announce the ABI freeze at H+2.**

**B** — `@cairn/core`: tar parsing, path normalisation, entry classification, the canonical
tree. Start the Merkle root. Write fixture tests as you go, not after.

**C** — `create-next-app` shell with layout, nav and the empty state. **Deploy it to a
public URL now**, showing "No attestations yet". Scaffold the indexer: Express, Mongo
connection, viem client, health endpoint.

**Gate H+3:** ABI frozen · dashboard live at a public URL · `pnpm build` green.

### H+3 → H+6 · Core logic

**A** — Implement `submit()` and `corroborate()`. EIP-712 domain and type hashes. Nonce
handling. `packageId` binding check. Hardhat tests for the happy paths and the five most
important reverts.

**B** — Finish the Merkle root (RFC 6962 construction). Commit golden vectors. Write the
determinism tests from `SPEC-DIGEST.md` §7 — **tests 2 and 5 especially** (repack
invariance, content-swap sensitivity). Export the type hash constants and assert they match
the contract's.

**C** — Indexer ingestion: backfill, subscribe, idempotent upserts, checkpointing. Mongo
schema and indexes. `/health`, `/stats`, `/packages`.

**Gate H+6:** **digest frozen** · contracts tested · indexer ingesting from a local chain.

### H+6 → H+9 · First vertical slice

**A** — `deploy.ts` writing `deployments/<chainId>.json`. `seed.ts` creating real
attestations. `QuorumPolicy` admin functions. Then start the attester node.

**B** — `cairn publish` end-to-end against the local chain. Then begin `cairn verify`:
lockfile v2/v3 parsing, artifact resolution, digest computation, chain reads.

**C** — `/packages` list and `/packages/[packageId]` detail wired to the indexer. The
indexer-vs-chain dual read on the detail page.

**Gate H+9 — THE MILESTONE:** one package published, corroborated by one attester, and
`cairn verify` prints PASS. **If the slice is not working at H+9, stop adding features and
all three converge on it until it is.** A thin complete path beats four polished fragments;
this is the single most important rule in this document.

### H+9 → H+12 · Complete the loop

**A** — Attester node finished: watch loop, independent fetch, corroborate, divergence
reporting, idempotency store, `/health`. Three instances with distinct keys via
`pnpm attesters:up`.

**B** — `cairn verify` verdicts, policy file, exit codes, terminal rendering. `cairn status`.

**C** — Package timeline, divergence panel, attester health cards, `/divergences` feed.

**Gate H+12:** publish → 3 attesters corroborate → quorum → verify PASS, all visible on
the dashboard.

### ≈H+12 · Mandatory night checkpoint

Competition requirement. Confirm the procedure for remote teams on Discord **before the
window opens** — do not discover it at H+12. Nominate who handles it so the other two keep
working.

### H+12 → H+15 · The demo path

All three, together. This is the demo and it deserves undivided attention.

- Stand up Verdaccio (`pnpm registry:up`) configured to allow republishing the same version
- Build the demo fixture package and publish it
- Attest it, corroborate to quorum, confirm `verify` → PASS
- **Tamper**: republish the same version with an added `scripts/postinstall.js`
- Trigger a re-check → divergence on-chain → red on the dashboard → `verify` → **BLOCK**
- Wire the GitHub Actions demo repo so the red CI run is real

**Gate H+15:** the full tamper-to-block sequence runs start to finish, twice, without
manual intervention.

### H+15 → H+18 · Harden

- Every error state in the dashboard; no blank panels, no stack traces
- `verify` fails closed on unreachable chain — test it by killing Hardhat
- Attester handles registry 404 without reporting divergence
- Seed script verified from a cold `hardhat node` restart
- Fill test gaps; CI green
- **Stretch only if everything above is done:** the per-file delta in `verify` output

### H+18 → H+20 · Deployment decision and dress rehearsal

**Decide the chain question now, not later.** The rubric scores a live public deployment
above localhost. Options, in order of preference:

1. Deploy contracts to a public testnet; dashboard and indexer already public. Cleanest,
   needs funded keys — have them ready beforehand.
2. Keep the chain local, expose the RPC through a tunnel so the public dashboard reaches
   it. Works, but a tunnel dying mid-pitch is a real risk.
3. Fully local, screen-shared. Lowest score, highest reliability.

Then **full dress rehearsal #1**, timed, with screenshare, exactly as on the day.

### H+20 → H+22 · Slides and rehearsal #2

Build the deck (structure in `DEMO-RUNBOOK.md` §5). Rehearsal #2 with the deck. Fix
whatever the rehearsals broke — they always break something.

### H+22 → H+23 · Freeze and package

- Code freeze discipline: bug fixes only, no new features
- README, docs tidy, repository public and clean
- **Record the fallback demo video** — used only if the live run fails, but recorded while
  things still work
- Submit the repository link, live URL and slides. **Do not wait for H+24.**

### H+23 → H+24 · Buffer

Reserved. Rehearsal #3 if everything is in. Attend the final checkpoint window.

---

## 3. Cut list

Pre-agreed, in order. When behind, cut from the top without debate — deciding what to drop
at hour 19 while tired is how teams drop the wrong thing.

1. Per-file delta in `verify` output
2. `/verify` page client-side digesting → read-only chain lookup
3. `cairn status` command
4. Indexer-vs-chain dual read on the detail page
5. Divergence feed page → inline alerts only
6. Attester count 3 → 2 (threshold 2-of-2)

**Never cut:** the digest determinism tests, the append-only contract property, the
tamper → BLOCK demo path, three genuinely separate attester processes.

---

## 4. Standing rules

- **Commit every 20–30 minutes.** The history is graded; it is also your undo.
- **`main` must build.** Feature branches merge only when green.
- **Blocked for 20 minutes → say so in the team channel.** No silent struggling.
- **No new dependency after H+15** without all three agreeing. Late dependency changes
  break builds at the worst time, and a supply-chain project adding careless dependencies
  at hour 20 is a bad look if anyone checks.
- **Sleep in shifts if at all.** One person awake and coherent at H+20 is worth more than
  three people half-asleep. Decide the rotation at H+12, not at H+18.
- **At every gate, ask: can we demo today's state right now?** If no, fix that before
  continuing.
