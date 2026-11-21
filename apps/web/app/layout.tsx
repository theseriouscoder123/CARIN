import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Footer, Header, StatusStrip } from "@/components/shell";
import "./globals.css";

// next/font downloads at build time and serves from this origin — the CSP allows font-src 'self' only.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "CAIRN — transparency log for npm artifacts", template: "%s · CAIRN" },
  description: "Quorum-verified provenance for open-source dependencies"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        <Header />
        <StatusStrip />
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-8 md:px-6">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
