import { fallback, http, type Transport } from "viem";

/**
 * RPC configuration accepts one URL or a comma-separated failover list, e.g.
 *   CAIRN_RPC_URL=https://sepolia.base.org,https://base-sepolia-rpc.publicnode.com
 * Requests go to the first endpoint and fail over in order when one errors or rate-limits,
 * so a single public RPC outage cannot take the gate (or the demo) down.
 */
export function parseRpcUrls(rpcUrl: string): string[] {
  const urls = rpcUrl
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u !== "");
  if (urls.length === 0) throw new RangeError("no RPC URL configured");
  return urls;
}

/** A viem transport over the configured endpoint(s). */
export function rpcTransport(rpcUrl: string, opts: { timeout?: number; retryCount?: number } = {}): Transport {
  const urls = parseRpcUrls(rpcUrl);
  const one = (u: string) => http(u, { timeout: opts.timeout ?? 20_000, retryCount: opts.retryCount ?? 1 });
  return urls.length === 1 ? one(urls[0] as string) : fallback(urls.map(one), { rank: false, retryCount: 1 });
}

/** The first endpoint, for display (never contains secrets in our configs; strip query anyway). */
export function primaryRpc(rpcUrl: string): string {
  const first = parseRpcUrls(rpcUrl)[0] as string;
  try {
    const u = new URL(first);
    return `${u.origin}${u.pathname}`;
  } catch {
    return first;
  }
}
