import type { NextConfig } from "next";

const origin = (url: string | undefined, fallback: string) => {
  try {
    return new URL(url ?? fallback).origin;
  } catch {
    return new URL(fallback).origin;
  }
};

// The browser may talk to exactly two backends: the indexer (lists, history) and the chain
// RPC (independent verification). The CSP names them and nothing else.
const indexer = origin(process.env.NEXT_PUBLIC_INDEXER_URL, "http://127.0.0.1:4100");
// NEXT_PUBLIC_RPC_URL may be a comma-separated failover list: allow each endpoint.
const rpc = (process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545")
  .split(",")
  .map((u) => u.trim())
  .filter((u) => u !== "")
  .map((u) => origin(u, "http://127.0.0.1:8545"))
  .join(" ");
const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js inlines its bootstrap scripts; dev mode also needs eval for fast refresh.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${indexer} ${rpc}${dev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }
        ]
      }
    ];
  }
};

export default nextConfig;
