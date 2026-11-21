export default function HomePage() {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">Attestations</h1>
      <p className="text-neutral-400">
        Indexer not connected. This page will list on-chain attestations once
        <code className="mx-1 rounded bg-neutral-900 px-1 font-mono text-sm">apps/indexer</code>
        is running.
      </p>
    </section>
  );
}
