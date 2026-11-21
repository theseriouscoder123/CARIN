import { packageId, type OnChainRecord } from "@cairn/core";
import type { Address, Hex } from "viem";
import { short, type Style } from "../render/style.js";
import { parseSpec } from "./publish.js";

export interface StatusReport {
  schema: "cairn.status.v1";
  name: string;
  version: string;
  packageId: Hex;
  exists: boolean;
  artifactDigest?: Hex;
  tarballHash?: Hex;
  payloadDigest?: Hex;
  publisher?: Address;
  submittedAt?: string;
  corroborations?: number;
  threshold: number;
  attesterCount: number;
  hasQuorum: boolean;
  divergences: { attester: Address; observedDigest: Hex; reportedAt: string }[];
  blockNumber: string;
}

/** `cairn status <name@version>` (SPEC-CLI §4) — straight from contract state. */
export async function runStatus(spec: string, chain: { getRecord(id: Hex): Promise<OnChainRecord> }): Promise<StatusReport> {
  const { name, version } = parseSpec(spec);
  const id = packageId("npm", name, version);
  const r = await chain.getRecord(id);
  const common = {
    schema: "cairn.status.v1" as const,
    name,
    version,
    packageId: id,
    exists: r.exists,
    threshold: r.threshold,
    attesterCount: r.attesterCount,
    hasQuorum: r.hasQuorum,
    divergences: r.divergences.map((d) => ({ ...d, reportedAt: new Date(Number(d.reportedAt) * 1000).toISOString() })),
    blockNumber: r.blockNumber.toString()
  };
  if (!r.exists) return common;
  return {
    ...common,
    artifactDigest: r.artifactDigest,
    tarballHash: r.tarballHash,
    payloadDigest: r.payloadDigest,
    publisher: r.publisher,
    submittedAt: new Date(Number(r.submittedAt) * 1000).toISOString(),
    corroborations: r.corroborations
  };
}

export function renderStatus(r: StatusReport, s: Style): string {
  const row = (k: string, v: string) => `  ${s.dim(k.padEnd(15))}${v}`;
  const out = ["", `  ${s.bold("cairn status")}   ${r.name}@${r.version}`, ""];
  if (!r.exists) {
    out.push(row("packageId", short(r.packageId)), row("record", s.yellow("none — UNATTESTED")), "");
    return out.join("\n");
  }
  const quorum = r.hasQuorum ? s.green("reached") : r.divergences.length > 0 ? s.red("blocked by divergence") : s.yellow("not reached");
  out.push(
    row("packageId", short(r.packageId)),
    row("artifactDigest", s.cyan(r.artifactDigest ?? "")),
    row("tarballHash", short(r.tarballHash ?? "")),
    row("payloadDigest", short(r.payloadDigest ?? "")),
    row("publisher", r.publisher ?? ""),
    row("submitted", r.submittedAt ?? ""),
    row("corroborations", `${r.corroborations}/${r.attesterCount} attesters (threshold ${r.threshold})`),
    row("quorum", quorum)
  );
  for (const d of r.divergences) {
    out.push(row("divergence", `${s.red(short(d.observedDigest))} by ${short(d.attester)} at ${d.reportedAt}`));
  }
  out.push(row("read at block", r.blockNumber), "");
  return out.join("\n");
}
