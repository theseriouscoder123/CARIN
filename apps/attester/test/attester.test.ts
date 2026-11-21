import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as core from "@cairn/core";
import { RegistryError, TransactionError, digestArtifact, type RegistryAdapter } from "@cairn/core";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { writeTar } from "../../../packages/core/test/helpers/tar.js";
import * as attesterModule from "../src/attester.js";
import { Attester, FatalAttesterError, type ChainPort, type SubmittedEvent } from "../src/attester.js";
import { loadConfig } from "../src/config.js";
import { MemoryStateStore } from "../src/state.js";

const CLEAN = readFileSync(
  fileURLToPath(new URL("../../../packages/core/test/fixtures/cairn-demo-greeting-1.0.0.tgz", import.meta.url))
);
const TAMPERED = writeTar([
  { path: "package/package.json", data: '{"name":"@cairn-demo/greeting","version":"1.0.0"}' },
  { path: "package/index.js", data: "module.exports = 1;\n" },
  { path: "package/scripts/postinstall.js", data: "// simulated payload\n" }
]);
const CLEAN_DIGEST = digestArtifact(CLEAN).artifactDigest;
const TAMPERED_DIGEST = digestArtifact(TAMPERED).artifactDigest;

const ME = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const PUBLISHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const PKG = core.packageId("npm", "@cairn-demo/greeting", "1.0.0");

const event = (over: Partial<SubmittedEvent> = {}): SubmittedEvent => ({
  packageId: PKG,
  publisher: PUBLISHER,
  artifactDigest: CLEAN_DIGEST,
  ecosystem: "npm",
  name: "@cairn-demo/greeting",
  version: "1.0.0",
  blockNumber: 3n,
  ...over
});

/** Hand-written fake chain recording every corroborate() call. */
class FakeChain implements ChainPort {
  readonly chainId = 31337;
  readonly registry = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
  readonly address = ME;
  calls: { packageId: Hex; observed: Hex }[] = [];
  events: SubmittedEvent[] = [];
  head = 10n;
  failWith: Error | undefined;
  async headBlock() {
    return this.head;
  }
  async submittedEvents(from: bigint, to: bigint) {
    return this.events.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
  }
  async corroborate(packageId: Hex, observed: Hex) {
    if (this.failWith) throw this.failWith;
    this.calls.push({ packageId, observed });
    return `0x${String(this.calls.length).padStart(64, "0")}` as Hex;
  }
}

/** Fake registry whose served bytes can be swapped mid-test (the republication). */
class FakeRegistry implements RegistryAdapter {
  readonly ecosystem = "npm" as const;
  served: Uint8Array | undefined = CLEAN;
  fetches = 0;
  async resolve(name: string, version: string) {
    if (this.served === undefined) throw new RegistryError(`404 ${name}@${version}`, { status: 404 });
    return { ecosystem: "npm" as const, name, version, tarballUrl: "http://reg.test/x.tgz" };
  }
  async fetch() {
    this.fetches++;
    if (this.served === undefined) throw new RegistryError("404", { status: 404 });
    return this.served;
  }
}

function setup(store = new MemoryStateStore()) {
  const chain = new FakeChain();
  const registry = new FakeRegistry();
  const attester = new Attester(
    { chain, registry, store, sleep: async () => {}, random: () => 0 },
    { label: "attester-a", startBlock: 1 }
  );
  return { chain, registry, store, attester };
}

describe("match path", () => {
  it("corroborates with the digest it computed itself", async () => {
    const { chain, attester } = setup();
    const r = await attester.handleEvent(event());
    expect(r.action).toBe("corroborated");
    expect(chain.calls).toEqual([{ packageId: PKG, observed: CLEAN_DIGEST }]);
  });
});

describe("mismatch path", () => {
  it("reports the observed digest when the registry serves different bytes", async () => {
    const { chain, registry, attester } = setup();
    registry.served = TAMPERED;
    const r = await attester.handleEvent(event());
    expect(r.action).toBe("diverged");
    expect(chain.calls).toEqual([{ packageId: PKG, observed: TAMPERED_DIGEST }]);
    expect(attester.stats.divergencesReported).toBe(1);
  });
});

describe("self-skip", () => {
  it("an attester that is the publisher submits nothing and fetches nothing", async () => {
    const { chain, registry, attester } = setup();
    const r = await attester.handleEvent(event({ publisher: ME }));
    expect(r.action).toBe("skipped-self");
    expect(chain.calls).toHaveLength(0);
    expect(registry.fetches).toBe(0);
  });
});

describe("idempotency", () => {
  it("a restart with the same store does not resubmit", async () => {
    const store = new MemoryStateStore();
    const first = setup(store);
    first.chain.events = [event()];
    await first.attester.sync();
    expect(first.chain.calls).toHaveLength(1);

    const second = setup(store);
    second.chain.events = [event()];
    await second.attester.sync();
    await second.attester.handleEvent(event());
    expect(second.chain.calls).toHaveLength(0);
    expect(second.attester.stats.lastProcessedBlock).toBe(10);
  });

  it("state from a different chain deployment is discarded", async () => {
    const store = new MemoryStateStore();
    store.state = { chainId: 31337, registry: "0x0000000000000000000000000000000000000001", lastProcessedBlock: 99, packages: {} };
    const { attester } = setup(store);
    expect(attester.stats.lastProcessedBlock).toBe(0);
  });

  it("AlreadyCorroborated from the chain (lost local state) is treated as success", async () => {
    const { chain, attester } = setup();
    chain.failWith = new TransactionError("would revert", { errorName: "AlreadyCorroborated" });
    const r = await attester.handleEvent(event());
    expect(r.action).toBe("already-done");
    expect(attester.packages[PKG]?.corroborated).toBe(true);
  });
});

describe("unreachable registry", () => {
  it("retries, records UNREACHABLE locally, and writes nothing on-chain", async () => {
    const { chain, registry, attester } = setup();
    registry.served = undefined;
    const r = await attester.handleEvent(event());
    expect(r.action).toBe("unreachable");
    expect(chain.calls).toHaveLength(0);
    expect(attester.stats.registryReachable).toBe(false);
    expect(attester.packages[PKG]?.outcome).toBe("unreachable");
  });

  it("an unreachable package is retried on the next re-check and then corroborated", async () => {
    const { chain, registry, attester } = setup();
    registry.served = undefined;
    await attester.handleEvent(event());
    registry.served = CLEAN;
    await attester.recheck();
    expect(chain.calls).toEqual([{ packageId: PKG, observed: CLEAN_DIGEST }]);
  });
});

describe("divergence monitor", () => {
  it("catches republication after corroboration, and reports it only once", async () => {
    const { chain, registry, attester } = setup();
    await attester.handleEvent(event());
    expect((await attester.recheck(PKG))[0]?.action).toBe("unchanged");

    registry.served = TAMPERED; // attest at T0, tamper at T1
    expect((await attester.recheck(PKG))[0]?.action).toBe("diverged");
    expect((await attester.recheck(PKG))[0]?.action).toBe("unchanged");
    expect(chain.calls.map((c) => c.observed)).toEqual([CLEAN_DIGEST, TAMPERED_DIGEST]);
  });
});

describe("fatal policy errors", () => {
  it("NotAnAttester stops the attester", async () => {
    const { chain, attester } = setup();
    chain.failWith = new TransactionError("would revert", { errorName: "NotAnAttester" });
    await expect(attester.handleEvent(event())).rejects.toThrow(FatalAttesterError);
  });
});

describe("core parity", () => {
  it("the attester module uses the exact digest function the CLI uses", async () => {
    const src = readFileSync(fileURLToPath(new URL("../src/attester.ts", import.meta.url)), "utf8");
    expect(src).toMatch(/digestArtifact\(bytes\)\.artifactDigest/);
    expect(src).not.toMatch(/computeArtifactDigest|canonicaliseTarball|createHash/);
    expect(attesterModule).toBeDefined();
  });

  it("the attester's observed digest equals cairn publish's artifactDigest for the same bytes", async () => {
    const { chain, attester } = setup();
    await attester.handleEvent(event());
    const pub = core.preparePublication({
      bytes: CLEAN,
      ecosystem: "npm",
      name: "@cairn-demo/greeting",
      version: "1.0.0",
      publisher: PUBLISHER
    });
    expect(chain.calls[0]?.observed).toBe(pub.artifactDigest);
  });
});

describe("config", () => {
  const ok = { CAIRN_ATTESTER_KEY: "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", CAIRN_ATTESTER_LABEL: "attester-a" };

  it("refuses to start without a key and never echoes the key", () => {
    expect(() => loadConfig({ CAIRN_ATTESTER_LABEL: "a" })).toThrow(/CAIRN_ATTESTER_KEY/);
    try {
      loadConfig({ ...ok, CAIRN_ATTESTER_KEY: "secret-not-hex" });
    } catch (e) {
      expect((e as Error).message).not.toContain("secret-not-hex");
    }
  });

  it("applies defaults", () => {
    const c = loadConfig(ok);
    expect(c).toMatchObject({ port: 4001, recheckIntervalSec: 300, label: "attester-a" });
    expect(c.key.startsWith("0x")).toBe(true);
  });
});

describe("provider log-range caps", () => {
  it("shrinks the getLogs range until the provider accepts it, and processes every event", async () => {
    const store = new MemoryStateStore();
    const chain = new FakeChain();
    chain.head = 5000n;
    chain.events = [event({ blockNumber: 4321n })];
    const ranges: bigint[] = [];
    const original = chain.submittedEvents.bind(chain);
    chain.submittedEvents = async (from, to) => {
      ranges.push(to - from + 1n);
      if (to - from + 1n > 200n) throw new Error("eth_getLogs is limited to a 200 range");
      return original(from, to);
    };
    const attester = new Attester({ chain, registry: new FakeRegistry(), store, sleep: async () => {}, random: () => 0 }, { label: "a", startBlock: 1, blockChunk: 2000 });
    await attester.sync();
    expect(ranges.slice(0, 5)).toEqual([2000n, 1000n, 500n, 250n, 125n]);
    expect(chain.calls).toHaveLength(1);
    expect(attester.stats.lastProcessedBlock).toBe(5000);
  });
});
