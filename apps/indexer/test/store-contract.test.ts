// The same behavioural contract, run against every IndexStore implementation.
// MongoStore runs only when MONGODB_TEST_URI is set (e.g. `pnpm db:up` then
// MONGODB_TEST_URI=mongodb://127.0.0.1:27018 pnpm --filter @cairn/indexer test), so the
// default unit run stays free of network services (CLAUDE.md invariant 6).
import { MongoClient } from "mongodb";
import type { Address, Hex } from "viem";
import { afterAll, describe, expect, it } from "vitest";
import { MongoStore } from "../src/mongo-store.js";
import { projectAttestation } from "../src/projection.js";
import { MemoryStore, type IndexStore } from "../src/store.js";
import type { IndexedEvent } from "../src/types.js";

const MONGO = process.env.MONGODB_TEST_URI;
const dbName = `cairn_test_${process.pid}_${Date.now()}`;
const opened: MongoStore[] = [];

afterAll(async () => {
  for (const s of opened) await s.close();
  if (MONGO) {
    const c = new MongoClient(MONGO);
    await c.connect();
    await c.db(dbName).dropDatabase();
    await c.close();
  }
});

const factories: [string, () => Promise<IndexStore>, boolean][] = [
  ["MemoryStore", async () => new MemoryStore(), true],
  [
    "MongoStore",
    async () => {
      const s = await MongoStore.connect(MONGO as string, dbName);
      opened.push(s);
      await s.reset();
      return s;
    },
    MONGO !== undefined
  ]
];

const P1 = `0x${"01".repeat(32)}` as Hex;
const P2 = `0x${"02".repeat(32)}` as Hex;
const A = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const D = `0x${"aa".repeat(32)}` as Hex;

let seq = 0;
function ev(type: IndexedEvent["type"], block: number, packageId?: Hex, data: IndexedEvent["data"] = {}): IndexedEvent {
  seq++;
  const txHash = `0x${seq.toString(16).padStart(64, "0")}` as Hex;
  return { id: `${txHash}:0`, type, packageId, actor: A, data, blockNumber: block, blockHash: D, txHash, logIndex: 0, timestamp: new Date(block * 1000).toISOString() };
}
const submitted = (id: Hex, name: string, block: number) =>
  ev("AttestationSubmitted", block, id, { ecosystem: "npm", name, version: "1.0.0", artifactDigest: D, tarballHash: D, payloadDigest: D });

describe.each(factories)("%s", (_name, make, enabled) => {
  it.skipIf(!enabled)("meta round-trips", async () => {
    const s = await make();
    expect(await s.getMeta()).toBeUndefined();
    await s.setMeta({ chainId: 31337, registry: A, lastIndexedBlock: 7, lastIndexedHash: D });
    await s.setMeta({ chainId: 31337, registry: A, lastIndexedBlock: 9, lastIndexedHash: null });
    expect(await s.getMeta()).toEqual({ chainId: 31337, registry: A, lastIndexedBlock: 9, lastIndexedHash: null });
    expect(await s.ping()).toBe(true);
  });

  it.skipIf(!enabled)("insertEvents is idempotent by id and returns chain order", async () => {
    const s = await make();
    const e1 = submitted(P1, "a", 2);
    const e2 = ev("AttesterCorroborated", 3, P1, { corroborations: 1, quorumReached: false });
    await s.insertEvents([e2, e1]);
    await s.insertEvents([e1, e2]);
    const got = await s.eventsForPackage(P1);
    expect(got.map((e) => e.id)).toEqual([e1.id, e2.id]);
    expect(got[1]?.data).toEqual({ corroborations: 1, quorumReached: false });
  });

  it.skipIf(!enabled)("deleteEventsAfter removes later blocks and reports touched packages", async () => {
    const s = await make();
    await s.insertEvents([submitted(P1, "a", 2), submitted(P2, "b", 5), ev("DivergenceReported", 6, P1, { observedDigest: D })]);
    const touched = await s.deleteEventsAfter(4);
    expect(touched.sort()).toEqual([P1, P2].sort());
    expect(await s.eventsForPackage(P2)).toHaveLength(0);
    expect(await s.eventsForPackage(P1)).toHaveLength(1);
  });

  it.skipIf(!enabled)("eventsOfTypes filters, orders and limits", async () => {
    const s = await make();
    await s.insertEvents([ev("DivergenceReported", 3, P1), ev("AttesterAdded", 1), ev("DivergenceReported", 5, P2)]);
    const newest = await s.eventsOfTypes(["DivergenceReported"], { newestFirst: true, limit: 1 });
    expect(newest.map((e) => e.blockNumber)).toEqual([5]);
    expect((await s.eventsOfTypes(["AttesterAdded", "DivergenceReported"])).map((e) => e.blockNumber)).toEqual([1, 3, 5]);
  });

  it.skipIf(!enabled)("attestations: put, get, lookup, list (divergent pinned, filters, search), counts", async () => {
    const s = await make();
    const verified = projectAttestation([submitted(P1, "left-pad", 2), ev("AttesterCorroborated", 3, P1, { corroborations: 2, quorumReached: true })]);
    const divergent = projectAttestation([submitted(P2, "@cairn-demo/greeting", 1), ev("DivergenceReported", 2, P2, { observedDigest: D })]);
    await s.putAttestation(verified!);
    await s.putAttestation(divergent!);
    await s.putAttestation(verified!); // replace, not duplicate

    expect((await s.getAttestation(P1))?.status).toBe("VERIFIED");
    expect((await s.findByNameVersion("@cairn-demo/greeting", "1.0.0"))?._id).toBe(P2);
    expect((await s.listAttestations({ limit: 10 })).map((d) => d.status)).toEqual(["DIVERGENT", "VERIFIED"]);
    expect((await s.listAttestations({ limit: 10, status: "VERIFIED" })).map((d) => d._id)).toEqual([P1]);
    expect((await s.listAttestations({ limit: 10, q: "LEFT" })).map((d) => d._id)).toEqual([P1]);
    expect((await s.listAttestations({ limit: 10, q: "a.b(" })).length).toBe(0); // regex-special input is literal
    expect(await s.counts()).toEqual({ total: 2, verified: 1, pending: 0, divergent: 1 });

    expect((await s.findByName("left-pad")).map((d) => d._id)).toEqual([P1]);
    expect((await s.searchByName("GREET", 10)).map((d) => d._id)).toEqual([P2]);
    expect((await s.searchByName(undefined, 10)).length).toBe(2);
    await s.deleteAttestation(P1);
    expect(await s.getAttestation(P1)).toBeUndefined();
  });

  it.skipIf(!enabled)("reset clears everything", async () => {
    const s = await make();
    await s.insertEvents([submitted(P1, "a", 2)]);
    await s.setMeta({ chainId: 1, registry: A, lastIndexedBlock: 2, lastIndexedHash: D });
    await s.reset();
    expect(await s.getMeta()).toBeUndefined();
    expect(await s.eventsForPackage(P1)).toHaveLength(0);
  });
});
