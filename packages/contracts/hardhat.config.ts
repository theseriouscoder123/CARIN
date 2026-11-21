import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import { defineConfig } from "hardhat/config";

// Testnet keys live in a gitignored file generated locally (never committed). Loading it
// only fills env vars that are not already set; local networks never use these keys.
const keysFile = fileURLToPath(new URL("../../.cairn/keys/base-sepolia.env", import.meta.url));
if (existsSync(keysFile)) process.loadEnvFile(keysFile);
const deployerKey = process.env.CAIRN_DEPLOYER_KEY;

// Chain-agnostic (CLAUDE.md §4.1): addresses and chain ids come from the deployment file
// and env; adding a network here is the only change a new chain needs.
export default defineConfig({
  plugins: [hardhatViem, hardhatViemAssertions, hardhatNodeTestRunner],
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true }
  },
  networks: {
    localhost: {
      type: "http",
      url: process.env.CAIRN_RPC_URL ?? "http://127.0.0.1:8545"
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      chainId: 84532,
      url: process.env.CAIRN_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      accounts: deployerKey ? [deployerKey] : []
    }
  }
});
