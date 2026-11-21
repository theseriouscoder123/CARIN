import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NPM_REGISTRY, DEFAULT_RPC_URL } from "@cairn/core";

/** Global options shared by every command (SPEC-CLI §1). */
export interface GlobalOptions {
  rpcUrl: string;
  registryUrl: string;
  contract?: string | undefined;
  deployment?: string | undefined;
  json: boolean;
  color: boolean;
  verbose: number;
}

export function defaultRpcUrl(): string {
  return process.env.CAIRN_RPC_URL ?? DEFAULT_RPC_URL;
}

export function defaultRegistryUrl(): string {
  return process.env.CAIRN_REGISTRY_URL ?? DEFAULT_NPM_REGISTRY;
}

/** `${XDG_CACHE_HOME:-~/.cache}/cairn` */
export function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(base, "cairn");
}

/** Where `--payload-store local` writes; shared by CLI, attester and indexer on a host. */
export function payloadDir(): string {
  return process.env.CAIRN_PAYLOAD_DIR ?? join(cacheDir(), "payloads");
}
