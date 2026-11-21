# Demo Runbook

The live demo is the single highest-weighted thing in Phase 2 (Functional MVP & Live Demo,
35%). This document is the script. Rehearse it three times.

---

## 1. Why a local registry

**npm does not permit republishing a version.** Once `1.0.0` is published, those bytes are
immutable on the public registry. You therefore **cannot stage a tampering demo against
real npm** — the attack you are demonstrating is precisely the one npm's own policy
prevents at that layer.

The demo runs against **Verdaccio**, a local npm registry, configured to allow overwriting
a published version. This is honest: the point is to show CAIRN detecting byte-level
divergence for a version string, and Verdaccio is a real npm registry implementation
serving real tarballs over the real protocol. Verdaccio has no "overwrite" switch: the demo
**unpublishes** 1.0.0 and publishes different bytes under the same version, exactly what an
account takeover can do on any registry that permits unpublish. Say so on stage in one sentence — framing it
as a controlled environment is stronger than being asked and sounding evasive.

If anyone asks why this matters in the real world when npm forbids republish: registries
with mutable tags, internal and private registries, mirrors and proxies, and
account-takeover republication after an unpublish window all produce exactly this
condition. npm's immutability policy is a policy, enforced by the same party CAIRN
declines to trust.

---

## 2. Setup

```bash
# terminal 1 — chain
pnpm chain

# terminal 2 — registry (Verdaccio as a pinned devDependency; no Docker needed)
pnpm registry:up                 # :4873, state in .cairn/verdaccio (pnpm registry:reset wipes it)

# terminal 3 — deploy + seed, then the attesters (pointed at the local registry)
pnpm deploy:local && pnpm seed:local
pnpm attesters:demo              # three OS processes, three keys, ports 4001-4003

# terminal 4 — indexer (:4100) + dashboard (:3000)
pnpm dev
```

Pin the registry for the dashboard so package pages verify against the chain independently
of the indexer: copy `apps/web/.env.example` to `apps/web/.env.local` and set
`NEXT_PUBLIC_REGISTRY_ADDR` to the `registry` value in
`packages/contracts/deployments/31337.json` (deterministic on a fresh Hardhat node).

Without `MONGODB_URI` the indexer uses an in-memory store and rebuilds everything from chain
events in seconds on start — a live demonstration that it is a cache, not an authority.
`pnpm dev` keeps the dashboard up if the indexer dies; the dashboard then shows a red
"indexer unreachable" banner and package pages keep reading the chain directly.

**Rehearse the whole path unattended first:** with the stack *stopped*, run
`pnpm test:integration`. It cold-starts everything, runs every act below with assertions,
and tears down in about a minute. Green means the demo works on this machine today.

### Demo fixture

`fixtures/demo/greeting/` — a tiny, legible package. `pnpm demo:release` packs it and
publishes it to the local registry, then resolves the consumer's lockfile against it. Keep it small enough that the file
list fits on one screen.

```
package.json          name: @cairn-demo/greeting, version 1.0.0
index.js              module.exports = (n) => `Hello, ${n}!`
README.md
```

The tampered variant (`pnpm demo:tamper`) adds one file and the hook that runs it:

```
scripts/postinstall.js    // SIMULATED PAYLOAD — demo fixture, performs no action
package.json              "scripts": { "postinstall": "node scripts/postinstall.js" }
```

Make the malicious file's content obviously a stand-in, not functional malware. A judge
should see the shape of the attack without the repo containing anything real. Use a
comment: `// SIMULATED PAYLOAD — demo fixture, performs no action`.

---

## 3. The sequence

Total: 4–5 minutes. Practise until it runs without thinking.

### Act 1 — a clean release (60s)

```bash
pnpm demo:release                                                # the maintainer's normal npm publish
npx cairn publish fixtures/demo/cairn-demo-greeting-1.0.0.tgz    # needs CAIRN_PRIVATE_KEY
```

Show the terminal: digest computed, attestation submitted, transaction hash.

Switch to the dashboard. The package appears, status **PENDING**, `0 / 3` corroborations.
Within seconds the attester terminal and cards tick over: `1/3`, `2/3`, `3/3`. Status flips
to **VERIFIED**.

> Say: "Three independent processes just re-downloaded that package from the registry,
> recomputed the digest themselves, and signed on-chain that it matches. I didn't tell them
> it was fine — they checked."

### Act 2 — the gate passes (45s)

```bash
npx cairn verify --lockfile fixtures/demo/consumer/package-lock.json
```

`✓ 3 verified · PASSED`, exit 0.

> Say: "This is what a clean CI run looks like. Exit code zero, build proceeds."

### Act 3 — the tamper (60s)

```bash
pnpm demo:tamper        # unpublish 1.0.0, republish 1.0.0 with scripts/postinstall.js
```

The version string is **unchanged**: still `1.0.0`. Nothing a developer would notice.

> Say: "Same version. Every tool that pins by version string is satisfied. The bytes are
> different."

### Act 4 — detection (60s)

```bash
pnpm demo:recheck       # POST /admin/recheck on all three attesters, right now
```

All three print `✗ DIVERGENCE reported on-chain` with a transaction hash, and all three
observed the **same** new digest. Dashboard goes red. `npx cairn status
@cairn-demo/greeting@1.0.0` shows `quorum: blocked by divergence` and three divergence rows.

> Say: "Every attester re-checked the published artifact and found different bytes than
> were attested. That is now recorded on-chain, permanently, attributed to each attester."

### Act 5 — the block (60s)

Two beats. First, the existing project:

```bash
npx cairn verify --lockfile fixtures/demo/consumer/package-lock.json
```

`CONTESTED` · `BLOCKED`, exit 1 — the attesters' on-chain evidence alone blocks it.

Then the real exposure. **Be precise here; a sharp judge will check.** An *existing*
lockfile pins the old `integrity` hash, so `npm ci` itself would reject the republished
tarball. The danger is every *fresh* resolution — a new developer, a lockfile refresh, a
dependency-bot PR — which records the tampered hash, after which npm is perfectly satisfied:

```bash
cd fixtures/demo/consumer
del package-lock.json            # rm on macOS/Linux — "a new developer clones the repo"
npm install --package-lock-only  # npm happily records the tampered integrity
cd ../../..
npx cairn verify --lockfile fixtures/demo/consumer/package-lock.json
```

```
  ✗  @cairn-demo/greeting@1.0.0                          DIVERGENT
     attested   0x3e9e…46ec   by 0x7099…79C8  ·  3/3 attesters · quorum 2
     observed   0x28a1…d241
     delta      package.json  (content changed)
                scripts/postinstall.js  (added)

  BLOCKED — 1 divergent dependency
```

> Say: "npm's integrity check only compares against whatever the lockfile recorded when it
> was resolved. CAIRN compares against what the maintainer attested and independent parties
> confirmed. Non-zero exit — and nobody had to know in advance this package was malicious."

Then the GitHub Actions tab: a **red CI run** on the demo repo, failed by `cairn verify`.

## 3b. Public deployment (Base Sepolia)

The judged setup. Nothing on a public host needs to reach the laptop, so no tunnel.

| Piece | Where |
|---|---|
| Contracts | Base Sepolia (chain 84532) — `packages/contracts/deployments/84532.json` |
| Dashboard | Vercel — https://cairn-two-ecru.vercel.app |
| Indexer | Render free web service (`render.yaml`) + MongoDB Atlas free |
| Attesters, Verdaccio, CLI | The presenter's laptop; they only make outbound calls |

One-time setup:

```bash
# keys are generated locally into .cairn/keys/base-sepolia.env (gitignored)
# fund ONLY the deployer from the Coinbase Developer Platform faucet, then:
pnpm fund:base-sepolia         # tops up publisher + 3 attesters from the deployer
pnpm deploy:base-sepolia       # writes deployments/84532.json — commit it
pnpm seed:base-sepolia         # real npm artifacts, attested on Base Sepolia
```

Demo day, on the laptop:

```bash
pnpm registry:up
pnpm attesters:base-sepolia    # three processes, keys from .cairn/keys, RPC Base Sepolia
pnpm cairn:base-sepolia publish fixtures/demo/cairn-demo-greeting-1.0.0.tgz
pnpm cairn:base-sepolia verify --lockfile fixtures/demo/consumer/package-lock.json
```

Open the public dashboard a minute before the pitch: the free Render instance sleeps after
about 15 minutes idle and takes roughly 30 seconds to wake. Transaction links go to
https://sepolia.basescan.org, so judges can check every attestation on a public explorer.

If the public RPC rate-limits, set `CAIRN_BASE_SEPOLIA_RPC_URL` (laptop) and
`CAIRN_RPC_URL` (Render) to a free provider endpoint; nothing else changes.

### Fallback: local chain + tunnel

Only if the testnet path fails. Run the local stack (§2), then expose the RPC and the
indexer with Cloudflare quick tunnels (no account needed):

```bash
cloudflared tunnel --url http://localhost:8545    # → https://<a>.trycloudflare.com
cloudflared tunnel --url http://localhost:4100    # → https://<b>.trycloudflare.com
```

Set the Vercel env to those URLs (`NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_INDEXER_URL`,
`NEXT_PUBLIC_REGISTRY_ADDR` from `deployments/31337.json`), add the Vercel origin to the
indexer's `CORS_ORIGINS`, and redeploy (`npx vercel deploy --prod`, about a minute — the
`NEXT_PUBLIC_*` values are baked in at build time). If even that fails, screenshare the
local dashboard at http://localhost:3000: everything works identically.

## 4. Fallbacks

| Failure | Response |
|---|---|
| Internet drops | Everything runs locally; switch to the local URL and keep going |
| A service is dead | `pnpm dev` restart is 20s. Keep a second terminal pre-warmed |
| Hardhat was restarted | `pnpm deploy:local && pnpm seed:local`, restart attesters, `pnpm registry:reset` + `demo:release` — rehearse, timed |
| Unsure the stack works | Stop it and run `pnpm test:integration` (about one minute) |
| Dashboard broken | Run the whole demo in the terminal. The CLI is the product |
| Catastrophic | Play the recorded video, then take questions live |

Record the fallback video at H+22 while the system is working. Never record it at the end
when things are breaking.

**Designate one driver.** One person types, the others speak. Two people reaching for the
keyboard on a shared screen is the most common way a remote demo falls apart.

Before the call: close every other application, silence notifications, use a second monitor
for notes, and share a **single window**, not the whole desktop.

---

## 5. Pitch structure — 10 minutes

The stopwatch is "dirty": screenshare setup runs on your time. Rehearse the transition into
screenshare, not just the content.

| Time | Section | Content |
|---|---|---|
| 0:00–0:45 | The hook | "Every developer runs `npm install` and trusts that the bytes arriving are the bytes the maintainer published. 454,600 malicious packages were catalogued last year. Over 99% on npm." |
| 0:45–1:30 | The gap | Every existing defence trusts the registry operator — the same party that can unpublish, re-point a tag, or be taken over. No independently verifiable record of what a version actually was. |
| 1:30–2:15 | The precedent | Certificate Transparency, 2013. The answer to mis-issuing CAs was not a better CA; it was an append-only public log. Registries sit where CAs sat. |
| 2:15–3:00 | The design | Maintainer signs → independent attesters re-fetch and co-sign → M-of-N quorum → CI gate. Emphasise: we detect **divergence**, not maliciousness. |
| 3:00–7:30 | **Live demo** | §3 above |
| 7:30–8:30 | Why it's different | Independent re-fetch (nobody else does this). Multi-party log (theirs are single-operator). Zero adoption cost — one CI step, no migration. |
| 8:30–9:00 | Roadmap | Staked attesters, multi-registry, reproducible-build proofs. Say they're out of scope and why. |
| 9:00–10:00 | Q&A buffer | |

Give the demo the floor. Four and a half minutes of working software beats nine minutes of
slides, and the rubric agrees — Functional MVP & Live Demo is 35%, Pitching is 15%.

---

## 6. Q&A — prepared answers

**"Isn't this just Sigstore / npm provenance?"**
Those attest *where* an artifact was built. Neither has an independent party re-fetch the
published artifact and confirm the registry still serves what was built. And their
transparency logs are run by single organisations, which reintroduces the trusted party
they were designed to remove. We're complementary, not competing.

**"Why blockchain? A database would do this."**
A database has an owner who can rewrite it. The property we need is that no party —
including us — can alter a record after the fact, and that anyone can verify this
independently. That is the exact argument that produced Certificate Transparency.

**"Who runs the attesters? Isn't that centralised?"**
Today, an admin-managed set — and that's the MVP's weakest point, so I'll name it before
you do. But note what the admin *cannot* do: alter or delete any attestation. The record is
immutable; only the policy for interpreting it is administered. The roadmap replaces that
with staked, permissionless attesters and slashing.

**"What if the registry serves different bytes to attesters than to victims?"**
Then the victim's own `cairn verify` catches it, because the digest is computed locally
from the bytes that machine actually received — not from anything the registry or the
attesters report. A split-content attack has to fool the gate on the victim's machine,
which is the one place it cannot reach.

**"What about the first publication? Nothing to compare against."**
Correct — the first attestation is trust-on-first-use, same as SSH. What CAIRN gives you
from that point is that the artifact can never silently change. Reproducible-build proofs
are the roadmap answer to binding the first release to its source.

**"How do you handle false positives from repacking?"**
We record two digests. The Merkle root over the normalised file tree is immune to gzip
settings, mtimes and entry ordering; the raw tarball hash is not. A tarball-hash change
with a matching tree root is logged as a repack, not an alert. Only a tree-root mismatch
raises divergence.

**"Can you scale beyond npm?"**
Ecosystem-specific logic is confined to one adapter interface — resolve, fetch, normalise.
PyPI is a new file, not a refactor. We scoped to npm deliberately: multi-registry was on
the cut list from the proposal onward.

**"Is this really built in 24 hours?"**
Repository is public, commit history is in the window, and everything you just saw is
running live — no recorded demo, no mock data. Happy to open any file.
