// Run a command against Base Sepolia with the locally generated keys loaded.
//   node fixtures/demo/scripts/testnet-env.mjs <command> [args...]
// Sets CAIRN_RPC_URL (CAIRN_BASE_SEPOLIA_RPC_URL or the public endpoint) and maps
// CAIRN_PUBLISHER_KEY to CAIRN_PRIVATE_KEY. Keys never appear on the command line.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const keysFile = join(ROOT, ".cairn", "keys", "base-sepolia.env");
if (!existsSync(keysFile)) {
  console.error(`missing ${keysFile} — generate the testnet keys first (see docs/DEMO-RUNBOOK.md)`);
  process.exit(2);
}
process.loadEnvFile(keysFile);

const env = {
  ...process.env,
  CAIRN_RPC_URL: process.env.CAIRN_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
  CAIRN_PRIVATE_KEY: process.env.CAIRN_PRIVATE_KEY ?? process.env.CAIRN_PUBLISHER_KEY
};
const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: testnet-env.mjs <command> [args...]");
  process.exit(2);
}
const child = spawn(cmd, args, { cwd: process.cwd(), env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
