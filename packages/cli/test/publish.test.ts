import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConfigError, ManifestError, type PayloadStore, type RegistryAdapter } from "@cairn/core";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { parseSpec, runPublish } from "../src/commands/publish.js";
import { loadAccount } from "../src/keys.js";
import { renderPublish } from "../src/render/publish.js";
import { createStyle, short } from "../src/render/style.js";

const TGZ = readFileSync(
  fileURLToPath(new URL("../../core/test/fixtures/cairn-demo-greeting-1.0.0.tgz", import.meta.url))
);
// Hardhat dev account #1 — a published test key, never used outside local chains.
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(KEY);

const fakeAdapter = (bytes: Uint8Array): RegistryAdapter => ({
  ecosystem: "npm",
  resolve: async (name, version) => ({ ecosystem: "npm", name, version, tarballUrl: `http://reg.test/${name}-${version}.tgz` }),
  fetch: async () => bytes
});
const nullStore: PayloadStore = {
  put: async () => {
    throw new Error("dry run must not store payloads");
  },
  get: async () => undefined
};
const deps = { adapter: fakeAdapter(TGZ), payloadStore: nullStore, readFile: async () => TGZ };
const base = { dryRun: true, rpcUrl: "http://127.0.0.1:1" };

describe("parseSpec", () => {
  it("splits scoped and unscoped specs", () => {
    expect(parseSpec("@cairn-demo/greeting@1.0.0")).toEqual({ name: "@cairn-demo/greeting", version: "1.0.0" });
    expect(parseSpec("left-pad@1.3.0")).toEqual({ name: "left-pad", version: "1.3.0" });
  });
  it("rejects a spec without a version", () => {
    expect(() => parseSpec("@scope/pkg")).toThrow(ConfigError);
  });
});

describe("runPublish --dry-run", () => {
  it("derives identity from the artifact and touches neither chain nor store", async () => {
    const r = await runPublish({ ...base, tarball: "x.tgz", account }, deps);
    expect(r).toMatchObject({
      status: "dry-run",
      name: "@cairn-demo/greeting",
      version: "1.0.0",
      files: 4,
      artifactDigest: "0x8741ca22230122751e707a0080a2f14199d7a7eb52592902d2bf35b51f6fe119",
      publisher: account.address
    });
  });

  it("works without a key", async () => {
    const r = await runPublish({ ...base, tarball: "x.tgz" }, deps);
    expect(r.publisher).toBeNull();
  });

  it("--package fetches via the adapter and checks the manifest matches", async () => {
    const r = await runPublish({ ...base, package: "@cairn-demo/greeting@1.0.0" }, deps);
    expect(r.source).toContain("reg.test");
    await expect(runPublish({ ...base, package: "@cairn-demo/greeting@2.0.0" }, deps)).rejects.toThrow(ManifestError);
  });

  it("needs exactly one source", async () => {
    await expect(runPublish({ ...base }, deps)).rejects.toThrow(ConfigError);
    await expect(runPublish({ ...base, tarball: "x", package: "a@1.0.0" }, deps)).rejects.toThrow(ConfigError);
  });

  it("a real publish without a key is a config error, before any network access", async () => {
    await expect(runPublish({ ...base, dryRun: false, tarball: "x.tgz" }, deps)).rejects.toThrow(/signing key/);
  });
});

describe("rendering", () => {
  it("prints the digests and never the private key", async () => {
    const r = await runPublish({ ...base, tarball: "x.tgz", account }, deps);
    const text = renderPublish(r, createStyle(false)) + JSON.stringify(r);
    expect(text).toContain("@cairn-demo/greeting@1.0.0");
    expect(text).toContain(short(r.artifactDigest));
    expect(text.toLowerCase()).not.toContain(KEY.slice(2).toLowerCase());
  });

  it("emits no ANSI escapes when colour is off", async () => {
    const r = await runPublish({ ...base, tarball: "x.tgz" }, deps);
    expect(renderPublish(r, createStyle(false)).includes("\u001b[")).toBe(false);
  });
});

describe("loadAccount", () => {
  it("prefers the flag, falls back to env, accepts keys without 0x", () => {
    expect(loadAccount(undefined, { CAIRN_PRIVATE_KEY: KEY.slice(2) })?.address).toBe(account.address);
    expect(loadAccount(undefined, {})).toBeUndefined();
  });

  it("rejects malformed keys without echoing them", () => {
    const bad = "0xnotakey-secret-material";
    try {
      loadAccount(bad, {});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).not.toContain("secret-material");
    }
  });
});
