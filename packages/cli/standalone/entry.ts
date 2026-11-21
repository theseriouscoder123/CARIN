// Entry point of the standalone `cairn` bundle (cairn-cli-<version>.tgz). It preconfigures
// the public Base Sepolia deployment so the CLI works with zero setup outside this repo;
// every value can still be overridden (--rpc-url, --contract, CAIRN_* env vars).
import deployment from "../../contracts/deployments/84532.json" with { type: "json" };
import { registerKnownDeployment } from "@cairn/core";

process.env.CAIRN_RPC_URL ??= "https://sepolia.base.org,https://base-sepolia-rpc.publicnode.com,https://base-sepolia.gateway.tenderly.co";
registerKnownDeployment(deployment);

await import("../src/index.js");
