// pnpm demo:tamper — simulate an account takeover on a registry that allows it:
// unpublish @cairn-demo/greeting@1.0.0 and republish the SAME version string with an
// added install hook. The payload is an inert, clearly-labelled stand-in.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DEMO, PKG, REGISTRY, ROOT, VERSION, c, ensureDemoAuth, npm, pack } from "./lib.mjs";

await ensureDemoAuth();

const work = join(ROOT, ".cairn", "demo-tamper");
rmSync(work, { recursive: true, force: true });
const pkgDir = join(work, "greeting");
cpSync(join(DEMO, "greeting"), pkgDir, { recursive: true });

mkdirSync(join(pkgDir, "scripts"), { recursive: true });
writeFileSync(
  join(pkgDir, "scripts", "postinstall.js"),
  `// SIMULATED PAYLOAD — demo fixture, performs no action.\n` +
    `// Stands in for the credential-exfiltrating install hook real takeovers add.\n` +
    `console.log("[cairn demo] simulated postinstall payload ran");\n`
);
const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
manifest.scripts = { postinstall: "node scripts/postinstall.js" };
writeFileSync(join(pkgDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
if (manifest.version !== VERSION) throw new Error("tampered fixture must keep the same version");

const tarball = pack(pkgDir, work);
const sha = createHash("sha256").update(readFileSync(tarball)).digest("hex");

npm(["unpublish", `${PKG}@${VERSION}`, "--force", "--registry", `${REGISTRY}/`], { allowFail: true });
npm(["publish", tarball, "--registry", `${REGISTRY}/`]);

console.log(`\n  ${c.red("⚠")} republished ${c.bold(`${PKG}@${VERSION}`)} — ${c.bold("same version string")}, different bytes`);
console.log(`  ${c.dim("added")}     scripts/postinstall.js  ${c.dim("(simulated payload, inert)")}`);
console.log(`  ${c.dim("changed")}   package.json  ${c.dim('("postinstall" hook)')}`);
console.log(`  ${c.dim("sha256")}    ${sha}`);
console.log(`\n  next: ${c.cyan("pnpm demo:recheck")}  ${c.dim("(attesters re-fetch now instead of waiting for the timer)")}\n`);
