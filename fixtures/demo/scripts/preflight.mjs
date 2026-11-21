// pnpm demo:preflight[:base-sepolia] — one green/red checklist to run in the waiting room.
// Exits 0 only when everything the live demo touches is ready.
import { formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PKG, REGISTRY, attestedOnChain, c, ensureDemoAuth, npm, registryUp } from "./lib.mjs";

const core = await import("../../../packages/core/dist/index.js");
const rpcUrl = process.env.CAIRN_RPC_URL ?? core.DEFAULT_RPC_URL;
const indexerUrl = (process.env.CAIRN_DEMO_INDEXER_URL ?? "http://127.0.0.1:4100").replace(/\/+$/, "");
const dashboardUrl = process.env.CAIRN_DEMO_DASHBOARD_URL ?? "http://localhost:3000";
const attesterPorts = (process.env.CAIRN_ATTESTER_PORTS ?? "4001,4002,4003").split(",");
const MIN_BALANCE = 10n ** 13n; // 0.00001 ETH ≈ a dozen transactions on Base Sepolia

const results = [];
function report(ok, what, detail = "", fix = "") {
  results.push(ok);
  const mark = ok === "warn" ? c.dim("•") : ok ? c.green("✓") : c.red("✗");
  console.log(`  ${mark} ${what.padEnd(34)} ${c.dim(detail)}`);
  if (!ok && fix) console.log(`      ${c.dim("fix:")} ${fix}`);
}
async function getJson(url, timeoutMs = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, body: await res.json() };
}

console.log(`\n  ${c.bold("cairn demo preflight")}   ${c.dim(rpcUrl)}\n`);

// 1. chain + contract
let client;
let head = 0n;
try {
  const chainId = await core.getChainId(rpcUrl);
  const { address } = core.resolveRegistryAddress({ chainId });
  client = await core.CairnClient.connect({ rpcUrl, registryAddress: address });
  head = await client.public.getBlockNumber();
  report(true, "chain + AttestationRegistry", `chain ${chainId} · ${address} · block ${head}`);
} catch (err) {
  report(false, "chain + AttestationRegistry", err instanceof Error ? err.message : String(err), "start the chain / deploy (pnpm chain && pnpm deploy:local), or check CAIRN_RPC_URL");
}

// 2. local registry
if (await registryUp()) {
  try {
    await ensureDemoAuth({ exitOnFailure: false });
    report(true, "demo registry (Verdaccio)", `${REGISTRY} · demo user authenticated`);
  } catch (err) {
    report(false, "demo registry auth", err instanceof Error ? err.message.slice(0, 80) : REGISTRY, "stop Verdaccio, pnpm registry:reset, pnpm registry:up");
  }
} else {
  report(false, "demo registry (Verdaccio)", `${REGISTRY} unreachable`, "pnpm registry:up");
}

// 3. attesters
for (const port of attesterPorts) {
  try {
    const { body: h } = await getJson(`http://127.0.0.1:${port}/health`, 3000);
    const registered = client ? await client.isAttester(h.address) : false;
    const lag = Math.max(0, Number(head) - h.lastProcessedBlock);
    const ok = registered && h.chainReachable && h.registryReachable && lag < 60;
    report(
      ok,
      `attester ${h.label}`,
      `${h.address.slice(0, 10)}… · ${registered ? "registered" : "NOT registered"} · ${lag} blocks behind · registry ${h.registryReachable ? "ok" : "unreachable"}`,
      "restart the attesters (pnpm attesters:demo or pnpm attesters:base-sepolia)"
    );
    if (client && (await client.public.getChainId()) !== 31337) {
      const bal = await client.public.getBalance({ address: h.address });
      report(bal >= MIN_BALANCE, `  gas for ${h.label}`, `${formatEther(bal)} ETH`, "pnpm fund:base-sepolia");
    }
  } catch {
    report(false, `attester :${port}`, "not running", "pnpm attesters:demo (local) or pnpm attesters:base-sepolia");
  }
}

// 4. publisher key + gas
const key = process.env.CAIRN_PRIVATE_KEY;
if (!key) {
  report(false, "publisher key", "CAIRN_PRIVATE_KEY not set", "export it, or use the :base-sepolia script variants");
} else if (client) {
  const addr = privateKeyToAccount(key).address;
  const bal = await client.public.getBalance({ address: addr });
  const local = (await client.public.getChainId()) === 31337;
  report(local || bal >= MIN_BALANCE, "publisher key + gas", `${addr.slice(0, 10)}… · ${formatEther(bal)} ETH`, "pnpm fund:base-sepolia");
}

// 5. indexer + dashboard
try {
  const { status, body } = await getJson(`${indexerUrl}/api/v1/health`, 90_000); // Render may need to wake
  report(status === 200 && body.ok, "indexer", `${indexerUrl} · store ${body.store} · lag ${body.lag} · block ${body.lastIndexedBlock}`, "start it (pnpm dev) / wait for Render to wake");
} catch (err) {
  report(false, "indexer", `${indexerUrl} unreachable`, "pnpm dev (local) or open the Render service");
}
try {
  const res = await fetch(dashboardUrl, { signal: AbortSignal.timeout(15_000) });
  report(res.ok, "dashboard", `${dashboardUrl} · HTTP ${res.status}`, "pnpm dev (local) or check the Vercel deployment");
} catch {
  report(false, "dashboard", `${dashboardUrl} unreachable`, "pnpm dev (local) or check the Vercel deployment");
}

// 6. which version the next demo:release will use
if (client) {
  let next;
  for (let n = 0; n < 500 && !next; n++) {
    const v = `1.0.${n}`;
    const onRegistry = (await registryUp()) && npm(["view", `${PKG}@${v}`, "version"], { allowFail: true }).stdout.trim() !== "";
    if (!onRegistry && !(await attestedOnChain(v))) next = v;
  }
  report(next !== undefined, "next demo version", next ? `${PKG}@${next}` : "none free");
}

const failed = results.filter((r) => r === false).length;
console.log(failed === 0 ? `\n  ${c.green(c.bold("READY"))} — every component the demo touches is up\n` : `\n  ${c.red(c.bold("NOT READY"))} — ${failed} check(s) failed\n`);
process.exit(failed === 0 ? 0 : 1);
