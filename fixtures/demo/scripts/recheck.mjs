// pnpm demo:recheck — trigger every local attester's Divergence Monitor for the demo
// package now (POST /admin/recheck), rather than waiting for the interval on stage.
import { packageId } from "../../../packages/core/dist/index.js";
import { PKG, c, readDemoVersion } from "./lib.mjs";

const VERSION = readDemoVersion();

const id = packageId("npm", PKG, VERSION);
// The attested digest, read from any attester's view, distinguishes "still fine" from
// "divergence already reported" when a re-check finds nothing new to submit.
const attested = await fetch(`http://127.0.0.1:${(process.env.CAIRN_ATTESTER_PORTS ?? "4001").split(",")[0]}/packages`)
  .then((r) => r.json())
  .then((pk) => pk[id]?.attestedDigest)
  .catch(() => undefined);
const ports = (process.env.CAIRN_ATTESTER_PORTS ?? "4001,4002,4003").split(",");

console.log(`\n  re-checking ${c.bold(`${PKG}@${VERSION}`)}  ${c.dim(id)}\n`);
let reached = 0;
await Promise.all(
  ports.map(async (port) => {
    try {
      const [res, health] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/admin/recheck`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ packageId: id })
        }).then((r) => r.json()),
        fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json())
      ]);
      reached++;
      const r = res.results?.[0] ?? { action: res.error ?? "unknown" };
      const tag =
        r.action === "diverged" ? c.red("✗ DIVERGENCE reported on-chain") :
        r.action === "corroborated" ? c.green("✓ corroborated") :
        r.action === "unchanged"
          ? r.observed && r.observed !== attested ? c.dim("divergence already on record") : c.green("✓ still matches the attestation")
          : r.action;
      const tx = r.tx ? c.dim(`  tx ${r.tx.slice(0, 12)}…`) : "";
      console.log(`  ${health.label.padEnd(11)} ${tag}${tx}`);
    } catch (err) {
      console.log(`  :${port}  ${c.red("unreachable")} ${c.dim(err instanceof Error ? err.message : String(err))}`);
    }
  })
);
console.log(reached === 0 ? `\n  no attesters reachable — start them with: pnpm attesters:demo\n` : "");
