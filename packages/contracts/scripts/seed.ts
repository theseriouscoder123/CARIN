// Repopulate attestation state after a Hardhat restart (CLAUDE.md §7).
//   pnpm seed:local        (after pnpm chain + pnpm deploy:local)
//
// Publishes real artifacts fetched from the registry (CAIRN_REGISTRY_URL, default
// npmjs), through the exact runPublish path `cairn publish` uses. It deliberately does
// NOT corroborate: quorum comes only from the independent attester processes, which
// backfill these attestations when they start. Faking three attesters from one script
// is precisely what the competition rules prohibit.
import { defaultPublishDeps, runPublish } from "@cairn/cli/publish";
import { defaultRegistryUrl, defaultRpcUrl, payloadDir } from "@cairn/cli/config";
import { getChainId } from "@cairn/core";
import { privateKeyToAccount } from "viem/accounts";

const LOCAL_CHAIN_ID = 31337;
// Hardhat dev account #1: a published test key, only ever used against a local chain.
const LOCAL_PUBLISHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const SEED_PACKAGES = (process.env.CAIRN_SEED_PACKAGES ?? "left-pad@1.3.0,is-number@7.0.0,ms@2.1.3,escape-html@1.0.3")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s !== "");

const rpcUrl = defaultRpcUrl();
const chainId = await getChainId(rpcUrl);
const envKey = process.env.CAIRN_PRIVATE_KEY;
if ((envKey === undefined || envKey === "") && chainId !== LOCAL_CHAIN_ID) {
  throw new Error("CAIRN_PRIVATE_KEY is required to seed a non-local chain");
}
const account = privateKeyToAccount((envKey && envKey !== "" ? envKey : LOCAL_PUBLISHER_KEY) as `0x${string}`);
const deps = defaultPublishDeps(defaultRegistryUrl(), payloadDir());

console.log(`seeding chain ${chainId} as publisher ${account.address}`);
let failures = 0;
for (const spec of SEED_PACKAGES) {
  try {
    const r = await runPublish({ package: spec, account, dryRun: false, rpcUrl }, deps);
    const where = r.txHash ? `tx ${r.txHash.slice(0, 10)}… block ${r.blockNumber}` : "already on-chain";
    console.log(`  ✓ ${spec.padEnd(24)} ${r.status.padEnd(17)} ${r.artifactDigest.slice(0, 12)}…  ${where}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${spec.padEnd(24)} ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(failures === 0 ? "done — start the attesters to bring these to quorum" : `${failures} failed`);
if (failures > 0) process.exitCode = 1;
