// pnpm demo:release — the maintainer's ordinary release: pack the clean fixture and
// publish 1.0.0 to the local registry. Attesting it is a separate, visible step
// (`pnpm cairn publish …`), because that is the part of the demo CAIRN adds.
import { createHash } from "node:crypto";
import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DEMO, PKG, REGISTRY, TARBALL, VERSION, c, ensureDemoAuth, npm, pack } from "./lib.mjs";

await ensureDemoAuth();

const packed = pack(join(DEMO, "greeting"), DEMO);
if (packed !== TARBALL) renameSync(packed, TARBALL);
const bytes = readFileSync(TARBALL);
const sha = createHash("sha256").update(bytes).digest("hex");

const existing = npm(["view", `${PKG}@${VERSION}`, "dist.tarball"], { allowFail: true });
if (existing.status === 0 && existing.stdout.trim() !== "") {
  console.log(`\n  ${PKG}@${VERSION} is already on ${REGISTRY}.`);
  console.log(`  ${c.dim("For a clean run: stop Verdaccio, pnpm registry:reset, pnpm registry:up.")}\n`);
} else {
  npm(["publish", TARBALL, "--registry", `${REGISTRY}/`]);
  console.log(`\n  ${c.green("✓")} published ${c.bold(`${PKG}@${VERSION}`)} to ${REGISTRY}`);
}

// The consumer resolves against the local registry, like any project pointed at a mirror.
npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: join(DEMO, "consumer") });

console.log(`  ${c.dim("tarball")}   ${TARBALL}`);
console.log(`  ${c.dim("sha256")}    ${sha}`);
console.log(`  ${c.green("✓")} consumer lockfile resolved against ${REGISTRY}`);
console.log(`\n  next: ${c.cyan("pnpm cairn publish fixtures/demo/cairn-demo-greeting-1.0.0.tgz")}\n`);
