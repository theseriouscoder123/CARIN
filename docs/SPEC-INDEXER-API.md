# SPEC — Indexer and Read API

App: `apps/indexer`. Express 4 + viem event watcher + MongoDB.

**The indexer is a cache, never an authority.** No gate decision is derived from it.
`cairn verify` reads the chain directly. The indexer exists so the dashboard is fast and
so the event history is queryable. If a judge asks "what if the indexer lies?", the answer
is: nothing enforceable depends on it, and anyone can rebuild it from chain events.

It is a separate process from `apps/web` because the watcher holds a long-lived chain
subscription, which a serverless route handler cannot.

---

## 1. Ingestion

```
on startup:
  read checkpoint from Mongo (default: deployment block)
  backfill in ranges of 2000 blocks to head
  subscribe via viem watchContractEvent
```

Handlers for `AttestationSubmitted`, `AttesterCorroborated`, `DivergenceReported`.

### Rules

- **Idempotent upserts** keyed by `(txHash, logIndex)`. Reorgs and restarts both replay
  events; duplicates must be harmless.
- **Checkpoint after each batch**, not after each event.
- **Never derive state the chain did not emit.** If the dashboard needs a field, add it to
  the event in the contract rather than inferring it here. Inferred state drifts.
- On a reorg (viem reports a removed log), delete events at or above that block and
  re-ingest.

---

## 2. Mongo schema

### `attestations`

```jsonc
{
  "_id": "0x<packageId>",
  "ecosystem": "npm",
  "name": "@cairn-demo/greeting",
  "version": "1.0.0",
  "artifactDigest": "0x…",
  "tarballHash": "0x…",
  "payloadDigest": "0x…",
  "publisher": "0x…",
  "submittedAt": "2026-…Z",
  "blockNumber": 142,
  "txHash": "0x…",
  "corroborations": 3,
  "quorumReached": true,
  "divergenceCount": 0
}
```

Indexes: `{ name: 1, version: 1 }`, `{ submittedAt: -1 }`, `{ quorumReached: 1 }`,
`{ divergenceCount: -1 }`, and a text index on `name`.

### `events`

Append-only log of every ingested event — `packageId`, `type`, `actor`, `data`,
`blockNumber`, `txHash`, `logIndex`, `observedAt`. This backs the per-package timeline and
makes the dashboard's history honest: it is replaying chain events, not a summary the
server invented.

### `attesters`

`address`, `label`, `active`, `corroborationCount`, `divergenceCount`, `lastSeenAt`.
Populated from `QuorumPolicy` events plus attester `/health` polls.

---

## 3. REST API

Base: `/api/v1`. All responses JSON. All inputs validated with zod. CORS restricted to the
dashboard origin.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/health` | indexer status, head block, lag |
| `GET` | `/stats` | totals for the dashboard header |
| `GET` | `/packages` | paginated list; `?q=`, `?status=`, `?limit=`, `?cursor=` |
| `GET` | `/packages/:packageId` | full record + quorum + divergences |
| `GET` | `/packages/:packageId/timeline` | ordered events for that package |
| `GET` | `/attesters` | attester set with live health |
| `GET` | `/divergences` | all divergences, newest first — the alert feed |
| `GET` | `/lookup?name=&version=` | resolve a human name to a packageId |

### `/stats`

```jsonc
{
  "totalAttestations": 37,
  "quorumReached": 34,
  "pending": 2,
  "divergent": 1,
  "activeAttesters": 3,
  "threshold": 2,
  "headBlock": 1420,
  "indexerLag": 0
}
```

### `/health`

```jsonc
{ "ok": true, "headBlock": 1420, "lastIndexedBlock": 1420, "lag": 0, "mongo": "up" }
```

Return HTTP 503 when `lag > 50` or Mongo is down. The dashboard shows a degraded banner
rather than silently serving stale data — stale data presented as live is a small lie the
rules care about.

---

## 4. Conventions

- Pagination is cursor-based (`blockNumber + logIndex`), not offset. Offsets break under
  concurrent ingestion.
- Every response carries `asOfBlock`, so the dashboard can show "as of block N" and the
  staleness is visible rather than hidden.
- Errors: `{ "error": { "code": "...", "message": "..." } }` with real HTTP status codes.
- No write endpoints. The API is read-only — there is no way to inject an attestation
  through it. Say this in the pitch; it is a one-sentence answer to a whole category of
  "could someone fake it?" questions.
- Structured logging (pino). One line per request with duration.

---

## 5. Tests

- Event ingestion is idempotent — replay the same log twice, one document results.
- Reorg handling — removed logs roll back cleanly.
- Checkpoint resumption — restart mid-backfill resumes at the right block.
- `/packages/:id` matches a direct on-chain read for the same package.
- `/health` returns 503 when lag exceeds the threshold.
- Zod rejects malformed query parameters with 400, never 500.
