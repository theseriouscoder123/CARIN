"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EXPLORER_URL, INDEXER_URL, REGISTRY_ADDR, REPO_URL } from "@/lib/config";
import { chainName, short } from "@/lib/format";
import type { Health, Stats } from "@/lib/types";
import { HttpError, indexer, usePoll } from "@/lib/use-poll";
import { IconAlert, IconGithub, IconLogo, IconMenu, IconSearch, IconX } from "./icons";

const NAV = [
  { href: "/packages", label: "Packages" },
  { href: "/live", label: "Live" },
  { href: "/attesters", label: "Attesters" },
  { href: "/check", label: "Lockfile audit" },
  { href: "/verify", label: "Verify" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "How it works" }
];

/** Health survives a 503: the body still says how far behind the indexer is. */
async function fetchHealth(): Promise<Health> {
  try {
    return await indexer<Health>("/health");
  } catch (err) {
    if (err instanceof HttpError && err.status === 503) {
      const res = await fetch(`${INDEXER_URL}/api/v1/health`, { cache: "no-store" });
      return (await res.json()) as Health;
    }
    throw err;
  }
}

function SearchBox({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        router.push(v ? `/packages?q=${encodeURIComponent(v)}` : "/packages");
      }}
      className={`relative ${className}`}
    >
      <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search packages"
        aria-label="Search packages"
        className="w-full rounded border border-nav-line bg-nav-2 py-1.5 pr-3 pl-9 text-sm text-white outline-none placeholder:text-slate-400 focus:border-primary"
      />
    </form>
  );
}

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const health = usePoll<Health>(fetchHealth, "health");
  useEffect(() => setOpen(false), [path]);
  const h = health.data;
  const active = (href: string) => path === href || (href === "/packages" && path.startsWith("/package"));

  return (
    <header className="sticky top-0 z-40 border-b border-nav-line bg-nav text-white">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-4 px-4 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <IconLogo size={28} />
          <span className="font-mono text-[15px] font-bold tracking-wider">CAIRN</span>
        </Link>
        {h ? (
          <span
            className="hidden shrink-0 items-center gap-1.5 rounded border border-nav-line bg-nav-2 px-2 py-1 font-mono text-[11px] text-slate-300 lg:inline-flex"
            title={`chain ${h.chainId} · head block ${h.headBlock}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${h.ok ? "bg-teal" : "bg-warn"}`} />
            {chainName(h.chainId)} · #{h.headBlock.toLocaleString("en-US")}
          </span>
        ) : null}
        <nav className="hidden items-center gap-0.5 xl:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded px-2.5 py-1.5 text-[13px] whitespace-nowrap ${active(n.href) ? "bg-nav-2 font-semibold text-white" : "text-slate-300 hover:text-white"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <SearchBox className="hidden w-56 md:block lg:w-64" />
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="hidden text-slate-300 hover:text-white sm:block" title="Source on GitHub">
            <IconGithub size={20} />
          </a>
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-slate-200 xl:hidden" aria-label="Menu" aria-expanded={open}>
            {open ? <IconX size={22} /> : <IconMenu size={22} />}
          </button>
        </div>
      </div>
      {open ? (
        <div className="border-t border-nav-line px-4 pt-3 pb-4 xl:hidden">
          <SearchBox className="mb-3 md:hidden" />
          <nav className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={`rounded px-3 py-2 text-sm ${active(n.href) ? "bg-nav-2 font-semibold" : "text-slate-300"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
    </header>
  );
}

/** Thin status strip under the header: indexer freshness and any open divergences. */
export function StatusStrip() {
  const health = usePoll<Health>(fetchHealth, "health");
  const stats = usePoll<Stats>(() => indexer<Stats>("/stats"), "stats");
  const h = health.data;
  const s = stats.data;

  if (h === undefined && health.error) {
    return (
      <div role="alert" className="border-b border-bad/30 bg-bad-soft text-bad-ink">
        <p className="mx-auto flex max-w-[1320px] items-center gap-2 px-4 py-1.5 text-xs md:px-6">
          <IconAlert size={13} /> Indexer unreachable — lists cannot load. Package pages and audits still read the chain directly.
        </p>
      </div>
    );
  }
  if (!h) return <div className="h-[29px] border-b border-line bg-white" />;

  return (
    <div className={`border-b ${h.ok ? "border-line bg-white" : "border-warn/30 bg-warn-soft"}`}>
      <div className="mx-auto flex max-w-[1320px] items-center gap-3 overflow-hidden px-4 py-1.5 font-mono text-[11px] whitespace-nowrap text-muted md:px-6">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${h.ok ? "bg-ok" : "bg-warn"}`} />
          {h.ok ? "Indexer in sync" : `Indexer ${h.lag} block${h.lag === 1 ? "" : "s"} behind — cached data`}
        </span>
        <span className="hidden text-line-strong sm:inline">|</span>
        <span className="hidden sm:inline">
          indexed to #{h.lastIndexedBlock.toLocaleString("en-US")} of #{h.headBlock.toLocaleString("en-US")}
        </span>
        {s ? (
          <>
            <span className="text-line-strong">|</span>
            {s.divergent > 0 ? (
              <span className="font-semibold text-bad">
                {s.divergent} divergent release{s.divergent === 1 ? "" : "s"} on record
              </span>
            ) : (
              <span>0 divergent releases</span>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function Footer() {
  const health = usePoll<Health>(fetchHealth, "health");
  const registry = REGISTRY_ADDR ?? health.data?.registry;
  return (
    <footer className="mt-16 border-t border-line bg-white">
      <div className="mx-auto grid max-w-[1320px] gap-8 px-4 py-10 sm:grid-cols-2 md:grid-cols-4 md:px-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <IconLogo size={22} />
            <span className="font-mono text-sm font-bold tracking-wider">CAIRN</span>
          </div>
          <p className="text-xs leading-relaxed text-muted">An append-only transparency log for npm package artifacts.</p>
        </div>
        <FooterCol
          title="Registry"
          links={[
            ["/packages", "Package index"],
            ["/live", "Live consensus"],
            ["/attesters", "Attester nodes"]
          ]}
        />
        <FooterCol
          title="Verify"
          links={[
            ["/check", "Lockfile audit"],
            ["/verify", "Single package"],
            ["/docs#ci", "GitHub Action"]
          ]}
        />
        <FooterCol
          title="Project"
          links={[
            ["/docs", "Getting started"],
            ["/about", "How it works"],
            [REPO_URL, "Source on GitHub"],
            [`${REPO_URL}/blob/main/docs/openapi.yaml`, "Indexer API (OpenAPI)"]
          ]}
        />
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-2 px-4 py-3 font-mono text-[11px] text-muted md:px-6">
          <span>
            {health.data ? `${chainName(health.data.chainId)} · ` : ""}AttestationRegistry{" "}
            {registry ? (
              EXPLORER_URL ? (
                <a href={`${EXPLORER_URL}/address/${registry}`} target="_blank" rel="noreferrer" className="text-primary hover:underline" title={registry}>
                  {short(registry, 6, 4)}
                </a>
              ) : (
                <span title={registry}>{short(registry, 6, 4)}</span>
              )
            ) : (
              "—"
            )}
          </span>
          <span>Read-only view of on-chain state · nothing on this site is hardcoded</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="label mb-3">{title}</p>
      <ul className="space-y-2 text-[13px]">
        {links.map(([href, label]) => (
          <li key={href}>
            {href.startsWith("http") ? (
              <a href={href} target="_blank" rel="noreferrer" className="text-ink-2 hover:text-primary">
                {label}
              </a>
            ) : (
              <Link href={href} className="text-ink-2 hover:text-primary">
                {label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
