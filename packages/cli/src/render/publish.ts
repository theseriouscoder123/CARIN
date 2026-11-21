import type { PublishResult } from "../commands/publish.js";
import { short, type Style } from "./style.js";

const row = (s: Style, label: string, value: string) => `  ${s.dim(label.padEnd(15))}${value}`;

/** Pure: result object → terminal text (SPEC-CLI §2 "Output"). */
export function renderPublish(r: PublishResult, s: Style): string {
  const lines = [
    "",
    `  ${s.bold("cairn publish")}${r.status === "dry-run" ? s.dim("   (dry run — nothing submitted)") : ""}`,
    "",
    row(s, "package", s.bold(`${r.name}@${r.version}`)),
    row(s, "packageId", short(r.packageId)),
    row(s, "files", String(r.files)),
    row(s, "artifactDigest", s.cyan(short(r.artifactDigest))),
    row(s, "tarballHash", short(r.tarballHash)),
    row(s, "payloadDigest", short(r.payloadDigest)),
    row(s, "publisher", r.publisher ? short(r.publisher) : s.dim("(no key — dry run)"))
  ];
  for (const w of r.warnings) lines.push(`  ${s.yellow("⚠")} ${w}`);
  lines.push("");
  if (r.status === "submitted") {
    lines.push(`  ${s.green("✓ submitted")}   tx ${short(r.txHash ?? "")}   block ${r.blockNumber}`);
  } else if (r.status === "already-attested") {
    lines.push(`  ${s.green("✓ already attested")} with this exact artifactDigest — nothing to do`);
  } else {
    lines.push(`  ${s.dim("full artifactDigest")} ${r.artifactDigest}`);
  }
  lines.push("");
  return lines.join("\n");
}
