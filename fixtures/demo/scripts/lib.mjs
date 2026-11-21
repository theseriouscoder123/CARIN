// Shared helpers for the tamper demo scripts. Local Verdaccio only.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const DEMO = join(ROOT, "fixtures", "demo");
export const STATE = join(ROOT, ".cairn", "verdaccio");
export const REGISTRY = process.env.CAIRN_DEMO_REGISTRY ?? "http://127.0.0.1:4873";
export const PKG = "@cairn-demo/greeting";
export const VERSION = "1.0.0";
export const TARBALL = join(DEMO, "cairn-demo-greeting-1.0.0.tgz");

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
