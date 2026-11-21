"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CLI_TARBALL_URL, CLI_VERSION, REGISTRY_ADDR, REPO_URL } from "@/lib/config";

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-4 pr-20 font-mono text-sm leading-relaxed text-neutral-200">{children}</pre>
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(children).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
        className="absolute top-2 right-2 rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <h2 className="text-2xl font-semibold">
        <a href={`#${id}`} className="hover:underline">
          {title}
        </a>
      </h2>
      {children}
    </section>
  );
}

const TOC = [
  ["install", "Install the CLI"],
  ["verify", "Verify a project"],
  ["ci", "Add it to CI"],
  ["publish", "Attest your package"],
  ["policy", "Policy file"],
  ["attester", "Run an attester"],
  ["config", "Configuration"],
  ["api", "API & data"]
] as const;

export default function DocsPage() {
  return (
    <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
      <nav className="hidden lg:block">
        <div className="sticky top-6 space-y-1">
          <p className="mb-2 text-sm uppercase tracking-wide text-neutral-500">Getting started</p>
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block rounded-md px-2 py-1 text-neutral-300 hover:bg-neutral-900 hover:text-white">
              {label}
            </a>
          ))}
        </div>
      </nav>

      <article className="max-w-3xl space-y-12 text-lg text-neutral-300">
        <header className="space-y-3">
          <h1 className="text-4xl font-bold text-neutral-100">Getting started</h1>
          <p>
            CAIRN checks that every dependency you install is byte-for-byte what its maintainer published — confirmed on-chain by
            independent attesters — and fails the build when it is not. It works with your existing <span className="font-mono">npm</span>{" "}
            lockfile; nothing about how you install packages changes.
          </p>
        </header>

        <Section id="install" title="Install the CLI">
          <p>
            The CLI ships as a single self-contained file (v{CLI_VERSION}) on GitHub Releases — it is not on the npm registry. Requires
            Node.js 22 or newer. Run it once without installing:
          </p>
          <Code>{`npx --yes ${CLI_TARBALL_URL} verify`}</Code>
          <p>or install the <span className="font-mono">cairn</span> command globally:</p>
          <Code>{`npm install -g ${CLI_TARBALL_URL}\ncairn --version`}</Code>
          <p className="text-base text-neutral-400">
            It comes preconfigured for the public deployment on Base Sepolia (with RPC failover), so it works with zero setup.
          </p>
        </Section>

        <Section id="verify" title="Verify a project">
          <p>In a project with a <span className="font-mono">package-lock.json</span> (npm 7+, lockfile v2 or v3):</p>
          <Code>{`cairn verify\n# or point at a lockfile elsewhere\ncairn verify --lockfile path/to/package-lock.json`}</Code>
          <p>
            CAIRN downloads each dependency, digests the exact bytes your machine received, and compares them with the attested record and
            quorum read straight from the contract. Each dependency gets a verdict:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-base">
              <thead className="text-sm uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-4">Verdict</th>
                  <th className="py-2">Meaning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {[
                  ["PASS", "Attested, the bytes match, independent attesters reached quorum."],
                  ["UNDER_QUORUM", "Attested and matching, but not enough attesters have confirmed it yet."],
                  ["UNATTESTED", "No attestation exists for this exact version."],
                  ["DIVERGENT", "Attested — but the bytes you received differ. The alarm."],
                  ["CONTESTED", "Your bytes match, but attesters recorded divergence for this version."],
                  ["UNKNOWN", "The chain or registry could not be reached. Treated as failure: CAIRN fails closed."]
                ].map(([v, m]) => (
                  <tr key={v}>
                    <td className="py-2 pr-4 font-mono text-neutral-100">{v}</td>
                    <td className="py-2">{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Exit codes: <span className="font-mono">0</span> pass · <span className="font-mono">1</span> the gate fired (policy violation) ·{" "}
            <span className="font-mono">2</span> could not verify. Useful flags:
          </p>
          <Code>{`cairn verify --fail-on divergent      # divergent | under-quorum (default) | unattested
cairn verify --json                    # machine-readable report on stdout
cairn verify --only "@myorg/*"         # restrict to matching names
cairn status express@4.21.2            # one package's on-chain record`}</Code>
          <p className="text-base text-neutral-400">
            Want a quick look without installing anything? <Link href="/check" className="text-sky-300 underline">Check a lockfile</Link> in the
            browser (attestation status only).
          </p>
        </Section>

        <Section id="ci" title="Add it to CI">
          <p>One step in any GitHub Actions workflow, after checkout:</p>
          <Code>{`- uses: theseriouscoder123/CARIN@v1
  with:
    lockfile: package-lock.json   # default
    fail-on: under-quorum         # divergent | under-quorum | unattested`}</Code>
          <p>
            The job fails on a policy violation and writes a verdict table — with coverage and what changed — to the job summary. See it
            run:{" "}
            <a href={`${REPO_URL}/actions/workflows/demo-tampered-dependency.yml`} target="_blank" rel="noreferrer" className="text-sky-300 underline">
              clean lockfile passes, tampered dependency blocked
            </a>
            .
          </p>
        </Section>

        <Section id="publish" title="Attest your package">
          <p>Maintainers attest each release once, right after publishing it. Create an encrypted publisher keystore:</p>
          <Code>{`cairn keygen
# prints your publisher address — fund it with a little Base Sepolia ETH`}</Code>
          <p>Then attest a release tarball (or a version already on the registry):</p>
          <Code>{`npm pack
cairn publish my-package-1.2.3.tgz --keystore
# or attest a version already on the registry:
cairn publish --package my-package@1.2.3 --keystore`}</Code>
          <p className="text-base text-neutral-400">
            The first attestation of a name pins your key: later versions must be signed by the same key, so a hijacked registry account
            cannot produce attested releases. Use <span className="font-mono">--dry-run</span> to see the digests without submitting.
            In CI, set <span className="font-mono">CAIRN_KEYSTORE</span> and <span className="font-mono">CAIRN_KEYSTORE_PASSWORD</span> as
            secrets.
          </p>
        </Section>

        <Section id="policy" title="Policy file">
          <p>
            Optional <span className="font-mono">cairn.policy.json</span> in the project root. Allowlist entries need a reason and an expiry,
            and can never excuse a divergent or contested dependency.
          </p>
          <Code>{`{
  "failOn": ["DIVERGENT", "CONTESTED", "UNDER_QUORUM"],
  "minCorroborations": 2,
  "allow": [
    { "name": "legacy-pkg", "version": "1.0.0", "reason": "vendor EOL", "expires": "2027-03-31" }
  ]
}`}</Code>
        </Section>

        <Section id="attester" title="Run an attester">
          <p>
            Attesters independently re-download every attested release, recompute its digest and report it on-chain. In this MVP the
            attester set is admin-managed (2 of 3 must agree); run one from the repository:
          </p>
          <Code>{`git clone ${REPO_URL}
cd CARIN && corepack enable && pnpm install && pnpm build
CAIRN_ATTESTER_KEY=0x... CAIRN_ATTESTER_LABEL=my-attester \\
CAIRN_RPC_URL=https://sepolia.base.org \\
  node apps/attester/dist/index.js`}</Code>
          <p className="text-base text-neutral-400">
            The key must be registered in the QuorumPolicy contract to count toward quorum. Staked, permissionless attesters are on the
            roadmap.
          </p>
        </Section>

        <Section id="config" title="Configuration">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-base">
              <thead className="text-sm uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-4">Variable / flag</th>
                  <th className="py-2">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800 font-normal">
                {[
                  ["CAIRN_RPC_URL · --rpc-url", "RPC endpoint, or a comma-separated failover list"],
                  ["CAIRN_REGISTRY_ADDR · --contract", "AttestationRegistry address (default: bundled Base Sepolia deployment)"],
                  ["CAIRN_REGISTRY_URL · --registry-url", "npm registry used by --package (default: registry.npmjs.org)"],
                  ["CAIRN_KEYSTORE · --keystore", "encrypted publisher keystore from cairn keygen"],
                  ["CAIRN_KEYSTORE_PASSWORD", "keystore passphrase for non-interactive use"],
                  ["NO_COLOR · --no-color", "disable colour output"]
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-2 pr-4 font-mono text-sm text-neutral-100">{k}</td>
                    <td className="py-2">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="api" title="API & data">
          <p>
            Everything on this site is public and read-only. The contract on Base Sepolia is the source of truth
            {REGISTRY_ADDR ? (
              <>
                {" "}(<span className="font-mono text-base">{REGISTRY_ADDR}</span>)
              </>
            ) : null}
            ; the indexer API is a convenience cache described in{" "}
            <a href={`${REPO_URL}/blob/main/docs/openapi.yaml`} target="_blank" rel="noreferrer" className="text-sky-300 underline">
              OpenAPI
            </a>
            . Threat model and design decisions:{" "}
            <a href={`${REPO_URL}/tree/main/docs`} target="_blank" rel="noreferrer" className="text-sky-300 underline">
              docs/
            </a>
            .
          </p>
        </Section>
      </article>
    </div>
  );
}
