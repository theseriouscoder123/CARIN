import Link from "next/link";
import { ActivityFeed, AttesterCards, DivergenceAlert, DivergenceFeed, RecentPackages, StatCards } from "@/components/lists";
import { Card } from "@/components/ui";

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <DivergenceAlert />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold">Transparency log</h1>
          <p className="mt-2 max-w-3xl text-lg text-neutral-400">
            Every release attested by its maintainer, independently re-fetched and co-signed by attesters, recorded on an append-only contract.
          </p>
        </div>
        <Link href="/verify" className="rounded-lg bg-sky-500 px-6 py-3 text-lg font-semibold text-neutral-950 hover:bg-sky-400">
          Verify a package →
        </Link>
      </div>
      <StatCards />
      <ActivityFeed />
      <Card title="Attesters">
        <AttesterCards />
      </Card>
      <RecentPackages />
      <DivergenceFeed />
    </div>
  );
}
