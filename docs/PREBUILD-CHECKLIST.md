# Pre-Build Checklist

Everything here happens **before** the window opens. None of it is code in the CAIRN
repository.

The line is simple: **preparing your environment is allowed; writing the project is not.**
A judge checking originality looks at the CAIRN repository's commit history. Installing
Node, funding a wallet, and reading these specs leave no trace there.

---

## 1. Do not do these

- Do not create the CAIRN repository with code in it.
- Do not scaffold the monorepo "just to save time at hour zero". That scaffold is the
  first hour of the build and it is graded.
- Do not write `packages/core`, contracts, or any other implementation file.
- Do not copy a structure from a previous project into the repo.

If something would appear in `git log` before kick-off and is not documentation, it does
not belong.

---

## 2. Toolchain — all three machines

```bash
node --version      # 22.x (>=22.10)
pnpm --version      # 12.x (via corepack)
git --version
docker --version    # for Verdaccio and Mongo
```

Install and verify:

- Node 22 via nvm/fnm, with `.nvmrc` discipline agreed
- pnpm 12 (`corepack enable`; the root `packageManager` field pins the version)
- Docker Desktop (or Colima) running
- VS Code with Solidity, ESLint, Prettier, Tailwind extensions
- GitHub CLI authenticated

### Rehearse, then discard

In a **throwaway repository you never touch again**, each person should run through once:

- `pnpm init` + workspaces + Turborepo until `pnpm build` passes
- `hardhat init` (TypeScript), compile, run a test, start a node
- `create-next-app` with App Router + Tailwind, deploy it to a public URL
- Start Verdaccio in Docker, `npm publish` a toy package to it, confirm you can
  **republish the same version** after enabling overwrite
- Start MongoDB in Docker and connect from Node

Delete the repository afterwards. The point is muscle memory and finding broken
environments now, not at H+1.

> The Verdaccio republish step is the one people skip. Do not skip it. If overwrite does
> not work on the day, the entire demo has no tamper step.

---

## 3. Accounts and access

- [ ] GitHub organisation or repo owner decided; all three have push access
- [ ] Deployment host account ready, CLI authenticated, a test project deployed
- [ ] MongoDB Atlas cluster created (free tier) with a connection string in hand, or
      Docker Mongo verified locally
- [ ] IPFS pinning account (web3.storage or similar) with an API token — or confirm the
      local payload store is sufficient for the MVP
- [ ] If a public testnet is likely: wallets created and **funded now**. Faucets are
      rate-limited and fail at the worst moments. Fund three attester keys plus a deployer.

---

## 4. Competition logistics

- [ ] New dates confirmed; the table in `BUILD-PLAN-24H.md` §1 filled in with IST times
- [ ] **Ask the committee on Discord: how do fully-remote teams complete the mandatory
      night checkpoint?** Do not discover this at H+12.
- [ ] **Ask which pitching batch you are in.** The difference between batches is hours of
      post-freeze prep time and it changes the end of the schedule.
- [ ] Confirm what identity documents are required at check-in — the earlier guidance said
      passports for the online path; the commitment letter encloses national IDs. Have both
      available rather than assuming.
- [ ] All three members' check-in attendance confirmed, cameras working
- [ ] Backup internet arranged — mobile hotspot tested, not just owned
- [ ] Power: the window spans a night. Confirm no scheduled outage, have a plan if there is

---

## 5. Team agreements — settle these before, not during

- [ ] Lane assignment (A contracts, B core/CLI, C services/UI) confirmed and accepted
- [ ] Sleep rotation drafted — who sleeps when, decided at H+12 but sketched now
- [ ] Communication channel for the build (voice always-on is better than text)
- [ ] Who drives the demo screenshare, who narrates
- [ ] Agreement on the cut list in `BUILD-PLAN-24H.md` §3 — so cutting is execution, not
      debate
- [ ] Agreement that `main` must build, and that nobody merges red

---

## 6. Read before kick-off

Each person reads all of these at least once. Re-reading at H+3 while blocked is too late.

| Priority | Document | Who especially |
|---|---|---|
| 1 | `CLAUDE.md` | everyone |
| 1 | `BUILD-PLAN-24H.md` | everyone |
| 1 | `DEMO-RUNBOOK.md` | everyone |
| 2 | `ARCHITECTURE.md` | everyone |
| 2 | `SPEC-DIGEST.md` | **B especially — this is the hard one** |
| 2 | `SPEC-CONTRACTS.md` | A |
| 3 | `SPEC-CLI.md` | B |
| 3 | `SPEC-ATTESTER.md` | A |
| 3 | `SPEC-INDEXER-API.md`, `SPEC-DASHBOARD.md` | C |
| 3 | `TESTING.md` | everyone |

Rehearse the **pitch Q&A** (`DEMO-RUNBOOK.md` §6) out loud. Reading the answers is not the
same as having said them. The Sigstore question and the "why blockchain" question will
come up, and hesitating on either undercuts everything the demo just showed.

---

## 7. Fixture design — on paper only

Decide, but do not build:

- Demo package name and contents (`@cairn-demo/greeting`, three files)
- What the tampered version adds (`scripts/postinstall.js`, clearly labelled as simulated)
- The consumer project that runs `cairn verify`
- The GitHub repo that will show a red CI run

Write it on paper or in this file. Build it inside the window.

---

## 8. Final 24 hours before kick-off

- [ ] Full `pnpm`/Docker/Hardhat smoke test on each machine one last time
- [ ] Phones charged, notifications silenced, workspace cleared
- [ ] Snacks and water bought — nobody should be leaving the desk at H+14
- [ ] Sleep properly the night before. The first six hours set up everything else, and
      they are the hours most damaged by starting tired.
