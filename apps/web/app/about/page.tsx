import Link from "next/link";
import { IconAlert, IconCheck, IconKey, IconServer, IconShield, IconTerminal, IconX } from "@/components/icons";
import { Card, PageHeader } from "@/components/ui";

const STEPS = [
  {
    icon: <IconKey size={18} />,
    title: "Maintainer attests",
    cmd: "cairn publish",
    body: "Computes a reproducible Merkle digest over the release's normalised file tree, signs it, and writes it to an append-only contract."
  },
  {
    icon: <IconServer size={18} />,
    title: "Attesters re-fetch",
    cmd: "attester node",
    body: "Independent processes re-download the artifact from the registry, recompute the digest and report what they observed on-chain."
  },
  {
    icon: <IconShield size={18} />,
    title: "Contract decides",
    cmd: "M of N quorum",
    body: "A release counts as verified once M of N attesters agree — and loses quorum the moment any attester reports different bytes."
  },
  {
    icon: <IconTerminal size={18} />,
    title: "Build gate",
    cmd: "cairn verify",
    body: "Digests every artifact in your lockfile from the bytes your machine receives, reads the contract, and fails on anything divergent or under quorum. Unattested packages warn by default; --fail-on unattested blocks them."
  }
];

export default function AboutPage() {
  return (
    <div className="space-y-8">
      <PageHeader crumbs={<span>docs / architecture</span>} title="How CAIRN works" sub="Certificate Transparency, applied to package artifacts." />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <div key={s.title} className="relative rounded-lg border border-line bg-card p-5">
            <div className="flex items-center justify-between">
              <span className="rounded border border-primary/20 bg-primary-soft p-2 text-primary">{s.icon}</span>
              <span className="font-mono text-xs text-muted">0{i + 1}</span>
            </div>
            <p className="mt-4 text-[15px] font-semibold">{s.title}</p>
            <p className="mt-0.5 font-mono text-xs text-teal-ink">{s.cmd}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <Card title="The precedent">
            <p className="text-[15px] leading-relaxed text-ink-2">
              Certificate authorities could once mis-issue certificates and nobody could prove it. The fix was not a more trustworthy CA; it was a public,
              append-only log that made mis-issuance detectable by anyone. Package registries sit where CAs sat: a single issuer whose records are mutable
              and whose compromise is invisible downstream. CAIRN is that log for package artifacts.
            </p>
          </Card>

          <Card title="What CAIRN claims — precisely">
            <p className="text-[15px] leading-relaxed text-ink-2">
              CAIRN never decides whether code is malicious. It detects <b className="text-ink">divergence</b>: the same version string resolving to different
              bytes than were attested — the mechanical signature of republication, tag re-pointing and account takeover. It is visible from the first
              victim onward, not after an advisory is published.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded border border-ok/30 bg-ok-soft p-3 text-[13px]">
                <p className="flex items-center gap-1.5 font-semibold text-ok-ink">
                  <IconCheck size={14} strokeWidth={3} /> Detects
                </p>
                <p className="mt-1 text-ink-2">Republished versions, swapped tarballs, releases signed by a key other than the pinned publisher.</p>
              </div>
              <div className="rounded border border-line-strong bg-code p-3 text-[13px]">
                <p className="flex items-center gap-1.5 font-semibold text-ink-2">
                  <IconX size={14} strokeWidth={3} /> Does not judge
                </p>
                <p className="mt-1 text-ink-2">Whether attested code is safe. A malicious release attested by its real maintainer is consistent, not divergent.</p>
              </div>
            </div>
          </Card>
        </div>

        <Card title="Trust model and limits" icon={<IconAlert size={16} />} className="lg:col-span-4">
          <ul className="space-y-3 text-[13px] leading-relaxed text-ink-2">
            <li>Assumes at least M of N attesters are honest and independent, chain history is immutable, and SHA-256 is collision-resistant.</li>
            <li>Trusts neither the registry, the operators, any single attester, nor this dashboard — its indexer is a cache anyone can rebuild, and package pages re-read the contract in your browser.</li>
            <li>The attester set is admin-managed in this MVP. The admin can change who attests but cannot alter or delete any recorded attestation.</li>
            <li>The first attestation of a name is trust-on-first-use; later versions must be signed by the same pinned key.</li>
            <li>Repacking is not tampering: gzip settings, mtimes and entry order are normalised away.</li>
          </ul>
          <Link href="/docs" className="mt-4 inline-block text-[13px] font-semibold text-primary hover:underline">
            Getting started →
          </Link>
        </Card>
      </div>
    </div>
  );
}
