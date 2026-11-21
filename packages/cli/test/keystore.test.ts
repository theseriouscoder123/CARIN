import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, describe, expect, it } from "vitest";
import { KeystoreError, createKeystore, decryptKeystore, encryptKey, readKeystore } from "../src/keystore.js";

// Hardhat dev account #1 — a published test key.
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ADDRESS = privateKeyToAccount(KEY).address;
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "cairn-ks-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("keystore", () => {
  it("round-trips: decrypting with the right passphrase yields the same account", () => {
    const store = encryptKey(KEY, "correct horse battery");
    expect(store.address).toBe(ADDRESS);
    expect(decryptKeystore(store, "correct horse battery").address).toBe(ADDRESS);
  });

  it("never stores the key in plaintext", () => {
    const json = JSON.stringify(encryptKey(KEY, "correct horse battery"));
    expect(json.toLowerCase()).not.toContain(KEY.slice(2).toLowerCase());
  });

  it("rejects a wrong passphrase without revealing anything", () => {
    const store = encryptKey(KEY, "correct horse battery");
    expect(() => decryptKeystore(store, "wrong passphrase!")).toThrow(KeystoreError);
  });

  it("rejects a modified ciphertext (GCM authentication)", () => {
    const store = encryptKey(KEY, "correct horse battery");
    const flipped = store.cipher.ciphertext.replace(/^./, (c) => (c === "0" ? "1" : "0"));
    expect(() => decryptKeystore({ ...store, cipher: { ...store.cipher, ciphertext: flipped } }, "correct horse battery")).toThrow(KeystoreError);
  });

  it("refuses short passphrases", () => {
    expect(() => encryptKey(KEY, "short")).toThrow(/at least 8/);
  });

  it("createKeystore writes a readable file and refuses to overwrite it", () => {
    const path = join(tmp(), "nested", "keystore.json");
    const { address } = createKeystore(path, "correct horse battery");
    const back = readKeystore(path);
    expect(back.address).toBe(address);
    expect(decryptKeystore(back, "correct horse battery").address).toBe(address);
    expect(() => createKeystore(path, "correct horse battery")).toThrow(/refusing to overwrite/);
  });

  it("rejects files that are not keystores", () => {
    const path = join(tmp(), "nope.json");
    writeFileSync(path, JSON.stringify({ hello: "world" }));
    expect(() => readKeystore(path)).toThrow(KeystoreError);
    expect(readFileSync(path, "utf8")).toContain("hello");
  });
});
