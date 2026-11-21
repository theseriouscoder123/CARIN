// pnpm test:integration — the full demo path, automated (TESTING.md §5).
//
//   cold chain + Verdaccio → deploy → seed → 3 attesters → release → cairn publish
//   → quorum → verify PASS → tamper (same version) → recheck → divergence on-chain
//   → verify BLOCK (existing lockfile: CONTESTED) → fresh resolve → verify BLOCK (DIVERGENT)
//
// Needs network access to registry.npmjs.org (seed + Verdaccio uplink). Excluded from
// `pnpm test`. Requires ports 8545, 4873 and 4001-4003 to be free. Wipes the local demo
// registry under .cairn/verdaccio; isolates attester state, payloads and caches under
// .cairn/it-* so a developer's own state is untouched.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const CONSUMER_LOCK = join(ROOT, "fixtures", "demo", "consumer", "package-lock.json");
// Hardhat dev account #1 — public test key, local chain only.
const PUBLISHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const IT = join(ROOT, ".cairn");
const env = {
  ...process.env,
  CAIRN_STATE_DIR: join(IT, "it-attester-state"),
  CAIRN_PAYLOAD_DIR: join(IT, "it-payloads"),
  XDG_CACHE_HOME: join(IT, "it-cache"),
  CAIRN_RECHECK_INTERVAL: "3600",
  NO_COLOR: "1"
};
const started = Date.now();
const children = [];
const t = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s`;
const step = (msg) => console.log(`${t()}  ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class AssertionFailed extends Error {}
function assert(cond, msg) {
  if (!cond) throw new AssertionFailed(msg);
  console.log(`          ✓ ${msg}`);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

async function waitFor(what, fn, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // keep waiting
    }
    if (Date.now() > end) throw new AssertionFailed(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

/** Run to completion; returns { status, stdout, stderr }. */
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, env: { ...env, ...opts.env }, encoding: "utf8", shell: process.platform === "win32" && cmd !== process.execPath });
  if (opts.expectOk !== false && res.status !== 0) {
    throw new AssertionFailed(`${cmd} ${args.join(" ")} exited ${res.status}\n${res.stderr || res.stdout}`);
  }
  return res;
}

function cairn(args, extraEnv = {}) {
  const res = run(process.execPath, [CLI, "--json", ...args], { expectOk: false, env: extraEnv });
  let json;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    throw new AssertionFailed(`cairn ${args.join(" ")} did not print JSON:\n${res.stdout}\n${res.stderr}`);
  }
  return { code: res.status, json };
}

function background(name, cmd, args) {
  const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" && cmd !== process.execPath });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  children.push({ name, child, log: () => log });
  return child;
}

function killTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function health(port) {
  return (await fetch(`http://127.0.0.1:${port}/health`)).json();
}

async function main() {
  if (!existsSync(CLI)) throw new AssertionFailed("build first: pnpm build");
  for (const port of [8545, 4873, 4001, 4002, 4003]) {
    if (await portOpen(port)) throw new AssertionFailed(`port ${port} is in use — stop the dev stack before running the integration test`);
  }
  for (const d of ["verdaccio", "it-attester-state", "it-payloads", "it-cache"]) rmSync(join(IT, d), { recursive: true, force: true });
  rmSync(CONSUMER_LOCK, { force: true });

  step("cold start: Hardhat node + Verdaccio");
  background("chain", "pnpm", ["--filter", "@cairn/contracts", "node"]);
  background("registry", "pnpm", ["registry:up"]);
  await waitFor("chain :8545", () => portOpen(8545));
  await waitFor("Verdaccio :4873", async () => (await fetch("http://127.0.0.1:4873/-/ping")).ok);

  step("deploy + seed real npm artifacts");
  run("pnpm", ["deploy:local"]);
  run("pnpm", ["seed:local"]);

  step("three attester processes against the local registry");
  background("attesters", process.execPath, [join(ROOT, "apps", "attester", "scripts", "up.mjs"), "--registry", "http://127.0.0.1:4873"]);
  const ports = [4001, 4002, 4003];
  await waitFor("attesters to corroborate the seed", async () => {
    const hs = await Promise.all(ports.map(health));
    return hs.every((h) => h.processedCount >= 4);
  });
  const launcherLog = children.find((c) => c.name === "attesters")?.log() ?? "";
  const pids = new Set([...launcherLog.matchAll(/pid (\d+)/g)].map((m) => m[1]));
  const addresses = (await Promise.all(ports.map(health))).map((h) => h.address);
  assert(new Set(addresses).size === 3, "three attesters with three distinct keys");
  assert(pids.size === 3, `three separate OS processes (pids ${[...pids].join(", ")})`);

  step("ACT 1 — release @cairn-demo/greeting@1.0.0 and attest it");
  run(process.execPath, [join(ROOT, "fixtures", "demo", "scripts", "release.mjs")]);
  const pub = cairn(["publish", join(ROOT, "fixtures", "demo", "cairn-demo-greeting-1.0.0.tgz")], { CAIRN_PRIVATE_KEY: PUBLISHER_KEY });
  assert(pub.code === 0 && pub.json.status === "submitted", "cairn publish submitted the attestation");
  const attestedDigest = pub.json.artifactDigest;
  const status = await waitFor("quorum on the demo package", async () => {
    const s = cairn(["status", "@cairn-demo/greeting@1.0.0"]).json;
    return s.corroborations === 3 ? s : undefined;
  });
  assert(status.hasQuorum === true, "3/3 independent corroborations, quorum reached on-chain");

  step("ACT 2 — the gate passes");
  let v = cairn(["verify", "--lockfile", CONSUMER_LOCK]);
  assert(v.code === 0, "cairn verify exits 0");
  assert(v.json.summary.PASS === 3, "all 3 dependencies PASS");

  step("ACT 3 — tamper: republish the same version with an install hook");
  run(process.execPath, [join(ROOT, "fixtures", "demo", "scripts", "tamper.mjs")]);

  step("ACT 4 — attesters re-check and record divergence on-chain");
  const id = pub.json.packageId;
  const rechecks = await Promise.all(
    ports.map(async (p) =>
      (await fetch(`http://127.0.0.1:${p}/admin/recheck`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ packageId: id }) })).json()
    )
  );
  assert(rechecks.every((r) => r.results[0].action === "diverged"), "every attester reported a divergence");
  const observed = new Set(rechecks.map((r) => r.results[0].observed));
  assert(observed.size === 1 && !observed.has(attestedDigest), "all three observed the same, different digest");
  const after = cairn(["status", "@cairn-demo/greeting@1.0.0"]).json;
  assert(after.divergences.length === 3 && after.hasQuorum === false, "3 divergences on-chain; quorum revoked");

  step("ACT 5a — existing lockfile: blocked");
  v = cairn(["verify", "--lockfile", CONSUMER_LOCK]);
  const g = (r) => r.json.results.find((x) => x.name === "@cairn-demo/greeting");
  assert(v.code === 1, "cairn verify exits 1");
  assert(["CONTESTED", "DIVERGENT"].includes(g(v).verdict), `greeting is ${g(v).verdict}`);

  step("ACT 5b — a fresh resolve records the tampered integrity; npm is satisfied, CAIRN is not");
  rmSync(CONSUMER_LOCK, { force: true });
  run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: join(ROOT, "fixtures", "demo", "consumer") });
  v = cairn(["verify", "--lockfile", CONSUMER_LOCK]);
  assert(v.code === 1, "cairn verify exits 1");
  assert(g(v).verdict === "DIVERGENT", "greeting is DIVERGENT");
  assert(g(v).observedDigest === [...observed][0], "the gate's local digest equals what the attesters observed");
  assert(g(v).delta?.some((d) => d.path === "scripts/postinstall.js" && d.change === "added"), "delta names scripts/postinstall.js (added)");
  assert(v.json.summary.PASS === 2, "the untouched dependencies still PASS");
}

let failed = false;
try {
  await main();
  console.log(`\n${t()}  DEMO PATH GREEN\n`);
} catch (err) {
  failed = true;
  console.error(`\n${t()}  DEMO PATH FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  for (const c of children) console.error(`----- ${c.name} (last 1500 chars)\n${c.log().slice(-1500)}`);
} finally {
  for (const c of children) killTree(c.child);
  rmSync(join(IT, "verdaccio", "demo-user.json"), { force: true });
}
process.exit(failed ? 1 : 0);
