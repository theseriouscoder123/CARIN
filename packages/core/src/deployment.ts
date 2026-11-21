import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { ConfigError } from "./errors.js";

const address = z
  .string()
  .refine((s) => isAddress(s), "not an address")
  .transform((s) => getAddress(s));

/** Shape of `packages/contracts/deployments/<chainId>.json`, written by deploy.ts. */
export const DeploymentSchema = z.object({
  chainId: z.number().int().positive(),
  registry: address,
  quorumPolicy: address,
  deployedAtBlock: z.number().int().nonnegative(),
  deployer: address,
  attesters: z.array(address),
  threshold: z.number().int().positive(),
  abiHash: z.string(),
  deployedAt: z.string()
});
export type Deployment = z.infer<typeof DeploymentSchema>;

export const DEFAULT_RPC_URL = "http://127.0.0.1:8545";

export function readDeploymentFile(path: string): Deployment {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new ConfigError(`cannot read deployment file ${path}`, { cause });
  }
  const parsed = DeploymentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`invalid deployment file ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Locate `packages/contracts/deployments/<chainId>.json` by walking up from `start`.
 * Lets `cairn` run from anywhere inside the repo (e.g. the demo consumer project).
 */
export function findDeploymentFile(chainId: number, start: string = process.cwd()): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, "packages", "contracts", "deployments", `${chainId}.json`);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Resolve the registry address: explicit value → `CAIRN_REGISTRY_ADDR` → deployment file
 * (`CAIRN_DEPLOYMENT_FILE`, else discovered by walking up). Never hardcoded.
 */
export function resolveRegistryAddress(opts: {
  chainId: number;
  explicit?: string | undefined;
  deploymentFile?: string | undefined;
  env?: NodeJS.ProcessEnv;
}): { address: Address; deployment?: Deployment } {
  const env = opts.env ?? process.env;
  const direct = opts.explicit ?? env.CAIRN_REGISTRY_ADDR;
  if (direct !== undefined && direct !== "") {
    if (!isAddress(direct)) throw new ConfigError(`invalid registry address ${direct}`);
    return { address: getAddress(direct) };
  }
  const file = opts.deploymentFile ?? env.CAIRN_DEPLOYMENT_FILE ?? findDeploymentFile(opts.chainId);
  if (file === undefined) {
    throw new ConfigError(
      `no registry address for chain ${opts.chainId}: pass --contract, set CAIRN_REGISTRY_ADDR, ` +
        `or run the deploy script to create packages/contracts/deployments/${opts.chainId}.json`
    );
  }
  const deployment = readDeploymentFile(file);
  if (deployment.chainId !== opts.chainId) {
    throw new ConfigError(
      `deployment file ${file} is for chain ${deployment.chainId}, but the RPC is chain ${opts.chainId}`
    );
  }
  return { address: deployment.registry, deployment };
}
