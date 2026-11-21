// pnpm demo:release — the maintainer's ordinary release. Picks the first version 1.0.N
// that is neither attested on-chain nor present on the local registry (the chain is
// append-only, so each rehearsal needs a fresh one), builds it, publishes it to the local
// registry, and resolves the consumer project against it. Attesting is the separate,
// visible step: `cairn publish fixtures/demo/cairn-demo-greeting.tgz`.
//
// Chain: CAIRN_RPC_URL (local Hardhat by default; demo:release:base-sepolia sets it).
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO, PKG, REGISTRY, ROOT, TARBALL, attestedOnChain, c, ensureDemoAuth, fail, npm, pack, stageFixture, writeDemoVersion } from "./lib.mjs";

await ensureDemoAuth();

let version;
for (let n = 0; n < 500; n++) {
  const candidate = `1.0.${n}`;
  const onRegistry = npm(["view", `${PKG}@${candidate}`, "version"], { allowFail: true }).stdout.trim() !== "";
  if (onRegistry) continue;
  if (await attestedOnChain(candidate)) continue;
  version = candidate;
  break;
}
if (!version) fail("no free demo version found below 1.0.500");

const { pkgDir } = stageFixture(join(ROOT, ".cairn", "demo-build"), version);
const built = pack(pkgDir, join(ROOT, ".cairn", "demo-build"));
copyFileSync(built, TARBALL);
npm(["publish", TARBALL, "--registry", `${REGISTRY}/`]);
writeDemoVersion(version);

// The consumer is an ordinary project pointed at the local registry, like any mirror.
const template = readFileSync(join(DEMO, "consumer", "package.template.json"), "utf8");
writeFileSync(join(DEMO, "consumer", "package.json"), template.replace("{{DEMO_VERSION}}", version));
npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: join(DEMO, "consumer") });

const sha = createHash("sha256").update(readFileSync(TARBALL)).digest("hex");
console.log(`\n  ${c.green("✓")} published ${c.bold(`${PKG}@${version}`)} to ${REGISTRY}`);
console.log(`  ${c.dim("tarball")}   fixtures/demo/cairn-demo-greeting.tgz`);
console.log(`  ${c.dim("sha256")}    ${sha}`);
console.log(`  ${c.green("✓")} consumer lockfile resolved against ${REGISTRY}`);
console.log(`\n  next: ${c.cyan("cairn publish fixtures/demo/cairn-demo-greeting.tgz")}\n`);
