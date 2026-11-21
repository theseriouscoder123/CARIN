# SPEC — Attester Node

App: `apps/attester`. Long-running Node.js daemon. Three instances with distinct keys run
during the demo.

The attester is the component that makes CAIRN's trust claim real. If attesters are not
genuinely independent, quorum is theatre. **Three instances must run with distinct keys,
distinct processes, and ideally distinct hosts** — a single process pretending to be three
signers is exactly the "fake mockup" the rules prohibit, and a judge may ask to see the
processes.

---

## 1. Responsibilities

1. Watch the chain for `AttestationSubmitted`.
2. Independently fetch the artifact **from the public registry**, never from the publisher
   and never from another attester.
3. Recompute the digest using `@cairn/core` — the same code path the CLI uses.
4. Co-sign on match; report divergence on mismatch.
5. Periodically re-check already-attested packages, so post-attestation republication is
   caught even with no new on-chain activity.

That fifth duty is the Divergence Monitor. It can run as a second loop inside the same
process; it does not need its own deployment for the MVP.

---

## 2. Configuration

```
CAIRN_ATTESTER_KEY        hex private key (required)
CAIRN_RPC_URL             default http://127.0.0.1:8545
CAIRN_REGISTRY_ADDR       contract address
CAIRN_NPM_REGISTRY        default https://registry.npmjs.org
CAIRN_ATTESTER_LABEL      human label shown on the dashboard, e.g. "attester-a"
CAIRN_RECHECK_INTERVAL    seconds; default 300
CAIRN_START_BLOCK         backfill origin; default = deployment block
```

Validate all of it with zod at startup and exit loudly on anything missing. An attester
that silently starts with a default key is worse than one that refuses to boot.

---

## 3. Main loop

```
on startup:
  backfill from CAIRN_START_BLOCK to head, processing each AttestationSubmitted
  then subscribe to new events

on AttestationSubmitted(packageId, publisher, artifactDigest, …, eco, name, version):
  if publisher == self.address: skip          # never self-corroborate
  if alreadyProcessed(packageId): skip        # local idempotency store

  ref      = adapter.resolve(name, version)
  bytes    = adapter.fetch(ref)               # from the public registry
  tree     = canonicalise(bytes)
  observed = computeArtifactDigest(tree)

  if observed == artifactDigest:
     tx = registry.corroborate(packageId, observed)
  else:
     tx = registry.corroborate(packageId, observed)   # contract records divergence
  mark processed
```

Note the single call site: `corroborate()` takes the observed digest and the **contract**
decides whether that is corroboration or divergence. Keeping that decision on-chain means
the record is produced by consensus rules rather than by attester-side logic that a judge
would have to take on faith.

### 3.1 Timing

Insert a small randomised delay (0–3s) before submitting. Three attesters watching the
same event otherwise race for the same nonce slot on a local chain and produce confusing
reverts. On a public chain it also avoids identical-timestamp clustering that looks
synthetic.

### 3.2 Retries

| Condition | Behaviour |
|---|---|
| Registry 404 | retry 3× with exponential backoff, then record `UNREACHABLE` locally and **do not** submit anything |
| Registry 5xx / timeout | same as 404 |
| RPC failure | retry indefinitely with backoff; the event is not lost (idempotency store is the source of truth) |
| Tx revert `AlreadyCorroborated` | treat as success, mark processed |
| Tx revert `NotAnAttester` | fatal — log and exit; the operator must fix the policy |

**Absence is not divergence.** An unreachable artifact must never be reported as a
mismatch. Getting this wrong turns an npm outage into a global false alarm.

---

## 4. Re-check loop (Divergence Monitor)

Every `CAIRN_RECHECK_INTERVAL`:

1. Take the N most recently attested packages (and any explicitly watched).
2. Re-fetch, recompute.
3. If the digest now differs from the attested value and this attester has not already
   reported divergence for it, submit.

This is the loop that catches **post-attestation republication** — attest at T0, tamper at
T1. It is also the loop that drives the live demo, so make the interval configurable and
expose a manual trigger:

```
POST /admin/recheck { "packageId": "0x…" }
```

Bound to localhost. Waiting five minutes on stage for a timer is not an option; the manual
trigger is what makes the demo land in real time.

---

## 5. Local state

SQLite or a JSON file under `./.attester-state/<label>/`:

```jsonc
{
  "lastProcessedBlock": 1420,
  "processed": { "0x<packageId>": { "observed": "0x…", "at": "…", "tx": "0x…" } }
}
```

Required so a restart does not reprocess the entire history and re-submit transactions
that will revert.

---

## 6. Health endpoint

```
GET /health → {
  "label": "attester-a",
  "address": "0x…",
  "lastProcessedBlock": 1420,
  "processedCount": 37,
  "divergencesReported": 1,
  "registryReachable": true,
  "chainReachable": true,
  "uptimeSeconds": 4821
}
```

The dashboard renders these as live attester cards. During the pitch this is the evidence
that three genuinely separate processes are running — worth putting on screen.

---

## 7. Running three locally

```bash
CAIRN_ATTESTER_LABEL=attester-a CAIRN_ATTESTER_KEY=$KEY_A PORT=4001 pnpm --filter @cairn/attester start
CAIRN_ATTESTER_LABEL=attester-b CAIRN_ATTESTER_KEY=$KEY_B PORT=4002 pnpm --filter @cairn/attester start
CAIRN_ATTESTER_LABEL=attester-c CAIRN_ATTESTER_KEY=$KEY_C PORT=4003 pnpm --filter @cairn/attester start
```

Add a `pnpm attesters:up` root script that launches all three with distinct keys from
Hardhat's deterministic accounts. One command, three processes, no manual key juggling at
hour 22.

---

## 8. Tests

- **Match path** — given a fixture artifact and a matching attestation, the attester calls
  `corroborate` with the correct digest.
- **Mismatch path** — tampered artifact produces a divergence record on-chain.
- **Self-skip** — an attester that is also the publisher submits nothing.
- **Idempotency** — restarting mid-stream does not resubmit.
- **Unreachable registry** — produces no on-chain write at all.
- **Core parity** — the attester's digest equals the CLI's digest for the same bytes. This
  is the single most important test in the repository; run it in CI on every commit.

Registry and chain are injected interfaces, faked in unit tests. The one end-to-end test
that uses real Verdaccio + Hardhat lives in `test/integration/` and is excluded from the
default `pnpm test`.
