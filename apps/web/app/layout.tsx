import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { HealthBanner, SourceLine } from "@/components/health-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAIRN — transparency log",
  description: "Quorum-verified provenance for open-source dependencies"
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/live", label: "Live" },
  { href: "/packages", label: "Packages" },
  { href: "/attesters", label: "Attesters" },
  { href: "/verify", label: "Verify" },
  { href: "/check", label: "Check a lockfile" },
  { href: "/about", label: "How it works" }
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <HealthBanner />
        <header className="border-b border-neutral-800">
          <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4">
            <Link href="/" className="font-mono text-2xl font-bold tracking-tight">
              CAIRN
            </Link>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-lg text-neutral-300 hover:text-white">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-7xl space-y-1 px-6 pb-10">
          <SourceLine />
          <p className="text-xs text-neutral-600">Read-only view of an append-only on-chain log. Nothing on this page is hardcoded.</p>
        </footer>
      </body>
    </html>
  );
}
