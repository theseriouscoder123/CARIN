"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconFile, IconSearch, IconTerminal } from "@/components/icons";
import { ActivityFeed, AttesterList, CiCard, DivergenceAlert, HeroStats, RecentPackages } from "@/components/lists";

export default function OverviewPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <div className="space-y-6">
      <DivergenceAlert />

      <section className="overflow-hidden rounded-lg border border-nav-line bg-nav text-white">
        <div className="grid grid-cols-1 gap-8 px-6 py-8 md:px-10 md:py-10 lg:grid-cols-[1fr_420px]">
          <div className="min-w-0">
            <p className="mb-3 inline-flex items-center gap-2 rounded border border-teal/40 bg-teal/10 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-teal uppercase">
              npm · append-only transparency log
            </p>
            <h1 className="text-[28px] leading-9 font-bold tracking-tight md:text-4xl md:leading-[44px]">
              Every dependency, byte-for-byte
              <br className="hidden sm:block" /> what its maintainer published.
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-slate-300">
              Maintainers attest releases on-chain, independent attesters re-download and co-sign them, and your build fails the moment the bytes diverge.
            </p>
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(q.trim() ? `/packages?q=${encodeURIComponent(q.trim())}` : "/packages");
              }}
              className="mt-6 flex max-w-xl overflow-hidden rounded border border-line-strong bg-white focus-within:ring-2 focus-within:ring-primary"
            >
              <span className="flex items-center pl-3 text-muted">
                <IconSearch size={18} />
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search attested packages — express, chalk, @scope/name"
                aria-label="Search attested packages"
                className="min-w-0 flex-1 px-3 py-3 text-[15px] text-ink outline-none"
              />
              <button type="submit" className="bg-primary px-5 text-sm font-semibold hover:bg-primary-hover">
                Search
              </button>
            </form>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
              <Link href="/check" className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white">
                <IconFile size={14} /> Audit a lockfile
              </Link>
              <Link href="/docs" className="inline-flex items-center gap-1.5 text-slate-300 hover:text-white">
                <IconTerminal size={14} /> Install the CLI
              </Link>
            </div>
          </div>
          <div className="self-center">
            <HeroStats />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <RecentPackages limit={12} />
        </div>
        <aside className="space-y-6 lg:col-span-4">
          <ActivityFeed limit={8} />
          <AttesterList />
          <CiCard />
        </aside>
      </div>
    </div>
  );
}
