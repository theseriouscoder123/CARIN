// The live demo, beat by beat — and its unattended rehearsal. Same code path for both.
//
//   pnpm demo:stage:base-sepolia        press Enter for each beat (real commands, nothing faked)
//   pnpm demo:rehearse:base-sepolia     run every beat unattended and assert each outcome
//
// Prerequisites: the registry and the three attesters are running (run demo:preflight).
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { DEMO, PKG, ROOT, TARBALL, c, npm, readDemoVersion } from "./lib.mjs";

const core = await import("../../../packages/core/dist/index.js");
const REHEARSE = process.argv.includes("--rehearse");
const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const LOCK = join(DEMO, "consumer", "package-lock.json");
const rpcUrl = process.env.CAIRN_RPC_URL ?? core.DEFAULT_RPC_URL;
const dashboard = process.env.CAIRN_DEMO_DASHBOARD_URL ?? "http://localhost:3000";
const indexerUrl = (process.env.CAIRN_DEMO_INDEXER_URL ?? "http://127.0.0.1:4100").replace(/\/+$/, "");
const started = Date.now();
const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (t0) => ((Date.now() - t0) / 1000).toFixed(1);

const rl = REHEARSE ? undefined : createInterface({ input: process.stdin, output: process.stdout });
async function beat(n, title, subtitle) {
  if (rl) await rl.question(`\n${c.dim(`  ▸ Enter for beat ${n}: ${title}`)} `);
  console.log(`\n${c.bold(`━━ ${n}. ${title.toUpperCase()} ━━`)}  ${c.dim(subtitle)}   ${c.dim(`t+${secs(started)}s`)}\n`);
}
function check(ok, what) {
  if (!REHEARSE) return;
  console.log(`  ${ok ? c.green("✓") : c.red("✗")} ${what}`);
  if (!ok) failures.push(what);
}
function run(cmd, args, { capture = false, cwd = ROOT } = {}) {
  const res = spawnSync(cmd, args, { cwd, env: process.env, encoding: "utf8", stdio: capture ? "pipe" : "inherit", shell: process.platform === "win32" && cmd !== process.execPath });
  return { code: res.status ?? 1, stdout: res.stdout ?? "" };
}
const cairn = (args, opts) => run(process.execPath, [CLI, ...args], opts);
const cairnJson = (args) => {
  const r = cairn(["--json", ...args], { capture: true });
  try {
    return { code: r.code, json: JSON.parse(r.stdout) };
  } catch {
    return { code: r.code, json: undefined };
  }
};

// ── setup: chain, attester set, a fresh demo version ─────────────────────────────────
const chainId = await core.getChainId(rpcUrl);
const { address, deployment } = core.resolveRegistryAddress({ chainId });
const client = await core.CairnClient.connect({ rpcUrl, registryAddress: address });
const labels = deployment?.attesterLabels ?? {};
const attesters = (deployment?.attesters ?? []).map((a) => ({ address: a, label: labels[a] ?? `${a.slice(0, 8)}…` }));
console.log(`\n${c.bold("CAIRN live demo")}  ${c.dim(`chain ${chainId} · registry ${address}`)}`);
console.log(c.dim("  preparing a fresh release (the chain is append-only, so every run uses a new version)…"));
const rel = run(process.execPath, [join(DEMO, "scripts", "release.mjs")], { capture: true });
if (rel.code !== 0) {
  console.error(rel.stdout);
  process.exit(2);
}
const version = readDemoVersion();
const spec = `${PKG}@${version}`;
const packageId = core.packageId("npm", PKG, version);
console.log(`  ${c.green("✓")} ready: ${c.bold(spec)}  ${c.dim(packageId)}`);
console.log(`
  ${c.bold("Open on the projector now:")} ${c.cyan(`${dashboard}/live?spec=${encodeURIComponent(spec)}`)}`);
console.log(c.dim("  (it reads the chain directly and will show every state of this release as it happens)"));

// ── 1. attest ─────────────────────────────────────────────────────────────────────────
await beat(1, "Attest", "the maintainer signs a digest of the release and anchors it on-chain");
if (REHEARSE) {
  const pub = cairnJson(["publish", TARBALL]);
  check(pub.code === 0 && pub.json?.status === "submitted", `cairn publish submitted ${spec}`);
} else {
  cairn(["publish", TARBALL]);
}

// ── 2. corroborate: watch each attester's co-signature land on-chain ─────────────────
await beat(2, "Corroborate", "independent attesters re-fetch the artifact and recompute the digest");
const t2 = Date.now();
const seen = new Set();
while (seen.size < attesters.length && Date.now() - t2 < 120_000) {
  for (const a of attesters) {
    if (seen.has(a.address)) continue;
    if (await client.hasCorroborated(packageId, a.address)) {
      seen.add(a.address);
      console.log(`  ${c.green("✓")} ${c.bold(a.label)} corroborated on-chain  ${c.dim(`${secs(t2)}s · ${a.address}`)}`);
    }
  }
  if (seen.size < attesters.length) await sleep(1500);
}
const rec2 = await client.getRecord(packageId);
console.log(`\n  quorum ${rec2.hasQuorum ? c.green("REACHED") : c.red("not reached")} · ${rec2.corroborations}/${rec2.attesterCount} corroborations (threshold ${rec2.threshold})`);
check(rec2.corroborations === attesters.length && rec2.hasQuorum, `${attesters.length}/${attesters.length} corroborations, quorum reached`);

// ── 3. the gate passes ────────────────────────────────────────────────────────────────
await beat(3, "Gate passes", "a CI job verifies every dependency against on-chain quorum");
const v3 = cairn(["verify", "--lockfile", LOCK]);
console.log(c.dim(`  exit code ${v3.code}`));
check(v3.code === 0, "cairn verify PASSED (exit 0)");

// ── 4. tamper ─────────────────────────────────────────────────────────────────────────
await beat(4, "Tamper", "same version string, different bytes — an account takeover");
run(process.execPath, [join(DEMO, "scripts", "tamper.mjs")]);

// ── 5. detect ─────────────────────────────────────────────────────────────────────────
await beat(5, "Detect", "attesters re-check the published artifact and record what they saw");
run(process.execPath, [join(DEMO, "scripts", "recheck.mjs")]);
const t5 = Date.now();
let rec5 = await client.getRecord(packageId);
while (rec5.divergences.length < attesters.length && Date.now() - t5 < 60_000) {
  await sleep(1500);
  rec5 = await client.getRecord(packageId);
}
console.log(`  on-chain: ${c.red(`${rec5.divergences.length} divergence report(s)`)} · quorum ${rec5.hasQuorum ? "still reached" : c.red("REVOKED")}`);
check(rec5.divergences.length === attesters.length && !rec5.hasQuorum, `${attesters.length} divergences on-chain, quorum revoked`);

// ── 6. block ──────────────────────────────────────────────────────────────────────────
await beat(6, "Block", "a fresh install resolves the tampered bytes — npm is satisfied, CAIRN is not");
rmSync(LOCK, { force: true });
npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: join(DEMO, "consumer") });
console.log(c.dim("  (fresh lockfile resolved — npm recorded the tampered integrity without complaint)\n"));
const v6 = cairn(["verify", "--lockfile", LOCK]);
console.log(c.dim(`  exit code ${v6.code}`));
check(v6.code === 1, "cairn verify BLOCKED (exit 1)");
if (REHEARSE) {
  const j = cairnJson(["verify", "--lockfile", LOCK]).json;
  const g = j?.results?.find((r) => r.name === PKG);
  check(g?.verdict === "DIVERGENT", `${spec} is DIVERGENT`);
  check(g?.delta?.some((d) => d.path === "scripts/postinstall.js" && d.change === "added") === true, "delta names scripts/postinstall.js (added)");
}

// ── 7. proof ──────────────────────────────────────────────────────────────────────────
await beat(7, "Proof", "everything above is public and independently checkable");
console.log(`  live view   ${c.cyan(`${dashboard}/live?spec=${encodeURIComponent(spec)}`)}`);
console.log(`  package     ${c.cyan(`${dashboard}/packages/${packageId}`)}`);
if (chainId === 84532) console.log(`  on-chain    ${c.cyan(`https://sepolia.basescan.org/address/${address}`)}`);
console.log(`  CI gate     ${c.cyan("uses: theseriouscoder123/CARIN@v1")}`);
if (REHEARSE) {
  const t7 = Date.now();
  let status;
  while (Date.now() - t7 < 90_000) {
    try {
      status = (await (await fetch(`${indexerUrl}/api/v1/packages/${packageId}`, { signal: AbortSignal.timeout(30_000) })).json()).status;
    } catch {
      status = undefined;
    }
    if (status === "DIVERGENT") break;
    await sleep(3000);
  }
  check(status === "DIVERGENT", `indexer (${indexerUrl}) shows ${spec} as DIVERGENT`);
  try {
    check((await fetch(`${dashboard}/live`, { signal: AbortSignal.timeout(20_000) })).ok, `dashboard ${dashboard}/live is up`);
  } catch {
    check(false, `dashboard ${dashboard}/live is up`);
  }
}

rl?.close();
console.log(`\n${c.dim(`  total ${secs(started)}s`)}`);
if (REHEARSE) {
  console.log(failures.length === 0 ? `\n  ${c.green(c.bold("REHEARSAL GREEN"))} — the stage run will work\n` : `\n  ${c.red(c.bold("REHEARSAL FAILED"))} — ${failures.length} check(s): ${failures.join("; ")}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
