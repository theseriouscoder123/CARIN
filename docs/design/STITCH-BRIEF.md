# CAIRN dashboard — design brief for Google Stitch

How to use this: paste **Part A** into Stitch first, then each **Part B** screen prompt one at
a time in the same project, so every screen shares the design system. Ask Stitch to export
each screen as **HTML + Tailwind CSS**. Bring back the exports (or screenshots plus the code)
and the redesign gets implemented in `apps/web` against the live data.

---

## Part A — master prompt (paste first)

> Design a web app called **CAIRN** — a public transparency log for open-source software
> packages. It answers one question for developers: *"Is the package I'm about to install
> byte-for-byte what its maintainer published — and has anyone independently confirmed it?"*
>
> **Genre and inspiration:** the information architecture of modern package registries
> (search-first home page, one page per package with a version history, a metadata sidebar,
> a copyable install/command box, quality signals at a glance). Take inspiration from that
> *genre* only — do not copy any existing registry's logo, colours, mascot or exact layout.
> CAIRN's own identity: calm, precise, trustworthy, technical — closer to a security tool or
> a certificate-transparency explorer than a marketing site.
>
> **Audience:** software developers, security engineers and CI/CD maintainers. Also shown
> live on a projector to a judging panel, so status must be readable from across a room.
>
> **Design system:**
> - **Mode:** light theme by default (projects well), with a matching dark theme.
> - **Palette:** near-white background (#FAFAF9), white cards, slate text (#0F172A primary,
>   #475569 secondary), hairline borders (#E2E8F0). One brand accent: deep teal (#0F766E).
>   Status colours used *only* for status: verified = emerald (#059669), pending = amber
>   (#D97706), divergent = red (#DC2626), unattested = slate (#64748B).
> - **Status is never colour alone:** every status has an icon and a word — ✓ VERIFIED,
>   ◷ PENDING, ✗ DIVERGENT, ? UNATTESTED.
> - **Type:** Inter (or similar) for UI; JetBrains Mono for digests, addresses, commands and
>   versions. Generous sizes: body 16px, page titles 36–44px.
> - **Shapes:** 12px radius cards, soft shadows, 8px spacing grid, max content width 1200px.
> - **Hashes and addresses:** monospace, truncated like `0x7aac…b293` with a copy button and
>   the full value on hover.
> - **Logo:** a simple wordmark "CAIRN" with a minimal glyph of three stacked stones
>   (a cairn) — original, geometric, monochrome teal.
> - **Global header:** logo, a large search field ("Search packages, e.g. express"), nav links
>   Packages · Live · Attesters · Check a lockfile · Docs. Footer: "Read-only view of an
>   append-only on-chain log · Base Sepolia · contract 0x6261…77ec".
> - Every data area has designed **loading** (skeleton), **empty**, **error** and **stale**
>   states.

---

## Part B — screens (paste one at a time)

### B1. Home / search

> Design the CAIRN **home page**. Hero: headline "Know your dependencies are what was
> published." Sub-headline: "Every release is signed by its maintainer, re-downloaded and
> confirmed by independent attesters, and recorded on an append-only public ledger." A very
> large search box ("Search a package — express, chalk, @scope/name") with a secondary
> button "Check a whole lockfile".
>
> Below, a row of 4 stat tiles: **96** releases attested · **90** verified by quorum ·
> **6** divergences caught · **3** independent attesters (2 of 3 required).
>
> A red alert banner when divergences exist: "✗ 6 releases were republished with different
> bytes after attestation — CI builds using them are blocked. View divergences →".
>
> Two columns: left "Recently attested" list (package name, version, status pill, "3/3
> attesters", relative time); right "Live activity" feed with small icons: "attester-b
> corroborated chalk@4.1.2", "attester-a observed different bytes for
> @cairn-demo/greeting@1.0.5". Bottom: a "Use it in CI" card with a code block:
> `- uses: cairn/verify@v1` and a one-line explanation.

### B2. Package page (the most important screen)

> Design the CAIRN **package page** for `express`, modelled on a registry package page.
>
> **Header:** package name `express` large, the selected version `4.21.2` in a version
> dropdown, ecosystem tag "npm". A large **verdict badge**: "✓ VERIFIED · 3 of 3 attesters
> confirmed" (emerald). A copy box: `npx @cairn/cli verify` and a smaller "Add to CI" snippet.
>
> **Main column, tabs:** Overview · Versions · Evidence · Activity.
> - *Overview:* plain-language summary: "This release's files hash to 0x7aac…b293. The
>   maintainer signed that digest on Nov 21, 2026, and three independent attesters each
>   downloaded the package themselves and got the same result."
> - *Versions:* a table of every attested version (version, status pill, corroborations
>   "3/3", attested date). One row shows ✗ DIVERGENT in red — design that row's emphasis.
> - *Evidence:* a two-column "Indexer says / Chain says" comparison table for
>   artifactDigest, tarballHash, payloadDigest, publisher, corroborations, quorum — each row
>   ending in a small "✓ agree" or "✗ mismatch" marker, captioned "Read directly from the
>   contract in your browser".
> - *Activity:* a vertical timeline — "Attestation submitted by publisher 0x378f…5D72",
>   "Corroborated by attester-b", "Corroborated by attester-a", "Corroborated by
>   attester-c · quorum reached" — each with block number, time and a transaction link.
>
> **Right sidebar (metadata, like a registry):** Publisher (address, "pinned key"), Attested
> (date), Quorum (2 of 3), Corroborations (3), Digest (mono, copy), Tarball hash, Payload
> digest, Contract link, "View on explorer".

### B3. Package page — divergent state

> Same package-page layout for `@cairn-demo/greeting@1.0.5` in the **DIVERGENT** state. The
> verdict area becomes a full-width red panel: "✗ DIVERGENT — this version was republished
> with different bytes after it was attested. Quorum revoked; builds that use it are
> blocked." Show "Attested 0x49ff…a21c" vs "Observed 0x16a4…09d3" side by side, a list
> "Reported by attester-a, attester-b, attester-c" with times, and a "What changed" box:
> `scripts/postinstall.js — added`, `package.json — content changed`. Calm, serious, not
> alarmist — like a security advisory.

### B4. Live view (projected on stage)

> Design a **full-screen live view** meant to be projected. Minimal chrome. Top: "Following
> @cairn-demo/greeting@1.0.6". Centre: an enormous status word with icon — design three
> variants on one canvas: ◷ PENDING (amber), ✓ VERIFIED (emerald), ✗ DIVERGENT (red, whole
> background subtly tinted). Below: three large attester tiles (attester-a, attester-b,
> attester-c), each showing a state — "standing by", "re-fetched · digest matches ✓",
> "observed different bytes ✗". Bottom strip: attested digest vs observed digest in large
> monospace, and "Read from the contract in this browser at block 61,802,333". Must be legible
> from 10 metres.

### B5. Attesters

> Design the **Attesters** page: a short explainer ("Attesters independently re-download
> every release and re-compute its digest; the contract — not the attester — decides
> whether it matches"), then three attester cards in a grid: label, address (mono),
> online/health indicator, corroborations count (e.g. 95), divergences reported (6), last
> on-chain action ("12s ago"). Include a note area "Quorum: 2 of 3 attesters must agree" and
> an honest caption "In this MVP all three attesters are operated by the CAIRN team."

### B6. Check a lockfile

> Design a **Check a lockfile** page: a large drop zone / paste area for a
> `package-lock.json`, then a results view: a coverage ring "89 of 437 dependencies
> attested (20.4%)", verdict counts (✓ 89 verified, ? 348 unattested, ✗ 0 divergent), a
> searchable results table (package, version, status pill, corroborations), and a caption:
> "Reads attestation status from the chain in your browser. For byte-level verification of
> the files you actually install, run `npx @cairn/cli verify`."

### B7. Mobile

> Produce mobile versions (390px wide) of the home page and the package page: search
> stays prominent, the sidebar metadata moves below the verdict, tabs become a horizontal
> scroller.

---

## Real data to use in mock-ups (from the live deployment)

- Stats: 96 releases attested, 90 verified, 6 divergent, 3 attesters, quorum 2 of 3
- Verified examples: `express@4.21.2`, `chalk@4.1.2`, `debug@2.6.9`, `semver@7.6.3`,
  `left-pad@1.3.0` (digest `0x7aacfd0a505ea8611083862ebafe4c1f95fef4a108ca36ed80b68de23c01b293`)
- Divergent examples: `@cairn-demo/greeting@1.0.0` … `@1.0.5`
- Publisher: `0x378ffB0900eE3bCD9E45202d2150CE8204475D72`
- Attesters: attester-a `0xbC41…95fa`, attester-b `0xa76C…97b7`, attester-c `0x4074…969c`
- Contract: `0x6261c3ba0c08768e0c2b0ef6028a5ebf6f6b77ec` on Base Sepolia
- Real project coverage: 89 of 437 dependencies (20.4%)

## What comes back

For each screen: the Stitch export (HTML + Tailwind) or a screenshot plus the generated
code. The implementation will keep every number live (no hard-coded values ship), keep the
browser-side chain reads, and map Stitch's components onto the existing data hooks.
