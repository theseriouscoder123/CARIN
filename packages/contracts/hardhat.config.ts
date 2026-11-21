import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import { defineConfig } from "hardhat/config";

// Local Hardhat Network only (CLAUDE.md §4.1). A public network is a config entry
// added here later, reading its RPC URL and key from env.
export default defineConfig({
  plugins: [hardhatViem, hardhatViemAssertions, hardhatNodeTestRunner],
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  networks: {
    localhost: {
      type: "http",
      url: process.env.CAIRN_RPC_URL ?? "http://127.0.0.1:8545"
    }
  }
});
