import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAIRN — transparency log",
  description: "Quorum-verified provenance for open-source dependencies"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <header className="border-b border-neutral-800">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4">
            <span className="font-mono text-lg font-semibold tracking-tight">CAIRN</span>
            <span className="text-sm text-neutral-400">transparency log</span>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
