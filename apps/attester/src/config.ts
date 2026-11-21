import { ConfigError, DEFAULT_NPM_REGISTRY, DEFAULT_RPC_URL } from "@cairn/core";
import { z } from "zod";

/**
 * SPEC-ATTESTER §2. Validated at startup; anything missing or malformed exits loudly.
 * An attester that silently boots with a default key is worse than one that refuses.
 */
const EnvSchema = z.object({
  CAIRN_ATTESTER_KEY: z
    .string({ message: "CAIRN_ATTESTER_KEY is required" })
    .regex(/^(0x)?[0-9a-fA-F]{64}$/, "CAIRN_ATTESTER_KEY must be a 32-byte hex private key"),
  CAIRN_ATTESTER_LABEL: z
    .string({ message: "CAIRN_ATTESTER_LABEL is required" })
    .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "CAIRN_ATTESTER_LABEL must be a short lowercase slug"),
  CAIRN_RPC_URL: z.string().url().default(DEFAULT_RPC_URL),
  CAIRN_REGISTRY_ADDR: z.string().optional(),
  CAIRN_DEPLOYMENT_FILE: z.string().optional(),
  CAIRN_NPM_REGISTRY: z.string().url().optional(),
  CAIRN_REGISTRY_URL: z.string().url().optional(),
  CAIRN_RECHECK_INTERVAL: z.coerce.number().int().positive().default(300),
  CAIRN_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  CAIRN_START_BLOCK: z.coerce.number().int().nonnegative().optional(),
  CAIRN_STATE_DIR: z.string().default(".attester-state"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4001)
});

export interface AttesterConfig {
  key: `0x${string}`;
  label: string;
  rpcUrl: string;
  registryAddress?: string | undefined;
  deploymentFile?: string | undefined;
  npmRegistry: string;
  recheckIntervalSec: number;
  pollIntervalMs: number;
  startBlock?: number | undefined;
  stateDir: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AttesterConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`invalid attester configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const key = e.CAIRN_ATTESTER_KEY.startsWith("0x") ? e.CAIRN_ATTESTER_KEY : `0x${e.CAIRN_ATTESTER_KEY}`;
  return {
    key: key as `0x${string}`,
    label: e.CAIRN_ATTESTER_LABEL,
    rpcUrl: e.CAIRN_RPC_URL,
    registryAddress: e.CAIRN_REGISTRY_ADDR,
    deploymentFile: e.CAIRN_DEPLOYMENT_FILE,
    npmRegistry: e.CAIRN_NPM_REGISTRY ?? e.CAIRN_REGISTRY_URL ?? DEFAULT_NPM_REGISTRY,
    recheckIntervalSec: e.CAIRN_RECHECK_INTERVAL,
    pollIntervalMs: e.CAIRN_POLL_INTERVAL_MS,
    startBlock: e.CAIRN_START_BLOCK,
    stateDir: e.CAIRN_STATE_DIR,
    port: e.PORT
  };
}
