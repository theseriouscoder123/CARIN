// Distribute testnet ETH from the deployer to the publisher and the three attesters, so
// only one address ever needs a faucet claim.
//   pnpm fund:base-sepolia
// Tops each account up to CAIRN_FUND_TARGET_ETH (default 0.0002, ~250 corroborations at Base Sepolia prices), never draining the
// deployer below twice that. Prints balances first so you can see the faucet landed.
import { network } from "hardhat";
import { formatEther, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const { viem } = await network.getOrCreate();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
if (!deployer) throw new Error("no deployer key: generate .cairn/keys/base-sepolia.env");
const chainId = await publicClient.getChainId();
if (chainId === 31337) throw new Error("fund.ts is for public testnets; local accounts are pre-funded");

const roles = ["PUBLISHER", "ATTESTER_A", "ATTESTER_B", "ATTESTER_C"] as const;
const targets = roles.map((r) => {
  const key = process.env[`CAIRN_${r}_KEY`];
  if (!key) throw new Error(`CAIRN_${r}_KEY missing from .cairn/keys/base-sepolia.env`);
  return { role: r, address: privateKeyToAccount(key as `0x${string}`).address as Address };
});
const target = parseEther(process.env.CAIRN_FUND_TARGET_ETH ?? "0.0002");

const bal = (a: Address) => publicClient.getBalance({ address: a });
console.log(`chain ${chainId}`);
console.log(`  DEPLOYER    ${deployer.account.address}  ${formatEther(await bal(deployer.account.address))} ETH`);
for (const t of targets) console.log(`  ${t.role.padEnd(11)} ${t.address}  ${formatEther(await bal(t.address))} ETH`);

for (const t of targets) {
  const have = await bal(t.address);
  if (have >= target) continue;
  const need = target - have;
  const deployerBalance = await bal(deployer.account.address);
  if (deployerBalance - need < target * 2n) {
    console.log(`  ✗ not enough on the deployer to top up ${t.role}; claim more from the faucet and re-run`);
    process.exitCode = 1;
    break;
  }
  const hash = await deployer.sendTransaction({ to: t.address, value: need });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ✓ sent ${formatEther(need)} ETH to ${t.role}  tx ${hash}`);
}
