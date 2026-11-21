// Shared helpers for the tamper demo scripts (local Verdaccio; local chain or Base Sepolia).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const DEMO = join(ROOT, "fixtures", "demo");
export const STATE = join(ROOT, ".cairn", "verdaccio");
export const REGISTRY = process.env.CAIRN_DEMO_REGISTRY ?? "http://127.0.0.1:4873";
export const PKG = "@cairn-demo/greeting";
/** Fixed path for the stage command; the version inside changes per run. */
export const TARBALL = join(DEMO, "cairn-demo-greeting.tgz");
const DEMO_STATE = join(ROOT, ".cairn", "demo-state.json");

/**
 * The chain is append-only, so every rehearsal (and the pitch) needs a version that has
 * never been attested. demo:release picks it and records it here for tamper/recheck.
 */
export function readDemoVersion() {
  if (!existsSync(DEMO_STATE)) fail("no demo release yet — run pnpm demo:release first");
  return JSON.parse(readFileSync(DEMO_STATE, "utf8")).version;
}
export function writeDemoVersion(version) {
  mkdirSync(dirname(DEMO_STATE), { recursive: true });
  writeFileSync(DEMO_STATE, JSON.stringify({ version, at: new Date().toISOString() }));
}

/** Whether name@version is already attested on the chain at CAIRN_RPC_URL. */
export async function attestedOnChain(version) {
  const core = await import("../../../packages/core/dist/index.js");
  const rpcUrl = process.env.CAIRN_RPC_URL ?? core.DEFAULT_RPC_URL;
  let client;
  try {
    const chainId = await core.getChainId(rpcUrl);
    const { address } = core.resolveRegistryAddress({ chainId });
    client = await core.CairnClient.connect({ rpcUrl, registryAddress: address });
  } catch (err) {
    fail(`cannot read the chain at ${rpcUrl} to choose a fresh demo version: ${err instanceof Error ? err.message : err}`);
  }
  return (await client.getRecord(core.packageId("npm", PKG, version))).exists;
}

/** Copy the fixture into `dir` with its version set; returns the package directory. */
export function stageFixture(dir, version) {
  rmSync(dir, { recursive: true, force: true });
  const pkgDir = join(dir, "greeting");
  cpSync(join(DEMO, "greeting"), pkgDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  manifest.version = version;
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { pkgDir, manifest };
}

const tty = process.stdout.isTTY;
export const c = {
  bold: (s) => (tty ? `\u001b[1m${s}\u001b[22m` : s),
  dim: (s) => (tty ? `\u001b[2m${s}\u001b[22m` : s),
  green: (s) => (tty ? `\u001b[32m${s}\u001b[39m` : s),
  red: (s) => (tty ? `\u001b[31m${s}\u001b[39m` : s),
  cyan: (s) => (tty ? `\u001b[36m${s}\u001b[39m` : s)
};

export function fail(msg) {
  console.error(`\n  ${c.red("✗")} ${msg}\n`);
  process.exit(1);
}

/** Run npm with the demo user's npmrc. Throws with npm's stderr on failure unless allowFail. */
export function npm(args, { cwd = ROOT, allowFail = false } = {}) {
  const res = spawnSync("npm", [...args, "--userconfig", join(STATE, "npmrc")], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (res.status !== 0 && !allowFail) fail(`npm ${args.join(" ")} failed:\n${res.stderr || res.stdout}`);
  return res;
}

export async function registryUp() {
  try {
    const res = await fetch(`${REGISTRY}/-/ping`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Register (or log in) a local demo user through Verdaccio's real npm auth endpoint and
 * write an npmrc holding its token. The password is random and lives only in .cairn/.
 */
export async function ensureDemoAuth() {
  if (!(await registryUp())) fail(`Verdaccio is not running at ${REGISTRY} — start it with: pnpm registry:up`);
  mkdirSync(STATE, { recursive: true });
  const credsFile = join(STATE, "demo-user.json");
  const creds = existsSync(credsFile)
    ? JSON.parse(readFileSync(credsFile, "utf8"))
    : { name: "cairn-demo", password: randomBytes(18).toString("base64url") };

  // Reuse a stored token if the registry still accepts it.
  if (typeof creds.token === "string") {
    const who = await fetch(`${REGISTRY}/-/whoami`, { headers: { authorization: `Bearer ${creds.token}` } });
    if (who.ok) return writeNpmrc(creds.token);
  }

  const res = await fetch(`${REGISTRY}/-/user/org.couchdb.user:${creds.name}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: creds.name, password: creds.password, type: "user", roles: [], date: new Date().toISOString() })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.token !== "string") {
    fail(`could not authenticate the demo user (${res.status}): ${JSON.stringify(body)} — stop Verdaccio, pnpm registry:reset, pnpm registry:up`);
  }
  writeFileSync(credsFile, JSON.stringify({ ...creds, token: body.token }));
  writeNpmrc(body.token);
}

function writeNpmrc(token) {
  const host = REGISTRY.replace(/^https?:/, "");
  writeFileSync(join(STATE, "npmrc"), `registry=${REGISTRY}/
${host}/:_authToken=${token}
`);
}

/** npm pack a directory into `destDir`, returning the tarball path. */
export function pack(dir, destDir) {
  mkdirSync(destDir, { recursive: true });
  const res = npm(["pack", dir, "--pack-destination", destDir, "--json"]);
  const out = JSON.parse(res.stdout);
  return join(destDir, out[0].filename);
}

export function ensureDir(p) {
  mkdirSync(dirname(p), { recursive: true });
}
