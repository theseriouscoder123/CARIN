import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { packageId } from "@cairn/core";
import type { Address, Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/api.js";
import { Ingester, type ChainSource } from "../src/ingest.js";
import { projectAttestation } from "../src/projection.js";
import { MemoryStore } from "../src/store.js";
import type { EventType, IndexedEvent } from "../src/types.js";

const REGISTRY = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const PUBLISHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const A = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const B = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
const C = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address;
const PKG = packageId("npm", "@cairn-demo/greeting", "1.0.0").toLowerCase() as Hex;
const PKG2 = packageId("npm", "left-pad", "1.3.0").toLowerCase() as Hex;
const D = `0x${"aa".repeat(32)}` as Hex;
const EVIL = `0x${"ee".repeat(32)}` as Hex;

let n = 0;
function ev(type: EventType, block: number, over: Partial<IndexedEvent> = {}): IndexedEvent {
  n++;
  const txHash = `0x${n.toString(16).padStart(64, "0")}` as Hex;
  return { id: `${txHash}:0`, type, data: {}, blockNumber: block, blockHash: `0x${block.toString(16).padStart(64, "0")}` as Hex, txHash, logIndex: 0, timestamp: new Date(1_700_000_000_000 + block * 1000).toISOString(), ...over };
}
const submitted = (id: Hex, name: string, block: number) =>
  ev("AttestationSubmitted", block, { packageId: id, actor: PUBLISHER, data: { ecosystem: "npm", name, version: name === "left-pad" ? "1.3.0" : "1.0.0", artifactDigest: D, tarballHash: D, payloadDigest: D } });
const corroborated = (id: Hex, who: Address, count: number, quorum: boolean, block: number) =>
  ev("AttesterCorroborated", block, { packageId: id, actor: who, data: { corroborations: count, quorumReached: quorum } });
const diverged = (id: Hex, who: Address, block: number) =>
  ev("DivergenceReported", block, { packageId: id, actor: who, data: { expectedDigest: D, observedDigest: EVIL } });
const policy = (block: number) => [
  ev("AttesterAdded", block, { actor: A }),
  ev("AttesterAdded", block, { actor: B }),
  ev("AttesterAdded", block, { actor: C }),
  ev("ThresholdChanged", block, { data: { previousThreshold: 0, newThreshold: 2 } })
];

/** Fake chain: a list of events plus per-block hashes that a test can rewrite. */
class FakeChain implements ChainSource {
  readonly chainId = 31337;
  readonly registry = REGISTRY;
  events: IndexedEvent[] = [];
  height = 0;
  salt = "0";
  calls: [number, number][] = [];
  async head() {
    return this.height;
  }
  async blockHash(b: number) {
    return `0x${this.salt}${b.toString(16).padStart(63, "0")}` as Hex;
  }
  async logs(from: number, to: number) {
    this.calls.push([from, to]);
    return this.events.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
  }
}

function setup() {
  const chain = new FakeChain();
  const store = new MemoryStore();
  const ingester = new Ingester(chain, store, { startBlock: 1, chunk: 3 });
  return { chain, store, ingester };
}

describe("projection", () => {
  it("folds corroborations into VERIFIED at quorum", () => {
    const doc = projectAttestation([submitted(PKG, "@cairn-demo/greeting", 2), corroborated(PKG, A, 1, false, 3), corroborated(PKG, B, 2, true, 4)]);
    expect(doc).toMatchObject({ corroborations: 2, quorumReached: true, status: "VERIFIED", publisher: PUBLISHER });
  });

  it("a divergence makes it DIVERGENT and revokes quorum, as the contract does", () => {
    const doc = projectAttestation([submitted(PKG, "@cairn-demo/greeting", 2), corroborated(PKG, A, 1, false, 3), corroborated(PKG, B, 2, true, 4), diverged(PKG, C, 5)]);
    expect(doc).toMatchObject({ status: "DIVERGENT", quorumReached: false, divergenceCount: 1, corroborations: 2 });
  });

  it("no submission event means no document", () => {
    expect(projectAttestation([corroborated(PKG, A, 1, false, 3)])).toBeUndefined();
  });
});

describe("ingestion", () => {
  it("is idempotent: replaying the same logs yields one document and one event each", async () => {
    const { chain, store, ingester } = setup();
    chain.events = [...policy(1), submitted(PKG, "@cairn-demo/greeting", 2), corroborated(PKG, A, 1, false, 3)];
    chain.height = 3;
    await ingester.tick();
    await store.insertEvents(chain.events); // a replay
    await ingester.tick();
    expect(await store.eventsForPackage(PKG)).toHaveLength(2);
    expect((await store.counts()).total).toBe(1);
  });

  it("checkpoints per batch and resumes from the right block", async () => {
    const { chain, store, ingester } = setup();
    chain.events = [...policy(1), submitted(PKG, "@cairn-demo/greeting", 2)];
    chain.height = 7;
    await ingester.tick();
    expect(chain.calls).toEqual([[1, 3], [4, 6], [7, 7]]);
    expect((await store.getMeta())?.lastIndexedBlock).toBe(7);

    chain.calls = [];
    const resumed = new Ingester(chain, store, { startBlock: 1, chunk: 3 });
    chain.events.push(corroborated(PKG, A, 1, false, 9));
    chain.height = 9;
    await resumed.tick();
    expect(chain.calls).toEqual([[8, 9]]);
    expect((await store.getAttestation(PKG))?.corroborations).toBe(1);
  });

  it("a changed block hash (reorg / restarted chain) rolls back and rebuilds cleanly", async () => {
    const { chain, store, ingester } = setup();
    chain.events = [...policy(1), submitted(PKG, "@cairn-demo/greeting", 2), diverged(PKG, A, 3)];
    chain.height = 3;
    await ingester.tick();
    expect((await store.getAttestation(PKG))?.status).toBe("DIVERGENT");

    // the chain is replaced: the divergence never happened on the new history
    chain.salt = "1";
    chain.events = [...policy(1), submitted(PKG, "@cairn-demo/greeting", 2), corroborated(PKG, A, 1, false, 3)];
    await ingester.tick();
    const doc = await store.getAttestation(PKG);
    expect(doc).toMatchObject({ status: "PENDING", divergenceCount: 0, corroborations: 1 });
    expect(await store.eventsOfTypes(["DivergenceReported"])).toHaveLength(0);
  });

  it("an RPC failure during the checkpoint check leaves the index untouched", async () => {
    const { chain, store, ingester } = setup();
    chain.events = [...policy(1), submitted(PKG, "@cairn-demo/greeting", 2), diverged(PKG, A, 3)];
    chain.height = 3;
    await ingester.tick();
    chain.blockHash = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(ingester.tick()).rejects.toThrow("ECONNREFUSED");
    expect((await store.getAttestation(PKG))?.status).toBe("DIVERGENT");
    expect((await store.getMeta())?.lastIndexedBlock).toBe(3);
  });

  it("a chain head behind the checkpoint (Hardhat restarted) triggers a rebuild", async () => {
    const { chain, store, ingester } = setup();
    chain.events = [...policy(1), submitted(PKG, "@cairn-demo/greeting", 2)];
    chain.height = 10;
    await ingester.tick();
    chain.events = [...policy(1)];
    chain.height = 1;
    await ingester.tick();
    expect((await store.counts()).total).toBe(0);
  });
});

// ------------------------------------------------------------------ API

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any; // response bodies in assertions; shapes are checked by toMatchObject
const json = async (r: Response): Promise<Json> => r.json();

let server: Server | undefined;
afterEach(() => server?.close());

async function api(opts: { head?: number; last?: number; lagThreshold?: number } = {}) {
  const { chain, store, ingester } = setup();
  chain.events = [
    ...policy(1),
    submitted(PKG2, "left-pad", 2),
    corroborated(PKG2, A, 1, false, 3),
    corroborated(PKG2, B, 2, true, 3),
    submitted(PKG, "@cairn-demo/greeting", 4),
    corroborated(PKG, A, 1, false, 5),
    corroborated(PKG, B, 2, true, 5),
    diverged(PKG, C, 6)
  ];
  chain.height = 6;
  await ingester.tick();
  const ing = { headBlock: opts.head ?? ingester.headBlock, lastIndexedBlock: opts.last ?? ingester.lastIndexedBlock };
  const app = createApi({
    store,
    ingester: ing,
    corsOrigins: ["http://localhost:3000"],
    lagThreshold: opts.lagThreshold ?? 50,
    chain: { chainId: 31337, registry: REGISTRY },
    attesterHealth: async () => [
      { url: "http://a", health: { label: "attester-a", address: A, lastProcessedBlock: 6, processedCount: 2, divergencesReported: 0, registryReachable: true, chainReachable: true, uptimeSeconds: 5 } },
      { url: "http://b", error: "ECONNREFUSED" }
    ]
  });
  server = app.listen(0);
  await new Promise((r) => server!.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  return (path: string, init?: RequestInit) => fetch(`${base}${path}`, init);
}

describe("API", () => {
  it("/stats totals come from indexed events", async () => {
    const get = await api();
    const s = await json(await get("/stats"));
    expect(s).toMatchObject({ totalAttestations: 2, quorumReached: 1, divergent: 1, pending: 0, activeAttesters: 3, threshold: 2, asOfBlock: 6 });
  });

  it("/packages pins divergent packages to the top", async () => {
    const get = await api();
    const body = await json(await get("/packages"));
    expect(body.items.map((d: { name: string; status: string }) => `${d.name}:${d.status}`)).toEqual(["@cairn-demo/greeting:DIVERGENT", "left-pad:VERIFIED"]);
  });

  it("/packages/:id returns the record with divergences; timeline is newest first", async () => {
    const get = await api();
    const rec = await json(await get(`/packages/${PKG}`));
    expect(rec).toMatchObject({ name: "@cairn-demo/greeting", status: "DIVERGENT", divergences: [{ attester: C, observedDigest: EVIL }] });
    const tl = await json(await get(`/packages/${PKG}/timeline`));
    expect(tl.events.map((e: { type: string }) => e.type)).toEqual(["DivergenceReported", "AttesterCorroborated", "AttesterCorroborated", "AttestationSubmitted"]);
  });

  it("zod rejects malformed input with 400, never 500", async () => {
    const get = await api();
    for (const path of ["/packages/0x123", "/packages?limit=0", "/packages?status=GREEN", "/lookup?name=x", "/divergences?limit=-1"]) {
      const res = await get(path);
      expect(res.status, path).toBe(400);
      expect((await json(res)).error.code).toBe("BAD_REQUEST");
    }
  });

  it("unknown package is 404 with the error shape", async () => {
    const get = await api();
    const res = await get(`/packages/0x${"00".repeat(32)}`);
    expect(res.status).toBe(404);
    expect((await json(res)).error).toMatchObject({ code: "NOT_FOUND" });
  });

  it("is read-only: writes are refused", async () => {
    const get = await api();
    expect((await get("/packages", { method: "POST", body: "{}" })).status).toBe(405);
  });

  it("/health is 503 when lag exceeds the threshold", async () => {
    const get = await api({ head: 200, last: 6, lagThreshold: 50 });
    const res = await get("/health");
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ ok: false, lag: 194 });
  });

  it("/attesters merges the on-chain set with live health and reports the unreachable", async () => {
    const get = await api();
    const body = await json(await get("/attesters"));
    expect(body.threshold).toBe(2);
    expect(body.attesters).toHaveLength(3);
    const a = body.attesters.find((x: { address: string }) => x.address === A);
    expect(a).toMatchObject({ label: "attester-a", online: true, corroborationCount: 2 });
    expect(body.attesters.find((x: { address: string }) => x.address === C)).toMatchObject({ online: false, divergenceCount: 1 });
    expect(body.unreachable).toEqual([{ url: "http://b", error: "ECONNREFUSED" }]);
    expect(body.healthConfigured).toBe(true);
  });

  it("/lookup resolves a name to its packageId and indexed status", async () => {
    const get = await api();
    expect(await json(await get("/lookup?name=left-pad&version=1.3.0"))).toMatchObject({ packageId: PKG2, indexed: true, status: "VERIFIED" });
    expect(await json(await get("/lookup?name=ms&version=2.1.3"))).toMatchObject({ indexed: false });
  });

  it("CORS allows only the configured dashboard origin", async () => {
    const get = await api();
    const ok = await get("/stats", { headers: { origin: "http://localhost:3000" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const no = await get("/stats", { headers: { origin: "http://evil.test" } });
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("clientChainSource.blockHash", () => {
  async function sourceWith(getBlock: () => Promise<{ hash: Hex }>) {
    const { clientChainSource } = await import("../src/ingest.js");
    const { BlockNotFoundError } = await import("viem");
    const fake = {
      chainId: 31337,
      registry: REGISTRY,
      quorumPolicyAddress: async () => REGISTRY,
      public: { getBlock }
    } as unknown as Parameters<typeof clientChainSource>[0];
    return { src: await clientChainSource(fake), BlockNotFoundError };
  }

  it("propagates RPC failures instead of reporting a changed hash", async () => {
    const { src } = await sourceWith(async () => {
      throw new Error("fetch failed");
    });
    await expect(src.blockHash(5)).rejects.toThrow("fetch failed");
  });

  it("reports a genuinely missing block as undefined", async () => {
    const { BlockNotFoundError } = await import("viem");
    const { src } = await sourceWith(async () => {
      throw new BlockNotFoundError({ blockNumber: 5n });
    });
    expect(await src.blockHash(5)).toBeUndefined();
  });
});
