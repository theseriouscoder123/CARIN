import { ConfigError, DEFAULT_RPC_URL } from "@cairn/core";
import { z } from "zod";

const EnvSchema = z.object({
  CAIRN_RPC_URL: z.string().url().default(DEFAULT_RPC_URL),
  CAIRN_REGISTRY_ADDR: z.string().optional(),
  CAIRN_DEPLOYMENT_FILE: z.string().optional(),
  CAIRN_START_BLOCK: z.coerce.number().int().nonnegative().optional(),
  MONGODB_URI: z.string().optional(),
  MONGODB_DB: z.string().default("cairn"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  HOST: z.string().default("127.0.0.1"),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),
  CAIRN_ATTESTER_URLS: z.string().default("http://127.0.0.1:4001,http://127.0.0.1:4002,http://127.0.0.1:4003"),
  CAIRN_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1500),
  CAIRN_LAG_THRESHOLD: z.coerce.number().int().nonnegative().default(50)
});

export interface IndexerConfig {
  rpcUrl: string;
  registryAddress?: string | undefined;
  deploymentFile?: string | undefined;
  startBlock?: number | undefined;
  mongoUri?: string | undefined;
  mongoDb: string;
  port: number;
  host: string;
  corsOrigins: string[];
  attesterUrls: string[];
  pollIntervalMs: number;
  lagThreshold: number;
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter((x) => x !== "");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): IndexerConfig {
  const r = EnvSchema.safeParse(env);
  if (!r.success) {
    throw new ConfigError(`invalid indexer configuration:\n${r.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  const e = r.data;
  return {
    rpcUrl: e.CAIRN_RPC_URL,
    registryAddress: e.CAIRN_REGISTRY_ADDR,
    deploymentFile: e.CAIRN_DEPLOYMENT_FILE,
    startBlock: e.CAIRN_START_BLOCK,
    mongoUri: e.MONGODB_URI && e.MONGODB_URI !== "" ? e.MONGODB_URI : undefined,
    mongoDb: e.MONGODB_DB,
    port: e.PORT,
    host: e.HOST,
    corsOrigins: list(e.CORS_ORIGINS),
    attesterUrls: list(e.CAIRN_ATTESTER_URLS),
    pollIntervalMs: e.CAIRN_POLL_INTERVAL_MS,
    lagThreshold: e.CAIRN_LAG_THRESHOLD
  };
}
