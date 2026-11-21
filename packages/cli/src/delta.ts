import type { CanonicalEntry } from "@cairn/core";

export type DeltaKind = "added" | "removed" | "content changed" | "mode changed" | "kind changed";
export interface DeltaEntry {
  path: string;
  change: DeltaKind;
}

/**
 * Diff the attested file list (from the stored payload) against the tree this machine
 * observed. Turns "hashes differ" into "scripts/postinstall.js was added".
 */
export function diffTrees(attested: readonly CanonicalEntry[], observed: readonly CanonicalEntry[]): DeltaEntry[] {
  const before = new Map(attested.map((e) => [e.path, e]));
  const after = new Map(observed.map((e) => [e.path, e]));
  const out: DeltaEntry[] = [];
  for (const [path, a] of before) {
    const b = after.get(path);
    if (b === undefined) out.push({ path, change: "removed" });
    else if (a.kind !== b.kind) out.push({ path, change: "kind changed" });
    else if (a.contentHash !== b.contentHash) out.push({ path, change: "content changed" });
    else if (a.modeClass !== b.modeClass) out.push({ path, change: "mode changed" });
  }
  for (const path of after.keys()) if (!before.has(path)) out.push({ path, change: "added" });
  return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}
