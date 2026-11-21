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
serving real tarballs over the real protocol. Say so on stage in one sentence — framing it
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
pnpm --filter @cairn/contracts hardhat node

# terminal 2 — deploy + seed
pnpm --filter @cairn/contracts deploy:local
pnpm --filter @cairn/contracts seed

# terminal 3 — registry
pnpm registry:up                 # Verdaccio :4873, publish.allow_offline + overwrite

# terminal 4 — attesters
pnpm attesters:up                # three processes, three keys, ports 4001-4003

# terminal 5 — indexer + dashboard
pnpm dev
```

Verdaccio config must permit republishing the same version. Verify this during setup, not
on stage.

### Demo fixture

`fixtures/demo/greeting/` — a tiny, legible package. Keep it small enough that the file
list fits on one screen.

```
package.json          name: @cairn-demo/greeting, version 1.0.0
index.js              module.exports = (n) => `Hello, ${n}!`
README.md
```

The tampered variant adds one file:

```
scripts/postinstall.js    // exfiltration stand-in — a console.log, clearly labelled
```

Make the malicious file's content obviously a stand-in, not functional malware. A judge
should see the shape of the attack without the repo containing anything real. Use a
comment: `// SIMULATED PAYLOAD — demo fixture, performs no action`.

---

## 3. The sequence

Total: 4–5 minutes. Practise until it runs without thinking.

### Act 1 — a clean release (60s)

```bash
cairn publish fixtures/demo/greeting-1.0.0.tgz
```

Show the terminal: digest computed, attestation submitted, transaction hash.

Switch to the dashboard. The package appears, status **PENDING**, `0 / 3` corroborations.

Within seconds the attester cards tick over: `1/3`, `2/3`, `3/3`. Status flips to
**VERIFIED**, green.

> Say: "Three independent processes just re-downloaded that package from the registry,
> recomputed the digest themselves, and signed on-chain that it matches. I didn't tell them
> it was fine — they checked."

### Act 2 — the gate passes (45s)

```bash
cd fixtures/demo/consumer
cairn verify
```

```
  ✓ 1 verified
  PASS
```

> Say: "This is what a clean CI run looks like. Exit code zero, build proceeds."

### Act 3 — the tamper (60s)

```bash
pnpm demo:tamper        # rebuilds 1.0.0 with scripts/postinstall.js, republishes
```

Show that the version string is **unchanged**: still `1.0.0`. The lockfile does not change.
Nothing a developer would notice has changed.

> Say: "Same version. Same lockfile entry. Every tool that pins by version string is
> satisfied. The bytes are different."

### Act 4 — detection (60s)

```bash
curl -X POST localhost:4001/admin/recheck -d '{"packageId":"0x…"}'
```

(Or wait for the timer if it is short enough — but do not gamble on stage. Use the trigger.)

Dashboard goes red. Divergence banner at the top. The package detail page shows expected
vs observed digest, and which attester reported it.

> Say: "An attester re-checked the published artifact and found different bytes than were
> attested. That divergence is now recorded on-chain, permanently, attributed to the
> attester that found it."

### Act 5 — the block (60s)

```bash
cairn verify
```

```
  ✗  @cairn-demo/greeting@1.0.0                            DIVERGENT
     attested   0x7f3a…c21e
     observed   0xa014…77d9
     delta      scripts/postinstall.js  (added)

  BLOCKED — 1 divergent dependency
```

```bash
echo $?        # 1
```

Then the GitHub Actions tab: a **red CI run** on the demo repo, failed by `cairn verify`.

> Say: "Non-zero exit. The pipeline fails. The compromised dependency never reaches
> production — and nobody had to know in advance that this package was malicious."

---

## 4. Fallbacks

| Failure | Response |
|---|---|
| Internet drops | Everything runs locally; switch to the local URL and keep going |
| A service is dead | `pnpm dev` restart is 20s. Keep a second terminal pre-warmed |
| Hardhat was restarted | `deploy:local && seed` — rehearse this recovery, timed |
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
