export function short(hex: string | undefined | null, head = 4, tail = 4): string {
  if (!hex) return "—";
  return hex.length <= 2 + head + tail + 1 ? hex : `${hex.slice(0, 2 + head)}…${hex.slice(-tail)}`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const same = (a?: string | null, b?: string | null): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();

const CHAINS: Record<number, string> = { 84532: "Base Sepolia", 8453: "Base", 31337: "Hardhat local", 11155111: "Sepolia" };
export const chainName = (id: number): string => CHAINS[id] ?? `chain ${id}`;
