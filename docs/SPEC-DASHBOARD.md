# SPEC — Transparency Dashboard

App: `apps/web`. Next.js 16 App Router, TypeScript, Tailwind, wagmi + viem.

The dashboard is Feature 5 and it is what the audience looks at for most of the pitch. It
has two jobs: let anyone verify CAIRN's claims independently, and make the divergence event
unmistakable when it happens on stage.

---

## 1. Pages

| Route | Purpose |
|---|---|
| `/` | Overview: stats, attester health, recent attestations, divergence feed |
| `/packages` | Searchable, filterable list |
| `/packages/[packageId]` | Full record, attestation timeline, corroborations, divergences |
| `/attesters` | The attester set, live health, per-attester activity |
| `/verify` | Paste a package name + version, get the live verdict |
| `/about` | How it works, the trust model, the CT analogy |

`/verify` earns its place: it is how a judge checks the system without installing anything.
Make it the most prominent call to action on `/`.

---

## 2. Data access

- Reads go through the indexer API (`NEXT_PUBLIC_INDEXER_URL`) for lists and history.
- The **`/packages/[packageId]` page additionally reads the contract directly via viem**
  and displays both: "indexer says / chain says". When they agree, show a small verified
  tick. When they disagree, show a warning.

That dual read takes perhaps forty minutes and is disproportionately persuasive — it
demonstrates in the UI itself that the indexer is not trusted. It also pre-empts the
question "how do we know your backend isn't just making this up?"

- Server Components for initial data. Client Components only for live-polling pieces
  (attester health, divergence feed) and wallet interactions.
- Poll every 5s on `/` and package detail pages while the tab is visible; stop when hidden.

---

## 3. States — all five, for every data surface

Every list and detail view implements: **loading**, **empty**, **populated**, **error**,
**stale**. Judges reliably find the empty state, because they open the dashboard before the
demo data exists.

- **Loading** — skeletons, not spinners.
- **Empty** — "No attestations yet. Run `cairn publish` to create the first one." Never a
  blank panel.
- **Error** — what failed and what to do. Never a stack trace, never a silent fallback to
  mock data.
- **Stale** — when `/health` reports lag or 503, a persistent banner: "Indexer is N blocks
  behind. Showing cached data as of block X." Visible staleness beats invisible staleness.

---

## 4. Visual language

Status is the dominant visual signal. Three states, unmistakable at projector distance and
from the back of a room:

| State | Treatment |
|---|---|
| `VERIFIED` | green, check glyph, calm |
| `PENDING` | amber, clock glyph, "2 of 3 corroborations" |
| `DIVERGENT` | red, prominent, pinned to the top of every relevant view |

Rules:

- **Never rely on colour alone** — every state carries a glyph and a text label. Judges may
  be colour-blind and the projector will distort colour.
- Type scale big enough to read on a shared screen. This is projected, not viewed at desk
  distance. Err one step larger than feels right.
- Monospace for digests, truncated as `0x7f3a…c21e`, with click-to-copy and the full value
  on hover.
- A divergence appearing live should be **impossible to miss**: red banner at the top of
  `/`, a toast, and the package pinned to the top of the list.

---

## 5. Package detail page — the money page

Layout, top to bottom:

1. **Header** — name@version, status badge, ecosystem.
2. **Verdict card** — large status, corroborations `3 / 3`, quorum threshold, publisher.
3. **Digests** — `artifactDigest`, `tarballHash`, `payloadDigest`, each copyable, each
   shown with both the indexer's value and the on-chain value.
4. **Timeline** — vertical, newest first: attestation submitted → each corroboration (with
   attester label and address) → any divergence. Each row links to its transaction.
5. **Divergence panel** — when present: expected vs observed digest side by side, reporting
   attester, timestamp. If the payload is retrievable, the per-file delta.
6. **Raw** — collapsible JSON of the full record, for the sceptical.

The timeline is the single most convincing artifact in the whole project: it is a visible,
independently verifiable history of who said what and when.

---

## 6. `/verify` page

Input: package name + version. Output: live verdict read from the chain in the browser.

Show the work — "resolving… fetching from registry… computing digest… reading chain" — so
a viewer sees that verification is actually happening client-side rather than being
returned by a server.

> Scope note: fetching and digesting a tarball in-browser is doable but fiddly (CORS,
> gzip/tar in WASM or JS). If it threatens the schedule, `/verify` may read the attested
> record and quorum state from the chain and link to the CLI for byte-level verification.
> Say plainly on the page which it is doing. Do **not** claim client-side digesting that
> is not happening — that is exactly the "fake mockup" the rules prohibit.

---

## 7. Deployment

Deploy from **hour one**, showing the empty state. A dashboard first deployed at hour 23 is
the classic way to lose a demo.

- Public URL. Live deployment is scored above localhost.
- `NEXT_PUBLIC_INDEXER_URL`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_REGISTRY_ADDR` from env.
- If the chain is local-only at demo time, the deployed dashboard cannot reach it; plan for
  either an exposed RPC or a tunnelled local chain, and decide this **before** hour 20.
  See `BUILD-PLAN-24H.md` H+14.

---

## 8. What must be real

Per `CLAUDE.md` §0.3, every number on screen comes from a live source. No placeholder
counts, no lorem text, no seeded "example" packages presented as if attested.

The seed script (`packages/contracts/scripts/seed.ts`) creates **real** attestations on the
local chain — real transactions, real signatures, real corroborations. That is legitimate:
they are genuine records created by genuinely running the system. Hardcoding the same rows
into the frontend would not be.
