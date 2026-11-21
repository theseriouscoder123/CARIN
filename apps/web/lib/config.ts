// Every endpoint comes from env (CLAUDE.md §4.1). Local defaults match the dev stack.
export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:4100").replace(/\/+$/, "");
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
const RPC_LIST = RPC_URL.split(",").map((u) => u.trim()).filter((u) => u !== "");
/** For display: the primary endpoint, plus how many failovers stand behind it. */
export const RPC_LABEL = `${RPC_LIST[0] ?? RPC_URL}${RPC_LIST.length > 1 ? ` (+${RPC_LIST.length - 1} fallback${RPC_LIST.length > 2 ? "s" : ""})` : ""}`;
/** Optional: when unset, the dashboard uses the address the indexer reports, and says so. */
export const REGISTRY_ADDR = process.env.NEXT_PUBLIC_REGISTRY_ADDR as `0x${string}` | undefined;
export const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL?.replace(/\/+$/, "");
export const POLL_MS = 5000;
