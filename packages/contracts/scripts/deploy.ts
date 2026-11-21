// Deploy QuorumPolicy + AttestationRegistry and write deployments/<chainId>.json.
//   pnpm --filter @cairn/contracts deploy:local
// Env: CAIRN_ATTESTERS (comma-separated addresses; default Hardhat accounts #2-#4 on a
// local chain), CAIRN_THRESHOLD (default 2). Nothing about the chain is hardcoded here:
// moving to a testnet is a hardhat.config network entry plus these env vars.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";
import { getAddress, keccak256, stringToBytes, type Address } from "viem";

const LOCAL_CHAIN_ID = 31337;

const { viem } = await network.getOrCreate();
const publicClient = await viem.getPublicClient();
const [deployer, ...others] = await viem.getWalletClients();
if (!deployer) throw new Error("no deployer account available");
const chainId = await publicClient.getChainId();

function attesterSet(): Address[] {
  const fromEnv = process.env.CAIRN_ATTESTERS;
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv.split(",").map((a) => getAddress(a.trim()));
  if (chainId !== LOCAL_CHAIN_ID) throw new Error("CAIRN_ATTESTERS is required on non-local chains");
  // local dev convention: #0 deployer/admin, #1 publisher, #2-#4 attesters a/b/c
  const local = others.slice(1, 4).map((w) => w.account.address);
  if (local.length !== 3) throw new Error("expected Hardhat accounts #2-#4 for local attesters");
  return local;
}

const attesters = attesterSet();
const threshold = Number(process.env.CAIRN_THRESHOLD ?? "2");

const policy = await viem.deployContract("QuorumPolicy", [deployer.account.address, attesters, threshold]);
const registry = await viem.deployContract("AttestationRegistry", [policy.address]);
const block = await publicClient.getBlockNumber();

const deployment = {
  chainId,
  registry: registry.address,
  quorumPolicy: policy.address,
  deployedAtBlock: Number(block),
  deployer: deployer.account.address,
  attesters,
  threshold,
  abiHash: keccak256(stringToBytes(JSON.stringify(registry.abi))),
  deployedAt: new Date().toISOString()
};

const dir = fileURLToPath(new URL("../deployments/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}${chainId}.json`, JSON.stringify(deployment, null, 2) + "\n");

console.log(`AttestationRegistry  ${registry.address}`);
console.log(`QuorumPolicy         ${policy.address}  (${threshold}-of-${attesters.length})`);
console.log(`attesters            ${attesters.join(", ")}`);
console.log(`wrote deployments/${chainId}.json`);
