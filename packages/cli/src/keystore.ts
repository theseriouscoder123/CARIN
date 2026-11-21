import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CairnError, ConfigError } from "@cairn/core";
import type { LocalAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

/**
 * Encrypted publisher keystore: scrypt-derived key, AES-256-GCM. The raw private key only
 * ever exists in memory; on disk it is ciphertext, and GCM's tag rejects any tampering.
 */
const KeystoreSchema = z.object({
  version: z.literal(1),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  kdf: z.object({
    name: z.literal("scrypt"),
    salt: z.string(),
    N: z.number().int(),
    r: z.number().int(),
    p: z.number().int()
  }),
  cipher: z.object({
    name: z.literal("aes-256-gcm"),
    iv: z.string(),
    tag: z.string(),
    ciphertext: z.string()
  })
});
export type Keystore = z.infer<typeof KeystoreSchema>;

export class KeystoreError extends CairnError {
  constructor(message: string) {
    super("KEYSTORE", message);
  }
}

const SCRYPT = { N: 2 ** 15, r: 8, p: 1 };
const MIN_PASSWORD = 8;

function deriveKey(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Buffer {
  return scryptSync(password.normalize("NFKC"), salt, 32, { ...params, maxmem: 256 * params.N * params.r });
}

export function defaultKeystorePath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "cairn", "keystore.json");
}

export function encryptKey(privateKey: `0x${string}`, password: string): Keystore {
  if (password.length < MIN_PASSWORD) throw new KeystoreError(`passphrase must be at least ${MIN_PASSWORD} characters`);
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt, SCRYPT);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(privateKey.slice(2), "hex")), cipher.final()]);
  return {
    version: 1,
    address: privateKeyToAccount(privateKey).address,
    kdf: { name: "scrypt", salt: salt.toString("hex"), ...SCRYPT },
    cipher: { name: "aes-256-gcm", iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("hex") }
  };
}

export function decryptKeystore(store: Keystore, password: string): LocalAccount {
  const key = deriveKey(password, Buffer.from(store.kdf.salt, "hex"), store.kdf);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(store.cipher.iv, "hex"));
  decipher.setAuthTag(Buffer.from(store.cipher.tag, "hex"));
  let raw: Buffer;
  try {
    raw = Buffer.concat([decipher.update(Buffer.from(store.cipher.ciphertext, "hex")), decipher.final()]);
  } catch {
    throw new KeystoreError("wrong passphrase, or the keystore file has been modified");
  }
  const account = privateKeyToAccount(`0x${raw.toString("hex")}`);
  if (account.address.toLowerCase() !== store.address.toLowerCase()) {
    throw new KeystoreError("keystore address does not match its decrypted key");
  }
  return account;
}

export function readKeystore(path: string): Keystore {
  if (!existsSync(path)) throw new ConfigError(`keystore not found: ${path} (create one with: cairn keygen)`);
  const parsed = KeystoreSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new KeystoreError(`${path} is not a CAIRN keystore`);
  return parsed.data;
}

/** Write a new keystore; refuses to overwrite an existing file. Returns the address. */
export function createKeystore(path: string, password: string): { address: string } {
  if (existsSync(path)) throw new KeystoreError(`${path} already exists — refusing to overwrite a key`);
  const store = encryptKey(generatePrivateKey(), password);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort on filesystems without POSIX modes
  }
  return { address: store.address };
}

/** Read a passphrase: CAIRN_KEYSTORE_PASSWORD, else a hidden prompt on a TTY. */
export async function readPassphrase(prompt: string): Promise<string> {
  const fromEnv = process.env.CAIRN_KEYSTORE_PASSWORD;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  if (!process.stdin.isTTY) throw new ConfigError("no passphrase: set CAIRN_KEYSTORE_PASSWORD for non-interactive use");
  process.stderr.write(prompt);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") {
          stdin.setRawMode(false);
          reject(new ConfigError("cancelled"));
          return;
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}
