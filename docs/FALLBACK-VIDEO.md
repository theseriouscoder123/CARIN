# Fallback demo video — shot list and narration

Record this **once, while everything is green**, as insurance for the live demo. It is a screen
recording of the real system running on Base Sepolia — not a mock-up — so it is honest to show
if the venue network fails. Target length: 3 minutes 30 seconds.

## Setup (5 minutes before recording)

1. `pnpm registry:up` and `pnpm attesters:base-sepolia` in two terminals.
2. `pnpm demo:preflight:base-sepolia` → must print **READY**.
3. Screen layout: terminal on the left half, browser on the right half. Font size large
   (terminal ≥ 18 pt, browser zoom 125%). Close notifications.
4. Start the recorder (OBS: Display Capture, 1920×1080, 30 fps, microphone on).
5. In the terminal: `pnpm demo:stage:base-sepolia`. It prepares a fresh release and prints a
   `…/live?spec=…` link — open it in the browser **before** pressing Enter.

## Shots and narration

| # | Screen | Action | Say (≈ words) |
|---|---|---|---|
| 1 | Browser: `/live` showing **WAITING** | — | "This is CAIRN's live view, reading the contract on Base Sepolia directly from the browser. It's waiting for a new release." (25) |
| 2 | Terminal | Enter → beat 1 (publish) | "The maintainer runs `cairn publish`: a reproducible Merkle digest of the package, signed and anchored on-chain." (20) |
| 3 | Browser | Watch the three tiles turn green | "Three independent attesters re-download the package from the registry and recompute the digest themselves. Each co-signs on-chain. Quorum reached." (25) |
| 4 | Terminal | Enter → beat 3 (verify) | "In CI, `cairn verify` digests every dependency it is about to install and checks quorum on-chain. Everything passes — exit code zero." (25) |
| 5 | Terminal | Enter → beat 4 (tamper) | "Now an attacker takes over the account and republishes the same version — same version string, different bytes, with an install hook added." (25) |
| 6 | Browser | Enter → beat 5; tiles turn red, page goes **DIVERGENT** | "The attesters re-check and find different bytes. That divergence is recorded on-chain, permanently, and quorum is revoked." (22) |
| 7 | Terminal | Enter → beat 6 (block) | "A fresh install records the tampered hash and npm is satisfied. CAIRN is not: divergent, with the exact file that was added — and a non-zero exit, so the build stops." (32) |
| 8 | Browser: GitHub Actions, *demo: tampered dependency* run | Click the run; show the green and red jobs and the summary table | "Adopting it is one line in any GitHub workflow. Clean lockfile: green. Tampered dependency: blocked." (18) |
| 9 | Browser: BaseScan tab from the stage driver's links | Show the contract's transactions | "Every step you just saw is a public transaction anyone can verify." (12) |

## After recording

- Watch it once end to end; re-record if any beat is cut off.
- Export as MP4 (H.264). Keep it on the presenting laptop **and** a USB stick.
- Note the demo version used (e.g. `@cairn-demo/greeting@1.0.7`) in the file name, so a judge
  can find the same release on the dashboard and on BaseScan.
