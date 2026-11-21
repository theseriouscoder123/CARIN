import { AttesterCards } from "@/components/lists";

export default function AttestersPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-bold">Attesters</h1>
      <p className="max-w-3xl text-lg text-neutral-400">
        Each attester is a separate process with its own key. It re-downloads every attested artifact from the registry itself, recomputes the
        digest, and reports what it saw. The contract — not the attester — decides whether that is a corroboration or a divergence.
      </p>
      <AttesterCards large />
    </div>
  );
}
