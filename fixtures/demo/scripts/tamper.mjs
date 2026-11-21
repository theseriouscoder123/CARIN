// pnpm demo:tamper — simulate an account takeover on a registry that allows it:
// unpublish the current demo version and republish the SAME version string with an
// added install hook. The payload is an inert, clearly-labelled stand-in.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PKG, REGISTRY, ROOT, buildTampered, c, ensureDemoAuth, npm, readDemoVersion } from "./lib.mjs";

await ensureDemoAuth();
const VERSION = readDemoVersion();
const work = join(ROOT, ".cairn", "demo-tamper");
const tarball = buildTampered(work, VERSION);
const sha = createHash("sha256").update(readFileSync(tarball)).digest("hex");

npm(["unpublish", `${PKG}@${VERSION}`, "--force", "--registry", `${REGISTRY}/`], { allowFail: true });
npm(["publish", tarball, "--registry", `${REGISTRY}/`]);

console.log("");
console.log(`  ${c.red("⚠")} republished ${c.bold(`${PKG}@${VERSION}`)} — ${c.bold("same version string")}, different bytes`);
console.log(`  ${c.dim("added")}     scripts/postinstall.js  ${c.dim("(simulated payload, inert)")}`);
console.log(`  ${c.dim("changed")}   package.json  ${c.dim('("postinstall" hook)')}`);
console.log(`  ${c.dim("sha256")}    ${sha}`);
console.log("");
console.log(`  next: ${c.cyan("pnpm demo:recheck")}  ${c.dim("(attesters re-fetch now instead of waiting for the timer)")}`);
console.log("");
