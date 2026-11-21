// Runner for the CAIRN GitHub Action: runs `cairn verify --json`, prints the human report
// to the log, writes a Markdown verdict table to the job summary, and exits with verify's
// own exit code (0 pass · 1 gate fired · 2 could not verify).
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const env = process.env;
const actionPath = env.ACTION_PATH;
const cli = join(actionPath, "packages", "cli", "dist", "index.js");

const shared = ["--rpc-url", env.RPC_URL];
if (env.CONTRACT) shared.push("--contract", env.CONTRACT);
else {
  // The deployment files shipped with this action; the CLI checks the chain id matches.
  const chainId = JSON.parse(
    (await fetch(env.RPC_URL.split(",")[0].trim(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] })
    }).then((r) => r.text()).catch(() => '{"result":"0x0"}')) || '{"result":"0x0"}'
  ).result;
  const file = join(actionPath, "packages", "contracts", "deployments", `${parseInt(chainId, 16)}.json`);
  if (existsSync(file)) shared.push("--deployment", file);
}
const verifyArgs = ["verify", "--lockfile", env.LOCKFILE, "--fail-on", env.FAIL_ON];
if (env.POLICY) verifyArgs.push("--policy", env.POLICY);

// Human-readable report into the log (colour on; GitHub renders ANSI).
spawnSync(process.execPath, [cli, ...shared, ...verifyArgs], { stdio: "inherit", env: { ...env, FORCE_COLOR: "1" } });
// Machine-readable pass for the summary and the authoritative exit code.
const res = spawnSync(process.execPath, [cli, ...shared, "--json", ...verifyArgs], { encoding: "utf8", env });
const code = res.status ?? 2;

let report;
try {
  report = JSON.parse(res.stdout);
} catch {
  report = undefined;
}

const short = (h) => (typeof h === "string" && h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : (h ?? "—"));
const lines = [];
if (!report || report.error) {
  lines.push("## ❌ CAIRN could not verify this build", "", `\`${report?.error?.message ?? (res.stderr || "unknown error").trim()}\``, "", "The gate fails closed: an unverifiable build never passes.");
} else {
  const s = report.summary;
  const verdict = code === 0 ? "✅ PASSED" : code === 1 ? "❌ BLOCKED" : "⚠️ COULD NOT VERIFY (failing closed)";
  lines.push(`## CAIRN verify — ${verdict}`, "");
  lines.push(`\`${report.lockfile}\` · ${report.checked} dependencies · fail on: ${report.policy.failOn.join(", ")}`, "");
  lines.push("| Verdict | Count |", "|---|---|");
  for (const [k, v] of Object.entries(s)) lines.push(`| ${k === "PASS" ? "✅" : k === "UNATTESTED" || k === "UNDER_QUORUM" ? "⚠️" : "❌"} ${k} | ${v} |`);
  const failing = report.results.filter((r) => r.failing);
  if (failing.length > 0) {
    lines.push("", "### Blocked dependencies", "", "| Package | Verdict | Attested | Observed here | Corroborations |", "|---|---|---|---|---|");
    for (const r of failing) {
      const pkg = r.packageId ? `[${r.name}@${r.version}](${env.DASHBOARD_URL}/packages/${r.packageId})` : `${r.name}@${r.version}`;
      lines.push(`| ${pkg} | **${r.verdict}** | \`${short(r.attestedDigest)}\` | \`${short(r.observedDigest)}\` | ${r.corroborations ?? "—"}/${r.attesterCount ?? "—"} |`);
    }
    for (const r of failing.filter((x) => x.delta?.length)) {
      lines.push("", `**${r.name}@${r.version} — what changed:**`, "");
      for (const d of r.delta) lines.push(`- \`${d.path}\` — ${d.change}`);
    }
    if (failing.some((r) => r.verdict === "DIVERGENT")) {
      lines.push("", "> The same version string now resolves to different bytes than were attested — the mechanical signature of republication or account takeover. CAIRN does not judge whether the code is malicious; it proves it is not what was published.");
    }
  }
  lines.push("", `Quorum read directly from the AttestationRegistry · [transparency dashboard](${env.DASHBOARD_URL})`);
}

if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
else console.log(lines.join("\n"));
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `exit-code=${code}\n`);
process.exit(code);
