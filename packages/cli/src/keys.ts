import { ConfigError } from "@cairn/core";
import type { LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HEX_KEY = /^(0x)?[0-9a-fA-F]{64}$/;

/**
 * Load a signing key from `--key` or `CAIRN_PRIVATE_KEY`. The key string itself is never
 * returned, logged or embedded in an error message — only the derived account.
 */
export function loadAccount(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): LocalAccount | undefined {
  const raw = flag ?? env.CAIRN_PRIVATE_KEY;
  if (raw === undefined || raw === "") return undefined;
  const trimmed = raw.trim();
  if (!HEX_KEY.test(trimmed)) throw new ConfigError("signing key is not a 32-byte hex string");
  const key = (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
  return privateKeyToAccount(key);
}
