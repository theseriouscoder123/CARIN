import type { DependencyResult, VerifyReport } from "../commands/verify.js";
import type { Verdict } from "../policy.js";
import { short, type Style } from "./style.js";

const RULE_WIDTH = 66;

function label(r: DependencyResult): string {
  return `${r.name}@${r.version}`;
}

function headline(r: DependencyResult, s: Style, icon: string, color: (x: string) => string): string {
  const left = `  ${color(icon)}  ${label(r)}`;
  const visible = 5 + label(r).length;
  const pad = Math.max(2, RULE_WIDTH - visible - r.verdict.length);
  return `${left}${" ".repeat(pad)}${color(s.bold(r.verdict))}`;
}

const STORY: Partial<Record<Verdict, string>> = {
  DIVERGENT: "This version was republished after attestation.",
  CONTESTED: "Independent attesters observed different bytes for this version.",
  UNDER_QUORUM: "Not enough independent attesters have confirmed this artifact yet.",
  UNATTESTED: "No attestation exists on-chain for this version.",
  UNKNOWN: "Could not be checked — treated as a failure (the gate fails closed)."
};

function detail(r: DependencyResult, s: Style): string[] {
  const lines: string[] = [];
  const pad = "     ";
  if (r.attestedDigest) {
    const quorum =
      r.threshold !== undefined ? `${r.corroborations ?? 0}/${r.attesterCount ?? "?"} attesters · quorum ${r.threshold}` : "";
    lines.push(`${pad}${s.dim("attested")}   ${short(r.attestedDigest)}   by ${short(r.publisher ?? "")}  ·  ${quorum}`);
  }
  if (r.observedDigest && r.verdict === "DIVERGENT") lines.push(`${pad}${s.dim("observed")}   ${s.red(short(r.observedDigest))}`);
  if (r.delta && r.delta.length > 0) {
    r.delta.forEach((d, i) => {
      const tag = i === 0 ? s.dim("delta   ") : "        ";
      const color = d.change === "added" ? s.red : d.change === "removed" ? s.yellow : (x: string) => x;
      lines.push(`${pad}${tag}   ${color(d.path)}  ${s.dim(`(${d.change})`)}`);
    });
  }
  for (const d of r.divergences) lines.push(`${pad}${s.dim("divergence")} attester ${short(d.attester)} observed ${short(d.observedDigest)}`);
  if (r.reason) lines.push(`${pad}${s.dim("reason")}     ${r.reason}`);
  const story = STORY[r.verdict];
  if (story) lines.push("", `${pad}${story}`);
  return lines;
}

/** Pure: report → terminal text (SPEC-CLI §3.4). */
export function renderVerify(report: VerifyReport, s: Style): string {
  const out: string[] = ["", `  ${s.bold("cairn verify")}   ·   ${report.checked} dependencies   ·   npm`, ""];
  const n = (v: Verdict) => report.summary[v] ?? 0;
  const count = (x: number) => String(x).padStart(4);

  if (n("PASS")) out.push(`  ${s.green("✓")}${count(n("PASS"))}  verified`);
  if (n("UNDER_QUORUM")) out.push(`  ${s.yellow("⚠")}${count(n("UNDER_QUORUM"))}  under quorum`);
  if (n("UNATTESTED")) out.push(`  ${s.yellow("⚠")}${count(n("UNATTESTED"))}  unattested`);
  if (n("CONTESTED")) out.push(`  ${s.red("✗")}${count(n("CONTESTED"))}  ${s.bold("CONTESTED")}`);
  if (n("DIVERGENT")) out.push(`  ${s.red("✗")}${count(n("DIVERGENT"))}  ${s.bold("DIVERGENT")}`);
  if (n("UNKNOWN")) out.push(`  ${s.red("✗")}${count(n("UNKNOWN"))}  unknown`);

  const rule = `  ${s.dim("─".repeat(RULE_WIDTH - 1))}`;
  const failing = report.results.filter((r) => r.failing);
  const others = report.results.filter((r) => !r.failing && r.verdict !== "PASS");

  // When the chain itself is unreachable every row says the same thing: say it once.
  const allUnknown = failing.length > 1 && failing.every((r) => r.verdict === "UNKNOWN" && r.reason === failing[0]?.reason);
  if (allUnknown) {
    out.push("", rule, `  ${s.red("✗")}  ${s.bold(`${failing.length} dependencies UNKNOWN`)}`, "", `     ${s.dim("reason")}     ${failing[0]?.reason ?? ""}`, "", `     ${STORY.UNKNOWN}`, rule);
  } else {
    for (const r of failing) {
      out.push("", rule, headline(r, s, "✗", s.red), "", ...detail(r, s), rule);
    }
  }
  if (others.length > 0) out.push("");
  for (const r of others) {
    const suffix = r.allowed ? s.dim(`  allowed until ${r.allowed.expires}: ${r.allowed.reason}`) : "";
    out.push(`${headline(r, s, "⚠", s.yellow)}${suffix}`);
    if (r.reason) out.push(`     ${s.dim(r.reason)}`);
  }
  for (const note of report.notes) out.push(`  ${s.yellow("note")} ${note}`);

  out.push("");
  if (report.exitCode === 1) {
    const worst = failing.filter((r) => r.verdict === "DIVERGENT").length;
    const why = worst > 0 ? `${worst} divergent dependenc${worst === 1 ? "y" : "ies"}` : `${failing.length} dependenc${failing.length === 1 ? "y" : "ies"} failed policy`;
    out.push(`  ${s.red(s.bold("BLOCKED"))} — ${why}`);
  } else if (report.exitCode === 2) {
    out.push(`  ${s.red(s.bold("ERROR"))} — ${failing.length} dependenc${failing.length === 1 ? "y" : "ies"} could not be verified; failing closed`);
  } else {
    out.push(`  ${s.green(s.bold("PASSED"))} — no dependency at or above the fail threshold`);
  }
  out.push("");
  return out.join("\n");
}
