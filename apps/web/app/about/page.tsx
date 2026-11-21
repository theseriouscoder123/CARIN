import { Card } from "@/components/ui";

export default function AboutPage() {
  return (
    <div className="max-w-4xl space-y-6 text-lg text-neutral-300">
      <h1 className="text-4xl font-bold text-neutral-100">How CAIRN works</h1>

      <Card title="The precedent: Certificate Transparency">
        <p>
          In 2013, certificate authorities could mis-issue certificates and nobody could prove it. The fix was not a more trustworthy CA; it was a
          public, append-only log that made mis-issuance detectable by anyone. Package registries sit where CAs sat: a single issuer whose records
          are mutable and whose compromise is invisible downstream. CAIRN is that log for package artifacts.
        </p>
      </Card>

      <Card title="Four moving parts">
        <ol className="list-decimal space-y-2 pl-6">
          <li>
            A maintainer runs <span className="font-mono">cairn publish</span>: it computes a reproducible Merkle digest over the release&apos;s
            normalised file tree, signs it, and writes it to an append-only contract.
          </li>
          <li>Independent attester processes re-download the artifact from the registry, recompute the digest, and report what they observed.</li>
          <li>The contract counts a release as verified only once M of N attesters agree — and revokes that the moment any attester reports different bytes.</li>
          <li>
            <span className="font-mono">cairn verify</span> digests every artifact in your lockfile from the bytes your machine receives, reads the
            contract, and fails the build on anything unattested, under quorum or divergent.
          </li>
        </ol>
      </Card>

      <Card title="What CAIRN claims — precisely">
        <p>
          CAIRN never decides whether code is malicious. It detects <strong>divergence</strong>: the same version string resolving to different
          bytes than were attested. That is the mechanical signature of republication, tag re-pointing and account takeover, and it is visible from
          the first victim onward rather than after an advisory is published.
        </p>
      </Card>

      <Card title="Trust model and known limits">
        <ul className="list-disc space-y-2 pl-6">
          <li>Assumes at least M of N attesters are honest and independent, the chain&apos;s history is immutable, and SHA-256 is collision-resistant.</li>
          <li>Does not trust the registry, the CAIRN operators, any single attester, or this dashboard. The indexer behind it is a cache anyone can rebuild from chain events; package pages re-read the contract from your browser.</li>
          <li>The attester set is admin-managed in this MVP — the admin can change who attests, but cannot alter or delete any recorded attestation. Staked, permissionless attesters are roadmap work.</li>
          <li>The first attestation of a name is trust-on-first-use; later versions must be signed by the same pinned key.</li>
          <li>Repacking is not tampering: gzip settings, mtimes and entry order are normalised away. Only a change to the file tree is a divergence.</li>
        </ul>
      </Card>
    </div>
  );
}
