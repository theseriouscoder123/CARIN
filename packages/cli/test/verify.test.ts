import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConfigError,
  digestArtifact,
  packageId,
  preparePublication,
  type AttestationPayload,
  type OnChainRecord,
  type PayloadStore
} from "@cairn/core";
import type { Address, Hex } from "viem";
import { afterAll, describe, expect, it } from "vitest";
import { writeTar } from "../../core/test/helpers/tar.js";
import { checkIntegrity, type ArtifactSource } from "../src/artifacts.js";
import { runVerify, type RecordReader } from "../src/commands/verify.js";
import { LockfileError, parseLockfile } from "../src/lockfile.js";
import { failOnFromLevel, loadPolicy, type Policy } from "../src/policy.js";
import { renderVerify } from "../src/render/verify.js";
import { createStyle } from "../src/render/style.js";

const CLEAN = readFileSync(fileURLToPath(new URL("../../core/test/fixtures/cairn-demo-greeting-1.0.0.tgz", import.meta.url)));
const TAMPERED = writeTar([
  { path: "package/README.md", data: "# @cairn-demo/greeting\n\nTest fixture for the CAIRN determinism harness. Not a real package.\n" },
  { path: "package/index.js", data: "evil();\n" },
  { path: "package/package.json", data: "{}" },
  { path: "package/scripts/postinstall.js", data: "// simulated\n" }
]);
const PUBLISHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const ATTESTER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const sri = (b: Uint8Array) => `sha512-${createHash("sha512").update(b).digest("base64")}`;

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// ---------------------------------------------------------------- lockfile

function lock(packages: Record<string, unknown>, lockfileVersion = 3) {
  return JSON.stringify({ name: "app", lockfileVersion, packages: { "": { name: "app" }, ...packages } });
}
const reg = (name: string, v: string) => `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${v}.tgz`;

describe("parseLockfile", () => {
  it("reads v3 (and v2) packages maps, deduping name@version across paths", () => {
    const text = lock({
      "node_modules/a": { version: "1.0.0", resolved: reg("a", "1.0.0"), integrity: "sha512-x" },
      "node_modules/b/node_modules/a": { version: "1.0.0", resolved: reg("a", "1.0.0") },
      "node_modules/@s/b": { version: "2.0.0", resolved: reg("@s/b", "2.0.0") }
    });
    for (const v of [2, 3]) {
      const deps = parseLockfile(lock(JSON.parse(text).packages, v));
      expect(deps.map((d) => `${d.name}@${d.version}`)).toEqual(["@s/b@2.0.0", "a@1.0.0"]);
    }
    expect(parseLockfile(text).find((d) => d.name === "a")?.paths).toHaveLength(2);
  });

  it("rejects v1 with a clear message rather than guessing", () => {
    expect(() => parseLockfile(JSON.stringify({ lockfileVersion: 1, dependencies: {} }))).toThrow(/lockfileVersion 1/);
  });

  it("rejects non-lockfiles", () => {
    expect(() => parseLockfile("{}")).toThrow(LockfileError);
    expect(() => parseLockfile("not json")).toThrow(LockfileError);
  });

  it("skips the root, workspace links and bundled deps; uses alias names; flags non-registry sources", () => {
    const deps = parseLockfile(
      lock({
        "packages/ws": { version: "0.0.0" },
        "node_modules/ws": { resolved: "packages/ws", link: true },
        "node_modules/bundled": { version: "1.0.0", inBundle: true },
        "node_modules/alias": { name: "real-pkg", version: "3.0.0", resolved: reg("real-pkg", "3.0.0") },
        "node_modules/g": { version: "1.0.0", resolved: "git+ssh://git@github.com/x/g.git#abc" }
      })
    );
    expect(deps.map((d) => d.name)).toEqual(["g", "real-pkg"]);
    expect(deps.find((d) => d.name === "g")?.registrySource).toBe(false);
  });
});

// ---------------------------------------------------------------- policy

describe("policy", () => {
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "cairn-policy-"));
    dirs.push(d);
    return d;
  };

  it("--fail-on levels are severity thresholds and always include UNKNOWN", () => {
    expect(failOnFromLevel("divergent")).toEqual(["DIVERGENT", "CONTESTED", "UNKNOWN"]);
    expect(failOnFromLevel("unattested")).toContain("UNATTESTED");
  });

  it("forces UNKNOWN into failOn even if the file omits it (fail closed)", () => {
    const f = join(tmp(), "p.json");
    writeFileSync(f, JSON.stringify({ failOn: ["DIVERGENT"] }));
    expect(loadPolicy({ path: f }).failOn).toEqual(["DIVERGENT", "UNKNOWN"]);
  });

  it("drops expired allowlist entries with a note", () => {
    const f = join(tmp(), "p.json");
    writeFileSync(f, JSON.stringify({ allow: [{ name: "x", version: "1.0.0", reason: "r", expires: "2026-01-01" }] }));
    const p = loadPolicy({ path: f, today: new Date("2026-11-21") });
    expect(p.allow).toHaveLength(0);
    expect(p.notes[0]).toMatch(/expired/);
  });

  it("rejects allowlist entries without a reason or expiry", () => {
    const f = join(tmp(), "p.json");
    writeFileSync(f, JSON.stringify({ allow: [{ name: "x", version: "1.0.0" }] }));
    expect(() => loadPolicy({ path: f })).toThrow(ConfigError);
  });

  it("an explicit missing policy path is an error; the default path is optional", () => {
    expect(() => loadPolicy({ path: join(tmp(), "nope.json") })).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------- verdicts

const G = "@cairn-demo/greeting";
const ID = packageId("npm", G, "1.0.0");
const pub = preparePublication({ bytes: CLEAN, ecosystem: "npm", name: G, version: "1.0.0", publisher: PUBLISHER });

function record(over: Partial<OnChainRecord> = {}): OnChainRecord {
  return {
    packageId: ID,
    exists: true,
    artifactDigest: pub.artifactDigest,
    tarballHash: pub.tarballHash,
    payloadDigest: pub.payloadDigest,
    publisher: PUBLISHER,
    submittedAt: 1n,
    corroborations: 3,
    hasQuorum: true,
    threshold: 2,
    attesterCount: 3,
    divergences: [],
    blockNumber: 10n,
    ...over
  };
}

const chainWith = (r: OnChainRecord | Error): RecordReader => ({
  getRecord: async () => {
    if (r instanceof Error) throw r;
    return r;
  }
});
const serving = (b: Uint8Array | Error): ArtifactSource => ({
  fetch: async () => {
    if (b instanceof Error) throw b;
    return { bytes: b, fromCache: false };
  }
});
const payloads: PayloadStore = {
  put: async () => ({ digest: pub.payloadDigest, location: "mem" }),
  get: async (d: Hex) => (d === pub.payloadDigest ? (JSON.parse(JSON.stringify(pub.payload)) as AttestationPayload) : undefined)
};
const LOCK = lock({ [`node_modules/${G}`]: { version: "1.0.0", resolved: "http://reg.test/g.tgz", integrity: sri(CLEAN) } });
const policy = (over: Partial<Policy> = {}): Policy => ({ ...loadPolicy({ path: undefined }), ...over });

async function verify(chain: RecordReader | undefined, artifacts: ArtifactSource, p = policy(), lockText = LOCK) {
  return runVerify(
    { lockfile: "package-lock.json", policy: p, only: [], concurrency: 4 },
    { chain, chainError: chain ? undefined : "chain unreachable", artifacts, payloads, readFile: async () => lockText }
  );
}

describe("verdicts", () => {
  it("PASS: record, digest match, quorum, no divergences → exit 0", async () => {
    const r = await verify(chainWith(record()), serving(CLEAN));
    expect(r.results[0]?.verdict).toBe("PASS");
    expect(r.results[0]?.integrityMatch).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("UNATTESTED: no record → warning, not failure, under the default policy", async () => {
    const r = await verify(chainWith(record({ exists: false })), serving(CLEAN));
    expect(r.results[0]).toMatchObject({ verdict: "UNATTESTED", failing: false, warning: true });
    expect(r.exitCode).toBe(0);
  });

  it("UNDER_QUORUM: fails the default policy → exit 1", async () => {
    const r = await verify(chainWith(record({ corroborations: 1, hasQuorum: false })), serving(CLEAN));
    expect(r.results[0]?.verdict).toBe("UNDER_QUORUM");
    expect(r.exitCode).toBe(1);
  });

  it("policy minCorroborations above the on-chain threshold is enforced", async () => {
    const r = await verify(chainWith(record({ corroborations: 2 })), serving(CLEAN), policy({ minCorroborations: 3 }));
    expect(r.results[0]?.verdict).toBe("UNDER_QUORUM");
  });

  it("DIVERGENT: local bytes differ from the attested digest, with a per-file delta", async () => {
    const r = await verify(chainWith(record()), serving(TAMPERED));
    const d = r.results[0];
    expect(d?.verdict).toBe("DIVERGENT");
    expect(d?.observedDigest).toBe(digestArtifact(TAMPERED).artifactDigest);
    expect(d?.delta).toEqual([
      { path: "index.js", change: "content changed" },
      { path: "lib/format.js", change: "removed" },
      { path: "package.json", change: "content changed" },
      { path: "scripts/postinstall.js", change: "added" }
    ]);
    expect(r.exitCode).toBe(1);
  });

  it("DIVERGENT even when the chain says quorum — local bytes always win", async () => {
    const r = await verify(chainWith(record({ hasQuorum: true, corroborations: 3 })), serving(TAMPERED));
    expect(r.results[0]?.verdict).toBe("DIVERGENT");
  });

  it("CONTESTED: digest matches but attesters recorded divergences", async () => {
    const r = await verify(
      chainWith(record({ hasQuorum: false, divergences: [{ attester: ATTESTER, observedDigest: `0x${"ab".repeat(32)}`, reportedAt: 5n }] })),
      serving(CLEAN)
    );
    expect(r.results[0]?.verdict).toBe("CONTESTED");
    expect(r.exitCode).toBe(1);
  });

  it("UNKNOWN when the chain is unreachable → exit 2, never PASS", async () => {
    const r = await verify(undefined, serving(CLEAN));
    expect(r.results[0]?.verdict).toBe("UNKNOWN");
    expect(r.exitCode).toBe(2);
  });

  it("UNKNOWN when a single chain read or artifact fetch fails", async () => {
    expect((await verify(chainWith(new Error("rpc down")), serving(CLEAN))).results[0]?.verdict).toBe("UNKNOWN");
    const r = await verify(chainWith(record()), serving(new Error("404")));
    expect(r.results[0]?.verdict).toBe("UNKNOWN");
    expect(r.exitCode).toBe(2);
  });

  it("UNKNOWN fails even under --fail-on divergent", async () => {
    const r = await verify(undefined, serving(CLEAN), policy({ failOn: failOnFromLevel("divergent") }));
    expect(r.exitCode).toBe(2);
  });

  it("a fired gate (1) outranks an operational failure (2)", async () => {
    const text = lock({
      [`node_modules/${G}`]: { version: "1.0.0", resolved: "http://reg.test/g.tgz" },
      "node_modules/other": { version: "1.0.0", resolved: "http://reg.test/o.tgz" }
    });
    const chain: RecordReader = {
      getRecord: async (id) => (id === ID ? record() : Promise.reject(new Error("rpc flake")))
    };
    const r = await verify(chain, serving(TAMPERED), policy(), text);
    expect(r.summary).toMatchObject({ DIVERGENT: 1, UNKNOWN: 1 });
    expect(r.exitCode).toBe(1);
  });

  it("an allowlist entry can excuse UNATTESTED but never DIVERGENT", async () => {
    const allow = [{ name: G, version: "1.0.0", reason: "testing", expires: "2099-01-01" }];
    const p = policy({ failOn: failOnFromLevel("unattested"), allow });
    const unattested = await verify(chainWith(record({ exists: false })), serving(CLEAN), p);
    expect(unattested.results[0]).toMatchObject({ verdict: "UNATTESTED", failing: false, allowed: { reason: "testing" } });
    expect(unattested.exitCode).toBe(0);
    const divergent = await verify(chainWith(record()), serving(TAMPERED), p);
    expect(divergent.results[0]).toMatchObject({ verdict: "DIVERGENT", failing: true, allowed: undefined });
    expect(divergent.exitCode).toBe(1);
  });

  it("non-registry sources are UNATTESTED without any network access", async () => {
    const text = lock({ "node_modules/g": { version: "1.0.0", resolved: "git+https://github.com/x/g.git#abc" } });
    const r = await verify(chainWith(new Error("must not be called")), serving(new Error("must not fetch")), policy(), text);
    expect(r.results[0]).toMatchObject({ verdict: "UNATTESTED" });
  });

  it("--only restricts by name pattern", async () => {
    const r = await runVerify(
      { lockfile: "x", policy: policy(), only: ["@cairn-demo/*"], concurrency: 2 },
      { chain: chainWith(record()), artifacts: serving(CLEAN), readFile: async () => lock({
          [`node_modules/${G}`]: { version: "1.0.0", resolved: "http://reg.test/g.tgz" },
          "node_modules/other": { version: "1.0.0", resolved: "http://reg.test/o.tgz" }
        }) }
    );
    expect(r.results.map((x) => x.name)).toEqual([G]);
  });
});

describe("integrity and rendering", () => {
  it("checkIntegrity accepts matching SRI, rejects mismatches, ignores absent", () => {
    expect(checkIntegrity(CLEAN, sri(CLEAN))).toBe(true);
    expect(checkIntegrity(TAMPERED, sri(CLEAN))).toBe(false);
    expect(checkIntegrity(CLEAN, undefined)).toBeUndefined();
  });

  it("renders BLOCKED with the delta, and no ANSI when colour is off", async () => {
    const text = renderVerify(await verify(chainWith(record()), serving(TAMPERED)), createStyle(false));
    expect(text).toContain("DIVERGENT");
    expect(text).toContain("scripts/postinstall.js");
    expect(text).toContain("BLOCKED");
    expect(text.includes("\u001b[")).toBe(false);
  });

  it("the JSON report has the cairn.verify.v1 shape", async () => {
    const r = await verify(chainWith(record()), serving(CLEAN));
    expect(JSON.parse(JSON.stringify(r, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v)))).toMatchObject({
      schema: "cairn.verify.v1",
      checked: 1,
      summary: { PASS: 1 },
      exitCode: 0
    });
  });
});

describe("batched chain reads and digest cache", () => {
  const LOCK2 = lock({
    [`node_modules/${G}`]: { version: "1.0.0", resolved: "http://reg.test/g.tgz" },
    "node_modules/other": { version: "1.0.0", resolved: "http://reg.test/o.tgz" }
  });

  it("uses one getRecords batch and never the per-package read", async () => {
    let batches = 0;
    const chain: RecordReader = {
      getRecord: async () => {
        throw new Error("per-package read must not be used when a batch is available");
      },
      getRecords: async (ids) => {
        batches++;
        return new Map(ids.map((id) => [id, id === ID ? record() : record({ packageId: id, exists: false })]));
      }
    };
    const r = await verify(chain, serving(CLEAN), policy(), LOCK2);
    expect(batches).toBe(1);
    expect(r.summary).toMatchObject({ PASS: 1, UNATTESTED: 1 });
  });

  it("a failed batch fails closed: every dependency UNKNOWN, exit 2", async () => {
    const chain: RecordReader = {
      getRecord: async () => record(),
      getRecords: async () => {
        throw new Error("rate limited");
      }
    };
    const r = await verify(chain, serving(CLEAN), policy(), LOCK2);
    expect(r.summary).toEqual({ UNKNOWN: 2 });
    expect(r.exitCode).toBe(2);
  });

  it("a digest-cache hit skips canonicalisation but still catches divergence and builds the delta", async () => {
    const store = new Map<string, `0x${string}`>();
    const digests = { get: (h: `0x${string}`) => store.get(h), set: (h: `0x${string}`, d: `0x${string}`) => void store.set(h, d) };
    const run = () =>
      runVerify(
        { lockfile: "x", policy: policy(), only: [], concurrency: 2 },
        { chain: chainWith(record()), artifacts: serving(TAMPERED), payloads, digests, readFile: async () => LOCK }
      );
    const first = await run();
    expect(store.size).toBe(1);
    const second = await run();
    expect(second.results[0]?.verdict).toBe("DIVERGENT");
    expect(second.results[0]?.observedDigest).toBe(first.results[0]?.observedDigest);
    expect(second.results[0]?.delta?.some((d) => d.path === "scripts/postinstall.js")).toBe(true);
  });
});
