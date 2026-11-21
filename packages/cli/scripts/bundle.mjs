// Build the standalone CLI: one self-contained ESM file (core, viem, zod, commander
// inlined) plus a minimal package.json, packed into cairn-cli-<version>.tgz.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const cli = JSON.parse(readFileSync(here("../package.json"), "utf8"));
const out = here("../standalone/dist/");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [here("../standalone/entry.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: `${out}cairn.mjs`,
  legalComments: "none",
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __cairnRequire } from "node:module";\nconst require = __cairnRequire(import.meta.url);'
  },
  logLevel: "warning"
});

writeFileSync(
  `${out}package.json`,
  `${JSON.stringify(
    {
      name: "cairn-cli",
      version: cli.version,
      description: "CAIRN: verify npm dependencies against an on-chain, quorum-attested transparency log",
      type: "module",
      bin: { cairn: "cairn.mjs" },
      files: ["cairn.mjs", "README.md"],
      engines: { node: ">=22" },
      license: "MIT",
      repository: "github:theseriouscoder123/CARIN"
    },
    null,
    2
  )}\n`
);
copyFileSync(here("../standalone/README.md"), `${out}README.md`);

const packed = execFileSync("npm", ["pack", "--json", "--pack-destination", here("../standalone/")], {
  cwd: out,
  encoding: "utf8",
  shell: process.platform === "win32"
});
const [info] = JSON.parse(packed);
console.log(`built standalone/${info.filename} (${(info.size / 1024).toFixed(0)} KiB, ${info.entryCount} files)`);
