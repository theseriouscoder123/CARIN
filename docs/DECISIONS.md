# Decision records

Short records of every place the build deliberately departs from, or adds to, the
pre-window specs. Each says what was decided, why, and what it costs.

---

### D1 — `submit()` takes an explicit `publisher`

**Decision.** The signer recovered from the EIP-712 signature must equal a `publisher`
argument. **Why.** Without it, a tampered signature recovers to *some* address and is filed
under it; nothing can be rejected and the nonce check is meaningless. **Cost.** One extra
argument. (SPEC-CONTRACTS §2.5)

### D2 — Package names are pinned to their first publisher

**Decision.** The first attestation of `ecosystem:name` pins its publisher key; later
versions from another key revert `PublisherNotPinned`. **Why.** Closes version squatting
for established names and means a hijacked npm account cannot mint attested releases.
**Cost.** No key rotation yet (roadmap); brand-new names remain trust-on-first-use.

### D3 — One divergence report per attester per package

**Decision.** An attester may report divergence after having corroborated (republication),
but only once per package. **Why.** The monitor re-checks on a loop; unbounded reports
would grow the array forever. **Cost.** None observed.

### D4 — Indexer polls `eth_getLogs` instead of `watchContractEvent`

**Decision.** Backfill and poll with checkpointing. **Why.** Over HTTP RPC, viem's watcher
polls anyway; explicit polling gives one code path for backfill and live, idempotent by
`(txHash, logIndex)`. **Cost.** Up to one poll interval of latency (1.5–4 s).

### D5 — Adaptive `eth_getLogs` ranges

**Decision.** On a failed log query, halve the block range and retry, down to 10 blocks.
**Why.** Providers cap ranges differently; Base's public RPC rejects spans over 200 blocks,
which stalled both log loops on first deploy. **Cost.** None; `CAIRN_LOG_CHUNK` presets it.

### D6 — An RPC failure must never trigger an index rebuild

**Decision.** Only `BlockNotFoundError` counts as a changed block hash. **Why.** Treating a
connection error as a reorg wiped a MongoDB index during testing.

### D7 — In-memory index store when no MongoDB is configured

**Decision.** `MongoStore` with `MONGODB_URI`, else `MemoryStore`. **Why.** The indexer is a
cache rebuildable from chain events; the fallback demonstrates exactly that and keeps local
development dependency-free. **Cost.** Memory mode rebuilds on every start (seconds).

### D8 — Dashboard: client-side polling, no wagmi, no pino

**Decision.** Data panels are client components polling every 3–5 s; no wallet library;
the indexer logs one JSON line per request without pino. **Why.** Live updates and real
loading/error/stale states for the demo; nothing needs a wallet; fewer dependencies in a
supply-chain project. **Cost.** No server-rendered initial data.

### D9 — Tarballs are parsed in memory, not streamed

**Decision.** Parse the inflated buffer with a 1 GiB inflate cap. **Why.** Canonicalisation
stays pure and synchronous given bytes (simplest to test and fuzz); npm tarballs are small.
**Cost.** Memory proportional to tarball size.

### D10 — No `normalise()` on the registry adapter

**Decision.** Canonicalisation is ecosystem-neutral and lives in `core`. **Why.** One digest
implementation (invariant 3). A future PyPI adapter adds its own normalisation then.

### D11 — Verdaccio as a pinned devDependency, not Docker; "overwrite" is unpublish

**Decision.** Run Verdaccio with Node. It has no overwrite switch, so the demo unpublishes
and republishes the same version. **Why.** One less daemon on stage; unpublish/republish is
the real takeover capability. **Cost.** None.

### D12 — The demo picks a fresh version every run

**Decision.** `demo:release` chooses the first `1.0.N` not attested on-chain or present on
the registry. **Why.** The chain is append-only; a fixed version can only be demonstrated
once. **Cost.** Every rehearsal leaves a permanent record (which is the point).

### D13 — Batched reads through Multicall3

**Decision.** `verify` reads every record in one batched pass (100 packages per request)
where Multicall3 exists. **Why.** ~5 RPC calls per dependency rate-limited real lockfiles;
437 dependencies now verify in about 11 s cold, 6 s warm.

### D14 — Out of scope by decision, disclosed instead

Public payload storage (IPFS), attesters on separate hosts and publishing the CLI to npm
were considered and deliberately not built in the window. The limitations they would remove
are stated in `docs/THREAT-MODEL.md`.
