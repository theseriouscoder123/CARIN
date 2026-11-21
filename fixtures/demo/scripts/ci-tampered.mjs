// Used by .github/workflows/demo-tampered-dependency.yml. Inside a CI runner, on a fresh
// local registry, publish the TAMPERED build of a demo version whose clean build is
// already attested and corroborated on Base Sepolia, then resolve the consumer project
// against it — exactly what a fresh install would see after an account takeover.
//   DEMO_VERSION (default 1.0.1)
import { join } from "node:path";
import { PKG, REGISTRY, ROOT, buildTampered, c, ensureDemoAuth, npm, resolveConsumer } from "./lib.mjs";

const version = process.env.DEMO_VERSION ?? "1.0.1";
await ensureDemoAuth();
const tarball = buildTampered(join(ROOT, ".cairn", "ci-tampered"), version);
npm(["publish", tarball, "--registry", `${REGISTRY}/`]);
resolveConsumer(version);
console.log(`${c.red("⚠")} registry now serves a tampered ${PKG}@${version}; consumer lockfile resolved against it`);
